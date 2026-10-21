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

# 角色 tag 最多 39 個 token（共用 tag 加品質 tag 佔 36 個），超過時 check_tokens 會報錯。
# face 是表情差分用的臉部 tag，同 notebook 的 CHARACTERS；base_seed 以後的值要記進 characters.md 的定稿紀錄
OUTFITS = {
    # 溫芷薰「心動」：夏日祭典的浴衣。外觀 tag 同定稿，白袍、毛衣、長裙換成浴衣
    "zhixun_yukata": {
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


def base_image(key):
    return Image.open(OUT / key / f"{OUTFITS[key]['base_seed']}.png").convert("RGB")


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
    o = OUTFITS[key]
    preview = base_image(key)
    x, y, w, h = o["face_box"]
    draw = ImageDraw.Draw(preview)
    draw.rectangle((x, y, x + w, y + h), outline="red", width=2)
    draw.ellipse((x, y, x + w, y + h), outline="blue", width=2)  # 實際重畫的範圍
    for kx, ky, kr in o["keep_dark"]:  # 綠色小圈：要保留的淚痣，圈的中心要對準痣
        draw.ellipse((kx - kr - 3, ky - kr - 3, kx + kr + 3, ky + kr + 3), outline="lime", width=1)
    crop = preview.crop((max(0, x - 80), max(0, y - 80), x + w + 80, y + h + 80))
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
    o = OUTFITS[key]
    load_pipe(inpaint=True)
    base = base_image(key)
    names = [args.only] if args.only else list(EXPRESSIONS)
    folder = OUT / key
    x, y, w, h = o["face_box"]
    for name in names:
        crops, labels = [], []
        for seed in parse_seeds(args.seeds):
            path = folder / "expr" / name / f"{seed}.png"
            if not path.exists():
                t = time.time()
                image, prompt = inpaint_face(o, base, EXPRESSIONS[name], seed, args.strength)
                path.parent.mkdir(parents=True, exist_ok=True)
                image.save(path)
                log(folder, {"kind": "expression", "outfit": key, "base_seed": o["base_seed"], "expression": name,
                             "seed": seed, "strength": args.strength, "face_box": o["face_box"],
                             "keep_dark": o["keep_dark"], "prompt": prompt})
                print(f"{key} {name} seed {seed}：{time.time() - t:.0f} 秒", flush=True)
            crops.append(Image.open(path).crop((max(0, x - 120), max(0, y - 120), x + w + 120, y + h + 160)))
            labels.append(f"{name} seed {seed}")
        contact_sheet(crops, labels, folder / "expr" / f"sheet_{name}.png", thumb_h=300)
    print(f"{key}：表情總表在 {folder / 'expr'}", flush=True)


# ---- 步驟 4：去背、去白邊、輸出 ----
def cmd_export(key, args):
    o = OUTFITS[key]
    missing = set(EXPRESSIONS) - set(o["picks"])
    if missing:
        raise SystemExit(f"{key} 的 picks 少了這些表情：{sorted(missing)}")
    from rembg import new_session, remove
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from defringe import defringe

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
        rgba.save(export / f"{name}.webp", "WEBP", quality=90, method=6)
        print(name, (export / f"{name}.webp").stat().st_size // 1024, "KB", flush=True)
    # 放在深色底上檢查去背邊緣（網站深色模式的背景色）
    paths = [export / f"{name}.webp" for name in o["picks"]]
    backdrop = Image.new("RGBA", base.size, (26, 25, 23, 255))
    contact_sheet([Image.alpha_composite(backdrop, Image.open(p).convert("RGBA")).convert("RGB") for p in paths],
                  [p.stem for p in paths], export / "sheet.png", cols=5, thumb_h=360)
    print(f"{key}：輸出在 {export}", flush=True)


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
            p.add_argument("--only", choices=list(EXPRESSIONS), help="只跑一個表情（先用 surprised 確認範圍）")
            p.add_argument("--strength", type=float, default=0.6, help="表情變化太小就調高，臉不像同一個人就調低")
    args = ap.parse_args()
    run = {"base": cmd_base, "box": cmd_box, "expr": cmd_expr, "export": cmd_export}[args.cmd]
    for key in (list(OUTFITS) if args.outfit == "all" else [args.outfit]):
        run(key, args)


if __name__ == "__main__":
    main()
