"""封面重畫成 Animagine 的畫風（11/15 Roger：還是覺得 10/22 的 art/bakeoff/cover/cover.png 風格好看）。

10/22 那張（方向 1）是 Animagine 一次畫五個人再整張 img2img，光線、線條、眼睛的細節都一致；但站位、道具、人設不對。
現在的封面（方向 2，art/cover_qwen.py）站位、道具、姿勢都對，但人是 Qwen-Image-Edit 分開重畫再合成的，線條粗、上色平。
Roger 決定：維持現在的構圖，只把畫風換成 Animagine；人站近一點（膝上、肩膀稍微重疊）。

    .venv-gpu\\Scripts\\python.exe art\\cover_restyle.py closer --scale 1.3 --squeeze 0.86 --lift -60 --shift ying=-110,0 zhixun=70,0 fei=40,0 --tag adj   # 步驟 1：把人放大、靠攏，重新合成（不用 GPU）

    （ComfyUI 開著：C:\\Users\\USER\\ComfyUI\\.venv\\Scripts\\python.exe C:\\Users\\USER\\ComfyUI\\main.py --port 8188 --disable-smart-memory）
    .venv-gpu\\Scripts\\python.exe art\\cover_restyle.py book --seeds 1-4   # 步驟 0：靜澄的書從腰間移到胸前（Qwen 局部重畫）
    .venv-gpu\\Scripts\\python.exe art\\cover_restyle.py book-apply 2        #         挑好的 seed 存成新的圖層

輸出在 art/bakeoff/cover/restyle/（不進 repo）。分層和光線合成沿用 cover_qwen.py 的 layout2 和 cmd_unify（"c" 那組，現在封面用的）。
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

ART = Path(__file__).resolve().parent
sys.path.insert(0, str(ART))
import cover_qwen  # noqa: E402

SRC = cover_qwen.OUT / "layout2"
OUT = ART / "bakeoff" / "cover" / "restyle"


# ---- 步驟 0：靜澄的書移到胸前 ----
# 11/15 Roger：人站近之後書在腰間會被裁掉／擋住，「把書上面一點可能會比較好」。書拿在她的左手（畫面右邊），
# 只移書會和手臂接不起來，所以把左肩到腰這一塊連手臂一起重畫，改成把書抱在胸前。座標是 layout2 圖層（1463×2195）的像素
BOOK_CROP = (460, 360, 1200, 1400)  # 送進 Qwen 的範圍：上半身，臉在範圍上面不會動到
BOOK_MASK = (190, 110, 690, 940)  # 重畫的範圍（相對 BOOK_CROP）：她的左臂、腰間的書、胸前
BOOK_PROMPT = ("She is now hugging the plain dark red hardcover book against her chest with her left arm, the book held flat "
               "in front of her chest. Her left hand holds the book. Remove the book from her hip. Keep her right hand "
               "waving, the white lab coat, the blue turtleneck, her long black hair and the same anime art style. "
               "Plain white background.")
BOOK_DIR = OUT / "book"


def book_source():
    layer = Image.open(SRC / "layers" / "jingcheng.png").convert("RGBA")
    white = Image.new("RGBA", layer.size, (255, 255, 255, 255))
    white.alpha_composite(layer)
    return layer, white.convert("RGB")


def cmd_book(args):
    from PIL import ImageDraw, ImageFilter
    BOOK_DIR.mkdir(parents=True, exist_ok=True)
    _, white = book_source()
    crop = white.crop(BOOK_CROP)
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).rectangle(BOOK_MASK, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(cover_qwen.PROPS_FEATHER))
    crop.save(BOOK_DIR / "source.png")
    mask.save(BOOK_DIR / "mask.png")
    cover_qwen.upload(crop, "nmle_book_src.png")
    cover_qwen.upload(mask.convert("RGB"), "nmle_book_mask.png")
    for seed in cover_qwen.parse_seeds(args.seeds):
        path = BOOK_DIR / f"{seed}.png"
        if path.exists():
            continue
        g = cover_qwen.graph("nmle_book_src.png", seed, BOOK_PROMPT, cover_qwen.NEGATIVE, mask="nmle_book_mask.png")
        cover_qwen.download(cover_qwen.run(g), path)
        print(f"book seed {seed}：{path}", flush=True)


def patch_layer(layer, box, mask, new):
    """把一塊重畫結果（在白底上畫的）貼回透明圖層：mask（0–1，和 box 同尺寸）以內換成 new，透明度用「比白底暗多少」算
    （同 cover_qwen 的顏色轉透明），mask 以外用原本的"""
    import numpy as np
    from scipy import ndimage
    white = Image.new("RGBA", layer.size, (255, 255, 255, 255))
    white.alpha_composite(layer)
    mask = mask[..., None]
    src = np.asarray(white.convert("RGB").crop(box)).astype(np.float32) / 255
    rgb = src * (1 - mask) + new * mask
    a_old = np.asarray(layer.crop(box))[..., 3].astype(np.float32) / 255
    a_new = np.clip((1 - rgb.min(axis=2)) / 0.08, 0, 1)  # 比白底暗 8% 以上就是不透明
    alpha = a_old * (1 - mask[..., 0]) + a_new * mask[..., 0]
    # 11/19 Roger 看封面：靜澄胸口的白袍半透明，看得到後面的背景。白袍和白底只差一點點，上面那行把胸口、手臂到口袋
    # 整片判成半透明。輪廓裡面（填滿洞之後往內縮 3 px）一律不透明，只有最外圈用算出來的透明度
    full = np.asarray(layer)[..., 3].astype(np.float32) / 255
    x0, y0, x1, y1 = box
    full[y0:y1, x0:x1] = alpha
    solid = ndimage.binary_fill_holes(full > 0.5)
    inside = ndimage.binary_erosion(solid, iterations=3)
    inside = ndimage.gaussian_filter(inside.astype(np.float32), 1.5)[y0:y1, x0:x1]
    raised = np.maximum(alpha, inside)
    # Qwen 輸出的白底不是純白，輪廓外會留下一塊淡淡的長方形霧影：離輪廓 6 px 以外、重畫範圍裡的清成透明
    near = ndimage.binary_dilation(solid, iterations=6)[y0:y1, x0:x1]
    raised = np.where(near, raised, a_old * (1 - mask[..., 0]))
    # 預乘回去：半透明的地方原本混了白底，顏色要還原；被補成不透明的地方，在白底上看到的顏色就是白袍本身的顏色
    a = np.maximum(alpha, 1e-3)[..., None]
    color = np.clip((rgb - (1 - a)) / a, 0, 1)
    k = np.clip((raised - alpha) / np.maximum(raised, 1e-3), 0, 1)[..., None]
    color = color * (1 - k) + rgb * k
    patch = Image.fromarray(np.dstack([color, raised[..., None]]).__mul__(255).round().astype(np.uint8), "RGBA")
    result = layer.copy()
    result.paste(patch, box[:2])
    return result


def cmd_book_apply(args):
    """挑好的 seed 貼回圖層"""
    import numpy as np
    layer, _ = book_source()
    out = Image.open(BOOK_DIR / f"{args.seed}.png").convert("RGB").resize(
        (BOOK_CROP[2] - BOOK_CROP[0], BOOK_CROP[3] - BOOK_CROP[1]), Image.LANCZOS)
    mask = np.asarray(Image.open(BOOK_DIR / "mask.png")).astype(np.float32) / 255
    result = patch_layer(layer, BOOK_CROP, mask, np.asarray(out).astype(np.float32) / 255)
    path = BOOK_DIR / f"jingcheng_book{args.seed}.png"
    result.save(path)
    print(f"新的圖層：{path}（closer 加 --layer jingcheng={path.relative_to(ART.parent)}）", flush=True)


# ---- 步驟 0b：補完抱書的左手 ----
# 11/19 Roger：「左手部分被裁切掉了」。seed 4 把手畫到 BOOK_MASK 的左邊界外，邊界外是原本的白袍，
# 手指的關節和書背左緣被一條直線切掉、羽化成一片糊。把範圍往左擴大，只重畫手和書背這一塊，其他照 seed 4
HAND_CROP = (520, 610, 920, 1060)  # layout2 圖層的座標（BOOK_CROP 左上角往右 60、往下 250）
HAND_MASK = (60, 30, 270, 340)  # 重畫的範圍（相對 HAND_CROP）：被切掉的手、書背左緣和旁邊一條白袍
HAND_PROMPT = ("Her left hand grips the spine of the dark red hardcover book she hugs against her chest. Draw the complete "
               "hand with all four fingers and knuckles wrapped around the book's spine, and the full straight left edge "
               "of the book, in front of her white lab coat. Keep the book, the sleeve, the lab coat and the same anime "
               "art style exactly as they are.")


def hand_source(book_seed):
    layer = Image.open(BOOK_DIR / f"jingcheng_book{book_seed}.png").convert("RGBA")
    white = Image.new("RGBA", layer.size, (255, 255, 255, 255))
    white.alpha_composite(layer)
    return layer, white.convert("RGB")


def cmd_hand(args):
    from PIL import ImageDraw, ImageFilter
    cover_qwen.LIGHTNING = args.lightning  # 只補一小塊，用 Lightning 8 步（一張約 2 分鐘；40 步要 13 分鐘）
    _, white = hand_source(args.book)
    crop = white.crop(HAND_CROP)
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).rectangle(HAND_MASK, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(cover_qwen.PROPS_FEATHER))
    crop.save(BOOK_DIR / "hand_source.png")
    mask.save(BOOK_DIR / "hand_mask.png")
    cover_qwen.upload(crop, "nmle_hand_src.png")
    cover_qwen.upload(mask.convert("RGB"), "nmle_hand_mask.png")
    for seed in cover_qwen.parse_seeds(args.seeds):
        path = BOOK_DIR / f"hand_{seed}.png"
        if path.exists():
            continue
        g = cover_qwen.graph("nmle_hand_src.png", seed, HAND_PROMPT, cover_qwen.NEGATIVE, mask="nmle_hand_mask.png")
        cover_qwen.download(cover_qwen.run(g), path)
        print(f"hand seed {seed}：{path}", flush=True)


def cmd_hand_apply(args):
    import numpy as np
    layer, _ = hand_source(args.book)
    out = Image.open(BOOK_DIR / f"hand_{args.seed}.png").convert("RGB").resize(
        (HAND_CROP[2] - HAND_CROP[0], HAND_CROP[3] - HAND_CROP[1]), Image.LANCZOS)
    mask = np.asarray(Image.open(BOOK_DIR / "hand_mask.png")).astype(np.float32) / 255
    result = patch_layer(layer, HAND_CROP, mask, np.asarray(out).astype(np.float32) / 255)
    path = BOOK_DIR / f"jingcheng_book{args.book}_hand{args.seed}.png"
    result.save(path)
    print(f"新的圖層：{path}（closer 加 --layer jingcheng={path.relative_to(ART.parent)}）", flush=True)


def cmd_closer(args):
    """每個人以畫面頂端為基準放大 scale 倍（頭往下一點、腿出畫面），水平方向再往中間收 squeeze，肩膀才會重疊"""
    layout = json.loads((SRC / "layout.json").read_text(encoding="utf-8"))
    W, H = Image.open(SRC / "layers" / "bg.png").size
    cx = W / 2
    # 個別微調（畫布 px，畫布是 2688 寬，最後縮成 1920）：例如 ying=-90,0
    layers = {k: ART.parent / v for k, v in (a.split("=") for a in args.layer)}  # 換掉某個人的圖層（例如書移到胸前的靜澄）
    shifts = {k: tuple(int(v) for v in xy.split(",")) for k, xy in (a.split("=") for a in args.shift)}
    for scale in args.scale:
        tag = f"closer_s{scale}" + (f"_{args.tag}" if args.tag else "")
        folder = cover_qwen.OUT / tag
        (folder / "layers").mkdir(parents=True, exist_ok=True)
        shutil.copy(SRC / "layers" / "bg.png", folder / "layers" / "bg.png")
        figures = {}
        for char, info in layout["figures"].items():
            layer = Image.open(layers.get(char, SRC / "layers" / f"{char}.png"))
            w, h = layer.size
            nw, nh = round(w * scale), round(h * scale)
            layer.resize((nw, nh), Image.LANCZOS).save(folder / "layers" / f"{char}.png")
            x0, y0 = info["pos"]
            # 圖層中心的新位置：離畫面中心的距離乘上 squeeze（放大後整排會變寬，收回來才會重疊）
            center = x0 + w / 2
            ncenter = cx + (center - cx) * args.squeeze
            dx, dy = shifts.get(char, (0, 0))
            figures[char] = {**info, "pos": [round(ncenter - nw / 2 + dx), round(y0 * scale + args.lift + dy)], "size": [nw, nh]}
        (folder / "layout.json").write_text(json.dumps({**layout, "figures": figures}, ensure_ascii=False, indent=1),
                                            encoding="utf-8")
        cover_qwen.cmd_unify(argparse.Namespace(layout=folder.name, variants="c"))
        OUT.mkdir(parents=True, exist_ok=True)
        Image.open(folder / "unify" / "c.png").convert("RGB").resize((1920, 1080), Image.LANCZOS).save(
            OUT / f"{tag}.png")
        print(f"closer {scale}：{OUT / f'{tag}.png'}", flush=True)


# ---- 步驟 2：Animagine + tile ControlNet 重畫畫風 ----
#   .venv-gpu/Scripts/python.exe art/cover_restyle.py restyle closer_s1.3_adj --strength 0.45 0.55 0.65
# 10/23 試過整張 img2img 統一畫風：強度夠讓畫風變的時候，修好的臉、手、道具也一起被改掉（見 cover_qwen.py 的「統一光線不重畫」）。
# 這次加 tile ControlNet（xinsir/controlnet-tile-sdxl-1.0，Apache-2.0）把原圖的輪廓和配色鎖住，強度可以拉高、只換畫法。
# 提示詞照 10/22 那張（cover.py 的 GROUP_PROMPT）加上亮、柔和的光線
RESTYLE_SIZE = (1536, 864)
RESTYLE_PROMPT = ("5girls, multiple girls, group picture, labcoat, looking at viewer, smile, cowboy shot, outdoors, "
                  "university campus, cherry blossoms, falling petals, blue sky, soft lighting, bright, pastel colors, "
                  "detailed eyes, shiny hair")
# 11/19 Roger：「光線和色彩還是比較平」。soft lighting、pastel colors 把它往柔、淡的方向推（彩度也是這樣被吃掉的），
# --lit 換成逆光、輪廓光、鮮豔的顏色
RESTYLE_LIT = ("soft lighting, bright, pastel colors", "backlighting, sunlight, rim lighting, bright, vivid colors")
CONTROLNET = "xinsir/controlnet-tile-sdxl-1.0"


def load_restyle_pipe():
    import torch
    from diffusers import ControlNetModel, StableDiffusionXLControlNetImg2ImgPipeline
    import outfits
    base = outfits.load_pipe()
    controlnet = ControlNetModel.from_pretrained(CONTROLNET, torch_dtype=torch.float16)
    pipe = StableDiffusionXLControlNetImg2ImgPipeline(**base.components, controlnet=controlnet)
    pipe.enable_model_cpu_offload()
    pipe.vae.enable_tiling()
    return pipe


def cmd_restyle(args):
    import time
    import torch
    import outfits
    size = tuple(int(v) for v in args.size.split("x")) if args.size else RESTYLE_SIZE
    source = Image.open(cover_qwen.OUT / args.layout / "unify" / f"{args.variant}.png").convert("RGB").resize(size, Image.LANCZOS)
    folder = OUT / "restyle" / (args.layout + ("" if args.variant == "c" else f"_v{args.variant}") + ("_lit" if args.lit else ""))
    folder.mkdir(parents=True, exist_ok=True)
    pipe = load_restyle_pipe()
    prompt = RESTYLE_PROMPT.replace("cowboy shot", args.shot) + outfits.SUFFIX  # 手機版是全身：--shot "full body"
    if args.lit:
        prompt = prompt.replace(*RESTYLE_LIT)
    negative = outfits.NEGATIVE.replace("scenery, ", "")
    for strength in args.strength:
        for cn in args.control:
            for seed in cover_qwen.parse_seeds(args.seeds):
                path = folder / f"s{strength}_c{cn}_{seed}.png"
                if path.exists():
                    continue
                t = time.time()
                image = pipe(prompt=prompt, negative_prompt=negative, image=source, control_image=source,
                             strength=strength, controlnet_conditioning_scale=cn, guidance_scale=outfits.CFG,
                             num_inference_steps=outfits.STEPS, generator=torch.Generator("cpu").manual_seed(seed)).images[0]
                image.save(path)
                outfits.log(folder, {"kind": "restyle", "layout": args.layout, "strength": strength, "control": cn,
                                     "seed": seed, "prompt": prompt, "negative": negative, "size": size})
                print(f"restyle {path.name}：{time.time() - t:.0f} 秒", flush=True)


# ---- 步驟 2b：顏色換回原圖 ----
# 11/19 正式重畫（closer_s1.3_b4b、0.55／0.8）：提示詞的 pastel colors 把彩度吃掉，葉縈的綠毛衣、緞帶、試管和智薰的
# 淡紫毛衣變灰，綠／紫眼睛變藍。Lab 色彩空間裡亮度（線條、光影）用重畫的，顏色（a、b）用原圖的，人設配色就回來了
def cmd_recolor(args):
    import numpy as np
    from PIL import ImageFilter
    from skimage import color
    src = Path(args.image)
    layout, _, variant = src.parent.name.removesuffix("_lit").partition("_v")  # restyle 的資料夾：<layout>[_v<光線那組>][_lit]
    out = Image.open(src).convert("RGB")
    ref = Image.open(cover_qwen.OUT / layout / "unify" / f"{variant or 'c'}.png").convert("RGB").resize(out.size, Image.LANCZOS)
    ref = ref.filter(ImageFilter.GaussianBlur(args.blur))
    lab = color.rgb2lab(np.asarray(out) / 255)
    ref_lab = color.rgb2lab(np.asarray(ref) / 255)
    lab[..., 1:] = lab[..., 1:] * (1 - args.weight) + ref_lab[..., 1:] * args.weight
    rgb = (color.lab2rgb(lab) * 255).round().clip(0, 255).astype(np.uint8)
    path = src.with_name(f"{src.stem}_rc{args.weight}.png")
    Image.fromarray(rgb).save(path)
    print(f"換回顏色：{path}", flush=True)


# ---- 步驟 3：放大 2 倍，分塊輕微重畫（細節、線條） ----
# 1536×864 直接放大線條會糊。整張 3072×1728 一次重畫 8 GB 放不下，切 1024 的塊（重疊 256、羽化接起來），
# 每塊用同一個 tile ControlNet 鎖住內容，強度低（0.3）只補細節；提示詞不寫人數（一塊裡只有局部）
UPSCALE_PROMPT = ("multiple girls, labcoat, cherry blossoms, soft lighting, bright, pastel colors, detailed eyes, shiny hair, "
                  "detailed hair, clean lineart")
TILE, OVERLAP = 1024, 256


def tile_starts(total):
    starts, x = [], 0
    while x + TILE < total:
        starts.append(x)
        x += TILE - OVERLAP
    return starts + [total - TILE]


def cmd_upscale(args):
    import numpy as np
    import torch
    import outfits
    src = Path(args.image)
    big = Image.open(src).convert("RGB")
    big = big.resize((big.width * 2, big.height * 2), Image.LANCZOS)
    pipe = load_restyle_pipe()
    negative = outfits.NEGATIVE.replace("scenery, ", "")
    acc = np.zeros((big.height, big.width, 3), np.float32)
    wsum = np.zeros((big.height, big.width, 1), np.float32)
    ramp = np.minimum(np.arange(TILE) + 1, OVERLAP) / OVERLAP
    ramp = np.minimum(ramp, ramp[::-1])
    weight = np.minimum.outer(ramp, ramp)[..., None].astype(np.float32)  # 塊的邊緣權重漸弱，接縫看不出來
    for y in tile_starts(big.height):
        for x in tile_starts(big.width):
            tile = big.crop((x, y, x + TILE, y + TILE))
            out = pipe(prompt=UPSCALE_PROMPT + outfits.SUFFIX, negative_prompt=negative, image=tile, control_image=tile,
                       strength=args.strength, controlnet_conditioning_scale=1.0, guidance_scale=outfits.CFG,
                       num_inference_steps=outfits.STEPS, generator=torch.Generator("cpu").manual_seed(args.seed)).images[0]
            acc[y:y + TILE, x:x + TILE] += np.asarray(out, np.float32) * weight
            wsum[y:y + TILE, x:x + TILE] += weight
            print(f"upscale 塊 ({x},{y})", flush=True)
    path = src.with_name(f"{src.stem}_x2.png")
    Image.fromarray((acc / wsum).round().clip(0, 255).astype(np.uint8)).save(path)
    print(f"放大：{path}", flush=True)


# ---- 步驟 4：逐臉修（各自的人設 tag，局部重畫） ----
# 臉的範圍用 --box 角色=x,y,w,h 給（放大後圖上的 px，看圖量）。每張臉切出來放大到約 1024 重畫，只換橢圓遮罩內
def cmd_faces(args):
    import torch
    import outfits
    src = Path(args.image)
    image = Image.open(src).convert("RGB")
    outfits.load_pipe(inpaint=True)
    folder = src.with_name(f"{src.stem}_faces")
    folder.mkdir(exist_ok=True)
    for spec in args.box:
        char, _, nums = spec.partition("=")
        x, y, w, h = (int(v) for v in nums.split(","))
        face_tags = outfits.LOOKS[char][1]
        o = {"face_box": (x, y, w, h), "face": face_tags, "keep_dark": [], "negative": outfits.LOOKS[char][2]}
        for seed in outfits.parse_seeds(args.seeds):
            result, prompt = outfits.inpaint_face(o, image, "smile", seed, args.strength, pad=args.pad)
            crop = result.crop((max(0, x - args.pad), max(0, y - args.pad), x + w + args.pad, y + h + args.pad))
            crop.save(folder / f"{char}_{seed}.png")
            print(f"臉 {char} seed {seed}", flush=True)
    # 選好的 seed 用 faces-apply 貼回


def cmd_faces_apply(args):
    import outfits
    src = Path(args.image)
    image = Image.open(src).convert("RGB")
    outfits.load_pipe(inpaint=True)
    for spec in args.pick:
        char, _, rest = spec.partition("=")
        box, _, seed = rest.rpartition(":")
        x, y, w, h = (int(v) for v in box.split(","))
        o = {"face_box": (x, y, w, h), "face": outfits.LOOKS[char][1], "keep_dark": [], "negative": outfits.LOOKS[char][2]}
        image, _ = outfits.inpaint_face(o, image, "smile", int(seed), args.strength, pad=args.pad)
        print(f"貼回 {char} seed {seed}", flush=True)
    path = src.with_name(f"{src.stem}_faces.png")
    image.save(path)
    print(f"逐臉修完：{path}", flush=True)


# ---- 步驟 5：調色、Logo、輸出 ----
# 11/19 Roger 從三種調色挑 g1（彩度 ×1.12、對比 ×1.05）：重畫後比 10/22 的舊封面淡，g2（×1.22、×1.08）橘紅太搶
GRADE = (1.12, 1.05)


def cmd_final(args):
    from PIL import ImageEnhance
    src = Path(args.image)
    image = Image.open(src).convert("RGB").resize(cover_qwen.FINAL, Image.LANCZOS)
    image = ImageEnhance.Contrast(ImageEnhance.Color(image).enhance(GRADE[0])).enhance(GRADE[1]).convert("RGBA")
    width, anchor, margin = cover_qwen.LOGO_LAYOUTS[cover_qwen.LOGO_PICK]
    logo = Image.open(cover_qwen.LOGO).convert("RGBA")
    w = round(cover_qwen.FINAL[0] * width)
    logo = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
    y = cover_qwen.FINAL[1] - logo.height - round(cover_qwen.FINAL[1] * margin)
    image.alpha_composite(logo, ((cover_qwen.FINAL[0] - w) // 2, y))
    image = image.convert("RGB")
    image.save(OUT / "cover.png")
    image.save(OUT / "cover.webp", "WEBP", quality=88, method=6)
    image.resize((1200, 675), Image.LANCZOS).save(OUT / "cover-og.jpg", "JPEG", quality=88, optimize=True, progressive=True)
    for name in ("cover.webp", "cover-og.jpg"):
        print(f"{OUT / name}（{(OUT / name).stat().st_size // 1024} KB）", flush=True)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("closer")
    p.add_argument("--scale", type=float, nargs="+", default=[1.15, 1.25])
    p.add_argument("--squeeze", type=float, default=0.95, help="水平位置往中間收的比例")
    p.add_argument("--lift", type=int, default=0, help="整排上下移動（px，負的往上）")
    p.add_argument("--shift", nargs="*", default=[], help="個別微調，角色=dx,dy（畫布 px）")
    p.add_argument("--tag", help="輸出檔名後綴")
    p.add_argument("--layer", nargs="*", default=[], help="換掉的圖層，角色=repo 裡的相對路徑")
    p = sub.add_parser("restyle")
    p.add_argument("layout", help="art/bakeoff/cover/qwen/ 底下 closer 做出來的資料夾，例如 closer_s1.3_adj")
    p.add_argument("--strength", type=float, nargs="+", default=[0.45, 0.55, 0.65])
    p.add_argument("--control", type=float, nargs="+", default=[0.7], help="ControlNet 的強度")
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--size", help="寬x高，預設 RESTYLE_SIZE；手機版（1080×2340）用 832x1800")
    p.add_argument("--shot", default="cowboy shot")
    p.add_argument("--variant", default="c", help="unify 的哪一組光線（cover_qwen.UNIFY）")
    p.add_argument("--lit", action="store_true", help="提示詞換成逆光、鮮豔（RESTYLE_LIT）")
    p = sub.add_parser("book")
    p.add_argument("--seeds", default="1-4")
    p = sub.add_parser("book-apply")
    p.add_argument("seed")
    p = sub.add_parser("hand")
    p.add_argument("--book", default="4", help="書用哪個 seed 的圖層")
    p.add_argument("--seeds", default="1-4")
    p.add_argument("--lightning", type=int, default=8, choices=[0, 4, 8])
    p = sub.add_parser("hand-apply")
    p.add_argument("seed")
    p.add_argument("--book", default="4")
    p = sub.add_parser("final")
    p.add_argument("image")
    p = sub.add_parser("recolor")
    p.add_argument("image")
    p.add_argument("--weight", type=float, default=1.0, help="顏色用原圖的比例")
    p.add_argument("--blur", type=float, default=1.0)
    p = sub.add_parser("upscale")
    p.add_argument("image")
    p.add_argument("--strength", type=float, default=0.3)
    p.add_argument("--seed", type=int, default=1)
    for name in ("faces", "faces-apply"):
        p = sub.add_parser(name)
        p.add_argument("image")
        p.add_argument("--strength", type=float, default=0.35)
        p.add_argument("--pad", type=int, default=96)
        if name == "faces":
            p.add_argument("--box", nargs="+", required=True, help="角色=x,y,w,h")
            p.add_argument("--seeds", default="1-3")
        else:
            p.add_argument("--pick", nargs="+", required=True, help="角色=x,y,w,h:seed")
    args = ap.parse_args()
    {"closer": cmd_closer, "book": cmd_book, "book-apply": cmd_book_apply, "hand": cmd_hand, "hand-apply": cmd_hand_apply, "restyle": cmd_restyle,
     "final": cmd_final, "recolor": cmd_recolor, "upscale": cmd_upscale, "faces": cmd_faces, "faces-apply": cmd_faces_apply}[args.cmd](args)


if __name__ == "__main__":
    main()
