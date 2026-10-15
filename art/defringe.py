"""立繪去背的後處理：合併兩個去背模型的遮罩（combine_masks），再修正半透明邊緣的顏色（defringe）。

去背模型給頭髮細絲、輪廓邊緣的是半透明遮罩，這沒問題；但這些像素的顏色仍混著原本的淺灰白背景，
放在網站的深色背景上會出現一圈白色光暈。這裡保留每個像素的透明度，只修正顏色：
半透明像素 = 前景 × 透明度 + 背景 × (1 - 透明度)，用去背前的背景色反推出前景色；
太透明、反推不穩定的像素，改用附近不透明部分的平滑顏色。邊緣仍然柔和，但不再帶著背景的白。

透明度本身給錯的地方（例如髮絲之間的背景被當成頭髮）defringe 救不回來，交給 combine_masks；
試過依顏色修正透明度，但白袍和淺灰背景太像，會削掉白袍邊緣，所以不做。

要在存成 webp 之前、還有去背前原圖的時候做：全透明的地方要是原本的背景色才算得準。
webp 壓縮會改掉部分看不到的像素（試過從 webp 還原原圖，髮絲間出現棋盤格），所以不要拿輸出後的 webp 來處理。

notebook 步驟 4 輸出 webp 前會用同樣的函式；改這裡要一起改 notebook。
已經輸出的立繪要重做，用 art/recut.py。

"""
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter

SOLID = 230  # 透明度高於這個值的像素顏色可信，不動


def smooth_fill(rgb, known, sigma):
    """用 known 像素的顏色平滑地填滿整張圖（高斯加權平均）；離太遠的退回最近像素的顏色。"""
    w = gaussian_filter(known.astype(float), sigma)
    filled = np.stack([gaussian_filter(rgb[..., c] * known, sigma) for c in range(3)], -1) / np.maximum(w, 1e-6)[..., None]
    far = w < 1e-3
    if far.any():
        _, (iy, ix) = distance_transform_edt(~known, return_indices=True)
        filled[far] = rgb[iy, ix][far]
    return filled


def defringe(image: Image.Image, solid: int = SOLID) -> Image.Image:
    rgba = np.array(image.convert('RGBA')).astype(float)
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    clear = alpha == 0
    if not clear.any() or not (alpha >= solid).any():
        return image
    # 每個位置原本的背景色：全透明的地方還是去背前的背景，從那裡平滑地推過來（背景有漸層也能處理）
    bg = smooth_fill(rgb, clear, 6)
    # 半透明像素 = 前景 × a + 背景 × (1 - a)，用背景色反推前景（把混進來的背景白扣掉）
    a = (alpha / 255)[..., None]
    fg = np.clip((rgb - (1 - a) * bg) / np.maximum(a, 1e-3), 0, 255)
    # 很透明的像素反推不穩定，改用附近不透明部分的平滑顏色
    near = smooth_fill(rgb, alpha >= solid, 2)
    t = np.clip((a - 0.15) / 0.35, 0, 1)
    semi = alpha < solid
    out = rgb.copy()
    out[semi] = (t * fg + (1 - t) * near)[semi]
    rgba[..., :3] = out
    return Image.fromarray(rgba.round().astype(np.uint8), 'RGBA')


def combine_masks(isnet: Image.Image, birefnet: Image.Image, cut: float = 60, sigma: float = 1.5) -> Image.Image:
    """合併兩個去背模型的遮罩：以 isnet-anime 的平滑邊緣為主，BiRefNet 判斷為背景的地方挖掉。
    isnet-anime 會把髮絲之間的背景當成半透明的頭髮留下來；BiRefNet 能分辨那是背景，但細髮絲的邊緣會變成鋸齒。
    BiRefNet 的遮罩先稍微模糊，鋸齒才不會傳到結果上。"""
    b = gaussian_filter(np.asarray(birefnet.convert('L')).astype(float), sigma)
    keep = np.clip(b / cut, 0, 1)
    return Image.fromarray((np.asarray(isnet.convert('L')).astype(float) * keep).round().astype(np.uint8), 'L')


def whitish_edges(image: Image.Image) -> int:
    """半透明、又很亮很灰的像素數（白邊的程度），用來比較處理前後"""
    a = np.asarray(image.convert('RGBA')).astype(int)
    rgb, alpha = a[..., :3], a[..., 3]
    semi = (alpha > 20) & (alpha < SOLID)
    return int((semi & (rgb.mean(-1) > 215) & (rgb.max(-1) - rgb.min(-1) < 25)).sum())
