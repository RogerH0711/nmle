# 配音的語氣檢查（11/14 Roger：「坐下吧」突然變很大聲；疑問句尾音沒往上，聽起來變肯定句）。語音辨識只看字，這兩種抓不到。
#
# 在 WSL 用 Breeze 的環境跑（有 librosa）：
#   ~/code/breeze-tts/.venv/bin/python art/voice_prosody.py level fei breeze2-seg-B_s1-v3 breeze2-seg-B_s1-v3lv   # 複製一份，各段音量對齊
#   ~/code/breeze-tts/.venv/bin/python art/voice_prosody.py check fei breeze2-seg-B_s1-v3lv                     # 量問句尾音，寫 prosody.json
# 只適用 seg（分段念）的音檔：段和段之間是插入的靜音（連續的 0），用 sent.json 對回每段的文字。
# prosody.json：{角色: {設定: {音檔名: {'loud': [各段 dB], 'rise': [問句段的尾音升幾個半音]}}}}，voice_export 讀來判斷能不能上線。
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_breeze2 import level, loudness_db, split_pieces  # noqa: E402
from voice_breezy import story_lines  # noqa: E402

BREEZY = Path(__file__).resolve().parent / 'bakeoff' / 'voice' / 'breezy'
ROOT = Path(__file__).resolve().parent.parent
# 句尾有這些語助詞的問句不一定上揚（「看得到嗎？」「我不能稱讚喔？」），不檢查
PARTICLES = '嗎吧呢啊喔嘛啦耶齁呀哦'


# 顏緋的聲音約 200–450 Hz；範圍開太大（120–800）會有八度誤判，量出 ±12 半音的假值
# 有疑問詞、正反問（是不是、要不要）的問句，問的意思已經在字裡，尾音不一定上揚，也不檢查
QUESTION_WORDS = re.compile(r'什麼|怎麼|為什麼|哪|誰|幾|多少|(.)不\1')


def needs_rise(piece):
    """是非問句、句尾沒有語助詞的（「這分數是你考的？」「送我的？」），不上揚聽起來就變肯定句（11/14 Roger）"""
    body = re.sub(r'\[.*?\]', '', piece).rstrip('！？。…—')
    return (piece.rstrip('！。').endswith('？') and bool(body) and body[-1] not in PARTICLES
            and not QUESTION_WORDS.search(body.split('，')[-1]))


def rise(y, sr):
    """尾音比整段中間高幾個半音：最後 0.2 秒有聲部分的 f0 中位數 ÷ 前面有聲部分的中位數"""
    import librosa
    f0, voiced, _ = librosa.pyin(y, fmin=150, fmax=500, sr=sr, frame_length=2048, hop_length=256)
    t = np.arange(len(f0)) * 256 / sr
    ok = voiced & ~np.isnan(f0)
    if ok.sum() < 6:
        return None
    end = t[ok][-1]
    tail = f0[ok & (t >= end - 0.2)]
    body = f0[ok & (t < end - 0.2)]
    if len(tail) < 2 or len(body) < 3:
        return None
    return float(12 * np.log2(np.median(tail) / np.median(body)))


def do_level(cid, src, dst):
    a, b = BREEZY / cid / src, BREEZY / cid / dst
    b.mkdir(exist_ok=True)
    shutil.copy(a / 'sent.json', b / 'sent.json')
    lines = json.loads((ROOT / 'data' / 'lines' / f'{cid}.json').read_text(encoding='utf-8'))['lines'] + story_lines(cid)
    expression = {l['id']: l.get('expression', 'normal') for l in lines}
    for wav in sorted(a.glob('*.wav')):
        if (b / wav.name).exists():
            continue
        y, sr = sf.read(wav, dtype='float32')
        spans = split_pieces(y, sr)
        out = y.copy()
        for (s, e), p in zip(spans, level([y[s:e] for s, e in spans], expression[wav.stem.rsplit('_t', 1)[0].split('.')[0]])):
            out[s:e] = p
        sf.write(b / wav.name, out, sr, subtype='PCM_16')
    print(f'{b}')


def do_check(cid, cfg):
    folder = BREEZY / cid / cfg
    sent = json.loads((folder / 'sent.json').read_text(encoding='utf-8'))
    path = BREEZY / 'prosody.json'
    allp = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    res = allp.setdefault(cid, {}).setdefault(cfg, {})
    for wav in sorted(folder.glob('*.wav')):
        if wav.name in res:
            continue
        key = wav.stem.rsplit('_t', 1)[0]
        y, sr = sf.read(wav, dtype='float32')
        spans = split_pieces(y, sr)
        pieces = sent[key]['pieces']
        item = {'loud': [round(loudness_db(y[s:e]), 1) for s, e in spans], 'rise': []}
        if len(spans) == len(pieces):
            item['rise'] = [None if r is None else round(r, 1)
                            for (s, e), p in zip(spans, pieces) if needs_rise(p) for r in [rise(y[s:e], sr)]]
        else:
            item['mismatch'] = [len(spans), len(pieces)]
        res[wav.name] = item
    path.write_text(json.dumps(allp, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{path}：{cfg} {len(res)} 個音檔')


if __name__ == '__main__':
    cmd, cid, *rest = sys.argv[1:]
    do_level(cid, *rest) if cmd == 'level' else do_check(cid, *rest)
