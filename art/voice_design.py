# 五位學姊的候選聲音：Qwen3-TTS VoiceDesign 用文字描述生成聲音，給 Roger 挑一個當參考音檔
#
# 環境：.venv-tts-fast（faster-qwen3-tts 0.5.4 + transformers 5.15.1，5.20 載入會出錯），3070 上約 0.5 倍即時。
#   .venv-tts-fast/Scripts/python.exe -X utf8 art/voice_design.py [角色 id ...]
# 輸出：art/bakeoff/voice/<角色>/<描述>_s<seed>.wav（不進 repo）
#
# VoiceDesign 每次生成都會抽一個新的聲音，同一段描述換 seed 就是不同的人，所以每段描述跑幾個 seed。
# 描述 A 直接寫「台灣口音」；描述 B 改寫成具體的發音特徵（捲舌輕、沒有兒化音），看哪種比較像台灣人。
import sys
from pathlib import Path

import soundfile as sf
import torch

OUT = Path(__file__).parent / 'bakeoff' / 'voice'
SEEDS = range(1, 7)  # 3 個常常全部念錯同一個詞（夏以晴的「配速」），多抽幾個再用 voice_check.py 篩
TAIWAN = '台灣人說的國語：捲舌音輕、不帶兒化音，語尾助詞自然。'
# Qwen3-TTS 照大陸讀音，「姊」念成 zǐ（台灣念 jiě），送進模型前換成同音的字
SAY = str.maketrans({'姊': '姐'})

NAMES = {'jingcheng': '沈靜澄', 'yiqing': '夏以晴', 'ying': '葉縈', 'zhixun': '溫芷薰', 'fei': '顏緋'}

# 試聽的句子取自 characters.md 的台詞範例，{player} 代入「學弟」
VOICES = {
    'jingcheng': {
        'person': '26歲的女研究生，解剖學助教，寡言冷靜。',
        'voice': '中低音，音色清冷乾淨，語速慢，句子之間常有停頓，語調平穩、起伏很小，帶一點知性的距離感，但不兇。',
        'text': '……正確。手的位置，記住了就不要忘。三天沒來。……我把你的位子留著。只是剛好沒人坐而已。',
    },
    'yiqing': {
        'person': '24歲的醫學系女學生，田徑隊，開朗有活力。',
        'voice': '明亮的中高音，語速偏快，語調上揚，笑著說話，充滿元氣，像剛跑完步一樣有精神。',
        'text': '漂亮！這題的配速完美！學弟——！你跑去哪了啦！我一個人讀書好無聊，以後不准偷跑！',
    },
    'ying': {
        'person': '25歲的女研究助理，輕聲細語、溫柔，但愛得有點太重。',
        # 原本寫「語速慢，語尾稍微拖長」，念出來每秒不到 2 個字，一句台詞要 20 秒
        'voice': '偏高的輕柔女聲，帶一點氣音，語速適中，偶爾把語尾輕輕拖長、上揚，甜甜的，卻讓人有點發毛。',
        'text': '答對了呢。我就知道，你最聰明了。錯了也沒關係喔。錯的題目，我都幫你記下來了。全部、都記下來了。',
    },
    'zhixun': {
        'person': '27歲的女臨床藥師，溫柔包容、成熟的大姊姊，喜歡逗學弟。',
        'voice': '溫暖的中低音，音色柔和成熟，語速慢，帶著笑意，有點慵懶，像在哄人。',
        'text': '好棒好棒，小學弟今天的吸收率很好呢。好久不見了呢。藥要按時吃，書也要按時讀喔。姊姊有點寂寞了。',
    },
    'fei': {
        'person': '28歲的女住院醫師，嘴硬心軟、好勝的傲嬌。',
        'voice': '清亮的中高音，語速偏快，咬字俐落，語氣有點不耐煩、帶刺，說到在意的地方會突然結巴、變小聲。',
        'text': '哼，算你還有點腦袋。不是在誇你喔！你、你這幾天跑去哪了？我才沒有在等你！只是考古題印好了沒人拿而已！',
    },
}


def instructs(v):
    return {
        'A': f"{v['person']}台灣口音。{v['voice']}",
        'B': f"{v['person']}{TAIWAN}{v['voice']}",
    }


def main():
    from faster_qwen3_tts import FasterQwen3TTS  # 只在 .venv-tts-fast；voice_check.py 只讀上面的 VOICES

    ids = sys.argv[1:] or list(VOICES)
    model = FasterQwen3TTS.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', local_files_only=True)
    for cid in ids:
        v = VOICES[cid]
        (OUT / cid).mkdir(parents=True, exist_ok=True)
        for name, instruct in instructs(v).items():
            (OUT / cid / f'{name}.txt').write_text(instruct, encoding='utf-8')
            for seed in SEEDS:
                torch.manual_seed(seed)
                wavs, sr = model.generate_voice_design(text=v['text'].translate(SAY), instruct=instruct, language='Chinese')
                path = OUT / cid / f'{name}_s{seed}.wav'
                sf.write(path, wavs[0], sr)
                print(f'{path.relative_to(OUT)} {len(wavs[0]) / sr:.1f} 秒', flush=True)


if __name__ == '__main__':
    main()
