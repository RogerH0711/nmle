# BGM 候選：ACE-Step 1.5 turbo 生成純音樂，給 Roger 挑一首定案
#
# 環境：art/ace-step（git clone，不進 repo，`uv sync` 建 .venv，模型第一次跑會自動下載到 checkpoints/）。
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/bgm.py [曲目 id ...]
# 輸出：art/bakeoff/bgm/<曲目 id>/s<seed>.flac（不進 repo）；已經有的 seed 會跳過，可以中斷後續跑。
#
# 3070 只有 8GB：照官方 Tier 建議用 2B turbo、INT8 量化、CPU offload，不載 LM（曲風都由 caption 指定，用不到它改寫）。
# 同一個行程每生成一首，記憶體約多 3.6GB 不會放掉，連跑 13 首用到 47GB、把虛擬記憶體撐爆後無聲結束（沒有 Traceback）。
# 一次跑 10 首以內，或結束後再跑一次接著做。
import shutil
import sys
import time
from pathlib import Path

ART = Path(__file__).parent
ACE = ART / 'ace-step'
sys.path.insert(0, str(ACE))

OUT = ART / 'bakeoff' / 'bgm'
SEEDS = range(1, 5)
DURATION = 100  # 秒：夠長才不會一下就聽出循環，定案時再切循環點

# 所有曲目共用：要能邊讀書邊聽，所以不能有人聲、不能有搶注意力的主旋律
COMMON = 'instrumental background music for a visual novel, no vocals, gentle and unobtrusive, suitable for studying, clean mix'

# 曲目 id 見 web/src/audioRules.ts 的 chooseBgm；角色的感覺取自 characters.md 的個性
TRACKS = {
    'map': dict(bpm=92, key='C major', sig='4', style='sunny university campus afternoon, acoustic guitar, soft piano, light shaker, warm and carefree'),
    'library': dict(bpm=72, key='F major', sig='4', style='quiet library at dusk, mellow felt piano, soft pad, faint vinyl warmth, calm and focused'),
    'theme_jingcheng': dict(bpm=66, key='A minor', sig='4', style='cool and reserved, sparse solo piano, distant cello, cold ambient pad, lots of space between notes, minimal'),
    # v1（ukulele、拍手、116 BPM）四首 Roger 都覺得很難聽；改成柔和一點的流行樂，元氣靠節奏和明亮的音色，不靠吵
    'theme_yiqing': dict(v=2, bpm=108, key='D major', sig='4', style='sunny upbeat pop instrumental, clean electric guitar, warm electric piano, soft synth pad, light steady drum groove, positive and encouraging, not busy'),
    'theme_ying': dict(bpm=80, key='E minor', sig='3', style='sweet yet slightly unsettling waltz, music box, celesta, soft pizzicato strings, delicate, a little eerie'),
    'theme_zhixun': dict(bpm=84, key='F major', sig='4', style='warm and mature, smooth jazz lounge, Rhodes electric piano, upright bass, brushed drums, relaxed and elegant'),
    # v1（斷奏弦樂、撥弦、100 BPM）最高 6 分；改成鋼琴主奏加弦樂四重奏，俐落但溫暖
    'theme_fei': dict(v=2, bpm=92, key='A minor', sig='4', style='confident and elegant chamber pop, expressive piano lead, string quartet, gentle cello line, crisp yet warm, a little sweet underneath'),
}


def main():
    # 在這裡才 import：bgm_loop.py 只要讀 TRACKS，不用載入整個 acestep
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    # 用法：bgm.py [曲目 id ...] [--seeds 5-8]
    args = sys.argv[1:]
    seeds = SEEDS
    if '--seeds' in args:
        i = args.index('--seeds')
        lo, hi = map(int, args[i + 1].split('-'))
        seeds = range(lo, hi + 1)
        del args[i:i + 2]
    names = args or list(TRACKS)
    handler = AceStepHandler()
    status, ok = handler.initialize_service(
        project_root=str(ACE),
        config_path='acestep-v15-turbo',
        device='cuda',
        compile_model=True,  # 量化需要
        offload_to_cpu=True,
        offload_dit_to_cpu=True,
        quantization='int8_weight_only',
    )
    if not ok:
        sys.exit(f'模型載入失敗：{status}')

    for name in names:
        t = TRACKS[name]
        folder = OUT / name
        folder.mkdir(parents=True, exist_ok=True)
        prefix = f"v{t['v']}_" if 'v' in t else ''  # 改過描述的曲目換檔名，舊的候選留著對照
        for seed in seeds:
            target = folder / f'{prefix}s{seed}.flac'
            if target.exists():
                continue
            params = GenerationParams(
                caption=f"{t['style']}, {COMMON}",
                lyrics='[Instrumental]',
                instrumental=True,
                bpm=t['bpm'],
                keyscale=t['key'],
                timesignature=t['sig'],
                duration=DURATION,
                inference_steps=8,
                seed=seed,
                thinking=False,
                use_cot_metas=False,
                use_cot_caption=False,
                use_cot_language=False,
            )
            config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[seed], audio_format='flac')
            start = time.time()
            result = generate_music(handler, None, params, config, save_dir=str(folder / 'tmp'))
            if not result.success:
                sys.exit(f'{name} s{seed} 失敗：{result.error}')
            shutil.move(result.audios[0]['path'], target)
            shutil.rmtree(folder / 'tmp', ignore_errors=True)
            print(f'{name} s{seed}：{time.time() - start:.0f} 秒', flush=True)


if __name__ == '__main__':
    main()
