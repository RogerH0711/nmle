"""劇情服裝立繪，在本機 3070 跑，不用 Colab。流程和 art/portraits.ipynb 的步驟 2–4 相同：

    .venv-gpu\\Scripts\\python.exe art\\outfits.py base all --seeds 100-115   # 步驟 2：候選圖，挑基本立繪
    .venv-gpu\\Scripts\\python.exe art\\outfits.py box all                    # 步驟 3 前：預覽 FACE_BOX、KEEP_DARK
    .venv-gpu\\Scripts\\python.exe art\\outfits.py expr all --only surprised  # 步驟 3：表情差分（先只跑驚訝）
    .venv-gpu\\Scripts\\python.exe art\\outfits.py export all                 # 步驟 4：去背、去白邊、輸出 webp

模型、參數、共用 tag 和 notebook 相同（Animagine XL 4.0 Opt、CFG 5、28 steps、Euler a、832×1216），
角色的髮型、眼睛等外觀沿用 characters.md 的定稿 tag，只換服裝。
輸出都在 art/bakeoff/outfits/<服裝 id>/（不進 repo）：候選圖 <seed>.png 與總表 sheet_*.png、
預覽 box.png、表情 expr/<表情>/<seed>.png 與總表、輸出 export/<表情>.webp；參數記在同一個資料夾的 log.jsonl。
已經存在的圖會跳過，中斷後重跑會接著做。
"""
import argparse
import json
import sys
import time
from pathlib import Path

import torch
from diffusers import AutoPipelineForInpainting, EulerAncestralDiscreteScheduler, StableDiffusionXLPipeline
from huggingface_hub import hf_hub_download
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent / "bakeoff" / "outfits"
WIDTH, HEIGHT = 832, 1216
CFG, STEPS = 5.0, 28
COMMON = "1girl, solo, mature female, full body, standing, looking at viewer, simple background, white background"
SUFFIX = ", safe, masterpiece, high score, great score, absurdres"
NEGATIVE = ("lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, "
            "worst quality, low quality, low score, bad score, average score, signature, watermark, username, "
            "blurry, scenery, motion lines, nsfw, nude, explicit, child, loli, aged down")
EXPRESSIONS = {
    "normal": "closed mouth, light smile",
    "happy": "smile, open mouth, happy",
    "shy": "blush, looking away, embarrassed",
    "sad": "frown, sad, looking down",
    "surprised": "surprised, wide-eyed, open mouth",
}
# 角色專屬表情，同名的蓋掉上面的共用表情（同 notebook 的 EXTRA_EXPRESSIONS）。
# 換了造型的學姊在刷題畫面也會用到這些表情，每套造型都要有
EXTRA_EXPRESSIONS = {
    "fei": {"pout": "pout, blush, looking away"},
    # 酷系：平常面無表情，開心也只是淡淡一笑
    "jingcheng": {"normal": "closed mouth, expressionless", "happy": "light smile, closed mouth"},
    "ying": {"yandere": "smile, shaded face, empty eyes"},
}

# 角色 tag 最多 39 個 token（共用 tag 加品質 tag 佔 36 個），超過時 check_tokens 會報錯。
# face 是表情差分用的臉部 tag，同 notebook 的 CHARACTERS；base_seed 以後的值要記進 characters.md 的定稿紀錄
OUTFITS = {
    # 溫芷薰「心動」：夏日祭典的浴衣。外觀 tag 同定稿，白袍、毛衣、長裙換成浴衣
    "zhixun_yukata": {
        "char": "zhixun",
        "tags": "light purple hair, long hair, wavy hair, side ponytail, purple eyes, droopy eyes, mole under eye, "
                "purple yukata, floral print, obi, hair flower, holding uchiwa",
        "negative": "large breasts, cleavage",
        # 不寫 mole under eye，淚痣用 KEEP_DARK 從基本立繪搬回來（理由見 characters.md）
        "face": "light purple hair, long hair, wavy hair, purple eyes, droopy eyes",
        "base_seed": 113,
        "face_box": (378, 114, 104, 102),  # 右側的紅色髮花留在橢圓外
        "keep_dark": [(453, 163, 3)],  # 左眼下的淚痣
        "picks": {name: 1 for name in EXPRESSIONS},  # seed 4 臉色偏淡、淚痣不明顯
    },
    # 夏以晴「告白前夕」：田徑比賽中。髮型、髮夾、護腕同定稿，外套和運動褲換成比賽服與號碼布
    "yiqing_track": {
        "char": "yiqing",
        "tags": "orange hair, short hair, bob cut, hairclip, amber eyes, athletic female, orange sports tank top, "
                "track shorts, race bib, running shoes, wristband, smile",
        "negative": "",
        "face": "orange hair, short hair, bob cut, hairclip, amber eyes",
        "base_seed": 109,
        "face_box": (365, 140, 106, 100),  # 髮夾在右上方，留在橢圓外
        "keep_dark": [],
        "picks": {name: 3 for name in EXPRESSIONS},  # seed 4 臉頰多出線條，seed 1 害羞幾乎沒臉紅
    },
}

# 服裝商店的造型（10/21 提案、Roger 同意）：每位一套私服、一套依個性的造型。
# 外觀 tag 沿用定稿（characters.md），只換服裝；基本立繪選好後再填 base_seed、face_box 等。
# 負向 tag 不排除身材（10/21 Roger：成年人該是什麼樣子就什麼樣子），葉縈的 bare legs 是防止只穿一件外衣、露出腿
LOOKS = {
    "yiqing": ("orange hair, short hair, bob cut, hairclip, amber eyes, athletic female",
               "orange hair, short hair, bob cut, hairclip, amber eyes", ""),
    "fei": ("red hair, medium hair, side braid, red eyes, tsurime, slender",
            "red hair, medium hair, side braid, red eyes, tsurime", ""),
    # 眼鏡要寫顏色：定稿是灰色細框，只寫 glasses 會被畫成金框（見 notebook）
    "jingcheng": ("black hair, very long hair, straight hair, blue eyes, glasses, grey-framed eyewear, tall female",
                  "black hair, long hair, straight hair, side part, blue eyes, glasses, grey-framed eyewear", ""),
    "zhixun": ("light purple hair, long hair, wavy hair, side ponytail, purple eyes, droopy eyes, mole under eye",
               "light purple hair, long hair, wavy hair, purple eyes, droopy eyes", ""),
    "ying": ("dark green hair, long hair, low twintails, hair ribbon, green eyes, bags under eyes",
             "dark green hair, long hair, green eyes, bags under eyes", "bare legs"),
}
SHOP = {
    "yiqing_casual": ("yiqing", "orange hoodie, denim shorts, baseball cap, sneakers, wristband, smile"),
    "yiqing_winter": ("yiqing", "long coat, orange scarf, earmuffs, track pants, sneakers, wristband, smile"),
    "fei_casual": ("fei", "black turtleneck, beige coat, long coat, black pants, ankle boots, crossed arms"),
    # 謝師宴的晚禮服。畫出來多半是深 V、高開衩的長禮服，10/21 Roger 和朋友看過，認為在輔導級內、也比較好看，採用這版。
    # 試過的保守版（候選在 art/bakeoff/outfits/fei_dress_v2/）：
    # "red dress, long sleeves, knee-length skirt, pantyhose, high heels, crossed arms"，負向加 "cleavage, side slit, evening gown"
    "fei_dress": ("fei", "red dress, cocktail dress, knee-length dress, high heels, crossed arms"),
    "jingcheng_casual": ("jingcheng", "navy blue dress, long dress, open cardigan, holding book, expressionless"),
    "jingcheng_pajamas": ("jingcheng", "pajamas, striped pajamas, long sleeves, slippers, hugging pillow, expressionless"),
    # 下面四套的候選圖是 10/21 放寬尺度之前畫的，負向 tag 照當時的寫，才能重現同一張基本立繪；
    # 表情差分有的在放寬之後跑（沒有這兩個 tag），哪幾張記在 characters.md
    "zhixun_summer": ("zhixun", "white shirt, long skirt, sun hat, sandals, light smile", "large breasts, cleavage"),
    "zhixun_winter": ("zhixun", "turtleneck sweater, scarf, long coat, long skirt, boots", "large breasts, cleavage"),
    "ying_casual": ("ying", "green dress, long dress, open cardigan, sleeves past fingers, light smile",
                    "large breasts, cleavage"),
    "ying_pajamas": ("ying", "animal hood, oversized hoodie, pajamas, sleeves past fingers, pajama pants, light smile",
                     "large breasts, cleavage"),
}
for _key, (_char, _clothes, *_extra) in SHOP.items():  # 第三項（選填）是這套造型另外加的負向 tag
    _tags, _face, _negative = LOOKS[_char]
    _negative = ", ".join(n for n in [_negative, *_extra] if n)
    OUTFITS[_key] = {"char": _char, "tags": f"{_tags}, {_clothes}", "negative": _negative, "face": _face,
                     "base_seed": None, "face_box": None, "keep_dark": [], "picks": {}}

# 選定的基本立繪與臉部範圍。add_dark 是要點上去的淚痣（候選圖沒畫），keep_dark 保留基本立繪上原有的痣
SHOP_FINAL = {
    "yiqing_casual": {"base_seed": 114, "face_box": (360, 128, 100, 90)},  # 髮夾在帽簷下看得到
    "yiqing_winter": {"base_seed": 108, "face_box": (362, 128, 92, 80)},  # 右邊的耳罩留在橢圓外
    "fei_casual": {"base_seed": 105, "face_box": (372, 148, 82, 76)},  # 編髮在右耳後，和定稿同一邊
    "fei_dress": {"base_seed": 100, "face_box": (368, 116, 86, 84)},  # 正面、編髮同一邊；右耳的耳環留在橢圓外
    "jingcheng_casual": {"base_seed": 100, "face_box": (360, 98, 92, 86)},  # 灰色細框眼鏡在橢圓內，每個表情重畫
    "jingcheng_pajamas": {"base_seed": 115, "face_box": (330, 125, 120, 90)},
    "zhixun_summer": {"base_seed": 104, "face_box": (392, 145, 96, 82), "add_dark": [(454, 178)],
                      "keep_dark": [(454, 178, 3)]},  # 候選圖的痣不是沒畫就是畫錯邊，選臉最清楚的再點上去
    "zhixun_winter": {"base_seed": 106, "face_box": (355, 130, 90, 68), "keep_dark": [(425, 172, 3)]},  # 下緣停在圍巾上方
    "ying_casual": {"base_seed": 112, "face_box": (372, 128, 104, 92)},
    "ying_pajamas": {"base_seed": 108, "face_box": (370, 132, 90, 84)},  # 兩側停在帽緣內
}
for _key, _final in SHOP_FINAL.items():
    OUTFITS[_key].update(_final)
    # 各表情選用的差分 seed（10/22）：十套都是 seed 1，臉型和基本立繪最一致
    OUTFITS[_key]["picks"] = {name: 1 for name in {**EXPRESSIONS, **EXTRA_EXPRESSIONS.get(OUTFITS[_key]["char"], {})}}
# 葉縈的 yandere 用 STRENGTH 0.6 時眼睛上的陰影出不來（不像定稿的眼神死），改用 --strength 0.7 跑的 seed 6
OUTFITS["ying_casual"]["picks"]["yandere"] = 6
OUTFITS["ying_pajamas"]["picks"]["yandere"] = 6

# 表情變體：不畫新的全身圖，拿網站上已經去背的立繪（data/characters/<角色>/<表情>.webp）重畫臉部。
# 去背前的原圖只存在 Colab 的 Google Drive，本機用同一個 seed 也畫不出同一張（亂數產生器不同）。
# 臉部完全不透明，所以鋪在白底上重畫，輸出時臉部範圍外的像素和透明度都沿用原檔，不用重新去背。
# expressions：{輸出的表情 id: (拿哪個表情當底, 表情 tag)}
VARIANTS = {
    # 沈靜澄「心動」：眼鏡掉了、戴回去之前的三句。鏡腳延伸到左耳，FACE_BOX 比定稿的 (338, 102, 106, 102) 往左多包到耳朵
    "jingcheng_noglasses": {
        "char": "jingcheng",
        "face": "black hair, long hair, straight hair, side part, blue eyes",
        "negative": "glasses, eyewear",
        "face_box": (322, 100, 128, 108),
        "keep_dark": [],
        "expressions": {
            "noglasses_squint": ("normal", "squinting, closed mouth"),  # 瞇著眼睛找路
            "noglasses_shy": ("shy", "blush, looking away, embarrassed"),
        },
        # STRENGTH 0.7：整副眼鏡要重畫掉，比換表情需要更大的改動（沒試過 0.6）。seed 2 瀏海上多一塊膚色，seed 1 最接近原本的臉
        "picks": {"noglasses_squint": 1, "noglasses_shy": 1},
    },
}
DATA = Path(__file__).resolve().parent.parent / "data" / "characters"

pipe = inpaint_pipe = None


def load_pipe(inpaint=False):
    global pipe, inpaint_pipe
    if pipe is None:
        path = hf_hub_download("cagliostrolab/animagine-xl-4.0", "animagine-xl-4.0-opt.safetensors")
        pipe = StableDiffusionXLPipeline.from_single_file(path, torch_dtype=torch.float16)
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
        if inpaint:
            inpaint_pipe = AutoPipelineForInpainting.from_pipe(pipe)  # 共用權重
        # 3070 只有 8 GB：模型各部分用到時才搬上 GPU，VAE 分塊解碼
        for p in (pipe, inpaint_pipe):
            if p is not None:
                p.enable_model_cpu_offload()
                p.vae.enable_tiling()
    return inpaint_pipe if inpaint else pipe


def check_tokens(text, label):
    count = len(pipe.tokenizer(text).input_ids) - 2
    if count > 75:
        raise ValueError(f"{label} 有 {count} 個 token，超過 75，後面的 tag 會被丟掉：\n{text}")


def negative_for(o):
    negative = NEGATIVE + (", " + o["negative"] if o["negative"] else "")
    check_tokens(negative, "negative prompt")
    return negative


def log(folder, record):
    with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({**record, "time": time.time()}, ensure_ascii=False) + "\n")


def contact_sheet(images, labels, out, cols=4, thumb_h=420):
    thumbs = [im.resize((round(im.width * thumb_h / im.height), thumb_h)) for im in images]
    w = max(t.width for t in thumbs)
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (w * cols, (thumb_h + 28) * rows), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (t, label) in enumerate(zip(thumbs, labels)):
        x, y = (i % cols) * w, (i // cols) * (thumb_h + 28)
        sheet.paste(t, (x, y + 28))
        draw.text((x + 6, y + 6), str(label), fill="black")
    sheet.save(out)


def parse_seeds(text):
    a, _, b = text.partition("-")
    return list(range(int(a), int(b or a) + 1))


def config(key):
    return OUTFITS.get(key) or VARIANTS[key]


def expressions_of(key):
    """{表情 id: (當底的表情, 表情 tag)}；劇情服裝的底都是基本立繪（None）。"""
    if key in VARIANTS:
        return VARIANTS[key]["expressions"]
    tags = {**EXPRESSIONS, **EXTRA_EXPRESSIONS.get(OUTFITS[key]["char"], {})}
    return {n: (None, t) for n, t in tags.items()}


def source_rgba(key, source):
    return Image.open(DATA / VARIANTS[key]["char"] / f"{source}.webp").convert("RGBA")


MOLE = (122, 27, 43)  # 浴衣基本立繪（seed 113）淚痣中心的顏色


def add_dark(image, points):
    """在基本立繪上點淚痣（候選圖沒畫或畫錯邊時用）：放大 8 倍畫圓再縮回來，邊緣才柔和，大小同浴衣那顆。"""
    for x, y in points:
        sc, r = 8, 1.1
        box = (x - 3, y - 3, x + 4, y + 4)
        mask = Image.new("L", ((box[2] - box[0]) * sc, (box[3] - box[1]) * sc), 0)
        c = (x - box[0] + 0.5) * sc
        ImageDraw.Draw(mask).ellipse((c - r * sc, c - r * sc, c + r * sc, c + r * sc), fill=255)
        mask = mask.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
        image.paste(Image.composite(Image.new("RGB", mask.size, MOLE), image.crop(box), mask), box[:2])
    return image


def base_image(key, source=None):
    if key in VARIANTS:
        rgba = source_rgba(key, source or "normal")
        return Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
    image = Image.open(OUT / key / f"{OUTFITS[key]['base_seed']}.png").convert("RGB")
    return add_dark(image, OUTFITS[key].get("add_dark", []))


# ---- 步驟 2：候選圖 ----
def cmd_base(key, args):
    o = OUTFITS[key]
    load_pipe()
    prompt = o["tags"] + ", " + COMMON + SUFFIX
    check_tokens(prompt, "prompt")
    negative = negative_for(o)
    folder = OUT / key
    folder.mkdir(parents=True, exist_ok=True)
    for seed in parse_seeds(args.seeds):
        path = folder / f"{seed}.png"
        if path.exists():
            continue
        t = time.time()
        image = pipe(prompt=prompt, negative_prompt=negative, width=WIDTH, height=HEIGHT,
                     guidance_scale=CFG, num_inference_steps=STEPS,
                     generator=torch.Generator("cpu").manual_seed(seed)).images[0]
        image.save(path)
        log(folder, {"kind": "base", "outfit": key, "seed": seed, "prompt": prompt, "negative": negative,
                     "cfg": CFG, "steps": STEPS})
        print(f"{key} seed {seed}：{time.time() - t:.0f} 秒", flush=True)
    done = sorted((p for p in folder.glob("*.png") if p.stem.isdigit()), key=lambda p: int(p.stem))
    for i in range(0, len(done), 8):
        part = done[i:i + 8]
        contact_sheet([Image.open(p) for p in part], [f"seed {p.stem}" for p in part], folder / f"sheet_{i // 8 + 1}.png")
    print(f"{key}：完成 {len(done)} 張，總表在 {folder}", flush=True)


# ---- 步驟 3 前：預覽臉部範圍 ----
def cmd_box(key, args):
    o = config(key)
    preview = base_image(key)
    x, y, w, h = o["face_box"]
    draw = ImageDraw.Draw(preview)
    draw.rectangle((x, y, x + w, y + h), outline="red", width=2)
    draw.ellipse((x, y, x + w, y + h), outline="blue", width=2)  # 實際重畫的範圍
    for kx, ky, kr in o["keep_dark"]:  # 綠色小圈：要保留的淚痣，圈的中心要對準痣
        draw.ellipse((kx - kr - 3, ky - kr - 3, kx + kr + 3, ky + kr + 3), outline="lime", width=1)
    crop = preview.crop((max(0, x - 80), max(0, y - 80), x + w + 80, y + h + 80))
    (OUT / key).mkdir(parents=True, exist_ok=True)
    crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS).save(OUT / key / "box.png")
    print(f"{key}：預覽在 {OUT / key / 'box.png'}", flush=True)


# ---- 步驟 3：表情差分（同 notebook 的 inpaint_face、keep_dark） ----
def face_mask(size, box, feather):
    mask = Image.new("L", size, 0)
    x, y, w, h = box
    ImageDraw.Draw(mask).ellipse((x, y, x + w, y + h), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(feather))


def keep_dark(result, base, points):
    """把基本立繪上的淚痣疊回去：只在小圓內，每個像素取兩張圖裡比較深的顏色。"""
    for kx, ky, kr in points:
        pad = 2
        box = (kx - kr - pad, ky - kr - pad, kx + kr + pad + 1, ky + kr + pad + 1)
        mask = Image.new("L", (box[2] - box[0], box[3] - box[1]), 0)
        ImageDraw.Draw(mask).ellipse((pad, pad, pad + 2 * kr, pad + 2 * kr), fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(1))
        here = result.crop(box)
        result.paste(Image.composite(ImageChops.darker(here, base.crop(box)), here, mask), box[:2])


def inpaint_face(o, base, expression_tags, seed, strength, pad=96):
    x, y, w, h = o["face_box"]
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(base.width, x + w + pad), min(base.height, y + h + pad)
    crop = base.crop((x0, y0, x1, y1))
    scale = 1024 / max(crop.size)  # 臉在全身圖裡很小，放大到約 1024 重畫，細節才夠
    big = (round(crop.width * scale / 8) * 8, round(crop.height * scale / 8) * 8)
    local_box = (x - x0, y - y0, w, h)
    big_box = tuple(round(v * big[0] / crop.width) for v in local_box)
    prompt = f"1girl, solo, mature female, portrait, {o['face']}, {expression_tags}, looking at viewer" + SUFFIX
    check_tokens(prompt, "prompt")
    out = inpaint_pipe(prompt=prompt, negative_prompt=negative_for(o),
                       image=crop.resize(big, Image.LANCZOS), mask_image=face_mask(big, big_box, 12),
                       width=big[0], height=big[1], strength=strength,
                       guidance_scale=CFG, num_inference_steps=STEPS,
                       generator=torch.Generator("cpu").manual_seed(seed)).images[0]
    # 縮回原尺寸，只在羽化遮罩範圍內換掉，遮罩外完全是原圖
    patch = Image.composite(out.resize(crop.size, Image.LANCZOS), crop, face_mask(crop.size, local_box, 6))
    result = base.copy()
    result.paste(patch, (x0, y0))
    keep_dark(result, base, o["keep_dark"])
    return result, prompt


def cmd_expr(key, args):
    o = config(key)
    load_pipe(inpaint=True)
    exprs = expressions_of(key)
    names = [args.only] if args.only else list(exprs)
    folder = OUT / key
    x, y, w, h = o["face_box"]
    for name in names:
        source, tags = exprs[name]
        base = base_image(key, source)
        crops, labels = [], []
        for seed in parse_seeds(args.seeds):
            path = folder / "expr" / name / f"{seed}.png"
            if not path.exists():
                t = time.time()
                image, prompt = inpaint_face(o, base, tags, seed, args.strength)
                path.parent.mkdir(parents=True, exist_ok=True)
                image.save(path)
                log(folder, {"kind": "expression", "outfit": key, "base_seed": o.get("base_seed", source), "expression": name,
                             "seed": seed, "strength": args.strength, "face_box": o["face_box"],
                             "keep_dark": o["keep_dark"], "prompt": prompt, "negative": negative_for(o)})
                print(f"{key} {name} seed {seed}：{time.time() - t:.0f} 秒", flush=True)
            crops.append(Image.open(path).crop((max(0, x - 120), max(0, y - 120), x + w + 120, y + h + 160)))
            labels.append(f"{name} seed {seed}")
        contact_sheet(crops, labels, folder / "expr" / f"sheet_{name}.png", thumb_h=300)
    print(f"{key}：表情總表在 {folder / 'expr'}", flush=True)


# ---- 步驟 4：去背、去白邊、輸出 ----
def cmd_export(key, args):
    o = config(key)
    missing = set(expressions_of(key)) - set(o["picks"])
    if missing:
        raise SystemExit(f"{key} 的 picks 少了這些表情：{sorted(missing)}")
    if key in VARIANTS:
        return export_variant(key, o)
    from rembg import new_session, remove
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from defringe import defringe
    from recolor import save_portrait

    folder = OUT / key
    base = base_image(key)
    # 所有表情共用基本立繪的透明遮罩，切換表情時輪廓才不會跳動；bria-rmbg 最乾淨（見 notebook 步驟 4）
    alpha = remove(base, session=new_session("bria-rmbg"), only_mask=True).convert("L")
    export = folder / "export"
    export.mkdir(parents=True, exist_ok=True)
    for name, seed in o["picks"].items():
        src = base if seed is None else Image.open(folder / "expr" / name / f"{seed}.png").convert("RGB")
        rgba = src.copy()
        rgba.putalpha(alpha)
        rgba = defringe(rgba)  # 要在還有原本背景色的時候做
        save_portrait(rgba, export / f"{name}.webp", o["char"])  # 顏緋會自動調色（art/recolor.py）
        print(name, (export / f"{name}.webp").stat().st_size // 1024, "KB", flush=True)
    # 放在深色底上檢查去背邊緣（網站深色模式的背景色）
    paths = [export / f"{name}.webp" for name in o["picks"]]
    backdrop = Image.new("RGBA", base.size, (26, 25, 23, 255))
    contact_sheet([Image.alpha_composite(backdrop, Image.open(p).convert("RGBA")).convert("RGB") for p in paths],
                  [p.stem for p in paths], export / "sheet.png", cols=5, thumb_h=360)
    print(f"{key}：輸出在 {export}", flush=True)


def export_variant(key, o):
    """表情變體：只換臉部範圍內的顏色，透明度和範圍外的像素都沿用原檔。直接輸出到 data/characters/<角色>/。"""
    folder = OUT / key
    mask = face_mask((WIDTH, HEIGHT), o["face_box"], 6)
    for name, seed in o["picks"].items():
        source, _ = expressions_of(key)[name]
        original = source_rgba(key, source)
        redrawn = Image.open(folder / "expr" / name / f"{seed}.png").convert("RGBA")
        redrawn.putalpha(original.getchannel("A"))
        out = Image.composite(redrawn, original, mask)
        path = DATA / o["char"] / f"{name}.webp"
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from recolor import save_portrait
        save_portrait(out, path, o["char"], adjusted=True)  # 底圖是 data/ 裡已經調過色的檔案，不再調一次
        print(name, path.stat().st_size // 1024, "KB", flush=True)
    print(f"{key}：輸出在 {DATA / o['char']}", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, seeds in [("base", "100-115"), ("box", None), ("expr", "1-4"), ("export", None)]:
        p = sub.add_parser(name)
        p.add_argument("outfit", help="服裝 id，或 all")
        if seeds:
            p.add_argument("--seeds", default=seeds, help="例如 " + seeds)
        if name == "expr":
            p.add_argument("--only", help="只跑一個表情（先用 surprised 確認範圍）")
            p.add_argument("--strength", type=float, default=0.6, help="表情變化太小就調高，臉不像同一個人就調低")
    args = ap.parse_args()
    run = {"base": cmd_base, "box": cmd_box, "expr": cmd_expr, "export": cmd_export}[args.cmd]
    for key in (list(OUTFITS) + list(VARIANTS) if args.outfit == "all" else [args.outfit]):
        run(key, args)


if __name__ == "__main__":
    main()
