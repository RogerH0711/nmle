# 用語音辨識檢查配音念錯的字：Breeze-ASR-25（聯發科，台灣華語微調的 Whisper large-v2，Apache-2.0）
#
# 環境：.venv-tts（transformers 4.57），顯示記憶體約 3 GB。
#   .venv-tts/Scripts/python.exe -X utf8 art/voice_check.py            # 檢查 voice_design.py 的候選聲音
#   .venv-tts/Scripts/python.exe -X utf8 art/voice_check.py breezy     # 檢查 voice_breezy.py 念的台詞
# 錯字率（CER）是辨識結果和原文的編輯距離 ÷ 原文字數，標點、空白不算。辨識本身也會錯，
# 所以 CER 高的只是「要人聽」的名單，不代表一定念錯。最長停頓用來抓卡住、拖很久沒聲音的音檔。
import html
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
import torch
from transformers import pipeline

PUNCT = re.compile(r'[\s，。、！？!?,.…—\-－～~「」『』（）()：:；;""\'＂]+')


def plain(text):
    return PUNCT.sub('', text).replace('姐', '姊')  # 台灣兩個字同音，辨識結果哪個都可能出現


def cer(ref, hyp):
    """逐字的編輯距離 ÷ 原文字數"""
    a, b = plain(ref), plain(hyp)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] / max(len(a), 1)


def longest_pause(wav, sr, frame=0.02):
    """音量低於最大音量 -40 dB 的最長連續秒數（頭尾的靜音不算）"""
    n = int(sr * frame)
    frames = wav[: len(wav) // n * n].reshape(-1, n)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    loud = rms > rms.max() * 10 ** (-40 / 20)
    idx = np.flatnonzero(loud)
    if len(idx) == 0:
        return 0.0
    gaps = np.diff(idx) - 1
    return float(gaps.max() * frame) if len(gaps) else 0.0


def load_asr():
    return pipeline('automatic-speech-recognition', model='MediaTek-Research/Breeze-ASR-25',
                    torch_dtype=torch.float16, device='cuda:0')


def check(asr, items):
    """items：[(音檔路徑, 原文)]，回傳每個音檔的 (路徑, 秒數, 最長停頓, CER, 辨識結果)"""
    rows = []
    for path, ref in items:
        wav, sr = sf.read(path, dtype='float32')
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        # Whisper 要 16 kHz；自己先轉，pipeline 才能正確判斷有沒有超過 30 秒
        audio = soxr.resample(wav, sr, 16000)
        hyp = asr(audio, generate_kwargs={'language': 'zh', 'task': 'transcribe'},
                  return_timestamps=len(audio) > 30 * 16000)['text']
        rows.append((path, len(wav) / sr, longest_pause(wav, sr), cer(ref, hyp), hyp))
    return rows


PASS = 0.10  # 試聽頁只放錯字率在這以下的候選


def page(rows):
    """候選聲音的試聽頁：每位學姊一區，描述 A、B 分開，只放錯字率 PASS 以下的"""
    from voice_design import NAMES, OUT, VOICES, instructs

    parts = ['<!doctype html><meta charset="utf-8"><title>候選聲音</title><style>'
             'body{font:15px/1.6 sans-serif;max-width:860px;margin:24px auto;padding:0 16px}'
             'td{padding:4px 8px;vertical-align:middle}audio{height:32px}.dim{color:#888;font-size:13px}</style>'
             '<h1>候選聲音</h1><p class="dim">art/voice_design.py 生成、art/voice_check.py 檢查。'
             f'只列語音辨識錯字率 {PASS:.0%} 以下的；錯字率是辨識結果和原文比對，辨識本身也會錯。</p>']
    for cid, v in VOICES.items():
        mine = [r for r in rows if r[0].parent.name == cid]
        parts.append(f'<h2>{NAMES[cid]}</h2><p>台詞：{html.escape(v["text"])}</p>')
        for name, instruct in instructs(v).items():
            ok = [r for r in mine if r[0].stem.startswith(name + '_') and r[3] <= PASS]
            parts.append(f'<h3>描述 {name}（{len(ok)} 個）</h3><p class="dim">{html.escape(instruct)}</p><table>')
            for path, secs, pause, e, hyp in ok:
                rate = len(plain(v['text'])) / secs
                parts.append(f'<tr><td>{path.stem}</td><td><audio controls preload="none" src="{cid}/{path.name}"></audio></td>'
                             f'<td>{secs:.1f} 秒・{rate:.1f} 字/秒・錯字率 {e:.0%}<br><span class="dim">{html.escape(hyp)}</span></td></tr>')
            parts.append('</table>')
    (OUT / 'index.html').write_text('\n'.join(parts), encoding='utf-8')


def check_breezy(asr):
    """voice_breezy.py 念的台詞。每句念了好幾次（<台詞 id>_t<k>.wav），每次都辨識，結果寫進 results.json；
    每個設定（資料夾）印出每句最好的那次，和「最好的那次錯字率 5% 以下」的句數"""
    import json
    from voice_breezy import DATA, OUT

    results = {}
    for cdir in sorted(p for p in OUT.iterdir() if p.is_dir()):
        texts = {l['id']: l['text'].replace('{player}', '學弟')
                 for l in json.loads((DATA / f'{cdir.name}.json').read_text(encoding='utf-8'))['lines']}
        for r in sorted(p for p in cdir.iterdir() if p.is_dir()):
            wavs = sorted(r.glob('*_t*.wav'))  # 沒有 _t 的是 10/25 第一次試念，沒有固定 seed，不算
            takes = {}
            for path, secs, pause, e, hyp in check(asr, [(w, texts[w.stem.rsplit('_t', 1)[0]]) for w in wavs]):
                lid, k = path.stem.rsplit('_t', 1)
                takes.setdefault(lid, []).append({'take': int(k), 'secs': round(secs, 1), 'pause': round(pause, 1),
                                                  'cer': round(e, 3), 'heard': hyp})
            if not takes:
                continue
            results.setdefault(cdir.name, {})[r.name] = {'text': {lid: texts[lid] for lid in takes}, 'takes': takes}
            good = 0
            for lid, ts in takes.items():
                best = min(ts, key=lambda t: (t['cer'], t['pause']))
                good += best['cer'] <= 0.05
                cers = '/'.join(f"{t['cer']:.0%}" for t in sorted(ts, key=lambda t: t['take']))
                print(f"{cdir.name}/{r.name}/{lid}\t最好 t{best['take']} {best['cer']:.0%}\t各次 {cers}\t{best['heard']}", flush=True)
            print(f'== {cdir.name}/{r.name}：{good}/{len(takes)} 句最好的那次錯字率 5% 以下', flush=True)
    (OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')


def main():
    sys.path.insert(0, str(Path(__file__).parent))
    if sys.argv[1:] == ['breezy']:
        return check_breezy(load_asr())
    from voice_design import OUT, VOICES

    items = [(p, VOICES[c]['text']) for c in VOICES for p in sorted((OUT / c).glob('*.wav'))]
    rows = check(load_asr(), items)
    for path, secs, pause, e, hyp in rows:
        rate = len(plain(VOICES[path.parent.name]['text'])) / secs
        print(f'{path.parent.name}/{path.name}\t{secs:.1f}s\t{rate:.1f}字/s\t停頓{pause:.1f}s\tCER {e:.0%}\t{hyp}', flush=True)
    page(rows)


if __name__ == '__main__':
    main()
