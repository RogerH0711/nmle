"""遊戲封面「醫師一階攻略」：五位學姊的合照，在本機 3070 跑，模型和參數同 art/outfits.py。

    .venv-gpu\\Scripts\\python.exe art\\cover.py pose all --seeds 1-6   # 步驟 1：每位的封面姿勢候選
    .venv-gpu\\Scripts\\python.exe art\\cover.py bg --seeds 1-8         # 步驟 2：背景候選
    .venv-gpu\\Scripts\\python.exe art\\cover.py layout                 # 步驟 3：照 PICKS 去背、排版
    .venv-gpu\\Scripts\\python.exe art\\cover.py unify --seeds 1-4      # 步驟 4：整張 img2img，統一光線與畫風
    .venv-gpu\\Scripts\\python.exe art\\cover.py faces s0.4_1           # 步驟 5：逐一修臉，髮色、眼睛才不會互相混到
    .venv-gpu\\Scripts\\python.exe art\\cover.py merge s0.4_1           #         挑好的臉（FACE_PICKS）貼回去
    .venv-gpu\\Scripts\\python.exe art\\cover.py final faces/s0.4_1/merged.png  # 步驟 6：疊上 Logo，輸出 1920×1080

Logo 是 art/cover_logo.html，用無頭 Chrome 截 #logo（透明背景、2 倍解析度）存成 art/bakeoff/cover/logo.png。
遊戲名「醫師一階攻略～五位學姊陪你考過～」是 10/22 Roger 定的：原本「一階攻略」看不出是醫師國考，加上「醫師」；
考過一階的人說「考過」「過了」，不說「上榜」；英文用「Medical Licensing Examination · Stage 1」（不是美國的 Step 1）。

構圖照 Roger 的原則：五位地位相同（同《五等分的花嫁》的概念），沒有單一主角，同樣的取景（cowboy shot）、
臉一樣大，依身高微調。外觀 tag 沿用 characters.md 的定稿，只換姿勢和表情。
輸出都在 art/bakeoff/cover/（不進 repo），參數記在同一個資料夾的 log.jsonl；已經存在的圖會跳過。
"""
import argparse
import sys
import time
from pathlib import Path

import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import outfits  # noqa: E402  共用模型載入、token 檢查、總表、log
from outfits import CFG, NEGATIVE, STEPS, SUFFIX, check_tokens, contact_sheet, log, parse_seeds  # noqa: E402

OUT = Path(__file__).resolve().parent / "bakeoff" / "cover"
POSE_W, POSE_H = 832, 1216
COMMON = "1girl, solo, mature female, cowboy shot, looking at viewer, simple background, white background"

# 封面姿勢：外觀與服裝 tag 同定稿，後面接各自的姿勢和表情。整句超過 75 個 token 時先刪腿部的服裝
# （cowboy shot 拍不到）：沈靜澄的 black pants 和 tall female（身高在排版時調）、溫芷薰的 long skirt 和 open labcoat、葉縈的 long skirt
POSES = {
    "fei": "red hair, medium hair, side braid, red eyes, tsurime, red scrubs, scrub top, labcoat, open labcoat, "
           "pen behind ear, crossed arms, slender, pout, blush",
    "jingcheng": "black hair, very long hair, straight hair, blue eyes, glasses, grey-framed eyewear, "
                 "labcoat, open labcoat, blue turtleneck, holding book, light smile",
    "yiqing": "orange hair, short hair, bob cut, hairclip, amber eyes, athletic female, orange track jacket, "
              "open jacket, white t-shirt, track pants, wristband, smile, open mouth, v",
    "zhixun": "light purple hair, long hair, wavy hair, side ponytail, purple eyes, droopy eyes, mole under eye, "
              "labcoat, purple sweater, lanyard, smile, hand on own cheek",
    "ying": "dark green hair, long hair, low twintails, hair ribbon, green eyes, bags under eyes, oversized labcoat, "
            "sleeves past fingers, holding test tube, green sweater, smile, head tilt",
}

# 背景：醫學院校園，畫面上方留天空給 Logo
BG_W, BG_H = 1344, 768
BG_PROMPT = ("no humans, scenery, outdoors, university campus, hospital, building, cherry blossoms, falling petals, "
             "blue sky, cloud, sunlight, tree, path, depth of field")
BG_NEGATIVE = ("lowres, text, error, worst quality, low quality, low score, bad score, average score, signature, "
               "watermark, username, blurry, 1girl, 1boy, people, nsfw")


# 大合照：五個人在同一張圖裡、同一個鏡頭（分開生成再拼，每個人離鏡頭的距離、角度都不同，不像合照）。
# 髮色和髮長寫進去，五個人的輪廓才會不同，之後依輪廓把每個人分配給最像的學姊、再逐一重畫成定稿的樣子
GROUP_W, GROUP_H = 1344, 768
GROUP_TXT = ("5girls, group photo, standing, side-by-side, cowboy shot, straight-on, looking at viewer, "
             "smile, labcoat, red hair, black hair, glasses, orange hair, short hair, purple hair, "
             "green hair, twintails, outdoors, cherry blossoms, blue sky")
# cropped 會讓模型避開 cowboy shot 這種裁切的取景；motion lines 是壓立繪背景特效用的，這裡用不到（負向也只讀 75 個 token）
GROUP_TXT_NEGATIVE = NEGATIVE.replace("scenery, motion lines, ", "").replace("cropped, ", "") + ", 6+girls, 4girls, 1boy"


def generate(folder, seeds, prompt, negative, size, meta):
    pipe = outfits.load_pipe()
    check_tokens(prompt, "prompt")
    check_tokens(negative, "negative prompt")
    folder.mkdir(parents=True, exist_ok=True)
    for seed in seeds:
        path = folder / f"{seed}.png"
        if path.exists():
            continue
        t = time.time()
        image = pipe(prompt=prompt, negative_prompt=negative, width=size[0], height=size[1],
                     guidance_scale=CFG, num_inference_steps=STEPS,
                     generator=torch.Generator("cpu").manual_seed(seed)).images[0]
        image.save(path)
        log(folder, {**meta, "seed": seed, "prompt": prompt, "negative": negative, "cfg": CFG, "steps": STEPS,
                     "size": size})
        print(f"{folder.name} seed {seed}：{time.time() - t:.0f} 秒", flush=True)
    done = sorted((p for p in folder.glob("*.png") if p.stem.isdigit()), key=lambda p: int(p.stem))
    cols = 4 if size[0] > size[1] else 6
    contact_sheet([Image.open(p) for p in done], [f"seed {p.stem}" for p in done], folder / "sheet.png",
                  cols=cols, thumb_h=300 if size[0] > size[1] else 420)
    print(f"{folder.name}：完成 {len(done)} 張，總表在 {folder / 'sheet.png'}", flush=True)


def cmd_pose(args):
    for char in (list(POSES) if args.char == "all" else [args.char]):
        generate(OUT / "pose" / char, parse_seeds(args.seeds), POSES[char] + ", " + COMMON + SUFFIX, NEGATIVE,
                 (POSE_W, POSE_H), {"kind": "pose", "char": char})


def cmd_bg(args):
    generate(OUT / "bg", parse_seeds(args.seeds), BG_PROMPT + SUFFIX, BG_NEGATIVE, (BG_W, BG_H), {"kind": "bg"})


def cmd_group(args):
    generate(OUT / "group", parse_seeds(args.seeds), GROUP_TXT + SUFFIX, GROUP_TXT_NEGATIVE, (GROUP_W, GROUP_H),
             {"kind": "group"})


# ---- 步驟 3：排版 ----
# 挑好的候選（seed），看過總表後填（10/22）：
# 顏緋 2 正面抱胸嘟嘴；沈靜澄 1 推眼鏡抱書；夏以晴 6 比 V（5 更有元氣，但取景太近，臉調成一樣大後身體短 170 px；3 的頭頂被切掉）；
# 溫芷薰 4 髮色最接近定稿的淡紫灰（2、3 太紫）；葉縈 1 低雙馬尾、袖子蓋過手指（5 的緞帶是紅的、6 有黑煙特效）。
# 背景 3：建築在正中間、左右對稱，上方的天空留給 Logo
PICKS = {"fei": 2, "jingcheng": 1, "yiqing": 6, "zhixun": 4, "ying": 1}
BG_PICK = 3
CANVAS = (2048, 1152)  # 16:9，縮成 1920×1080 剛好；SDXL 要 8 的倍數
FACE_H = 240  # 每張臉（偵測框）在畫布上的高度，五位一樣大，再依身高微調
HEIGHTS = {"fei": 160, "jingcheng": 168, "yiqing": 163, "zhixun": 170, "ying": 158}  # characters.md
ORDER = ["fei", "jingcheng", "yiqing", "zhixun", "ying"]  # 由左到右；代表色紅、藍、橘、紫、綠交錯
SLOTS_X = [300, 664, 1024, 1384, 1748]  # 臉的中心
FACE_Y = 430  # 163 cm 的人臉中心的高度；高的人往上、矮的人往下
CM_PX = 4  # 每差 1 cm 移動幾 px
# 候選圖大多是近距離的取景，放到臉一樣大時身體在畫面底部前就斷了：底部用淡粉白的光暈淡出，Logo 放在上面
FADE_TOP = 660
FADE_FULL = 940  # 到這裡完全是光暈色（溫芷薰、葉縈的身體在 860–930 斷掉）
FADE_COLOR = (255, 242, 247)


def detect_faces(image, n=1, min_size=60):
    """動漫臉偵測（nagadomi/lbpcascade_animeface，MIT），回傳最大的 n 張臉 [(x, y, w, h)]，由左到右。"""
    import cv2
    import numpy as np
    gray = cv2.equalizeHist(cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2GRAY))
    cascade = cv2.CascadeClassifier(str(OUT / "lbpcascade_animeface.xml"))
    for strict in (5, 3, 1):  # 從嚴到寬；沈靜澄推眼鏡的手擋到臉，要放寬到 3
        faces = cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=strict, minSize=(min_size, min_size))
        if len(faces) >= n:
            biggest = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[:n]
            return sorted((tuple(int(v) for v in f) for f in biggest), key=lambda f: f[0])
    raise SystemExit(f"偵測不到 {n} 張臉，換一張候選或手動指定")


def detect_face(image):
    return detect_faces(image)[0]


EDGE = 48  # 候選圖裡碰到邊框的手肘、袖子會被切成一直線：去背後靠近四邊的透明度漸淡，排在一起才不會露出切邊


def cutout(path):
    from rembg import new_session, remove
    from defringe import defringe
    from PIL import ImageChops
    image = Image.open(path).convert("RGB")
    rgba = image.copy()
    rgba.putalpha(remove(image, session=new_session("bria-rmbg"), only_mask=True).convert("L"))
    rgba = defringe(rgba)
    w, h = rgba.size
    values = [round(255 * i / (EDGE - 1)) for i in range(EDGE)]  # 由外往內 0→255
    col = Image.new("L", (w, 1), 255)
    col.putdata(values + [255] * (w - 2 * EDGE) + values[::-1])  # 左右兩邊
    row = Image.new("L", (1, h), 255)
    row.putdata(values + [255] * (h - EDGE))  # 只有上面；下面交給底部光暈
    ramp = ImageChops.multiply(col.resize((w, h)), row.resize((w, h)))
    rgba.putalpha(ImageChops.multiply(rgba.getchannel("A"), ramp))
    return rgba


def cmd_layout(args):
    import json
    if len(PICKS) < len(POSES) or BG_PICK is None:
        raise SystemExit("先在 PICKS、BG_PICK 填好挑選的 seed")
    bg = Image.open(OUT / "bg" / f"{BG_PICK}.png").convert("RGB")
    scale = max(CANVAS[0] / bg.width, CANVAS[1] / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.LANCZOS)
    canvas = bg.crop((0, 0, CANVAS[0], CANVAS[1])).convert("RGBA")  # 從上面切，天空留給 Logo
    faces = {}
    placed = []
    for char, x_center in zip(ORDER, SLOTS_X):
        path = OUT / "pose" / char / f"{PICKS[char]}.png"
        fx, fy, fw, fh = detect_face(Image.open(path))
        figure = cutout(path)
        s = FACE_H * (HEIGHTS[char] / 163) ** 0.5 / fh  # 臉的大小只隨身高微調
        figure = figure.resize((round(figure.width * s), round(figure.height * s)), Image.LANCZOS)
        cy = FACE_Y - (HEIGHTS[char] - 163) * CM_PX
        left = round(x_center - (fx + fw / 2) * s)
        top = round(cy - (fy + fh / 2) * s)
        placed.append((char, figure, (left, top)))
        faces[char] = [round(left + fx * s), round(top + fy * s), round(fw * s), round(fh * s)]
    # 兩側先畫、中間最後畫，中間的人在最前面
    for i in [0, 4, 1, 3, 2]:
        char, figure, pos = placed[i]
        canvas.alpha_composite(figure, pos)
    fade = Image.new("L", (1, CANVAS[1]), 0)
    for y in range(FADE_TOP, CANVAS[1]):
        t = min(1, (y - FADE_TOP) / (FADE_FULL - FADE_TOP))
        fade.putpixel((0, y), round(255 * t * t * (3 - 2 * t)))  # smoothstep
    canvas.paste(Image.new("RGB", CANVAS, FADE_COLOR), (0, 0), fade.resize(CANVAS))
    canvas = canvas.convert("RGB")
    canvas.save(OUT / "layout.png")
    (OUT / "layout.json").write_text(json.dumps({"picks": PICKS, "bg": BG_PICK, "faces": faces}, ensure_ascii=False))
    print(f"排版在 {OUT / 'layout.png'}，臉的位置 {faces}", flush=True)


# ---- 步驟 4：整張 img2img ----
GROUP_PROMPT = ("5girls, multiple girls, group picture, labcoat, looking at viewer, smile, cowboy shot, outdoors, "
                "university campus, cherry blossoms, falling petals, blue sky")
GROUP_NEGATIVE = NEGATIVE.replace("scenery, ", "")


def load_img2img():
    from diffusers import AutoPipelineForImage2Image, EulerAncestralDiscreteScheduler, StableDiffusionXLPipeline
    from huggingface_hub import hf_hub_download
    path = hf_hub_download("cagliostrolab/animagine-xl-4.0", "animagine-xl-4.0-opt.safetensors")
    base = StableDiffusionXLPipeline.from_single_file(path, torch_dtype=torch.float16)
    base.scheduler = EulerAncestralDiscreteScheduler.from_config(base.scheduler.config)
    pipe = AutoPipelineForImage2Image.from_pipe(base)
    pipe.enable_model_cpu_offload()
    pipe.vae.enable_tiling()
    outfits.pipe = base  # check_tokens 用它的 tokenizer
    return pipe


def cmd_unify(args):
    pipe = load_img2img()
    prompt = GROUP_PROMPT + SUFFIX
    check_tokens(prompt, "prompt")
    layout = Image.open(OUT / "layout.png").convert("RGB")
    folder = OUT / "unify"
    folder.mkdir(parents=True, exist_ok=True)
    for strength in args.strength:
        for seed in parse_seeds(args.seeds):
            path = folder / f"s{strength}_{seed}.png"
            if path.exists():
                continue
            t = time.time()
            image = pipe(prompt=prompt, negative_prompt=GROUP_NEGATIVE, image=layout, strength=strength,
                         width=CANVAS[0], height=CANVAS[1], guidance_scale=CFG, num_inference_steps=STEPS,
                         generator=torch.Generator("cpu").manual_seed(seed)).images[0]
            image.save(path)
            log(folder, {"kind": "unify", "seed": seed, "strength": strength, "prompt": prompt,
                         "negative": GROUP_NEGATIVE, "cfg": CFG, "steps": STEPS})
            print(f"unify 強度 {strength} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 大合照：放大、逐一重畫成各自的學姊 ----
# 合照 seed 8（10/22）：五個人眼睛幾乎同高、離鏡頭一樣遠，臉最大；髮型輪廓剛好對得上五位，髮色順序也接近：
# 黑髮眼鏡→沈靜澄、橘髮→夏以晴、紫色長髮→溫芷薰、綠色長髮→葉縈、紅色中長髮→顏緋。兩端的人都把手舉到頭髮旁，左右對稱。
# （seed 6 站得最整齊，但五個人有三個短髮，長髮的三位很難從短髮重畫出來）
GROUP_PICK = 8
ASSIGN = ["jingcheng", "yiqing", "zhixun", "ying", "fei"]  # 合照裡由左到右


def cmd_hires(args):
    """合照放大到 CANVAS，再 img2img 補細節（1344×768 直接放大會糊）。"""
    pipe = load_img2img()
    image = Image.open(OUT / "group" / f"{GROUP_PICK}.png").convert("RGB")
    scale = max(CANVAS[0] / image.width, CANVAS[1] / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    top = (image.height - CANVAS[1]) // 2
    image = image.crop((0, top, CANVAS[0], top + CANVAS[1]))
    prompt = GROUP_TXT + SUFFIX
    folder = OUT / "hires"
    folder.mkdir(parents=True, exist_ok=True)
    for seed in parse_seeds(args.seeds):
        path = folder / f"g{GROUP_PICK}_s{args.strength}_{seed}.png"
        if path.exists():
            continue
        out = pipe(prompt=prompt, negative_prompt=GROUP_TXT_NEGATIVE, image=image, strength=args.strength,
                   width=CANVAS[0], height=CANVAS[1], guidance_scale=CFG, num_inference_steps=STEPS,
                   generator=torch.Generator("cpu").manual_seed(seed)).images[0]
        out.save(path)
        log(folder, {"kind": "hires", "group": GROUP_PICK, "seed": seed, "strength": args.strength, "prompt": prompt})
        print(f"hires {path.name}", flush=True)


# 重畫每個人用的 tag：定稿的外觀與服裝，不寫姿勢（姿勢沿用合照，才不會和合照的身體打架）
PERSON_TAGS = {
    "fei": "red hair, medium hair, side braid, red eyes, tsurime, red scrubs, scrub top, labcoat, open labcoat, "
           "pen behind ear, slender",
    "jingcheng": "black hair, very long hair, straight hair, blue eyes, glasses, grey-framed eyewear, labcoat, "
                 "open labcoat, blue turtleneck, black pants",
    "yiqing": "orange hair, short hair, bob cut, hairclip, amber eyes, athletic female, orange track jacket, "
              "open jacket, white t-shirt, track pants, wristband",
    "zhixun": "light purple hair, long hair, wavy hair, side ponytail, purple eyes, droopy eyes, mole under eye, "
              "labcoat, open labcoat, purple sweater, long skirt, lanyard",
    "ying": "dark green hair, long hair, low twintails, hair ribbon, green eyes, bags under eyes, oversized labcoat, "
            "sleeves past fingers, green sweater, long skirt",
}


def person_masks(image):
    """五個人各自的遮罩：去背得到所有人的範圍，再依臉的位置在兩人中間切開。"""
    from rembg import new_session, remove
    from PIL import ImageChops, ImageDraw, ImageFilter
    fg = remove(image, session=new_session("bria-rmbg"), only_mask=True).convert("L")
    faces = detect_faces(image, n=5, min_size=80)
    centers = [x + w / 2 for x, _, w, _ in faces]
    bounds = [0] + [(a + b) / 2 for a, b in zip(centers, centers[1:])] + [image.width]
    masks = []
    for left, right in zip(bounds, bounds[1:]):
        col = Image.new("L", image.size, 0)
        ImageDraw.Draw(col).rectangle((left, 0, right, image.height), fill=255)
        masks.append(ImageChops.multiply(fg, col.filter(ImageFilter.GaussianBlur(10))))
    return faces, masks


def cmd_people(args):
    import json
    from PIL import ImageFilter
    if len(ASSIGN) != 5:
        raise SystemExit("先在 ASSIGN 填好合照裡由左到右是誰")
    outfits.load_pipe(inpaint=True)
    source = Image.open(OUT / "hires" / f"{args.source}.png").convert("RGB")
    faces, masks = person_masks(source)
    folder = OUT / "people" / args.source
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "faces.json").write_text(json.dumps(dict(zip(ASSIGN, faces))))
    for char, mask in zip(ASSIGN, masks):
        if args.only and char not in args.only.split(","):
            continue
        box = mask.point(lambda v: 255 if v > 8 else 0).getbbox()
        x0, y0 = max(0, box[0] - 24), max(0, box[1] - 24)
        x1, y1 = min(source.width, box[2] + 24), min(source.height, box[3] + 24)
        crop, crop_mask = source.crop((x0, y0, x1, y1)), mask.crop((x0, y0, x1, y1))
        scale = 1216 / max(crop.size)  # 放大到 SDXL 習慣的大小再重畫，細節才夠
        big = (round(crop.width * scale / 8) * 8, round(crop.height * scale / 8) * 8)
        prompt = f"1girl, solo, mature female, cowboy shot, {PERSON_TAGS[char]}, looking at viewer" + SUFFIX
        check_tokens(prompt, "prompt")
        for seed in parse_seeds(args.seeds):
            path = folder / f"{char}_{seed}.png"
            if path.exists():
                continue
            out = outfits.inpaint_pipe(
                prompt=prompt, negative_prompt=NEGATIVE, image=crop.resize(big, Image.LANCZOS),
                mask_image=crop_mask.resize(big, Image.LANCZOS).filter(ImageFilter.GaussianBlur(6)),
                width=big[0], height=big[1], strength=args.strength, guidance_scale=CFG, num_inference_steps=STEPS,
                generator=torch.Generator("cpu").manual_seed(seed)).images[0]
            patch = Image.composite(out.resize(crop.size, Image.LANCZOS), crop, crop_mask)
            result = source.copy()
            result.paste(patch, (x0, y0))
            result.crop((x0, y0, x1, y1)).save(path)
            log(folder, {"kind": "person", "char": char, "seed": seed, "strength": args.strength, "prompt": prompt,
                         "box": [x0, y0, x1, y1]})
            print(f"{char} seed {seed}", flush=True)


def recolor(char, rgb, mask, face_bottom):
    """直接改衣服的顏色（重畫拉不動的時候先上色、再低強度重畫修光影）。rgb、mask 是 numpy 陣列，回傳改好的 rgb。"""
    import numpy as np
    hsv = np.array(Image.fromarray(rgb).convert("HSV")).astype(float)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    rows = np.arange(rgb.shape[0])[:, None] > face_bottom  # 只改脖子以下，頭髮和臉不動
    inside = (mask > 128) & rows
    blue = (h > 160) & (h < 230) & (s > 0.15)
    if char == "fei":  # 藍綠色的刷手服 → 紅色
        sel = inside & blue
        hsv[..., 0][sel] = 356 * 255 / 360
        hsv[..., 1][sel] = np.minimum(1, s[sel] * 1.2) * 255
    elif char == "yiqing":  # 白袍 → 橘色運動外套、淺藍上衣 → 白 T 恤、深藍褲子 → 橘色運動褲
        coat = inside & (s < 0.18) & (v > 0.45)
        shirt = inside & blue & (v > 0.7)
        pants = inside & blue & (v <= 0.7)
        for sel, hue, sat, val in [(coat, 24, 0.85, 0.97), (pants, 20, 0.8, 0.85)]:
            hsv[..., 0][sel] = hue * 255 / 360
            hsv[..., 1][sel] = sat * 255
            hsv[..., 2][sel] = v[sel] * val * 255
        hsv[..., 1][shirt] = 0.03 * 255
        hsv[..., 2][shirt] = np.maximum(v[shirt], 0.93) * 255
    elif char == "zhixun":  # 太飽和的紫髮、紫毛衣 → 定稿的淡紫灰、薰衣草色；眼睛會一起變淡，修臉時補回來
        sel = (mask > 128) & (h > 245) & (h < 320) & (s > 0.2)
        hsv[..., 1][sel] = s[sel] * 0.45 * 255
        hsv[..., 2][sel] = np.minimum(1, v[sel] * 1.18) * 255
    else:
        raise SystemExit(f"{char} 沒有上色規則")
    return np.array(Image.fromarray(hsv.astype("uint8"), "HSV").convert("RGB"))


def cmd_recolor(args):
    """先上色、再重畫：在 people 的候選上改衣服顏色，存成 <角色>_c<seed>.png，再用 --strength 重畫成 <角色>_r<seed>.png。"""
    import json
    import numpy as np
    from PIL import ImageFilter
    outfits.load_pipe(inpaint=True)
    source = Image.open(OUT / "hires" / f"{args.source}.png").convert("RGB")
    _, masks = person_masks(source)
    folder = OUT / "people" / args.source
    faces = json.loads((folder / "faces.json").read_text())
    char = args.char
    mask = masks[ASSIGN.index(char)]
    box = mask.point(lambda v: 255 if v > 8 else 0).getbbox()
    x0, y0 = max(0, box[0] - 24), max(0, box[1] - 24)
    base = Image.open(folder / f"{char}_{args.base}.png").convert("RGB")
    crop_mask = mask.crop((x0, y0, x0 + base.width, y0 + base.height))
    _, fy, _, fh = faces[char]
    colored = Image.fromarray(recolor(char, np.array(base), np.array(crop_mask), fy + fh - y0 + 10))
    colored.save(folder / f"{char}_c{args.base}.png")
    scale = 1216 / max(base.size)
    big = (round(base.width * scale / 8) * 8, round(base.height * scale / 8) * 8)
    prompt = f"1girl, solo, mature female, cowboy shot, {PERSON_TAGS[char]}, looking at viewer" + SUFFIX
    for seed in parse_seeds(args.seeds):
        out = outfits.inpaint_pipe(
            prompt=prompt, negative_prompt=NEGATIVE, image=colored.resize(big, Image.LANCZOS),
            mask_image=crop_mask.resize(big, Image.LANCZOS).filter(ImageFilter.GaussianBlur(6)),
            width=big[0], height=big[1], strength=args.strength, guidance_scale=CFG, num_inference_steps=STEPS,
            generator=torch.Generator("cpu").manual_seed(seed)).images[0]
        Image.composite(out.resize(base.size, Image.LANCZOS), colored, crop_mask).save(folder / f"{char}_r{seed}.png")
        log(folder, {"kind": "recolor", "char": char, "base": args.base, "seed": seed, "strength": args.strength,
                     "prompt": prompt})
        print(f"{char} 上色後重畫 seed {seed}", flush=True)


# 每位挑好的重畫結果（上色後重畫的寫 "r1" 這種）。10/22：強度 0.65 只換得掉眼睛和髮型，0.8 換得掉沈靜澄、葉縈的衣服；
# 夏以晴的白袍→橘色外套、顏緋的藍綠色→紅色刷手服連 0.95 都拉不動，改成先上色再用 0.5 重畫（recolor）；
# 溫芷薰的紫髮太飽和，調成定稿的淡紫灰後用 0.4 重畫
PERSON_PICKS = {"jingcheng": 3, "yiqing": "r2", "zhixun": "r2", "ying": 3, "fei": "r2"}


def cmd_people_merge(args):
    """把挑好的人貼回合照。候選圖是矩形，裡面也有隔壁的人（還是原樣），所以用每個人的遮罩合成，只換她自己的範圍。"""
    source = Image.open(OUT / "hires" / f"{args.source}.png").convert("RGB")
    _, masks = person_masks(source)
    folder = OUT / "people" / args.source
    result = source.copy()
    for char, mask in zip(ASSIGN, masks):
        if char not in PERSON_PICKS:
            continue
        box = mask.point(lambda v: 255 if v > 8 else 0).getbbox()
        full = source.copy()
        full.paste(Image.open(folder / f"{char}_{PERSON_PICKS[char]}.png"), (max(0, box[0] - 24), max(0, box[1] - 24)))
        result = Image.composite(full, result, mask)
    result.save(folder / "merged.png")
    print(f"合成在 {folder / 'merged.png'}", flush=True)


# 兩人之間的接縫：遮罩是在兩人中間直直切開的，上色時會把隔壁的衣服一起染掉，留下一條直線
SEAM_TAGS = {
    "jingcheng": "labcoat, blue turtleneck", "yiqing": "orange track jacket, white t-shirt",
    "zhixun": "labcoat, purple sweater", "ying": "oversized labcoat, green sweater", "fei": "labcoat, red scrubs",
}
SEAM_BAND = 64  # 分界左右各重畫幾 px
# 10/22 Roger：肩並肩的地方怪。遮罩在兩人中間切開又模糊過，交界附近是兩個版本的人半透明疊在一起，
# 所以四條交界都要重畫，而且從下巴上方一點開始，把肩膀包進去，讓模型決定誰的肩膀在前面


def cmd_seams(args):
    import json
    from PIL import ImageDraw, ImageFilter
    outfits.load_pipe(inpaint=True)
    folder = OUT / "people" / args.source
    faces = json.loads((folder / "faces.json").read_text())
    image = Image.open(folder / "merged.png").convert("RGB")
    boxes = [faces[c] for c in ASSIGN]
    centers = [x + w / 2 for x, _, w, _ in boxes]
    for i in (int(v) for v in args.pairs.split(",")):
        b = round((centers[i] + centers[i + 1]) / 2)
        y0 = min(boxes[i][1] + boxes[i][3], boxes[i + 1][1] + boxes[i + 1][3]) - 40  # 比較高的下巴上方一點，肩膀才包得進去
        x0, x1 = b - 192, b + 192
        crop = image.crop((x0, y0, x1, image.height))
        mask = Image.new("L", crop.size, 0)
        ImageDraw.Draw(mask).rectangle((192 - SEAM_BAND, 40, 192 + SEAM_BAND, crop.height), fill=255)  # 上緣留空，模糊後才會淡出
        mask = mask.filter(ImageFilter.GaussianBlur(16))
        scale = 1216 / crop.height
        big = (round(crop.width * scale / 8) * 8, round(crop.height * scale / 8) * 8)
        a, c = ASSIGN[i], ASSIGN[i + 1]
        prompt = f"2girls, side-by-side, cowboy shot, {SEAM_TAGS[a]}, {SEAM_TAGS[c]}" + SUFFIX
        check_tokens(prompt, "prompt")
        out = outfits.inpaint_pipe(
            prompt=prompt, negative_prompt=NEGATIVE, image=crop.resize(big, Image.LANCZOS),
            mask_image=mask.resize(big, Image.LANCZOS), width=big[0], height=big[1], strength=args.strength,
            guidance_scale=CFG, num_inference_steps=STEPS,
            generator=torch.Generator("cpu").manual_seed(args.seed)).images[0]
        image.paste(Image.composite(out.resize(crop.size, Image.LANCZOS), crop, mask), (x0, y0))
        log(folder, {"kind": "seam", "pair": [a, c], "x": b, "seed": args.seed, "strength": args.strength,
                     "prompt": prompt})
        print(f"{a}｜{c} 的接縫（x={b}）", flush=True)
    image.save(folder / "seamed.png")
    print(f"修好接縫的合照在 {folder / 'seamed.png'}", flush=True)


# ---- 步驟 5：逐一修臉 ----
FACE_TAGS = {
    "fei": ("red hair, medium hair, side braid, red eyes, tsurime", "pout, blush"),
    "jingcheng": ("black hair, long hair, straight hair, side part, blue eyes, glasses, grey-framed eyewear",
                  "light smile, closed mouth"),
    "yiqing": ("orange hair, short hair, bob cut, hairclip, amber eyes", "smile, open mouth"),
    "zhixun": ("light purple hair, long hair, wavy hair, purple eyes, droopy eyes, mole under eye", "smile"),
    "ying": ("dark green hair, long hair, green eyes, bags under eyes", "smile"),
}


def cmd_faces(args):
    """在 people-merge 的合照上逐一重畫臉：眼睛顏色、表情回到各自的設定。臉的位置用 people 步驟偵測的 faces.json。"""
    import json
    outfits.load_pipe(inpaint=True)
    src = OUT / "people" / args.source
    faces = json.loads((src / "faces.json").read_text())
    image = Image.open(src / "seamed.png").convert("RGB")
    folder = OUT / "faces" / args.source
    folder.mkdir(parents=True, exist_ok=True)
    for char in ASSIGN:
        tags, expression = FACE_TAGS[char]
        o = {"face": tags, "face_box": tuple(faces[char]), "keep_dark": [], "negative": ""}
        for seed in parse_seeds(args.seeds):
            path = folder / f"{char}_{seed}.png"
            if path.exists():
                continue
            result, prompt = outfits.inpaint_face(o, image, expression, seed, args.strength, pad=120)
            x, y, w, h = faces[char]
            result.crop((x - 120, y - 120, x + w + 120, y + h + 120)).save(path)
            log(folder, {"kind": "face", "char": char, "seed": seed, "strength": args.strength, "prompt": prompt})
            print(f"{char} seed {seed}", flush=True)


# 每位挑好的修臉 seed；沒寫的維持 people-merge 的臉。10/22：夏以晴張嘴笑、顏緋嘟嘴臉紅、溫芷薰紫眼與淚痣、
# 葉縈綠眼與黑眼圈、沈靜澄藍眼淡笑
FACE_PICKS = {"jingcheng": 2, "yiqing": 1, "zhixun": 1, "ying": 1, "fei": 1}


def cmd_merge(args):
    """把挑好的臉貼回合照：只貼臉部的橢圓（同 inpaint_face 的遮罩），矩形的其他部分是重畫前的樣子，
    整塊貼回去會蓋掉之後修過的肩膀。"""
    import json
    from outfits import face_mask
    src = OUT / "people" / args.source
    faces = json.loads((src / "faces.json").read_text())
    image = Image.open(src / "seamed.png").convert("RGB")
    for char, seed in FACE_PICKS.items():
        x, y, w, h = faces[char]
        crop = Image.open(OUT / "faces" / args.source / f"{char}_{seed}.png")
        image.paste(crop, (x - 120, y - 120), face_mask(crop.size, (120, 120, w, h), 6))
    image.save(OUT / "faces" / args.source / "merged.png")
    print(f"合成在 {OUT / 'faces' / args.source / 'merged.png'}", flush=True)


# ---- 局部修圖：Roger 和 Claude 檢查整張圖後找出的細節 ----
# box 是要重畫的範圍（合照座標），ellipses 是實際換掉的地方（羽化過），prompt 寫這裡該畫成什麼
FIXES = {
    # 沈靜澄的右手懸在臉旁邊、手指不清楚 → 改成揮手
    "jingcheng_hand": {"box": (60, 200, 500, 700), "ellipses": [(170, 290, 390, 490), (140, 400, 280, 610)],
                       "prompt": "1girl, black hair, glasses, labcoat, sleeve, waving, raised hand, open hand",
                       "strength": 0.75},
    # 夏以晴：合照原本是側馬尾，重畫成短髮後兩側殘留馬尾，髮尾泛粉紅
    "yiqing_hair": {"box": (460, 100, 1000, 640), "ellipses": [(530, 330, 680, 510), (810, 210, 915, 500)],
                    "prompt": "1girl, orange hair, short hair, bob cut, hairclip, orange track jacket",
                    "strength": 0.8},
    # 溫芷薰和葉縈之間、葉縈左肩後面的深棕色色塊
    "ying_shoulder": {"box": (1080, 300, 1400, 700), "ellipses": [(1180, 390, 1260, 570)],
                      "prompt": "2girls, labcoat, white coat, shoulder, side-by-side", "strength": 0.7},
    # 顏緋已經綁了側編髮，右肩外側卻還飄著一束合照原本的長髮
    "fei_hair": {"box": (1600, 330, 2048, 760), "ellipses": [(1830, 470, 1960, 640)],
                 "prompt": "outdoors, cherry blossoms, tree, park, labcoat, red hair, side braid", "strength": 0.75},
}
# 每一處挑好的 seed（10/22）：沈靜澄張開手掌揮手；夏以晴兩側的殘留馬尾消失（2 多了黃色髮飾）；
# 葉縈肩後的色塊變成垂下的頭髮（3 多一條紅帶子）；顏緋的散髮換成背景的一小枝櫻花（1、2 的花簇大到像拿著花）
FIX_PICKS = {"jingcheng_hand": 3, "yiqing_hair": 3, "ying_shoulder": 1, "fei_hair": 3}


def fix_mask(size, offset, ellipses):
    from PIL import ImageDraw, ImageFilter
    mask = Image.new("L", size, 0)
    for x0, y0, x1, y1 in ellipses:
        ImageDraw.Draw(mask).ellipse((x0 - offset[0], y0 - offset[1], x1 - offset[0], y1 - offset[1]), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(10))


def cmd_fix(args):
    from PIL import ImageDraw
    image = Image.open(OUT / "faces" / args.source / "merged.png").convert("RGB")
    folder = OUT / "fix" / args.source
    folder.mkdir(parents=True, exist_ok=True)
    names = args.only.split(",") if args.only else list(FIXES)
    if args.preview:  # 先看範圍對不對：紅框是 box，藍圈是會換掉的地方
        preview = image.copy()
        draw = ImageDraw.Draw(preview)
        for name in names:
            draw.rectangle(FIXES[name]["box"], outline="red", width=3)
            for e in FIXES[name]["ellipses"]:
                draw.ellipse(e, outline="blue", width=3)
        preview.save(folder / "preview.png")
        print(f"範圍預覽在 {folder / 'preview.png'}", flush=True)
        return
    outfits.load_pipe(inpaint=True)
    for name in names:
        f = FIXES[name]
        crop = image.crop(f["box"])
        mask = fix_mask(crop.size, f["box"][:2], f["ellipses"])
        scale = 1024 / max(crop.size)  # 放大到 SDXL 習慣的大小再重畫
        big = (round(crop.width * scale / 8) * 8, round(crop.height * scale / 8) * 8)
        prompt = f["prompt"] + SUFFIX
        check_tokens(prompt, "prompt")
        for seed in parse_seeds(args.seeds):
            path = folder / f"{name}_{seed}.png"
            if path.exists():
                continue
            out = outfits.inpaint_pipe(
                prompt=prompt, negative_prompt=NEGATIVE, image=crop.resize(big, Image.LANCZOS),
                mask_image=mask.resize(big, Image.LANCZOS), width=big[0], height=big[1], strength=f["strength"],
                guidance_scale=CFG, num_inference_steps=STEPS,
                generator=torch.Generator("cpu").manual_seed(seed)).images[0]
            Image.composite(out.resize(crop.size, Image.LANCZOS), crop, mask).save(path)
            log(folder, {"kind": "fix", "name": name, "seed": seed, **f})
            print(f"{name} seed {seed}", flush=True)


def cmd_fix_apply(args):
    """把挑好的局部修圖貼回去（只貼遮罩範圍），存成 fix/<source>/fixed.png。"""
    image = Image.open(OUT / "faces" / args.source / "merged.png").convert("RGB")
    folder = OUT / "fix" / args.source
    for name, seed in FIX_PICKS.items():
        f = FIXES[name]
        crop = Image.open(folder / f"{name}_{seed}.png")
        image.paste(crop, f["box"][:2], fix_mask(crop.size, f["box"][:2], f["ellipses"]))
    image.save(folder / "fixed.png")
    print(f"修好的合照在 {folder / 'fixed.png'}", flush=True)


# ---- 步驟 6：疊上 Logo、輸出 ----
LOGO_WIDTH = 0.48  # Logo 佔畫面寬度的比例（主標 6 個字）
LOGO_BOTTOM = 0.015  # 放在底部光暈上，和下緣的距離


def cmd_final(args):
    image = Image.open(OUT / args.source).convert("RGBA")
    logo = Image.open(OUT / "logo.png").convert("RGBA")  # art/cover_logo.html 截出來的透明圖
    w = round(image.width * LOGO_WIDTH)
    logo = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
    image.alpha_composite(logo, ((image.width - w) // 2, image.height - logo.height - round(image.height * LOGO_BOTTOM)))
    image = image.convert("RGB").resize((1920, 1080), Image.LANCZOS)
    image.save(OUT / "cover.png")
    image.save(OUT / "cover.webp", "WEBP", quality=88, method=6)
    print(f"封面在 {OUT / 'cover.webp'}（{(OUT / 'cover.webp').stat().st_size // 1024} KB）", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pose")
    p.add_argument("char", help="角色 id，或 all")
    p.add_argument("--seeds", default="1-6")
    p = sub.add_parser("bg")
    p.add_argument("--seeds", default="1-8")
    p = sub.add_parser("group")
    p.add_argument("--seeds", default="1-16")
    p = sub.add_parser("hires")
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--strength", type=float, default=0.45)
    p = sub.add_parser("people")
    p.add_argument("source", help="hires 資料夾裡的檔名（不含 .png）")
    p.add_argument("--seeds", default="1-3")
    p.add_argument("--strength", type=float, default=0.65, help="髮色、服裝換不過去就調高，姿勢跑掉就調低")
    p.add_argument("--only", help="只重畫這幾位，逗號分隔")
    p = sub.add_parser("recolor")
    p.add_argument("source", help="同 people")
    p.add_argument("char")
    p.add_argument("--base", type=int, required=True, help="拿 people 的哪個 seed 當底")
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--strength", type=float, default=0.5)
    p = sub.add_parser("people-merge")
    p.add_argument("source", help="同 people")
    p = sub.add_parser("seams")
    p.add_argument("source", help="同 people（要先跑 people-merge）")
    p.add_argument("--pairs", default="0,1,2,3", help="修哪幾條分界：0 是左邊第一、二人之間")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--strength", type=float, default=0.85, help="0.6 會照著原本的直線畫回去")
    sub.add_parser("layout")
    p = sub.add_parser("unify")
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--strength", type=float, nargs="+", default=[0.35, 0.45], help="太像拼貼就調高，臉跑掉就調低")
    p = sub.add_parser("faces")
    p.add_argument("source", help="people 資料夾的名稱，例如 g8_s0.45_1（要先跑 people-merge）")
    p.add_argument("--seeds", default="1-3")
    p.add_argument("--strength", type=float, default=0.5)
    p = sub.add_parser("merge")
    p.add_argument("source", help="同 faces")
    p = sub.add_parser("fix")
    p.add_argument("source", help="同 faces")
    p.add_argument("--only", help="只修這幾處，逗號分隔（FIXES 的名稱）")
    p.add_argument("--seeds", default="1-3")
    p.add_argument("--preview", action="store_true", help="只畫出範圍，不重畫")
    p = sub.add_parser("fix-apply")
    p.add_argument("source", help="同 faces")
    p = sub.add_parser("final")
    p.add_argument("source", help="art/bakeoff/cover/ 底下修好臉的圖，例如 faces/s0.4_1/merged.png")
    args = ap.parse_args()
    {"pose": cmd_pose, "bg": cmd_bg, "group": cmd_group, "hires": cmd_hires, "people": cmd_people,
     "recolor": cmd_recolor, "people-merge": cmd_people_merge, "seams": cmd_seams, "fix": cmd_fix,
     "fix-apply": cmd_fix_apply,
     "layout": cmd_layout, "unify": cmd_unify, "faces": cmd_faces,
     "merge": cmd_merge, "final": cmd_final}[args.cmd](args)


if __name__ == "__main__":
    main()
