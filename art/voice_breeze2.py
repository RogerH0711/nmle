# 評估 Breeze TTS 2（BreezeBlue，3B，2026-08）念台詞，和 BreezyVoice 比較（11/12 Roger：可以控制語氣的話應該比較好，先評估成效和實作性）
#
# 裝在 WSL 的 ~/code/breeze-tts（官方推論程式，.venv 是 Python 3.12、torch 2.9.1），權重在 ~/code/breeze-tts-2。在 WSL 裡執行：
#   ~/code/breeze-tts/.venv/bin/python art/voice_breeze2.py fei B_s1 --mode clone --takes 4
#   ~/code/breeze-tts/.venv/bin/python art/voice_breeze2.py fei B_s1 --mode direct --takes 4
# 輸出放在和 voice_breezy.py 同一個地方（art/bakeoff/voice/breezy/<角色>/breeze2-<mode>-<候選>/<語音 key>_t<k>.wav），
# 這樣 voice_check.py breezy 和 voice_export.py 不用改就能辨識、評分、產生試聽頁。
#
# 模式：
# - clone：只給參考音檔和它的逐字稿（和 BreezyVoice 一樣的用法）
# - direct：參考音檔 + 語氣指示（instruction）。指示依台詞的表情（expression）換，見 DIRECTION
# 授權（模型權重的 LICENSE，11/12 讀過）：研究與非商業用途，自己跑出來的音檔也一樣；不能拿它的輸出去改進其他語音模型
#（§5(b)），所以不拿它做的聲音給 BreezyVoice 用。要上線的話要加上它要求的授權聲明（§4(c)）。
import argparse
import json
import re
import sys
from pathlib import Path

ART = Path(__file__).resolve().parent
REPO = Path.home() / 'code' / 'breeze-tts'
CKPT = Path.home() / 'code' / 'breeze-tts-2'
sys.path[:0] = [str(ART), str(REPO)]

from voice_breezy import DATA, OUT, REF_TEXT, TEST_LINES, voice_items  # noqa: E402

# 試念的台詞：voice_breezy 的 TEST_LINES，加上 11/12 B_s1 念不好的（停頓、醫學名詞、語氣詞）
EVAL_LINES = {
    'fei': TEST_LINES['fei'] + ['fei-correct-009', 'fei-correct-012', 'fei-wrong-008', 'fei-start-007',
                                'fei-streak-006', 'fei-gift-002', 'fei-correct-001', 'fei-correct-011'],  # 後兩句有「嗯」
}

# 11/13：clone 的錯字多半是大陸讀音（「學姊」念成 zǐ、「乾酪」念成 qián），換成同音、大陸也念對的字
# 11/13 Roger：clone-say「大陸腔有點變重」，姊→姐 拿掉，只留乾酪
SAY = [('乾酪', '干酪')]
# 11/14 Roger：「研究」的「究」台灣念四聲，模型念成一聲。試了研就、研舊、研救（fei-jiu.html），每句聽起來最好的不一樣，所以照台詞分開換（--say 才套用）
# 11/14 Roger 聽 v3：賄賂念成「散路」、學姊念成「學子」、飲料的「飲」念成一聲；辨識也抓到乾酪念成「乾陋」。第 19 次以後才換字
LINE_SAY = {'fei-wrong-003': [('研究', '研就')], 'fei-correct-014': [('研究', '研舊')],
            # 11/14 Roger：「台灣人會把賄賂說成會洛」；wrong-004 的「腫脹」30 次都念成「腫孩」；wrong-006「下一題」語氣沒接上，併成同一段念（第 31 次以後）
            'fei-gift-002': [('賄賂', '會洛')], 'fei-wrong-004': [('腫脹', '腫帳')], 'fei-wrong-006': [('樣子。下一題', '樣子，下一題')], 'fei-streak-006': [('學姊', '學姐')],
            'fei-correct-009': [('干酪', '干烙')], 'fei-streak-005': [('飲料', '引料')]}
# 11/13 Roger：「有咳或是有嗯的通常發音都發不好」。「咳」換成 Breeze 的語氣標記（官方列的中文標記：[笑] [咳嗽] [清嗓子] [叹气]）。--tags 才套用
TAGS = [('咳。', '[清嗓子]'), ('咳', '[清嗓子]')]

# 中文指示（cfg 4）11/12 試過，15 句裡很多念成別的句子（finish-006 平均念錯率 88%）；官方範例的指示都是英文
ACCENT_EN = ('A young Taiwanese woman speaking Mandarin with a natural Taiwan accent: light retroflex sounds, no erhua. '
             'Clear mid-high voice, fast and crisp delivery. ')
DIRECTION_EN = {
    'normal': 'Slightly impatient and prickly, a proud tsundere tone.',
    'pout': 'Stubborn and sulky, denying her feelings.',
    'shy': 'Embarrassed and flustered, voice getting softer, a little stammering.',
    'happy': 'Happy but trying to act cool.',
    'surprised': 'Startled, pitch rising.',
    'sad': 'Low and soft, a little worried.',
}

# 11/13 Roger：direct-en2「台灣國語太重了，鄉音很濃，不是現在台灣年輕人會有的發音」。口音交給參考音檔，指示只講語氣（--emo）
EMOTION_EN = {
    'normal': 'Speak naturally, slightly impatient and prickly, like a proud tsundere.',
    'pout': 'Speak naturally, stubborn and sulky.',
    'shy': 'Speak naturally, embarrassed and flustered, voice getting softer.',
    'happy': 'Speak naturally, happy but trying to act cool.',
    'surprised': 'Speak naturally, startled.',
    'sad': 'Speak naturally, soft and a little worried.',
}

# seg：在句號、問號、驚嘆號、「……」切開，每段分開 clone，再用固定長度的靜音接起來（11/12 Roger：逗號、句號的停頓不夠，「……」念不好）。
# 「……」不送進模型，變成停頓
GAP_END = 0.40
GAP_DOTS = 0.60
TRIM_DB = -40
TRIM_PAD = 0.03


MIN_PIECE = 3  # 11/13 Roger：seg 的 finish-006「今天」單獨一段，跟後面接得很怪；比這短的段用逗號接到下一段


def segments(text, merge_short=False):
    """[(要念的文字, 之後停幾秒)]；開頭的「……」變成最前面的停頓（文字是空字串）"""
    out = _segments(text)
    if not merge_short:
        return out
    merged = []
    carry = ''
    for body, gap in out:
        if carry:
            body = carry + body
            carry = ''
        if body and len(re.sub(r'\[.*?\]|\W', '', body)) < MIN_PIECE and gap:
            carry = body if re.search(r'\[.*?\]$', body) or body[-1] in '。！？，' else body + '，'
            continue
        merged.append((body, gap))
    if carry:
        merged.append((carry, 0.0))
    return merged


def _segments(text):
    out = []
    for piece, sep in re.findall(r'(.*?)((?:……)+|[。！？]+(?:——)?|$)', text):
        piece = piece.strip('——、，')
        if not piece and not sep:
            continue
        gap = GAP_DOTS if sep.startswith('……') else GAP_END
        body = piece + ('' if sep.startswith('……') else sep.replace('——', ''))
        if body.strip('。！？'):
            out.append((body, gap))
        elif out:
            out[-1] = (out[-1][0], max(out[-1][1], gap))
        else:
            out.append(('', gap))
    if out:
        out[-1] = (out[-1][0], 0.0)
    return out


def trim(y, sr):
    import numpy as np
    frame = int(0.01 * sr)
    rms = np.sqrt(np.convolve(y ** 2, np.ones(frame) / frame, mode='same'))
    loud = np.nonzero(rms > np.abs(y).max() * 10 ** (TRIM_DB / 20))[0]
    if not len(loud):
        return y
    return y[max(loud[0] - int(TRIM_PAD * sr), 0): loud[-1] + int(TRIM_PAD * sr)]


# 11/14 Roger：comeback-002 的「坐下吧」突然變很大聲（「要注意情緒跟聲音的大小聲」）。seg 每段分開念，音量各自不同，接起來會跳
#（實測那次是前一段 -29.4 dB、「坐下吧」-22.0 dB）。各段拉到整句中位數 ±LEVEL_DB 以內；
# 害羞、難過的台詞只壓太大聲的、不拉高小聲的（說到一半變小聲是語氣的一部分）
LEVEL_DB = 1.5
KEEP_QUIET = {'shy', 'sad'}


def loudness_db(y):
    """有聲音的部分（-40 dB 以上的 10ms 框）的平均能量，dB"""
    import numpy as np
    frame = 480
    n = len(y) // frame
    if not n:
        return -100.0
    rms = np.sqrt((y[:n * frame].reshape(n, frame) ** 2).mean(1))
    active = rms[rms > rms.max() * 10 ** (-40 / 20)]
    return float(20 * np.log10(np.sqrt((active ** 2).mean()) + 1e-9))


def level(pieces, expression='normal'):
    """各段音量對齊，回傳新的 pieces（峰值不超過 0.98）"""
    import numpy as np
    if len(pieces) < 2:
        return pieces
    db = [loudness_db(p) for p in pieces]
    mid = float(np.median(db))
    lo = -np.inf if expression in KEEP_QUIET else mid - LEVEL_DB
    out = []
    for p, d in zip(pieces, db):
        g = 10 ** ((min(max(d, lo), mid + LEVEL_DB) - d) / 20)
        out.append(p * min(g, 0.98 / max(np.abs(p).max(), 1e-9)))
    return out


def split_pieces(y, sr, min_gap=0.38):  # 插入的靜音至少 0.4 秒
    """把 seg 念好的音檔在插入的靜音（連續的 0）切回各段。回傳 [(開始, 結束)]"""
    import numpy as np
    nz = np.nonzero(y)[0]
    if not len(nz):
        return []
    cuts = np.nonzero(np.diff(nz) > min_gap * sr)[0]
    starts = np.r_[nz[0], nz[cuts + 1]]
    ends = np.r_[nz[cuts] + 1, nz[-1] + 1]
    return list(zip(starts.tolist(), ends.tolist()))


def spoken(key, text, say=False, tags=False, replace=()):
    """實際送進模型的文字（換字、語氣標記）"""
    for a, b in (SAY + LINE_SAY.get(key.split('.')[0], []) if say else []) + (TAGS if tags else []) + [r.split('=', 1) for r in replace]:
        text = text.replace(a, b)
    return text


ACCENT = '台灣人說的國語，捲舌音輕、不帶兒化音，語尾助詞自然。'
DIRECTION = {
    'normal': '語速偏快，咬字俐落，語氣有點不耐煩、帶刺。',
    'pout': '嘴硬、賭氣的語氣，有點不服氣。',
    'shy': '害羞、心虛，說到一半變小聲、有點結巴。',
    'happy': '掩飾不住的開心，但還是裝得很酷。',
    'surprised': '嚇了一跳，語氣上揚。',
    'sad': '低落、輕聲，帶一點擔心。',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('character')
    ap.add_argument('ref')
    ap.add_argument('--mode', choices=['clone', 'direct', 'seg'], default='clone')
    ap.add_argument('--takes', type=int, default=4)
    ap.add_argument('--lines', nargs='+')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--cfg-scale', type=float, default=None, help='預設 clone 1.0、direct 4（官方範例）')
    ap.add_argument('--tag', help='輸出資料夾再加的後綴')
    ap.add_argument('--en', action='store_true', help='direct 的指示用英文（DIRECTION_EN）')
    ap.add_argument('--emo', action='store_true', help='direct 的指示只講語氣、不講口音（EMOTION_EN）')
    ap.add_argument('--say', action='store_true', help='套用 SAY 的換字')
    ap.add_argument('--tags', action='store_true', help='套用 TAGS（語氣詞換成 Breeze 的語氣標記）')
    ap.add_argument('--merge-short', action='store_true', help='seg：太短的段接到下一段')
    # 11/14 Roger：「研究」的「究」台灣念四聲（ㄐㄧㄡˋ），模型念成一聲（大陸讀音）。試同音、大陸也念四聲的字，例如 --replace 研究=研就
    # 11/14 Roger：mock_high-002 疑問句尾音不上揚，30 次「完全不行」。試直接下指示（cfg 1.5，和 direct-emo 一樣）
    ap.add_argument('--instruct', help='每句都用這個語氣指示（英文）')
    ap.add_argument('--replace', nargs='+', default=[], metavar='原文=念法', help='額外換字（試念用）')
    args = ap.parse_args()
    cid = args.character

    import numpy as np
    import soundfile as sf
    import torch
    from breeze_infer.runtime import load_runtime, set_all_seeds, update_generation_config_for_breeze
    from breeze_infer.templates import get_template, prepare_inputs, select_template_name
    from models.fast_streaming import FastBreezeStreamingRuntime, FastStreamingConfig

    lines = json.loads((DATA / f'{cid}.json').read_text(encoding='utf-8'))['lines']
    expression = {l['id']: l.get('expression', 'normal') for l in lines}
    items = voice_items(lines, None if args.all else set(args.lines or EVAL_LINES[cid]))

    tokenizer, model, audio_tokenizer = load_runtime(CKPT, device='cuda:0', attn_implementation='eager')
    update_generation_config_for_breeze(model)
    # 和官方 infer.py 一樣的設定，不開 fast path（要 14.4 GiB）
    runtime = FastBreezeStreamingRuntime(model, audio_tokenizer, FastStreamingConfig(
        max_new_tokens=1500, max_seq_len=2048, fast_all=False, fast_text_encoder=False, fast_backbone_prefill=False,
        fast_backbone_decode=False, fast_depth_decoder=False, fast_codec=False, repetition_penalty=1.1), tokenizer=tokenizer)
    print(f'loaded, GPU {torch.cuda.memory_allocated() / 2**30:.2f} GiB', flush=True)

    ref_wav = ART / 'bakeoff' / 'voice' / cid / f'{args.ref}.wav'
    cfg_scale = args.cfg_scale or (4.0 if args.mode == 'direct' else 1.0)
    name = f'breeze2-{args.mode}-{args.ref}' + (f'-{args.tag}' if args.tag else '')
    out = OUT / cid / name
    out.mkdir(parents=True, exist_ok=True)
    for n, (key, text) in enumerate(items, 1):
        text = spoken(key, text, args.say, args.tags, args.replace)
        # 實際念的文字和分段記在 sent.json，給 voice_export（評分扣掉語氣標記換掉的字）和 voice_prosody（找問句段）用
        sent_path = out / 'sent.json'
        sent = json.loads(sent_path.read_text(encoding='utf-8')) if sent_path.exists() else {}
        sent[key] = {'text': text, 'pieces': [t for t, _ in segments(text, args.merge_short) if t] if args.mode == 'seg' else [text]}
        sent_path.write_text(json.dumps(sent, ensure_ascii=False, indent=1), encoding='utf-8')
        request = {'id': key, 'text': text, 'speaker': 'S0', 'ref_audio_path': str(ref_wav), 'ref_text': REF_TEXT[(cid, args.ref)]}
        if args.instruct:
            request['instruction'] = args.instruct
        elif args.mode == 'direct' or args.emo:
            face = expression[key.split('.')[0]]
            request['instruction'] = (EMOTION_EN[face] if args.emo else ACCENT_EN + DIRECTION_EN[face] if args.en
                                      else ACCENT + DIRECTION[face])
        for k in range(1, args.takes + 1):
            path = out / f'{key}_t{k}.wav'
            if path.exists():
                continue
            def say_one(t, rid):
                set_all_seeds(k)
                req = {**request, 'text': t, 'id': rid}
                inputs = prepare_inputs(tokenizer, audio_tokenizer, model, [req], get_template(select_template_name(req)),
                                        guidance_scale=cfg_scale, guidance_scale_ref=None, guidance_scale_ins=None)
                return np.concatenate([c.audio for c in runtime.iter_audio_chunks(inputs, request_id=rid, seed=k)])

            sr = runtime.sample_rate
            if args.mode == 'seg':
                segs = segments(text, args.merge_short)
                voiced = level([trim(say_one(t, f'{key}-{i}').astype(np.float32), sr) for i, (t, _) in enumerate(segs) if t],
                               expression[key.split('.')[0]])
                parts = []
                for t, gap in segs:
                    if t:
                        parts.append(voiced.pop(0))
                    parts.append(np.zeros(int(gap * sr), np.float32))
                y = np.concatenate(parts)
            else:
                y = say_one(text, key)
            sf.write(path, y, sr, subtype='PCM_16')
        print(f'{n}/{len(items)} {key}  peak GPU {torch.cuda.max_memory_allocated() / 2**30:.2f} GiB', flush=True)


if __name__ == '__main__':
    main()
