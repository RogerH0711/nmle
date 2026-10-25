# 用 BreezyVoice（聯發科，台灣華語，Apache-2.0）照參考音檔的音色念台詞
#
# BreezyVoice 只支援 Linux，裝在 WSL 的 ~/code/BreezyVoice（Python 3.10，.venv）。在 WSL 裡用它的 python 執行：
#   ~/code/BreezyVoice/.venv/bin/python art/voice_breezy.py fei B_s6 --takes 4
# 參考音檔是 voice_design.py 的候選（art/bakeoff/voice/<角色>/<候選>.wav），原文預設是它該念的那句；
# 參考音檔實際念的和原文不一樣時，用 --prompt-text 給實際念的內容，--tag 把結果放到另一個資料夾比較。
# 輸出：art/bakeoff/voice/breezy/<角色>/<候選>[-<tag>]/<台詞 id>_t<k>.wav，已經有的不重做。
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


# 讀音修正：只改送進 BreezyVoice 的文字，畫面上的台詞不變。注音寫法是在字後面加 [:注音+聲調]（BreezyVoice 的格式）。
# 每一條都是語音辨識在每次試念都聽錯、多念幾次也不會好的（10/25 顏緋試念）
SAY = [
    ('壞死', '壞[:ㄏㄨㄞ4]死'),  # 8 次都被聽成「陪死」
    ('爛到', '爛[:ㄌㄢ4]到'),    # 8 次都被聽成「煉到」「練到」
    ('RR', 'R R'),               # 英文縮寫連在一起時念不出來，字母分開
    ('OR', 'O R'),
]


def say(text):
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

    model = CustomCosyVoice('MediaTek-Research/BreezyVoice')
    # 手動標注音時，single_inference.py 會在括號處切開文字、每段分開正規化，非最後一段會刪掉最後一個字，
    # 因為它假設正規化工具（ttsfrd）會在沒有句號的文字後面補「。」。沒裝 ttsfrd 時用的 WeTextProcessing 不會補，
    # 刪掉的變成被標注音的那個字（「壞[:ㄏㄨㄞ4]死」念成「[:ㄏㄨㄞ4]死」），所以在這裡補上它預期的句號
    tn = model.frontend.zh_tn_model
    normalize = tn.normalize
    tn.normalize = lambda text: (out := normalize(text)) + ('' if text.endswith('。') or out.endswith('。') else '。')
    g2p = G2PWConverter(use_cuda=True)  # onnxruntime-gpu 要明確指定 provider，不給 use_cuda 會建立失敗
    lines = {l['id']: l['text'] for l in json.loads((DATA / f'{cid}.json').read_text(encoding='utf-8'))['lines']}
    prompt = args.prompt_text or VOICES[cid]['text']
    for ref in args.refs:
        out = OUT / cid / (f'{ref}-{args.tag}' if args.tag else ref)
        out.mkdir(parents=True, exist_ok=True)
        for lid in args.lines or TEST_LINES[cid]:
            for k in range(1, args.takes + 1):
                path = out / f'{lid}_t{k}.wav'
                if path.exists():
                    continue
                random.seed(k)
                np.random.seed(k)
                torch.manual_seed(k)
                single_inference(str(ART / 'bakeoff' / 'voice' / cid / f'{ref}.wav'), say(lines[lid].replace('{player}', '學弟')),
                                 str(path), model, g2p, prompt)


if __name__ == '__main__':
    main()
