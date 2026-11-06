# 定案的 BGM 切循環點、統一響度、壓成 mp3，寫進 data/audio/ 與 manifest.json
#
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/bgm_loop.py
# 輸入：art/bakeoff/bgm/<曲目 id>/<FINAL 的檔名>.flac（art/bgm.py 生成）
# 輸出：data/audio/bgm/<曲目 id>.mp3、data/audio/manifest.json 的 bgm；
#       art/bakeoff/bgm/seams/<曲目 id>.flac（接縫試聽：循環終點前 8 秒接回起點後 8 秒，不進 repo）
#
# 做法：循環長度取整數小節（BPM 來自 art/bgm.py 的 TRACKS），在前段找起點 A、後段找終點 B，
# 選兩邊前後各 1.5 秒頻譜最像的一組，再用波形相關把 B 對齊到 ±50ms 內最吻合的位置。
# 接縫：B 之前 1 秒和 A 之前 1 秒等功率交叉淡化，播到 B 跳回 A 時，聽到的正好是原本接在 A 前面的聲音。
# 音檔到 B 為止，manifest 的 loopStart = A、loopEnd = B（audio.ts 用 AudioBufferSourceNode 的 loop 播）。
import json
import sys
from pathlib import Path

import numpy as np
import pyloudnorm
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from bgm import OUT as CANDIDATES, TRACKS  # noqa: E402

ROOT = Path(__file__).parent.parent
AUDIO = ROOT / 'data' / 'audio'
SEAMS = CANDIDATES / 'seams'

# 11/06 Roger 定案（評分見 docs/design.md「聲音」）
FINAL = {
    'map': 's1',
    'library': 's6',
    'theme_jingcheng': 's1',
    'theme_yiqing': 'v2_s1',
    'theme_ying': 's8',
    'theme_zhixun': 's5',
    'theme_fei': 'v2_s2',
}

FADE = 1.0  # 秒
LUFS = -20.0  # BGM 預設音量 0.4 再往下壓，-20 夠了；各首一致比絕對值重要
PEAK = 10 ** (-1 / 20)  # -1 dBFS


def features(mono, sr, hop=512, n=2048, bands=48):
    """每一格的對數頻帶能量（簡化的 mel），正規化後拿來算餘弦相似度"""
    win = np.hanning(n)
    frames = np.lib.stride_tricks.sliding_window_view(mono, n)[::hop] * win
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    edges = np.geomspace(40, sr / 2, bands + 1) / (sr / 2) * (spec.shape[1] - 1)
    feat = np.stack([spec[:, int(a):max(int(b), int(a) + 1)].sum(1) for a, b in zip(edges[:-1], edges[1:])], 1)
    feat = np.log1p(feat * 1e4)
    feat -= feat.mean(1, keepdims=True)
    return feat / (np.linalg.norm(feat, axis=1, keepdims=True) + 1e-9), hop / sr


def best_loop(mono, sr, bpm, beats):
    feat, dt = features(mono, sr)
    bar = 60 / bpm * beats
    dur = len(mono) / sr
    ctx = int(1.5 / dt)

    def sim(a, b):
        i, j = int(a / dt), int(b / dt)
        return float((feat[i - ctx:i + ctx] * feat[j - ctx:j + ctx]).sum(1).mean())

    best = (-1.0, 0.0, 0.0)
    for a in np.arange(6.0, 25.0, 0.05):
        for k in range(1, 200):
            b = a + k * bar
            if b > dur - 4:
                break
            if b - a < 55:  # 循環至少 55 秒，才不會一直聽到同一段
                continue
            s = sim(a, b)
            if s > best[0]:
                best = (s, a, b)
    score, a, b = best

    # 細調：B 在 ±50ms 內找和 A 附近波形最吻合的位置（50ms 窗）
    ia, ib, w, r = int(a * sr), int(b * sr), int(0.05 * sr), int(0.05 * sr)
    ref = mono[ia - w:ia + w]
    shifts = range(-r, r + 1, 4)
    corr = [float(np.dot(ref, mono[ib + d - w:ib + d + w])) for d in shifts]
    ib += shifts[int(np.argmax(corr))]
    return ia, ib, score


def onset_env(mono, sr, hop=0.01):
    """每 10ms 的能量上升量，對齊節拍用"""
    h = int(hop * sr)
    rms = np.sqrt((mono[: len(mono) // h * h].reshape(-1, h) ** 2).mean(1))
    return np.maximum(np.diff(rms, prepend=rms[0]), 0), hop


def free_loops(mono, sr, count=4):
    """不限整數小節：整首找頻譜最像的起點、終點，再用起音對齊到 ±150ms 內；回傳彼此相隔 3 秒以上的前幾名。
    11/06 溫芷薰的整數小節接縫聽起來不對（推論：實際速度和設定的 BPM 有落差），改用這個挑。"""
    from scipy.signal import fftconvolve

    feat, dt = features(mono, sr, hop=2048)
    ctx = int(1.5 / dt)
    gram = feat @ feat.T
    # 沿對角線加總前後 1.5 秒：sim[i, j] = 兩邊對應格的平均相似度
    sim = fftconvolve(gram, np.eye(2 * ctx + 1), mode='same') / (2 * ctx + 1)
    n = len(feat)
    i, j = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
    t_i, t_j = i * dt, j * dt
    ok = (t_i >= 6) & (t_i <= 25) & (t_j - t_i >= 55) & (t_j <= len(mono) / sr - 4)
    sim = np.where(ok, sim, -np.inf)

    env, eh = onset_env(mono, sr)
    w, r = int(1.5 / eh), int(0.15 / eh)
    picked = []
    for flat in np.argsort(sim, axis=None)[::-1]:
        a, b = np.unravel_index(flat, sim.shape)
        if not np.isfinite(sim[a, b]):
            break
        ta, tb = a * dt, b * dt
        if any(abs(ta - pa) < 3 and abs(tb - pb) < 3 for _, pa, pb in picked):
            continue
        ea, eb = int(ta / eh), int(tb / eh)
        ref = env[ea - w:ea + w]
        corr = [float(np.dot(ref, env[eb + d - w:eb + d + w])) for d in range(-r, r + 1)]
        tb += (int(np.argmax(corr)) - r) * eh
        picked.append((float(sim[a, b]), ta, tb))
        if len(picked) == count:
            break
    return [(s, int(ta * sr), int(tb * sr)) for s, ta, tb in picked]


def render(y, sr, ia, ib, meter):
    """接縫交叉淡化、統一響度；回傳處理好的音訊與增益"""
    x = int(FADE * sr)
    out = y[:ib].copy()
    ramp = np.linspace(0, np.pi / 2, x)[:, None]
    out[ib - x:ib] = y[ib - x:ib] * np.cos(ramp) + y[ia - x:ia] * np.sin(ramp)
    gain = 10 ** ((LUFS - meter.integrated_loudness(out[ia:])) / 20)
    gain = min(gain, PEAK / np.abs(out).max())
    return out * gain, gain


def seam(out, sr, ia, ib):
    return np.concatenate([out[ib - 8 * sr:ib], out[ia:ia + 8 * sr]]).astype(np.float32)


def alternatives(track):
    """bgm_loop.py --alts <曲目 id>：寫出幾組不限整數小節的接縫，給 Roger 挑，挑好填進 PICK"""
    y, sr = sf.read(CANDIDATES / track / f'{FINAL[track]}.flac', dtype='float64')
    meter = pyloudnorm.Meter(sr)
    rows = []
    for n, (score, ia, ib) in enumerate(free_loops(y.mean(1), sr), 1):
        out, _ = render(y, sr, ia, ib, meter)
        sf.write(SEAMS / f'{track}_alt{n}.flac', seam(out, sr, ia, ib), sr)
        print(f'alt{n}：循環 {ia / sr:.2f}–{ib / sr:.2f} 秒，相似度 {score:.3f}')
        rows.append(f'<tr><td>alt{n}<br><small>循環 {ia / sr:.1f}–{ib / sr:.1f} 秒</small></td>'
                    f'<td><audio controls preload="none" src="seams/{track}_alt{n}.flac"></audio></td></tr>')
    (CANDIDATES / f'seams_{track}.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>接縫候選</title>'
        '<style>body{font:16px sans-serif;max-width:760px;margin:2em auto;padding:0 16px}td{padding:6px 12px 6px 0}audio{width:480px;max-width:100%}</style>'
        f'<h1>{track} 接縫候選</h1><p>每段 16 秒，第 8 秒的地方跳回循環起點。</p><table>{"".join(rows)}</table>',
        encoding='utf-8')


# 改用 free_loops 第幾名的曲目（Roger 聽過 --alts 的接縫後填）
PICK = {'theme_zhixun': 2}  # 11/06：整數小節的接縫不行，Roger 選 alt2


def main():
    if sys.argv[1:2] == ['--alts']:
        SEAMS.mkdir(parents=True, exist_ok=True)
        alternatives(sys.argv[2])
        return
    (AUDIO / 'bgm').mkdir(parents=True, exist_ok=True)
    SEAMS.mkdir(exist_ok=True)
    manifest_path = AUDIO / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    meter = None

    for track, name in FINAL.items():
        y, sr = sf.read(CANDIDATES / track / f'{name}.flac', dtype='float64')
        meter = meter or pyloudnorm.Meter(sr)
        t = TRACKS[track]
        if track in PICK:
            score, ia, ib = free_loops(y.mean(1), sr)[PICK[track] - 1]
        else:
            ia, ib, score = best_loop(y.mean(1), sr, t['bpm'], int(t['sig']))

        out, gain = render(y, sr, ia, ib, meter)
        sf.write(AUDIO / 'bgm' / f'{track}.mp3', out.astype(np.float32), sr, format='MP3', subtype='MPEG_LAYER_III')
        sf.write(SEAMS / f'{track}.flac', seam(out, sr, ia, ib), sr)

        manifest['bgm'][track] = {'file': f'bgm/{track}.mp3', 'loopStart': round(ia / sr, 4), 'loopEnd': round(ib / sr, 4)}
        lufs = meter.integrated_loudness(out[ia:])
        print(f'{track}（{name}）：循環 {ia / sr:.2f}–{ib / sr:.2f} 秒，相似度 {score:.3f}，{lufs:.1f} LUFS，增益 {20 * np.log10(gain):+.1f} dB')

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
