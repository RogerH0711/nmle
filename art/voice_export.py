# 配音定稿：每句挑最好的那次，裁掉頭尾空白、統一響度、壓成 mp3，寫進 data/audio/ 與 manifest.json
#
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_export.py fei B_s1-final
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_export.py fei B_s1-final --todo   # 只印還不完美的台詞 id（給 voice_rounds.sh 重念）
# 先跑 voice_breezy.py（念）和 voice_check.py breezy（辨識，寫 results.json）。這個環境有 soundfile（能寫 mp3）和 pyloudnorm。
# 需要 pypinyin：uv pip install --python art/ace-step/.venv/Scripts/python.exe pypinyin
# 輸出：data/audio/voice/<語音 key>.mp3、manifest.json 的 voice；試聽頁 art/bakeoff/voice/breezy/<角色>-<設定>.html（不進 repo）
#
# 每次念的結果用兩個數字評：
# - 念錯率：原文和辨識結果都轉成帶聲調的拼音再算編輯距離 ÷ 原文音節數。辨識常把同音同調的字寫錯（結核→結合、鱗狀→磷狀），
#   那不是念錯；聲調不同的（十題→實體）算錯（11/12 Roger：「語音辨識沒問題，要盡量把錯誤率壓到 0%」）。
# - 多停：句子中間的停頓（voice_check.py 的 gaps）比原文中間的標點多幾次。BreezyVoice 有時在詞中間停一下（「笨蛋｜學弟」）。
# 每句先挑能上線的，再挑（念錯率, 多停, 錯字率, 最長停頓）最小的那次。完美是念錯率 0 且不多停；
# 上線的門檻是念錯率 MAX_MISREAD 以下且不多停（manifest 沒列的網站就不播）。口音、語氣要靠人聽，試聽頁列全部。
import html
import json
import re
import sys
from pathlib import Path

import numpy as np
import pyloudnorm
import soundfile as sf
from pypinyin import Style, lazy_pinyin, load_phrases_dict, load_single_dict

# pypinyin 預設是大陸讀音，原文要用台灣讀音比對，不然念成大陸讀音的也算對（11/13：「乾酪」念成 qián lào、「學姊」念成 zǐ 都是 0%）
load_single_dict({ord('姊'): 'jiě'})
load_phrases_dict({'乾酪': [['gān'], ['lào']], '一階': [['yì'], ['jiē']]})  # 一接一聲字念四聲

ART = Path(__file__).parent
ROOT = ART.parent
BREEZY = ART / 'bakeoff' / 'voice' / 'breezy'
AUDIO = ROOT / 'data' / 'audio'

# 11/14 Roger：「賄賂」念成「散路」、「學姊」念成「學子」都沒抓出來。原本的門檻 10% 是比例，長句錯一個字只有 6–7%，
# 改成一個音節都不能錯。辨識自己寫錯字（聲調也不同的）會被誤判，那種要人聽過，記在 HEARD
MAX_MISREAD = 0.0

# Roger 聽過的判斷，優先於自動評分：{(角色, 設定, 音檔名): True（可以上線）/ False（不行）}
HEARD = {
    # 11/14 Roger 聽 v3：wrong-006「下一題」接得很奇怪；streak-005「十連對」語氣怪、「飲料」的飲念成一聲
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-wrong-006_t1.wav'): False,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-streak-005_t3.wav'): False,
}
# Roger 從 voice_pick.py 的挑選頁選的：{(角色, 設定, 語音 key): 第幾次}，直接用這次、當作可以上線
PICK = {
    # 11/14 Roger 聽 fei-pick.html。wrong-006 第 10 次「前一句還可以，但語氣沒有接到下一句」，第 31 次以後改成同一段念，Roger 改挑第 32 次
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-streak-005'): 27,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-streak-006'): 20,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-finish-003'): 11,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-gift_liked-001'): 30,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-wrong-006'): 32,  # 第 31 次以後「下一題」併成同一段
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-gift-002'): 32,  # 賄賂照「會洛」念
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-wrong-004'): 42,  # 腫脹照「腫帳」念
    # mock_high-002 台詞加了「嗎」，Roger 聽過挑的（當時說辨識沒寫出「嗎」是 voice_check 快取沿用舊檔的結果，11/15 重新辨識後兩次都是 0%）
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-mock_high-002.m'): 10,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-mock_high-002.f'): 5,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-comeback-002'): 2,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-correct-005'): 2,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-correct-006'): 2,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-correct-009'): 4,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-correct-011'): 2,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-correct-014'): 5,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-wrong-008'): 21,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-wrong-010'): 2,
    ('fei', 'breeze2-seg-B_s1-v3lv', 'fei-wrong-013'): 9,
}
LUFS = -18.0  # 播放時 BGM 降到四成，語音預設音量 0.8，比 BGM（-20 LUFS）稍大聲
PEAK = 10 ** (-1 / 20)
PAD = 0.08  # 裁空白時頭尾各留 80ms，不要切到氣音

NON_WORD = re.compile(r'[^\w]+|_')


DIGITS = '零一二三四五六七八九'


def chinese_numbers(text):
    """辨識常把「十題」寫成「10 題」，比對前換回中文（只處理 0–99）"""
    def one(m):
        n = int(m.group())
        if n >= 100:
            return m.group()
        tens, ones = divmod(n, 10)
        return (('' if tens == 1 else DIGITS[tens]) + '十' if tens else '') + (DIGITS[ones] if ones or not tens else '')
    return re.sub(r'\d+', one, text)


def syllables(text):
    """帶聲調的拼音（輕聲是 5），一個字一個音節；不是中文的（英文、數字）逐字小寫"""
    return lazy_pinyin(NON_WORD.sub('', text), style=Style.TONE3, neutral_tone_with_five=True,
                       errors=lambda s: list(s.lower()))


def misread(ref, heard):
    a, b = syllables(chinese_numbers(ref)), syllables(chinese_numbers(heard))
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1] / max(len(a), 1)


def pauses_allowed(text):
    """原文中間（前後都有字）的標點有幾處，連在一起的算一處"""
    return len(re.findall(r'(?<=\w)[^\w]+(?=\w)', text))


def score(text, take):
    take['misread'] = misread(text, take['heard'])
    take['extra'] = max(0, len(take['gaps']) - pauses_allowed(text))
    # 先比能不能上線：念錯率稍高但不多停的，比念錯率低但多停的好（多停的不上線）
    return not live(take), take['misread'], take['extra'], take['cer'], take['pause']


def live(take):
    if take.get('verdict') is not None:
        return take['verdict']
    return take['misread'] <= MAX_MISREAD and not take['extra'] and take.get('tune', True)


PICKS_FILE = ART / 'voice_picks.json'


def picked_take(cid, cfg, key):
    """Roger 挑的那次：先看 PICK，再看互動挑選頁（voice_server.py）存的 voice_picks.json"""
    if (cid, cfg, key) in PICK:
        return PICK[cid, cfg, key]
    if not PICKS_FILE.exists():
        return None
    return json.loads(PICKS_FILE.read_text(encoding='utf-8')).get(cid, {}).get(cfg, {}).get(key, {}).get('take')


def tune_ok(item):
    """voice_prosody.py 的結果：段數要對得上（對不上是段裡多了很長的靜音）。
    問句尾音（rise）只顯示、不擋：11/14 對照 Roger 聽過的，mock_high-001 他覺得可以、量出 -12 半音，
    mock_high-002 他覺得不像問句、量出 -1～-2.6，量測和聽感對不起來。問句靠 voice_pick.py 讓 Roger 挑"""
    return item is None or 'mismatch' not in item


def trim(y, sr, floor_db=-40):
    frame = int(0.01 * sr)
    rms = np.sqrt(np.convolve(y ** 2, np.ones(frame) / frame, mode='same'))
    loud = np.nonzero(rms > np.abs(y).max() * 10 ** (floor_db / 20))[0]
    if not len(loud):
        return y
    a, b = max(loud[0] - int(PAD * sr), 0), min(loud[-1] + int(PAD * sr), len(y))
    return y[a:b]


def best_takes(cid, cfg, max_take=None):
    result = json.loads((BREEZY / 'results.json').read_text(encoding='utf-8'))[cid][cfg]
    folder = BREEZY / cid / cfg
    sent = json.loads((folder / 'sent.json').read_text(encoding='utf-8')) if (folder / 'sent.json').exists() else {}
    prosody_path = BREEZY / 'prosody.json'
    prosody = json.loads(prosody_path.read_text(encoding='utf-8')).get(cid, {}).get(cfg) if prosody_path.exists() else None
    rows = []
    for key, takes in result['takes'].items():
        text = result['text'][key]
        # 換成語氣標記的字（「咳」→ [清嗓子]）辨識不會寫出來，比對時從原文拿掉
        if '[清嗓子]' in sent.get(key, {}).get('text', ''):
            text = text.replace('——咳。', '').replace('咳。', '').replace('咳', '')
        takes = [t for t in takes if max_take is None or t['take'] <= max_take]
        for t in takes:
            name = f"{key}_t{t['take']}.wav"
            if prosody is not None:
                t['tune'] = tune_ok(prosody.get(name))
            t['verdict'] = HEARD.get((cid, cfg, name))
        for t in takes:
            score(text, t)
        picked = [t for t in takes if t['take'] == picked_take(cid, cfg, key)]
        best = picked[0] if picked else min(takes, key=lambda t: score(text, t))
        if picked:
            best['verdict'] = True
        rows.append((key, text, best, len(takes)))
    return rows


def main():
    cid, cfg = sys.argv[1], sys.argv[2]
    rows = best_takes(cid, cfg)
    if '--todo' in sys.argv[3:]:
        print(' '.join(sorted({key.split('.')[0] for key, _, b, _ in rows if not live(b) or b['misread'] or b['extra']})))
        return

    # --page：只產生試聽頁，不動 data/audio（還沒決定要不要換上這個設定時用）
    page_only = '--page' in sys.argv[3:]
    (AUDIO / 'voice').mkdir(parents=True, exist_ok=True)
    manifest_path = AUDIO / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    voiced = {r[0] for r in rows if live(r[2])} if page_only else set(manifest['voice'])
    for key, text, best, _ in ([] if page_only else rows):
        mp3 = AUDIO / 'voice' / f'{key}.mp3'
        if live(best):
            y, sr = sf.read(BREEZY / cid / cfg / f"{key}_t{best['take']}.wav", dtype='float64')
            y = trim(y if y.ndim == 1 else y.mean(1), sr)
            meter = pyloudnorm.Meter(sr, block_size=min(0.4, len(y) / sr))
            gain = min(10 ** ((LUFS - meter.integrated_loudness(y)) / 20), PEAK / np.abs(y).max())
            sf.write(mp3, (y * gain).astype(np.float32), sr, format='MP3', subtype='MPEG_LAYER_III')
            voiced.add(key)
        else:
            voiced.discard(key)
            mp3.unlink(missing_ok=True)
    if not page_only:
        manifest['voice'] = sorted(voiced)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

    rows.sort(key=lambda r: (-r[2]['misread'], -r[2]['extra'], r[0]))
    page = ['<!doctype html><meta charset="utf-8"><title>配音試聽</title>',
            '<style>body{font:15px sans-serif;max-width:900px;margin:2em auto;padding:0 16px}td{padding:6px 10px 6px 0;vertical-align:top}'
            '.bad{color:#b00}.dim{color:#888}audio{width:260px}</style>',
            f'<h1>{cid} 配音（{cfg}）</h1><p>每句是念好幾次裡最好的那次。念錯率：拼音（含聲調）和原文不同的比例；'
            f'多停：句子中間的停頓比原文的標點多幾次。紅字是念錯率超過 {MAX_MISREAD:.0%} 或有多停，還沒上線。'
            f'聽聽看口音、語氣、斷句，有問題的記下語音 key。</p><table>']
    for key, text, best, n in rows:
        ok = live(best)
        stops = '、'.join(f'{s:.2f} 秒停 {d:.2f}' for s, d in best['gaps']) or '無'
        page.append(f'<tr><td><audio controls preload="none" src="{cid}/{cfg}/{key}_t{best["take"]}.wav"></audio></td>'
                    f'<td><b>{key}</b> <span class="{"" if ok else "bad"}">念錯率 {best["misread"]:.0%}・多停 {best["extra"]}</span>'
                    f'<span class="dim">（第 {best["take"]}/{n} 次；錯字率 {best["cer"]:.0%}）</span>'
                    f'<br>{html.escape(text)}<br><span class="dim">聽成：{html.escape(best["heard"])}<br>停頓：{stops}</span></td></tr>')
    page.append('</table>')
    out = BREEZY / f'{cid}-{cfg}.html'
    out.write_text('\n'.join(page), encoding='utf-8')
    perfect = sum(not r[2]['misread'] and not r[2]['extra'] for r in rows)
    print(f'{len(voiced & {r[0] for r in rows})}/{len(rows)} 句上線，其中 {perfect} 句完美（念錯率 0、不多停）；試聽頁 {out}')
    for key, text, best, n in rows:
        if best['misread'] or best['extra']:
            print(f"  念錯 {best['misread']:.0%} 多停 {best['extra']} {key}（{n} 次）：{text} → {best['heard']}")


if __name__ == '__main__':
    main()
