"""調整角色立繪的顏色（目前只有顏緋）。

10/23 Roger 看封面排版時發現：五個人放在一起，顏緋的紅特別鮮豔，跟其他人的色調不搭（單獨看立繪時看不出來）。
量過頭髮的飽和度：顏緋 0.86，其他四人 0.25–0.63。只降飽和度紅色會偏粉紅（像鮭魚色），所以飽和度和亮度一起降，
變成偏深的緋紅。比較過五個等級（art/bakeoff/cover/fei_color/），Roger 選 E：飽和度 ×0.82、亮度 −12%。

只動紅色系、而且夠鮮豔的像素：色相在 355° 前後 15° 內全套用，到 35° 漸弱為 0；飽和度 0.35 以下不動、0.55 以上全套用。
膚色、腮紅、白袍、私服的米色風衣都不受影響。data/characters/fei/ 底下 18 張（6 個表情 × 基本、私服、晚禮服）都已套用。
之後用 outfits.py、recut.py 匯出的立繪會經過 save_portrait 自動調色；用其他方式放進 data/ 的，要再跑一次這支。
調過的檔案在 EXIF 的 ImageDescription 記一筆，重跑會跳過，不會調兩次。
原圖在 git（commit 9ddbc82 以前）。

    .venv-gpu\\Scripts\\python.exe art\\recolor.py fei
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

DATA = Path(__file__).resolve().parent.parent / "data" / "characters"
# {角色: (中心色相, 飽和度倍率, 亮度降低比例)}
RECOLOR = {"fei": (355, 0.82, 0.12)}
HUE_FULL, HUE_FADE = 15, 20  # 中心色相前後幾度全套用、再往外幾度漸弱
SAT_FROM, SAT_FULL = 0.35, 0.55
MARK = "nmle-recolor"
EXIF_DESCRIPTION = 0x010E


def recolor(image, hue, factor, vdrop):
    a = np.asarray(image.convert("RGBA")).astype(np.float32) / 255
    hsv = cv2.cvtColor(a[..., :3], cv2.COLOR_RGB2HSV)  # float 輸入：H 0–360，S、V 0–1
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    dist = np.minimum(np.abs(h - hue), 360 - np.abs(h - hue))
    w = np.clip(1 - (dist - HUE_FULL) / HUE_FADE, 0, 1) * np.clip((s - SAT_FROM) / (SAT_FULL - SAT_FROM), 0, 1)
    hsv[..., 1] = s * (1 - w * (1 - factor))
    hsv[..., 2] = v * (1 - w * vdrop)
    a[..., :3] = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    return Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8), "RGBA")


def save_portrait(image, path, char, adjusted=False):
    """存角色立繪（webp，同 outfits.py 一直以來的存法）。outfits.py、recut.py 都經過這裡，新匯出的圖會自動調色。

    要調色的角色先調色，EXIF 記一筆；adjusted=True 表示來源已經是調過的圖（例如只重畫臉部、其他像素沿用
    data/ 裡的檔案），只寫記號、不再調，不然會調兩次。
    """
    if char not in RECOLOR:
        image.save(path, "WEBP", quality=90, method=6)
        return
    hue, factor, vdrop = RECOLOR[char]
    if not adjusted:
        image = recolor(image, hue, factor, vdrop)
    exif = Image.Exif()
    exif[EXIF_DESCRIPTION] = f"{MARK} hue={hue} s*{factor} v-{vdrop}"
    image.save(path, "WEBP", quality=90, method=6, exif=exif)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("char", choices=sorted(RECOLOR))
    args = ap.parse_args()
    for path in sorted((DATA / args.char).rglob("*.webp")):
        image = Image.open(path)
        if str(image.getexif().get(EXIF_DESCRIPTION, "")).startswith(MARK):
            print(f"跳過（已經調過）：{path.relative_to(DATA)}")
            continue
        save_portrait(image.convert("RGBA"), path, args.char)
        print(f"調好：{path.relative_to(DATA)}")


if __name__ == "__main__":
    main()
