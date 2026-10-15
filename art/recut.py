"""重做某位角色的立繪去背：從 Colab 產生的原圖重新去背，輸出到 data/characters/<角色>/。

notebook 步驟 4 已經用同樣的方法（兩個去背模型合併 + 去白邊）；這個工具給「已經輸出、要用新方法重做」的立繪用。
需要原圖：把 Google Drive 的 nmle-art/expr/animagine/<角色>/<基本立繪 seed>/ 下載到 art/<角色>/<基本立繪 seed>/。
選用的表情 seed 見 characters.md 的「定稿紀錄」。

用法（需要 rembg、scipy：pip install "rembg[cpu]" scipy）：
    python art/recut.py fei 113 normal=2 happy=2 shy=2 sad=2 surprised=2 pout=2

去背只用 normal 那張算一次，所有表情共用同一個遮罩，切換表情時輪廓才不會跳動（同 notebook）。
BiRefNet 在 CPU 上一張大約一分半鐘，模型第一次會下載約 1 GB。
"""
import sys
from pathlib import Path

from PIL import Image
from rembg import new_session, remove

from defringe import combine_masks, defringe, whitish_edges

ROOT = Path(__file__).resolve().parent.parent


def main(char, base_seed, picks):
    src = {name: ROOT / 'art' / char / base_seed / name / f'{seed}.png' for name, seed in picks.items()}
    missing = [str(p) for p in src.values() if not p.exists()]
    if missing:
        sys.exit('找不到原圖：\n' + '\n'.join(missing))
    base = Image.open(src['normal']).convert('RGB')
    print('去背中（isnet-anime）……', flush=True)
    isnet = remove(base, session=new_session('isnet-anime'), only_mask=True)
    print('去背中（birefnet-general，CPU 上約一分半鐘）……', flush=True)
    bref = remove(base, session=new_session('birefnet-general'), only_mask=True)
    alpha = combine_masks(isnet, bref)
    out_dir = ROOT / 'data' / 'characters' / char
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, path in src.items():
        rgba = Image.open(path).convert('RGB')
        rgba.putalpha(alpha)
        fixed = defringe(rgba)
        fixed.save(out_dir / f'{name}.webp', 'WEBP', quality=90, method=6)
        print(f'{name}：白邊像素 {whitish_edges(rgba)} → {whitish_edges(fixed)}')


if __name__ == '__main__':
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], dict(a.split('=') for a in sys.argv[3:]))
