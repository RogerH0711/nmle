# 用 BreezyVoice（聯發科，台灣華語，Apache-2.0）照參考音檔的音色念台詞
#
# BreezyVoice 只支援 Linux，裝在 WSL 的 ~/code/BreezyVoice（Python 3.10，.venv）。在 WSL 裡用它的 python 執行：
#   ~/code/BreezyVoice/.venv/bin/python art/voice_breezy.py fei B_s6 --takes 4
#   ~/code/BreezyVoice/.venv/bin/python art/voice_breezy.py fei B_s1 --all --takes 6 --tag final   # 正式念全部台詞
#   （正式量產用 art/voice_rounds.sh：念、辨識、還不完美的再多念幾次）
# 參考音檔是 voice_design.py 的候選（art/bakeoff/voice/<角色>/<候選>.wav），原文預設是它該念的那句；
# 參考音檔實際念的和原文不一樣時，用 --prompt-text 給實際念的內容，--tag 把結果放到另一個資料夾比較。
# 輸出：art/bakeoff/voice/breezy/<角色>/<候選>[-<tag>]/<語音 key>_t<k>.wav，已經有的不重做。
# 語音 key 是台詞 id；有 {player} 的台詞念兩次，key 是 <id>.m（學弟）、<id>.f（學妹），和 web/src/audioRules.ts 的 voiceKeys 一樣。
#
# BreezyVoice 每次念的結果都不一樣（語言模型是抽樣的），所以每句念 --takes 次，
# 再用 voice_check.py breezy 挑錯字率最低的。第 k 次用 seed k，可以重現。
#
# 不用它的 batch_inference.py：那支用 datasets 的 map 逐列處理，新版 datasets 會把函式 pickle 起來，
# 裡面的 onnxruntime session 不能 pickle。這裡直接載入一次模型、逐句呼叫 single_inference。
import argparse
import json
import os
import random
import re
import sys
from pathlib import Path

ART = Path(__file__).resolve().parent
DATA = ART.parent / 'data' / 'lines'
BREEZY = Path.home() / 'code' / 'BreezyVoice'
OUT = ART / 'bakeoff' / 'voice' / 'breezy'

# 試念的台詞：各種表情、醫學名詞、英文縮寫，和台灣、大陸讀音不同的字（危險性的「危」）
TEST_LINES = {
    'fei': ['fei-start-001', 'fei-correct-004', 'fei-correct-005', 'fei-correct-014', 'fei-wrong-003',
            'fei-streak-001', 'fei-gift_liked-001', 'fei-finish-006'],
}

# 要配音的情境（docs/design.md「聲音」）：當面的反應、模擬考高分、收禮、收到服裝。學姊傳的訊息（msg_*）是文字，不配音
VOICED = {'story', 'start', 'correct', 'wrong', 'streak', 'finish', 'comeback', 'gift', 'gift_liked', 'mock_high', 'outfit'}
PLAYER = {'m': '學弟', 'f': '學妹'}

# 參考音檔實際念的內容（Breeze-ASR-25 辨識，10/25）。voice_design.py 的原文是「不是在誇你喔！你、你……」，
# Qwen3-TTS 念成「我是在誇你喔」「你你」；用實際念的當提示，BreezyVoice 比較不會亂（試念 8 句：錯字率 5% 以下 4 句，用原文 2 句）
# 11/12 Roger 改用 B_s1（「s6 蠻糟的，這個聲音不好聽」），B_s1 的辨識結果沒有「哼」和「你你」
REF_TEXT = {
    ('fei', 'B_s6'): '哼，算你還有點腦袋。我是在誇你喔！你你這幾天跑去哪了？我才沒有在等你！只是考古題印好了沒人拿而已！',
    ('fei', 'B_s1'): '算你還有點腦袋。不是在誇你喔！你這幾天跑去哪了？我才沒有在等你！只是考古題印好了沒人拿而已！',
}


def story_lines(cid):
    """劇情（data/stories/<角色>.json）裡角色說的台詞，排成和 data/lines 一樣的格式（situation 是 story）。
    旁白、玩家不配音（11/14 Roger：旁白不用有聲音）"""
    path = DATA.parent / 'stories' / f'{cid}.json'
    if not path.exists():
        return []
    out = []

    def walk(ls):
        for l in ls:
            if l['speaker'] == 'choice':
                for o in l['options']:
                    walk(o['lines'])
            elif l['speaker'] == cid and re.search(r'\w', l['text']):  # 只有「…………」的不念
                out.append({'id': l['id'], 'situation': 'story', 'expression': l.get('expression', 'normal'), 'text': l['text']})
    for scene in json.loads(path.read_text(encoding='utf-8'))['scenes']:
        walk(scene['lines'])
    return out


def gift_names():
    """{禮物 id: 名稱}（data/gifts.json）"""
    return {g['id']: g['name'] for g in json.loads((DATA.parent / 'gifts.json').read_text(encoding='utf-8'))['gifts']}


def expand(line_id, text):
    """一句台詞要錄的 (語音 key, 文字)：{player} 分學弟（.m）、學妹（.f）；{gift} 每種禮物一版（.<禮物 id>，11/15 Roger 決定每種各錄）。
    網站播的時候 key 的組法見 web/src/audioRules.ts 的 voiceKeys"""
    out = [(line_id, text)]
    if '{gift}' in text:
        out = [(f'{k}.{gid}', t.replace('{gift}', name)) for k, t in out for gid, name in gift_names().items()]
    if '{player}' in text:
        out = [(f'{k}.{p}', t.replace('{player}', v)) for k, t in out for p, v in PLAYER.items()]
    return out


def voice_items(lines, ids=None):
    """(語音 key, 要念的文字)：有 {player}、{gift} 的展開（expand）；有其他代入欄位（{hours}）的沒辦法事先錄，跳過"""
    items = []
    for l in lines:
        if ids is not None and l['id'] not in ids:
            continue
        if ids is None and l.get('situation') not in VOICED:
            continue
        text = l['text']
        if re.search(r'\{(?!player\}|gift\})', text):
            continue
        items += expand(l['id'], text)
    return items


# 讀音修正：只改送進 BreezyVoice 的文字，畫面上的台詞不變。念之前先看注音：voice_breezy.py <角色> <候選> --all --show
#（套用 SAY 後的結果，標錯的字在這裡補）。注音寫法是在字後面加 [:注音+聲調]（BreezyVoice 的格式）。
# 每一條都是語音辨識在每次試念都聽錯、多念幾次也不會好的。BreezyVoice 先把文字轉成簡體再用 g2pW 標注音，
# 錯的讀音多半是 g2pW 標的（11/12 實測：「坏」標成 ㄆㄟ2、「酪」標成 ㄌㄨㄛ4）
SAY = [
    ('壞', '壞[:ㄏㄨㄞ4]'),      # 「壞死」「考壞」都被念成「陪」（10/25、11/12 顏緋）
    ('乾酪', '乾酪[:ㄌㄠ4]'),    # 6 次都念成 lù／luò（11/12 顏緋）
    # 繁轉簡後變成多音字、g2pW 標錯的（11/12）：么 ㄧㄠ1（「這麼」聽成「這要」）、胜 ㄒㄧㄥ1（「勝算」聽成「心算」）、种 ㄔㄨㄥ2
    ('麼', '麼[:ㄇㄜ5]'),
    ('勝', '勝[:ㄕㄥ4]'),
    ('種', '種[:ㄓㄨㄥ3]'),
    ('咳', '咳[:ㄎㄜ2]'),        # 沒標注音，24 次都被聽成「可」
    ('爛到', '爛[:ㄌㄢ4]到'),    # 8 次都被聽成「煉到」「練到」
    # BreezyVoice 在句號處切開、每句分開念；fei-wrong-008 長句後面的短句「跟分化不良不一樣」12 次都念壞，接成同一句。
    # 接起來後（第 13–18 次）念得到「跟分化不良不一樣」，但最後的「不要搞混」還是沒念，這句目前沒上線
    ('上皮。跟分化', '上皮，跟分化'),
    ('RR', 'R R'),               # 英文縮寫連在一起時念不出來，字母分開
    ('OR', 'O R'),
]


def say(text):
    # 「……」會原樣送進語言模型，那裡常多出不相干的音（11/12：「……對啦」念成「可惜對了」）；開頭的刪掉，中間的換成逗號。
    # 這條在 11/12 才加，B_s6-final 的第 1–6 次是沒換的
    text = re.sub(r'^(……)+', '', text)
    text = re.sub(r'(……)+', '，', text)
    text = re.sub(r'([，。？！])，', r'\1', text)
    text = re.sub(r'，([。？！])', r'\1', text)  # 「排隊的……！」→「排隊的！」
    for a, b in SAY:
        text = text.replace(a, b)
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('character')
    ap.add_argument('refs', nargs='+')
    ap.add_argument('--takes', type=int, default=1)
    ap.add_argument('--prompt-text', help='參考音檔實際念的內容（預設是 voice_design.py 的原文）')
    ap.add_argument('--tag', help='輸出資料夾加上的後綴，用來比較不同設定')
    ap.add_argument('--lines', nargs='+', help='只念這幾句（預設是 TEST_LINES 全部）')
    ap.add_argument('--all', action='store_true', help='念全部要配音的台詞（VOICED 的情境）')
    ap.add_argument('--show', action='store_true', help='不念，只印每句前處理後的注音，用來找 g2pW 標錯的讀音')
    args = ap.parse_args()
    cid = args.character

    # 這兩個環境變數要在程式啟動前設好，所以設完重新執行自己一次：
    # - LD_LIBRARY_PATH：onnxruntime-gpu 的 cuDNN 要從 torch 附的 nvidia 套件找 libnvrtc.so（.venv 裡另外建了指向 .so.11.2 的 symlink）
    # - expandable_segments：語言模型每一步都把 attention cache 接長一點，每步配置一塊稍大的記憶體，
    #   舊的用不上，保留的記憶體每步多約 15 MB。長句念到 400 步左右 8 GB 就滿了，之後每步從 16 ms 變成 700 ms，
    #   一句要 5 分鐘；開了之後穩定在 2.5 GB，同一句 18 秒（10/25 實測）
    nvidia = BREEZY / '.venv' / 'lib' / 'python3.10' / 'site-packages' / 'nvidia'
    if 'NMLE_LD' not in os.environ:
        libs = ':'.join(str(nvidia / p / 'lib') for p in ('cuda_nvrtc', 'cudnn', 'cublas', 'cuda_runtime'))
        env = {**os.environ, 'NMLE_LD': '1', 'LD_LIBRARY_PATH': libs + ':' + os.environ.get('LD_LIBRARY_PATH', ''),
               'PYTORCH_CUDA_ALLOC_CONF': 'expandable_segments:True'}
        os.execve(sys.executable, [sys.executable, *sys.argv], env)

    sys.path.insert(0, str(ART))
    from voice_design import VOICES

    # single_inference.py 用相對路徑找 Matcha-TTS，要在它的資料夾裡執行
    os.environ['PYTHONUTF8'] = '1'
    os.chdir(BREEZY)
    sys.path[:0] = [str(BREEZY), str(BREEZY / 'third_party' / 'Matcha-TTS')]
    import numpy as np
    import torch
    from g2pw import G2PWConverter
    from single_inference import CustomCosyVoice, single_inference

    lines = json.loads((DATA / f'{cid}.json').read_text(encoding='utf-8'))['lines']
    items = voice_items(lines, None if args.all else set(args.lines or TEST_LINES[cid]))
    if args.show:
        from single_inference import get_bopomofo_rare
        from tn.chinese.normalizer import Normalizer
        tn, g2p = Normalizer(), G2PWConverter(use_cuda=True)
        for key, text in items:
            # 和 single_inference 一樣，括號裡的注音不正規化（不然聲調數字會被轉成國字）
            parts = re.split(r'(\[.*?\])', say(text))
            print(key, ''.join(p if p.startswith('[') else get_bopomofo_rare(tn.normalize(p), g2p) if p else '' for p in parts))
        return

    model = CustomCosyVoice('MediaTek-Research/BreezyVoice')
    # 手動標注音時，single_inference.py 會在括號處切開文字、每段分開正規化，非最後一段會刪掉最後一個字，
    # 因為它假設正規化工具（ttsfrd）會在沒有句號的文字後面補「。」。沒裝 ttsfrd 時用的 WeTextProcessing 不會補，
    # 刪掉的變成被標注音的那個字（「壞[:ㄏㄨㄞ4]死」念成「[:ㄏㄨㄞ4]死」），所以在這裡補上它預期的句號
    tn = model.frontend.zh_tn_model
    normalize = tn.normalize
    tn.normalize = lambda text: (out := normalize(text)) + ('' if text.endswith('。') or out.endswith('。') else '。')
    g2p = G2PWConverter(use_cuda=True)  # onnxruntime-gpu 要明確指定 provider，不給 use_cuda 會建立失敗
    for ref in args.refs:
        prompt = args.prompt_text or REF_TEXT.get((cid, ref)) or VOICES[cid]['text']
        out = OUT / cid / (f'{ref}-{args.tag}' if args.tag else ref)
        out.mkdir(parents=True, exist_ok=True)
        for n, (key, text) in enumerate(items, 1):
            for k in range(1, args.takes + 1):
                path = out / f'{key}_t{k}.wav'
                if path.exists():
                    continue
                random.seed(k)
                np.random.seed(k)
                torch.manual_seed(k)
                single_inference(str(ART / 'bakeoff' / 'voice' / cid / f'{ref}.wav'), say(text), str(path), model, g2p, prompt)
            print(f'{n}/{len(items)} {key}', flush=True)


if __name__ == '__main__':
    main()
