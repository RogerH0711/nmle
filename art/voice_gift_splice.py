# 收禮台詞（有 {gift} 的 gift-001、gift-004）拆成「禮物名稱」和「後半句」分開挑，再接起來。
# 11/19 Roger 挑 v4blv 挑到一半：「很多台詞都類似……拿鐵跟便利貼分別聽，他們後面從謝謝開始，統一用一種就好」。
# B 設定其實是分兩段念（同一次的兩段用同一個 seed），後半句每種禮物的文字都一樣，同一次念出來幾乎一模一樣。所以：
#   前半（每種禮物各挑一次）：gift-001「{gift}？」從 v4b 切出第一段；gift-004 改成只念「{gift}」（v5head），「謝謝」移到後半
#   後半（兩句各挑一個，15 種禮物共用）：v5tail*，用拿鐵那次切出第二段。同一天 Roger 也要句尾加「欸～」「喔～」（尾音帶情緒）
#
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_gift_splice.py cut    # 切好前後半（options.json）
#   .venv-tts/Scripts/python.exe -X utf8 art/voice_gift_splice.py check           # 每段都辨識（Breeze-ASR-25），存 asr.json
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_gift_splice.py page   # 挑選頁 fei-gift-split-pick.html
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_gift_splice.py join   # 照挑的接起來 → fei/breeze2-seg-B_s1-v5/、試聽頁 fei-gift-joined.html
#   接好之後再跑一次 check（辨識接好的整句）、join（試聽頁附辨識結果）。挑選頁只列還沒挑好的
#
# 11/19 Roger 挑第一版：「全錯，沒一個講對的，你有先檢查過嗎？」（gift-004 只念名稱的運動飲料、運動護腕、拭鏡布，沒跑辨識就給他挑；
# 辨識結果是「蹦蹦飲料」「按東互吻」「新埠」這類）。所以挑選頁只列辨識過、念對的：辨識結果和原文轉成拼音（不分聲調）比，
# 同音字不算錯（拭鏡布聽成「市警部」算對）；沒辨識過的不列。他也說 gift-001 後半「第一個音『喔』不行」（14 次只有 4 次聽得到喔），
# 那句的後半開頭沒有喔的也不列
import html
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ART = Path(__file__).resolve().parent
sys.path.insert(0, str(ART))
from voice_breeze2 import GAP_DOTS, GAP_END, level, split_pieces  # noqa: E402

CID = 'fei'
BREEZY = ART / 'bakeoff' / 'voice' / 'breezy'
PICKS = ART / 'voice_picks.json'
PARTS = 'breeze2-seg-B_s1-v5parts'  # 切出來的前後半放這裡，挑的結果也記在這個設定底下
JOINED = 'breeze2-seg-B_s1-v5'
LINES = ['fei-gift-001', 'fei-gift-004']
# 前半：[(資料夾, 一個檔有幾段, 取第幾段, 標籤, 哪些禮物)]。挑選頁的值是「來源序號 × 100 + 第幾次」
# 11/19 Roger 第一輪：gift-004 只念名稱的運動飲料、運動護腕、拭鏡布「全錯」，細菌造型玩偶也都不行（辨識有幾次聽對，
# 可能是聲調，辨識抓不到）。這 4 種第一批不再列，換成名稱後面加句號重念的第二批
REDO_004 = {'sports_drink', 'wristband', 'glasses_cloth', 'microbe_plush'}
# 11/19 Roger 第二輪：拭鏡布「全錯，沒一個講對的」（已經寫成拭敬布，辨識 10 次只有 3 次聽成「試經部」，其他是「試進步」）；
# 細菌造型玩偶「細菌的菌是四聲，現在聽起來都是一聲」（台灣念 ㄐㄩㄣˋ，大陸念一聲）。第三輪換同音、大陸也念四聲的字（同 11/14 研究→研就），
# 第二批的這兩種不再列。標籤是 {禮物: 標籤}
REDO2_004 = {'glasses_cloth', 'microbe_plush'}
# 11/19 Roger 聽接好的整句：gift-001 運動飲料「運動跟飲料間隔太久」（第 3 次中間停了 0.78 秒）；gift-001 緞帶髮飾「唸成盾戴了」
#（緞 duàn 念成 dùn），換成同音的段、斷；gift-004 運動護腕「有點念得太正式了」（名稱後面加句號那批），試「～」和輕鬆的語氣指示。
# 運動飲料用 v4b 原本的念法多念幾次（第 7 次以後，seed 不同）
REDO_001 = {'ribbon'}
CASUAL = {'wristband'}
HEAD_SRC = {
    'fei-gift-001': [('breeze2-seg-B_s1-v4b', 2, 0, '', None),
                     ('breeze2-seg-B_s1-v6head', 1, 0, {'ribbon': '寫成段帶 '}, lambda g: g in REDO_001),
                     ('breeze2-seg-B_s1-v6head2', 1, 0, {'ribbon': '寫成斷帶 '}, lambda g: g in REDO_001)],
    'fei-gift-004': [('breeze2-seg-B_s1-v5head', 1, 0, '', lambda g: g not in REDO_004),
                     ('breeze2-seg-B_s1-v5head2', 1, 0, '加句號 ', lambda g: g in REDO_004 - REDO2_004),
                     ('breeze2-seg-B_s1-v5head3', 1, 0, {'microbe_plush': '寫成細郡 ', 'glasses_cloth': '寫成拭靜布 '}, lambda g: g in REDO2_004),
                     ('breeze2-seg-B_s1-v5head4', 1, 0, {'microbe_plush': '寫成細俊 ', 'glasses_cloth': '寫成拭淨布 '}, lambda g: g in REDO2_004),
                     ('breeze2-seg-B_s1-v5head5', 1, 0, {'microbe_plush': '寫成細駿 ', 'glasses_cloth': '寫成拭境布 '}, lambda g: g in REDO2_004),
                     ('breeze2-seg-B_s1-v5head6', 1, 0, '句尾「～」 ', lambda g: g in CASUAL),
                     ('breeze2-seg-B_s1-v5head7', 1, 0, '句號＋輕鬆的語氣指示 ', lambda g: g in CASUAL),
                     ('breeze2-seg-B_s1-v5head8', 1, 0, '句尾「～」＋輕鬆的語氣指示 ', lambda g: g in CASUAL)],
}
HEAD_SUFFIX = {'fei-gift-001': '？', 'fei-gift-004': '……'}
# 後半的版本（念的時候 --tag 用的名字）。挑選頁的值是「版本序號 × 100 + 第幾次」，例如 B 的第 3 次是 203。
# 最後一欄：從第幾次開始列。11/19 第一輪 A、B、C 各 6 次 Roger 都聽過、兩句都「都不行」（gift-001「C 第 3 次後面還可以，
# 第一個音『喔』不行」；gift-004「B 第 5 次尾音算比較好的，但『喔』沒念好」），第二輪只列新念的
TAIL_SRC = [
    ('A', 'breeze2-seg-B_s1-v5tail', '語氣指示和前半一樣（B 設定），句尾寫「欸～」「喔～」', 7),
    ('B', 'breeze2-seg-B_s1-v5tailp', '語氣指示多一句句尾助詞怎麼念（欸：有點意外、輕輕上揚；喔：溫柔地對他說）', 7),
    ('C', 'breeze2-seg-B_s1-v5tailq', '同 B 的語氣指示，句尾寫「欸。」「喔。」（不加～）', 7),
    ('D', 'breeze2-seg-B_s1-v5tailr', '沒想到那句：C＋開頭的「喔」寫成「哦」', 1),
    ('E', 'breeze2-seg-B_s1-v5tails', '沒想到那句：C＋開頭的「喔」寫成「噢」', 1),
    ('F', 'breeze2-seg-B_s1-v5tailo', '抽屜那句：B＋句尾的「喔～」寫成「歐～」（台灣的喔常念成 ou）', 1),
]
TAIL_GIFT = 'latte'  # 後半句從拿鐵那次切
TAIL_TEXT = {'fei-gift-001': '喔，謝謝。我沒想到你會送東西欸～',
             'fei-gift-004': '謝謝。你送的東西，我都放在值班室的抽屜裡，一樣都沒丟喔～'}
GAP = {'fei-gift-001': GAP_END, 'fei-gift-004': GAP_DOTS}  # 原文「？」「……」的停頓
# 拼音（不分聲調）的錯字率超過這個就不列。後半句：gift-001 只容許「欸」聽成「耶」那一個字（1/14）；gift-004 要全對
#（第二輪用 0.1 時，漏念「謝謝」、句尾「喔」念成「啊」、「沒丟」念成「買丟」的都混進來）
MAX_ERR = {'head': 0.2, 'fei-gift-001.tail': 0.08, 'fei-gift-004.tail': 0.0}
# 不用辨識排除的：11/19 第三輪拭鏡布 30 次都被辨識排除（大多聽成「試進步」），但 Roger 在 gift-001 挑的那次單獨辨識也是「試進步」；
# 他聽了說「拭鏡布感覺是辨識的問題，現在聽起來都沒問題了」。辨識對這個詞的 -n／-ng 不準，全部列出來（停頓照樣檢查）
NO_ASR = {'fei-gift-004.glasses_cloth.head'}
# 挑好了又要重挑的：{key: 從哪個值開始列}（比這小的不列，目前接的那個照樣列、標「你挑的」）。11/19 第四輪重挑了運動飲料、緞帶髮飾；
# 運動護腕 Roger 還是沿用原本的加句號第 7 次（他說太正式的那個），新念的留在頁面上，要換再挑
REPICK = {'fei-gift-004.wristband.head': 500}
# 借另一句挑好的名稱來比較：{key: 借哪個 key 目前挑的}，值是 9000 ＋ 那個 key 的值。11/19 Roger：兩句都有運動飲料，
# 為什麼一句可以一句不行？（分開念的兩個音檔，每次念都不一樣）要把「抽屜」那句的放進「沒想到」那句的選項比較（那句是「？」，語氣不同）
BORROW = {'fei-gift-001.sports_drink.head': 'fei-gift-004.sports_drink.head'}
NICK = {'fei-gift-001': '沒想到', 'fei-gift-004': '抽屜'}
HEAD_GAP = 0.2  # 名稱中間停頓超過這個秒數的不列（11/19 運動飲料第 3 次是 0.78 秒）


def gifts():
    data = json.loads((ART.parent / 'data' / 'gifts.json').read_text(encoding='utf-8'))
    return [(g['id'], g['name']) for g in data['gifts']]


def piece(path, count, index):
    """念好的音檔照插入的靜音切開，回傳第 index 段；段數不對（多停、少停）就回傳 None"""
    y, sr = sf.read(path, dtype='float32')
    spans = split_pieces(y, sr)
    if len(spans) != count:
        return None, sr
    a, b = spans[index]
    return y[a:b], sr


def takes(folder, key):
    return sorted(int(p.stem.rsplit('_t', 1)[1]) for p in folder.glob(f'{key}_t*.wav'))


def parts_dir():
    return BREEZY / CID / PARTS


def cmd_cut():
    """切出前後半，存成 PARTS/<line>.<gift>.head_t<k>.wav、PARTS/<line>.tail.<版本><k>.wav；
    候選清單存 options.json：{挑選 key: {'say': 原文, 'kind': head／tail, 'options': [[值, 標籤, 檔名]]}}"""
    out = parts_dir()
    out.mkdir(parents=True, exist_ok=True)
    options, skipped = {}, []
    for line in LINES:
        opts = []
        for n, (label, cfg, _, since) in enumerate(TAIL_SRC, 1):
            folder = BREEZY / CID / cfg
            for k in [k for k in takes(folder, f'{line}.{TAIL_GIFT}') if k >= since]:
                y, sr = piece(folder / f'{line}.{TAIL_GIFT}_t{k}.wav', 2, 1)
                if y is None:
                    skipped.append(f'{cfg}/{line}.{TAIL_GIFT}_t{k}')
                    continue
                sf.write(out / f'{line}.tail.{label}{k}.wav', y, sr, subtype='PCM_16')
                opts.append([n * 100 + k, f'{label} 第 {k} 次', f'{line}.tail.{label}{k}.wav'])
        options[f'{line}.tail'] = {'say': TAIL_TEXT[line], 'kind': 'tail', 'options': opts}
        for gid, name in gifts():
            opts = []
            for s, (cfg, count, index, label, which) in enumerate(HEAD_SRC[line]):
                if which and not which(gid):
                    continue
                folder = BREEZY / CID / cfg
                for k in takes(folder, f'{line}.{gid}'):
                    y, sr = piece(folder / f'{line}.{gid}_t{k}.wav', count, index)
                    if y is None:
                        skipped.append(f'{cfg}/{line}.{gid}_t{k}')
                        continue
                    src = f'{line}.{gid}.head{s or ""}_t{k}.wav'
                    sf.write(out / src, y, sr, subtype='PCM_16')
                    lab = label.get(gid, '') if isinstance(label, dict) else label
                    opts.append([s * 100 + k, f'{lab}第 {k} 次', src])
            options[f'{line}.{gid}.head'] = {'say': name, 'kind': 'head', 'options': opts}
    picks = json.loads(PICKS.read_text(encoding='utf-8')).get(CID, {}).get(PARTS, {})
    for key, other in BORROW.items():
        v = (picks.get(other) or {}).get('take')
        src = next((o[2] for o in options[other]['options'] if o[0] == v), None)
        if src:
            options[key]['options'].append([9000 + v, f'借「{NICK[other.split(".")[0]]}」那句挑的那個 ', src])
    (out / 'options.json').write_text(json.dumps(options, ensure_ascii=False, indent=1), encoding='utf-8')
    n = carry_over()
    print(f'切好 {sum(len(o["options"]) for o in options.values())} 段' + (f'；從整句帶過來 {n} 個' if n else ''))
    if skipped:
        print(f'段數不對、略過 {len(skipped)} 個：' + '、'.join(skipped))


def carry_over():
    """Roger 在整句的挑選頁（v4blv）已經挑的 gift-001，前半一樣，帶過來（gift-004 的前半改了，不帶）"""
    picks = json.loads(PICKS.read_text(encoding='utf-8'))
    old = picks.get(CID, {}).get('breeze2-seg-B_s1-v4blv', {})
    mine = picks.setdefault(CID, {}).setdefault(PARTS, {})
    n = 0
    for key, p in old.items():
        if key.startswith('fei-gift-001.') and p.get('take') and f'{key}.head' not in mine:
            mine[f'{key}.head'] = {'take': p['take'], 'note': '從整句的挑選頁帶過來'}
            n += 1
    if n:
        PICKS.write_text(json.dumps(picks, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    return n


def cmd_check():
    """每段都辨識，結果存 asr.json：{檔名: 聽成的字}。已經辨識過的跳過"""
    from voice_check import check, load_asr
    out = parts_dir()
    options = json.loads((out / 'options.json').read_text(encoding='utf-8'))
    path = out / 'asr.json'
    heard = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    todo = [(out / src, item['say']) for item in options.values() for _, _, src in item['options'] if src not in heard]
    # 接好的整句也辨識（join 之後再跑一次 check）：join.json 記著每句用哪兩段，換了段就重新辨識
    joined = BREEZY / CID / JOINED
    record = json.loads((joined / 'join.json').read_text(encoding='utf-8')) if (joined / 'join.json').exists() else {}
    jpath = joined / 'asr.json'
    jheard = json.loads(jpath.read_text(encoding='utf-8')) if jpath.exists() else {}
    jtodo = [(joined / f'{key}_t1.wav', r['say']) for key, r in record.items()
             if (jheard.get(key) or {}).get('parts') != [r['head'], r['tail']]]
    if todo or jtodo:
        asr = load_asr()
        for wav, _, _, _, hyp in check(asr, todo):
            heard[wav.name] = hyp
        path.write_text(json.dumps(heard, ensure_ascii=False, indent=1), encoding='utf-8')
        for wav, _, _, _, hyp in check(asr, jtodo):
            key = wav.stem.rsplit('_t', 1)[0]
            jheard[key] = {'parts': [record[key]['head'], record[key]['tail']], 'heard': hyp}
        if jtodo:
            jpath.write_text(json.dumps(jheard, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'辨識 {len(todo)} 段（共 {len(heard)} 段）；接好的整句 {len(jtodo)} 句')


def pinyin_err(ref, hyp):
    """辨識結果和原文都轉成拼音（不分聲調）再算錯字率，同音字不算錯"""
    from pypinyin import lazy_pinyin
    from voice_check import cer, plain
    a, b = lazy_pinyin(plain(ref)), lazy_pinyin(plain(hyp))
    # cer 是逐「字」比；拼音每個字換成一個代號再比
    codes = {s: chr(0x4e00 + i) for i, s in enumerate(sorted(set(a + b)))}
    return cer(''.join(codes[s] for s in a), ''.join(codes[s] for s in b))


def starts_with_o(hyp):
    from pypinyin import lazy_pinyin
    from voice_check import plain
    first = lazy_pinyin(plain(hyp)[:1])
    return bool(first) and first[0] in ('o', 'ou', 'wo')


def cmd_page():
    from voice_pick import SCRIPT, STYLE
    out = parts_dir()
    options = json.loads((out / 'options.json').read_text(encoding='utf-8'))
    heard = json.loads((out / 'asr.json').read_text(encoding='utf-8')) if (out / 'asr.json').exists() else {}
    missing = [src for item in options.values() for _, _, src in item['options'] if src not in heard]
    if missing:
        sys.exit(f'還有 {len(missing)} 段沒辨識，先跑 check')
    hidden = {}
    # Roger 已經挑的照樣列（他聽過覺得可以，辨識寫錯字的例如緞帶髮飾 6 次都聽成「你帶法事」）
    picked = {k: p.get('take') for k, p in json.loads(PICKS.read_text(encoding='utf-8')).get(CID, {}).get(PARTS, {}).items()}

    from voice_check import gaps

    def longest_gap(src):
        y, sr = sf.read(out / src, dtype='float32')
        return max((g for _, g in gaps(y, sr)), default=0.0)

    def block(key, item, title):
        rows = [f'<div class="line" data-key="{key}"><h3>{html.escape(title)}<span class="status"></span></h3>'
                f'<div class="say">{html.escape(item["say"])}</div><table>']
        shown = []
        for value, label, src in item['options']:
            hyp = heard[src]
            if key in REPICK and value < REPICK[key] and picked.get(key) != value:
                continue
            err = 0.0 if key in NO_ASR else pinyin_err(item['say'], hyp)
            ok = err <= MAX_ERR.get(key, MAX_ERR['head']) and (key != 'fei-gift-001.tail' or starts_with_o(hyp))
            gap = longest_gap(src) if item['kind'] == 'head' else 0.0
            if picked.get(key) == value:
                shown.append((-1, value, label + ('（你挑的，目前接的這個）' if key in REPICK else '（你挑的）'), src, hyp))
            elif ok and gap > HEAD_GAP:
                hidden.setdefault(key, []).append(f'{label}（中間停 {gap:.2f} 秒）')
            elif ok:
                shown.append((-0.5 if value >= 9000 else err, value, label, src, hyp))  # 借來比較的排在你挑的後面
            else:
                hidden.setdefault(key, []).append(f'{label}（聽成「{hyp}」）')

        def row(value, label, src, hyp):
            return (f'<tr><td><label><input type="radio" name="{key}" value="{value}"> <b>{label}</b></label></td>'
                    f'<td><audio controls preload="none" src="{CID}/{PARTS}/{src}"></audio></td>'
                    f'<td class="dim">聽成：{html.escape(hyp)}</td></tr>')
        for err, value, label, src, hyp in sorted(shown, key=lambda r: (r[0], r[1])):
            rows.append(row(value, label, src, hyp))
        if key in hidden:
            rows.append(f'<tr><td colspan="3" class="dim">辨識念錯、沒列出來的 {len(hidden[key])} 個：'
                        + html.escape('、'.join(hidden[key])) + '</td></tr>')
        rows.append(f'<tr><td><label><input type="radio" name="{key}" value="none"> 都不行</label></td>'
                    f'<td colspan="2"><input type="text" placeholder="備註"></td></tr></table></div>')
        return '\n'.join(rows)

    page = [f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>收禮台詞分開挑</title><style>{STYLE}</style>',
            f'<body data-cid="{CID}" data-cfg="{PARTS}">',
            f'<div class="bar"><b>收禮台詞：前半、後半分開挑</b><span id="count" class="status"></span></div>',
            '<p>後半句（從「謝謝」開始）兩句各挑一個，15 種禮物共用；前半只有禮物名稱，每種禮物各挑一次。挑完我照挑的接起來，'
            '再給你聽接好的整句。點一個就會自動存檔。</p>',
            '<p class="dim">每個候選都先用語音辨識（Breeze-ASR-25）檢查過，只列念對的（同音字算對）；「沒想到」那句的後半，'
            '開頭聽不到「喔」的也不列。辨識判斷不了聲調和語氣，這部分要靠你聽。</p>',
            '<p class="dim">第五輪：「抽屜」那句的拭鏡布，第三輪念的 30 次全部列出來（寫成拭靜布、拭淨布、拭境布各 10 次），'
            '不用辨識排除：辨識對這個詞不準，「聽成」只當參考。挑一個就好，「都不行」那個勾會被蓋過去。'
            '運動護腕目前接的是原本的加句號第 7 次，第四輪新念的也還在，要換再挑。其他挑好的不再列，'
            f'照挑的接好的整句在 <a href="{CID}-gift-joined.html">接好的整句</a>。名稱中間停超過 {HEAD_GAP} 秒的不列。</p>']
    pending = {k for k in options if not picked.get(k) or k in REPICK}  # 「都不行」存成 take: null，也算還沒挑好
    tails = [line for line in LINES if f'{line}.tail' in pending]
    if tails:
        page.append('<h2>後半句（共用）</h2><p class="dim">版本：' + '；'.join(f'{k}＝{d}' for k, _, d, _ in TAIL_SRC) + '</p>')
    for line in tails:
        page.append(block(f'{line}.tail', options[f'{line}.tail'], f'{line} 後半'))
    for line in LINES:
        heads = [(gid, name) for gid, name in gifts() if f'{line}.{gid}.head' in pending]
        if heads:
            page.append(f'<h2>{line} 前半（禮物名稱）</h2>')
        for gid, name in heads:
            key = f'{line}.{gid}.head'
            item = dict(options[key], say=name)
            page.append(block(key, item, f'{name}{HEAD_SUFFIX[line]}（{line}）'))
    page.append(f'<script>{SCRIPT}</script>')
    path = BREEZY / f'{CID}-gift-split-pick.html'
    path.write_text('\n'.join(page), encoding='utf-8')
    print(f'挑選頁 {path}')
    for key, items in hidden.items():
        print(f'  {key} 不列 {len(items)} 個')


def option_file(key, value):
    """挑選頁存的值換回檔名"""
    item = json.loads((parts_dir() / 'options.json').read_text(encoding='utf-8'))[key]
    return next(src for v, _, src in item['options'] if v == value)


def cmd_join():
    from voice_pick import STYLE
    picks = json.loads(PICKS.read_text(encoding='utf-8')).get(CID, {}).get(PARTS, {})
    parts = parts_dir()
    out = BREEZY / CID / JOINED
    out.mkdir(parents=True, exist_ok=True)
    rows, missing, record = [], [], {}
    jheard = json.loads((out / 'asr.json').read_text(encoding='utf-8')) if (out / 'asr.json').exists() else {}
    for line in LINES:
        t = picks.get(f'{line}.tail', {}).get('take')
        if not t:
            missing.append(f'{line} 後半')
            continue
        tail_name = option_file(f'{line}.tail', t)
        tail, sr = sf.read(parts / tail_name, dtype='float32')
        for gid, name in gifts():
            h = picks.get(f'{line}.{gid}.head', {}).get('take')
            if not h:
                missing.append(f'{name}（{line}）')
                continue
            head_name = option_file(f'{line}.{gid}.head', h)
            head, _ = sf.read(parts / head_name, dtype='float32')
            a, b = level([head, tail], 'shy')  # 和念的時候一樣：兩段音量對齊（害羞只壓太大聲的）
            y = np.concatenate([a, np.zeros(int(GAP[line] * sr), np.float32), b])
            key = f'{line}.{gid}'
            say = name + HEAD_SUFFIX[line] + TAIL_TEXT[line]
            sf.write(out / f'{key}_t1.wav', y, sr, subtype='PCM_16')
            record[key] = {'head': head_name, 'tail': tail_name, 'say': say}
            j = jheard.get(key) or {}
            hyp = j.get('heard') if j.get('parts') == [head_name, tail_name] else None  # 換了段的舊結果不算
            note = (f'聽成：{html.escape(hyp)}（拼音錯 {pinyin_err(say, hyp):.0%}）' if hyp is not None else '還沒辨識')
            rows.append(f'<tr><td>{html.escape(name)}</td><td class="dim">{line}</td>'
                        f'<td><audio controls preload="none" src="{CID}/{JOINED}/{key}_t1.wav"></audio></td>'
                        f'<td class="dim">{note}</td></tr>')
    (out / 'join.json').write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding='utf-8')
    page = [f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>收禮台詞接好的整句</title><style>{STYLE}</style>',
            '<body><div class="bar"><b>收禮台詞：接好的整句</b></div>',
            '<p class="dim">照分開挑的前半、後半接起來（中間的停頓和原文的「？」「……」一樣長），每句都用語音辨識檢查過；'
            '「拼音錯」是辨識結果和原文轉成拼音（不分聲調）比的錯字率。</p>'
            + (f'<p>還沒挑好：{html.escape("、".join(missing))}</p>' if missing else '') + '<table>', *rows, '</table>',
            '<script>document.addEventListener("play", e => document.querySelectorAll("audio").forEach(a => a !== e.target && a.pause()), true)</script>']
    (BREEZY / f'{CID}-gift-joined.html').write_text('\n'.join(page), encoding='utf-8')
    print(f'接好 {len(record)} 句 → {out}，試聽頁 {BREEZY / f"{CID}-gift-joined.html"}')
    if missing:
        print('還沒挑：' + '、'.join(missing))


if __name__ == '__main__':
    {'cut': cmd_cut, 'check': cmd_check, 'page': cmd_page, 'join': cmd_join}[sys.argv[1]]()
