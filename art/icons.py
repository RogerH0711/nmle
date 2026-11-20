"""網站圖示：分頁的 favicon、加到手機主畫面的圖示（web manifest）、iPhone 的 apple-touch-icon。

橘色圓角方塊上一個白色的「醫」。字型用 Windows 的微軟正黑體粗體；Mac 上要換成系統有的中文字型。
輸出到 data/icons/，網站的 index.html 和 web manifest（web/vite.config.ts）會用到。

用法：python art/icons.py（需要 Pillow）
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "data" / "icons"
FONT = "C:/Windows/Fonts/msjhbd.ttc"
TOP = (232, 119, 46)     # --accent
BOTTOM = (184, 86, 26)   # --accent-strong
TEXT = "醫"


def draw(size: int, *, maskable: bool = False, radius: float = 0.22) -> Image.Image:
    """maskable：Android 會把圖示裁成圓形或其他形狀，底色要鋪滿、字放在中間 80% 的安全區內"""
    scale = 4  # 先畫大再縮小，邊緣比較平滑
    s = size * scale
    bg = Image.new("RGB", (s, s))
    px = bg.load()
    for y in range(s):
        t = y / (s - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))
        for x in range(s):
            px[x, y] = c
    mask = Image.new("L", (s, s), 0)
    if maskable:
        mask.paste(255, (0, 0, s, s))
    else:
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * radius), fill=255)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(s * (0.5 if maskable else 0.66)))
    box = d.textbbox((0, 0), TEXT, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1]), TEXT, font=font, fill="white")
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192).save(OUT / "icon-192.png")
    draw(512).save(OUT / "icon-512.png")
    draw(512, maskable=True).save(OUT / "maskable-512.png")
    # iPhone 自己會加圓角，給滿版的
    draw(180, maskable=True).convert("RGB").save(OUT / "apple-touch-icon.png")
    draw(48, radius=0.18).save(OUT / "favicon-48.png")
    draw(32, radius=0.18).save(OUT / "favicon-32.png")
    print("寫入", OUT)


if __name__ == "__main__":
    main()
