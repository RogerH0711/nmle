"""遊戲立繪的局部重畫：用封面的 Qwen-Image-Edit-2511（art/cover_qwen.py 的 ComfyUI 工作流程）修 data/ 裡的立繪。

原圖不在本機，所以直接從 data/characters/ 的立繪下手：疊在白底上、裁出一塊放大重畫（細節才畫得出來），
縮回原尺寸後只在方框裡換掉；方框裡的透明度用 bria-rmbg 重算（同 art/recut.py）。預設服裝的表情身體像素完全一樣，
所以只畫一次（normal），再貼回每個表情（寫回前會檢查方框裡和 normal 一樣）。

    C:\\Users\\USER\\ComfyUI\\.venv\\Scripts\\python.exe C:\\Users\\USER\\ComfyUI\\main.py --port 8188 --disable-smart-memory
    .venv-gpu\\Scripts\\python.exe art\\portrait_props.py ying_notube --preview      # 只畫出範圍
    .venv-gpu\\Scripts\\python.exe art\\portrait_props.py ying_notube --seeds 1-6    # 生成，輸出到 art/bakeoff/portrait_props/
    .venv-gpu\\Scripts\\python.exe art\\portrait_props.py ying_notube --apply l8_2   # 用這張寫回 data/characters/ying/*.webp
"""
import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

import cover_qwen as cq
from recolor import save_portrait

ART = Path(__file__).resolve().parent
OUT = ART / "bakeoff" / "portrait_props"
DATA = ART.parent / "data" / "characters"
FEATHER = 6  # 原尺寸的羽化
TARGETS = ["normal", "happy", "sad", "shy", "surprised", "yandere"]


def tube_strip(shape, tube, half):
    """斜的長條：x = k*y + c，從 y0 到 y1，左右各 half px。"""
    k, c, y0, y1 = tube
    x = lambda y, dx: (int(k * y + c + dx), y)
    strip = np.zeros(shape, np.uint8)
    cv2.fillPoly(strip, [np.array([x(y0, -half), x(y0, half), x(y1, half), x(y1, -half)])], 1)
    return strip


def erase_old_tube(rgb, below=735, tube=(-0.3295, 446.5, 686, 862)):
    """原圖袖口下面的那段試管塗成白底（袖子外面，什麼都不用補）；壓在袖口尖端上的那段留給模型重畫。
    試管的線是用綠色液體擬合的。below 原本是 752（袖口尖端的下緣），但 735–752 的試管左側描線落在重畫範圍
    左邊的羽化帶，和原圖混出一條淡淡的殘影（透明度最高 12），所以從 735 就塗白；這一段的袖口尖端在重畫範圍中間，
    會被模型的輸出蓋過。回傳 (新的圖, 改過的範圍)。"""
    a = np.asarray(rgb).copy()
    old = tube_strip(a.shape[:2], tube, 14).astype(bool)
    old[:below] = False
    a[old] = 255
    return Image.fromarray(a), Image.fromarray(old.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))


# {名稱: 設定}，座標都是立繪原尺寸（832×1216）。prepare 在送去重畫前先改底圖。輸出在 art/bakeoff/portrait_props/<名稱>/
# 裁切範圍放大 scale 倍後要剛好是 FluxKontextImageScale 的尺寸之一（例如 880×1184），不然輸出會被縮放成別的比例，
# 縮回來和原圖對不齊（試過裁 400×560，放大 2 倍的 800×1120 被改成 880×1184，方框外平均差 8.6）
FIXES = {
    # 10/25 Roger：葉縈預設立繪的試管看起來浮在空中。定稿時 `holding test tube` 和 `sleeves past fingers` 互相衝突，
    # 袖口裡沒有手，試管只是靠在袖口外側的描線上。Roger 最後決定拿掉手上的試管、兩邊袖子都不露手
    # （另一邊彎著的袖子原本就沒露手），人設靠胸前口袋那排試管。之前試過、都沒採用的做法：
    # - 袖口露出手指捏著試管：模型總是畫出整隻手；放大 2 倍時手只有約 200 px，20 張沒有一張數得到確定的五根手指。
    #   只框手、放大 4 倍重畫，手指才畫對，但整隻手露在袖口外，Roger 覺得手臂太長。
    # - 手往上移、讓模型重畫袖口的接縫：袖口的白邊斷掉，開口直接通到背景。
    # - 袖口用原圖、手放在袖口後面合成：袖口的開口只是一條約 20 px 寬的斜縫，手背塞不進去，越修瑕疵越多。
    # - 整條袖子重畫、手肘微彎：模型照著參考圖幾乎原樣畫回來，指尖最多只移 4 px。
    # 這次 6 張：1 自己加了一隻手、3 的尖端多一塊黑影、4 的尖端被拉長；挑 2（形狀最接近原圖）
    "ying_notube": dict(char="ying", prepare=erase_old_tube, crop=(90, 560, 310, 856), scale=4,
                        boxes=[(178, 676, 248, 770)], targets=TARGETS, instruction=(
        "The oversized rolled-back lab coat cuff on the left side of the image is empty at its end: the long "
        "sleeve completely covers her hand, so no hand, no fingers and no test tube are visible anywhere. The "
        "white rim of the cuff and its dark outline continue cleanly around the lower corner of the cuff, and "
        "below the cuff there is only the plain white background")),
}


def prompt(instruction):
    return (f"Edit this anime character illustration. {instruction}. Keep everything else, including the lab coat, "
            "the pocket, the colors and the soft anime art style, exactly as in the image, on a plain white "
            "background. Correct anatomy, no text.")


def mask(name, size, crop=None):
    """白色＝重畫。crop 給的話是裁切後放大 scale 倍的座標。"""
    fix = FIXES[name]
    scale = 1 if crop is None else fix["scale"]
    m = Image.new("L", size, 0)
    for box in fix["boxes"]:
        if crop is not None:
            box = tuple((v - o) * scale for v, o in zip(box, crop[:2] * 2))
        ImageDraw.Draw(m).rectangle(box, fill=255)
    return m.filter(ImageFilter.GaussianBlur(FEATHER * scale))


def composed(name, pick=None):
    """回傳 (原本的 RGBA 立繪, 白底的 RGB, 改過的範圍)。pick 是挑好的輸出，None 是還沒重畫（給 generate 用）。"""
    fix = FIXES[name]
    rgba = Image.open(DATA / fix["char"] / "normal.webp").convert("RGBA")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    white.alpha_composite(rgba)
    white, done = white.convert("RGB"), Image.new("L", rgba.size, 0)
    if "prepare" in fix:
        white, done = fix["prepare"](white)
    if pick is None:
        return rgba, white, done
    crop = fix["crop"]
    out = Image.open(OUT / name / f"{pick}.png").convert("RGB")
    out = out.resize((crop[2] - crop[0], crop[3] - crop[1]), Image.LANCZOS)
    full = white.copy()
    full.paste(out, crop[:2])
    m = mask(name, rgba.size)
    return rgba, Image.composite(full, white, m), ImageChops.lighter(done, m)


def generate(name, seeds, preview):
    fix = FIXES[name]
    crop, scale = fix["crop"], fix["scale"]
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    _, white, _ = composed(name)
    part = white.crop(crop)
    part = part.resize((part.width * scale, part.height * scale), Image.LANCZOS)
    m = mask(name, part.size, crop)
    if preview:
        red = Image.new("RGB", part.size, (255, 0, 0))
        Image.composite(red, part, m.point(lambda v: v // 2)).save(folder / "mask.png")
        print(f"範圍畫在 {folder / 'mask.png'}", flush=True)
        return
    cq.upload(part, f"nmle_pp_{name}.png")
    cq.upload(m.convert("RGB"), f"nmle_pp_mask_{name}.png")
    for seed in seeds:
        path = folder / f"{cq.tag()}{seed}.png"
        if path.exists():
            continue
        t = time.time()
        cq.download(cq.run(cq.graph(f"nmle_pp_{name}.png", seed, prompt(fix["instruction"]), cq.NEGATIVE,
                                    mask=f"nmle_pp_mask_{name}.png")), path)
        with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"name": name, "seed": seed, "crop": crop, "scale": scale, "boxes": fix["boxes"],
                                "prompt": prompt(fix["instruction"]), "negative": cq.NEGATIVE,
                                "lightning": cq.LIGHTNING, "model": cq.model()["unet"], "time": time.time()},
                               ensure_ascii=False) + "\n")
        print(f"{name} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


def patched(name, pick):
    """回傳 (修好的 RGBA 整張圖, 改過的範圍)：範圍裡換成生成的結果，透明度用 bria-rmbg 重算（同 art/recut.py）。"""
    from rembg import new_session, remove
    rgba, rgb, m = composed(name, pick)
    alpha = remove(rgb, session=new_session("bria-rmbg"), only_mask=True).convert("L")
    result = rgb.convert("RGBA")
    result.putalpha(Image.composite(alpha, rgba.getchannel("A"), m))
    return Image.composite(result, rgba, m), m


def apply(name, pick):
    fix = FIXES[name]
    result, m = patched(name, pick)
    folder = DATA / fix["char"]
    normal = Image.open(folder / "normal.webp").convert("RGBA")
    for target in fix["targets"]:
        path = folder / f"{target}.webp"
        im = Image.open(path).convert("RGBA")
        assert ImageChops.difference(im, normal).crop(m.getbbox()).getbbox() is None, \
            f"{path} 重畫範圍裡和 normal 不一樣，不能直接貼"
        save_portrait(Image.composite(result, im, m), path, fix["char"], adjusted=True)
        print("寫回", path, flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("name", choices=list(FIXES))
    ap.add_argument("--seeds", default="1-4")
    ap.add_argument("--preview", action="store_true", help="只畫出範圍，不生成")
    ap.add_argument("--apply", help="用這張（輸出檔名，不含 .png）寫回 data/")
    ap.add_argument("--server", default=cq.SERVER)
    args = ap.parse_args()
    cq.SERVER = args.server.rstrip("/")
    cq.LIGHTNING = 8  # Lightning 8 步，一張約 2 分鐘（同封面）
    if args.apply:
        apply(args.name, args.apply)
    else:
        generate(args.name, cq.parse_seeds(args.seeds), args.preview)


if __name__ == "__main__":
    main()
