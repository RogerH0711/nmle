"""重做某位角色的立繪去背：從 Colab 產生的原圖重新去背，輸出到 data/characters/<角色>/。

notebook 步驟 4 已經用同樣的方法（bria-rmbg 去背 + 去白邊）；這個工具給「已經輸出、要重做」的立繪用。
需要原圖：把 Google Drive 的 nmle-art/expr/animagine/<角色>/<基本立繪 seed>/ 下載到 art/<角色>/<基本立繪 seed>/。
選用的表情 seed 見 characters.md 的「定稿紀錄」。

用法（需要 rembg、scipy：pip install "rembg[cpu]" scipy）：
    python art/recut.py fei 113 normal=2 happy=2 shy=2 sad=2 surprised=2 pout=2
    python art/recut.py fei 113 --mask art/mask/mask_fei_bria-rmbg.png normal=2 ...

--mask：直接用現成的遮罩（例如在 Colab 算好下載回來的），不在本機跑去背模型。
bria-rmbg 模型約 1 GB，在某些網路下載很慢，這時先在 Colab 算遮罩比較快。
去背只用 normal 那張算一次，所有表情共用同一個遮罩，切換表情時輪廓才不會跳動（同 notebook）。
"""
import sys
from pathlib import Path

from PIL import Image

from defringe import defringe, whitish_edges
from recolor import save_portrait

ROOT = Path(__file__).resolve().parent.parent


def main(char, base_seed, picks, mask_path=None):
    src = {name: ROOT / 'art' / char / base_seed / name / f'{seed}.png' for name, seed in picks.items()}
    missing = [str(p) for p in src.values() if not p.exists()]
    if missing:
        sys.exit('找不到原圖：\n' + '\n'.join(missing))
    if mask_path:
        alpha = Image.open(mask_path).convert('L')
    else:
        from rembg import new_session, remove
        print('去背中（bria-rmbg）……', flush=True)
        alpha = remove(Image.open(src['normal']).convert('RGB'), session=new_session('bria-rmbg'), only_mask=True).convert('L')
    out_dir = ROOT / 'data' / 'characters' / char
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, path in src.items():
        rgba = Image.open(path).convert('RGB')
        rgba.putalpha(alpha)
        fixed = defringe(rgba)
        save_portrait(fixed, out_dir / f'{name}.webp', char)  # 顏緋會自動調色（art/recolor.py）
        print(f'{name}：白邊像素 {whitish_edges(rgba)} → {whitish_edges(fixed)}')


if __name__ == '__main__':
    args = sys.argv[1:]
    mask = None
    if '--mask' in args:
        i = args.index('--mask')
        mask = args[i + 1]
        del args[i:i + 2]
    if len(args) < 3:
        sys.exit(__doc__)
    main(args[0], args[1], dict(a.split('=') for a in args[2:]), mask)
