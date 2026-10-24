"""遊戲封面「醫師一階攻略」：用 Qwen-Image-Edit-2511 畫五位學姊的大合照。

10/22 Roger 看過 SDXL 版（art/cover.py）後認為錯誤太多（手指、兩人交疊時頭髮和衣服歸屬錯亂），要求換更好的模型、
速度不是重點。SDXL 版的做法是先生成合照、再一個一個重畫成各自的學姊，交界處一直出問題。這裡試過兩條路：
- group：給模型看五位定稿立繪排成的拼貼，請它畫成同一個鏡頭下的插畫。角色都對、也沒有錯誤，但 10/23 Roger 認為
  看起來像五張立繪擺在一起，不像合照（每個人都是立繪原本的姿勢），四件白袍配一套運動服也不協調。
- edit：SDXL 版當構圖和畫風的底，角色設定表（sheet）當外觀參考，請模型修掉錯誤、把五個人改回定稿的樣子。
  Roger 喜歡 SDXL 版的合照感和畫風，要兩邊各取優點，所以走這條。

模型（都是 Apache-2.0）：Qwen-Image-Edit-2511 的 GGUF Q5_K_M（unsloth）、文字編碼器 Qwen2.5-VL-7B fp8、Qwen-Image VAE。
3070 只有 8 GB，用 ComfyUI 跑（會自動分段把模型搬進顯卡），裝在 repo 外的 C:\\Users\\USER\\ComfyUI，
GGUF 用 city96/ComfyUI-GGUF 載入。工作流程照 ComfyUI 官方範本 image_qwen_image_edit_2511（40 步、CFG 4、euler、simple、
ModelSamplingAuraFlow shift 3.1、CFGNorm），這裡用 API 送出，參數才記得住。

    C:\\Users\\USER\\ComfyUI\\.venv\\Scripts\\python.exe C:\\Users\\USER\\ComfyUI\\main.py --port 8188 --disable-smart-memory
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py collage                       # 步驟 1：定稿立繪排成拼貼（group 用）
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py sheet                         #         角色設定表（edit 用）
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py group --seeds 1-4              # 步驟 2：畫成大合照（一張約 14 分鐘）
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py edit --seeds 1-4               #         或修 SDXL 版
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py upscale edit_e1/2.png          # 步驟 3：放大 4 倍
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py person --round 1 --mask       # 步驟 4：一次修一個人，填 PERSON_PICKS
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py person-apply --round 1        #         再跑第 2 輪，得到 round2.png
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py fix person/round2.png         #         還有小錯再局部修正（--preview 看範圍）
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py fix-apply person/round2.png
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py final person/round2.png       # 步驟 5：疊上 Logo，輸出 1920×1080

10/23 起也可以送到 Colab 的 A100：本機一張要 20–50 分鐘，每個人只抽得起兩三個 seed；A100 快很多，可以多抽幾個再挑，
模型也換成原始精度 bf16。VM 的準備和連線方式見 art/cover_colab.py，連上之後加 --server，其他步驟都一樣
（圖都經 ComfyUI 的上傳 API 送過去）。用 bf16 畫的輸出檔名前面加 bf16_，不會和本機的撞名。

    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py --server http://127.0.0.1:8190 person --round 1 --mask --seeds 1-8

輸出在 art/bakeoff/cover/qwen/（不進 repo），大合照的參數記在 group_<RUN>/log.jsonl。
Logo 是 art/cover_logo.html 截出來的 art/bakeoff/cover/logo.png（截法見 art/cover.py）。
"""
import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ART = Path(__file__).resolve().parent
OUT = ART / "bakeoff" / "cover" / "qwen"
DATA = ART.parent / "data" / "characters"
SERVER = "http://127.0.0.1:8188"  # 本機的 ComfyUI；--server 可以換成 Colab 的網址

# ---- 步驟 1：拼貼 ----
CANVAS = (1920, 1080)
ORDER = ["jingcheng", "yiqing", "zhixun", "ying", "fei"]  # 由左到右，同 SDXL 版
# 葉縈用 normal：happy 是露齒大笑，10/23 封面照它畫，Roger 說病嬌的感覺和黑眼圈都沒了（normal 是半睜眼、黑眼圈、淡淡的笑）
EXPRESSIONS = {"jingcheng": "happy", "yiqing": "happy", "zhixun": "happy", "ying": "normal", "fei": "pout"}
HEIGHTS = {"fei": 160, "jingcheng": 168, "yiqing": 163, "zhixun": 170, "ying": 158}  # characters.md
CM_PX = 10  # 1 cm 幾 px：170 cm 的全身 1700 px，畫面只拍到大腿（cowboy shot）
GROUND = 1800  # 腳底的高度（在畫面外），每個人都站在同一個地面上
SLOTS_X = [250, 610, 960, 1310, 1670]  # 每個人的中心
# 由左到右貼，右邊的人站在前面。沈靜澄抱在胸前的書被夏以晴蓋住時只露出一角，模型會把那一角畫成來路不明的東西；
# 整個人改貼在前面，長髮又會蓋到夏以晴的腿。所以只把書、手和前臂再貼到最上層。
# 範圍是畫面座標的多邊形，下緣沿著袖子的下緣（用矩形的話，下緣會切過大衣，留下一條橫線）
# 夏以晴叉腰的手肘伸到 x≈900，原本整條手臂被溫芷薰的頭髮蓋住，髮絲中間的空隙又露出護腕，
# 模型會畫成頭髮纏在手腕上；讓她的手臂在前面，頭髮就落在手臂後方。
FRONT = {"jingcheng": [(300, 440), (525, 440), (525, 640), (514, 643), (503, 660), (480, 672), (462, 676),
                       (462, 722), (400, 724), (350, 727), (300, 731)],
         "yiqing": [(560, 380), (910, 380), (910, 880), (560, 880)]}
BACKGROUND = ART / "bakeoff" / "cover" / "bg" / "3.png"  # SDXL 版挑的校園櫻花背景


def cmd_collage(args):
    bg = Image.open(BACKGROUND).convert("RGB")
    scale = max(CANVAS[0] / bg.width, CANVAS[1] / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.LANCZOS).crop((0, 0) + CANVAS)
    canvas = bg.convert("RGBA")
    layers = {}
    for char, x in zip(ORDER, SLOTS_X):
        figure = Image.open(DATA / char / f"{EXPRESSIONS[char]}.webp").convert("RGBA")
        figure = figure.crop(figure.getchannel("A").getbbox())  # 只留人物
        h = round(HEIGHTS[char] * CM_PX)
        figure = figure.resize((round(figure.width * h / figure.height), h), Image.LANCZOS)
        layer = Image.new("RGBA", CANVAS)  # paste 可以貼到畫面外（負座標），alpha_composite 不行
        layer.paste(figure, (x - figure.width // 2, GROUND - h), figure)
        canvas = Image.alpha_composite(canvas, layer)
        layers[char] = layer
    for char, polygon in FRONT.items():
        mask = Image.new("L", CANVAS, 0)
        ImageDraw.Draw(mask).polygon(polygon, fill=255)
        layer = layers[char]
        layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
        canvas = Image.alpha_composite(canvas, layer)
    OUT.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT / "collage.png")
    print(f"拼貼在 {OUT / 'collage.png'}", flush=True)


# 角色設定表：五位的定稿立繪各取頭到大腿，白底排成一排，給 edit 步驟當外觀參考（image 2）。
# 白底、等高、不重疊，模型比較會把它當成「長相和服裝的參考」，而不是要照著擺的構圖。
SHEET_HEIGHT = 900
SHEET_KEEP = 0.6  # 立繪從頭頂往下取的比例


def reference(char):
    """定稿立繪從頭頂取到大腿，縮成 SHEET_HEIGHT 高（透明背景）。"""
    figure = Image.open(DATA / char / f"{EXPRESSIONS[char]}.webp").convert("RGBA")
    figure = figure.crop(figure.getchannel("A").getbbox())
    figure = figure.crop((0, 0, figure.width, round(figure.height * SHEET_KEEP)))
    return figure.resize((round(figure.width * SHEET_HEIGHT / figure.height), SHEET_HEIGHT), Image.LANCZOS)


def cmd_sheet(args):
    figures = [reference(char) for char in ORDER]
    gap = 40
    width = sum(f.width for f in figures) + gap * (len(figures) + 1)
    sheet = Image.new("RGBA", (width, SHEET_HEIGHT + 2 * gap), "white")
    x = gap
    for figure in figures:
        sheet.alpha_composite(figure, (x, gap))
        x += figure.width + gap
    sheet.convert("RGB").save(OUT / "sheet.png")
    print(f"角色設定表在 {OUT / 'sheet.png'}（{sheet.size}）", flush=True)


# ---- 步驟 2：大合照 ----
# 每個人的特徵都寫出來，模型才不會把兩個人的髮色、衣服混在一起。踩過的坑：
# - 寫「visual novel cover」，模型自己在上方畫了一行亂碼標題。
# - 寫沈靜澄「抱著書」，拼貼裡已經有書，模型又多畫一本攤開的。
# - 淚痣只寫「a mole under the eye」，夏以晴、沈靜澄臉上也長出痣，要寫明只有她有。
PROMPT = (
    "Redraw image 1 as one cohesive, high-quality anime illustration: a group photo of five "
    "adult women standing side by side under blooming cherry blossom trees on a university medical campus on a sunny "
    "spring day. They all stand on the same ground at the same distance from the camera, eye-level shot, cowboy shot "
    "framing from the thighs up, shoulders close together, everyone looking at the viewer. Keep the composition, the "
    "framing and the size and position of every woman exactly as in image 1. Keep every woman's face, "
    "hairstyle, hair color, eye color, glasses, outfit, held items and expression exactly as in image 1. "
    "From left to right: "
    "1) very long straight pure black hair with dark blue tips (not brown), blue eyes, grey thin-framed glasses, "
    "white lab coat over a blue turtleneck, gentle smile; 2) short orange bob with a pink "
    "hairclip, amber eyes, open orange track jacket over a white t-shirt, orange track pants, big cheerful smile; "
    "3) long wavy light lavender hair in a low side ponytail "
    "resting on her own shoulder, purple eyes, a small beauty mark under her left eye (she is the only one with a "
    "beauty mark), white lab coat over a lavender sweater, ID badge "
    "on a lanyard, warm smile; 4) long dark green hair in low twintails tied with ribbons, green eyes, slight dark "
    "circles under the eyes, oversized white lab coat with sleeves past the fingers over a green sweater, sweet smile; "
    "5) medium red hair with a side braid, red eyes, sharp eyes, white lab coat over a red scrub top and long red "
    "scrub pants, arms crossed, pouting and blushing. Each person is clearly separate; hair and clothes do not merge "
    "between neighbors, and no one's hair wraps around another person's arm. Correct anatomy, natural hands with five "
    "fingers, no floating objects, clean lineart, soft sunlight, falling petals. No text, title, logo or letters "
    "anywhere in the image."
)
NEGATIVE = ("extra fingers, missing fingers, deformed hands, fused fingers, extra arms, extra people, merged bodies, "
            "text, title, logo, letters, watermark, signature, blurry, lowres, bad anatomy")
STEPS, CFG, SHIFT = 40, 4.0, 3.1
# 輸出尺寸照官方範本用 FluxKontextImageScale：16:9 的拼貼會裁成 1392×752，之後再用 upscale 步驟放大。
# 試過直接出 1664×928（Qwen-Image 原生的 16:9），兩種接法都比較差：
# - 參考圖照官方接法（TextEncodeQwenImageEditPlus 接 vae，內部一律縮成約 1 MP）：輸出比參考圖大，
#   人物維持參考圖裡的像素大小，多出來的畫面補成背景，整張拉遠。
# - 參考圖也用 1664×928（文字編碼不接 vae，自己 VAEEncode 再接 ReferenceLatent）：模型幾乎不照參考圖，
#   畫成五個小小的全身像，畫風也變平。2511 是在約 1 MP 的參考圖上訓練的，不要偏離官方範本。
RUN = "v3"  # 輸出資料夾 group_<RUN>。v1：書被擋住、髮色棕色。v2：書露出來但多一本、痣長到別人臉上、頭髮纏手腕
# 模型的精度看 ComfyUI 上有哪些檔案，有的話用前面的：Colab（art/cover_colab.py）下載的是原始的 bf16，
# 本機 3070 只放得下 GGUF Q5_K_M 和 fp8 的文字編碼器。tag 加在輸出檔名前面，兩邊的結果才不會撞名。
MODELS = [
    {"tag": "bf16_", "loader": "UNETLoader", "unet": "qwen_image_edit_2511_bf16.safetensors",
     "clip": "qwen_2.5_vl_7b.safetensors"},
    {"tag": "", "loader": "UnetLoaderGGUF", "unet": "qwen-image-edit-2511-Q5_K_M.gguf",
     "clip": "qwen_2.5_vl_7b_fp8_scaled.safetensors"},
]
MODEL = None  # model() 第一次問過 ComfyUI 之後記在這裡
# 10/24 Google 取消了學生的 Colab Pro，之後都在本機 3070 跑：GGUF 40 步一張約 19 分鐘。
# --lightning 4 或 8 加上 lightx2v 的少步數 LoRA（Apache-2.0，lightx2v/Qwen-Image-Edit-2511-Lightning，
# 放在 ComfyUI\models\loras），步數改成 4 或 8、CFG 1（照 LoRA 的說明，不算負向提示詞）。輸出檔名的 tag 加 l<步數>_。
LIGHTNING = 0
LIGHTNING_LORA = "Qwen-Image-Edit-2511-Lightning-{}steps-V1.0-bf16.safetensors"


def tag():
    return model()["tag"] + (f"l{LIGHTNING}_" if LIGHTNING else "")


def model():
    global MODEL
    if MODEL is None:
        for m in MODELS:
            info = api(f"/object_info/{m['loader']}")
            if info and m["unet"] in info[m["loader"]]["input"]["required"]["unet_name"][0]:
                MODEL = m
                break
        else:
            raise SystemExit(f"{SERVER} 上沒有 Qwen-Image-Edit-2511 的模型檔")
        print(f"模型：{MODEL['unet']}、{MODEL['clip']}", flush=True)
    return MODEL


def graph(image_name, seed, prompt, negative, image2=None, mask=None, steps=STEPS, denoise=1.0):
    """ComfyUI API 格式的工作流程（同官方範本 image_qwen_image_edit_2511，本機的 UNet 改用 GGUF 載入）。

    image1 決定輸出的尺寸和構圖；image2 是額外的參考圖，照官方範本直接接到文字編碼，不經過縮放節點。
    mask 是和 image1 同尺寸的灰階圖（白色＝重畫）：用 SetLatentNoiseMask，每一步都把白色以外的部分換回原圖，
    模型只能改白色範圍，而且畫的時候看得到旁邊沒動的部分，邊緣會接起來。
    """
    m = model()
    unet = {"unet_name": m["unet"]} | ({"weight_dtype": "default"} if m["loader"] == "UNETLoader" else {})
    g = {
        "1": {"class_type": m["loader"], "inputs": unet},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": m["clip"], "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": SHIFT}},
        "5": {"class_type": "CFGNorm", "inputs": {"model": ["4", 0], "strength": 1.0}},
        "6": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "7": {"class_type": "FluxKontextImageScale", "inputs": {"image": ["6", 0]}},
        "8": {"class_type": "TextEncodeQwenImageEditPlus",
              "inputs": {"clip": ["2", 0], "vae": ["3", 0], "image1": ["7", 0], "prompt": prompt}},
        "9": {"class_type": "TextEncodeQwenImageEditPlus",
              "inputs": {"clip": ["2", 0], "vae": ["3", 0], "image1": ["7", 0], "prompt": negative}},
        "10": {"class_type": "FluxKontextMultiReferenceLatentMethod",
               "inputs": {"conditioning": ["8", 0], "reference_latents_method": "index_timestep_zero"}},
        "11": {"class_type": "FluxKontextMultiReferenceLatentMethod",
               "inputs": {"conditioning": ["9", 0], "reference_latents_method": "index_timestep_zero"}},
        "12": {"class_type": "VAEEncode", "inputs": {"pixels": ["7", 0], "vae": ["3", 0]}},
        "13": {"class_type": "KSampler",
               "inputs": {"model": ["5", 0], "positive": ["10", 0], "negative": ["11", 0], "latent_image": ["12", 0],
                          "seed": seed, "steps": STEPS, "cfg": CFG, "sampler_name": "euler", "scheduler": "simple",
                          "denoise": denoise}},
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["3", 0]}},
        "15": {"class_type": "SaveImage", "inputs": {"images": ["14", 0], "filename_prefix": "nmle_cover"}},
    }
    g["13"]["inputs"]["steps"] = steps
    if LIGHTNING:
        g["21"] = {"class_type": "LoraLoaderModelOnly",
                   "inputs": {"model": ["1", 0], "lora_name": LIGHTNING_LORA.format(LIGHTNING), "strength_model": 1.0}}
        g["4"]["inputs"]["model"] = ["21", 0]
        g["13"]["inputs"].update(steps=LIGHTNING, cfg=1.0)
    if image2:
        g["18"] = {"class_type": "LoadImage", "inputs": {"image": image2}}
        g["8"]["inputs"]["image2"] = g["9"]["inputs"]["image2"] = ["18", 0]
    if mask:
        g["19"] = {"class_type": "LoadImageMask", "inputs": {"image": mask, "channel": "red"}}
        g["20"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["12", 0], "mask": ["19", 0]}}
        g["13"]["inputs"]["latent_image"] = ["20", 0]
    return g


def fetch(path, data=None, content_type="application/json"):
    req = urllib.request.Request(SERVER + path, data=data, headers={"Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def api(path, data=None):
    return json.loads(fetch(path, json.dumps(data).encode() if data is not None else None))


def upload(image, name):
    """把圖（檔案路徑或 PIL 圖）放進 ComfyUI 的 input 資料夾。走上傳 API，本機和 Colab 都一樣。"""
    if isinstance(image, Path):
        png = image.read_bytes()
    else:
        buf = io.BytesIO()
        image.save(buf, "PNG")
        png = buf.getvalue()
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            "Content-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{boundary}--\r\n".encode()
    saved = json.loads(fetch("/upload/image", body, f"multipart/form-data; boundary={boundary}"))["name"]
    assert saved == name, f"ComfyUI 把 {name} 存成 {saved}"


def check_nodes(g):
    """送出前確認 ComfyUI 有這些節點、參數名稱也對（版本不同時節點的參數會改）。"""
    for node in g.values():
        info = api(f"/object_info/{node['class_type']}")
        if node["class_type"] not in info:
            raise SystemExit(f"ComfyUI 沒有 {node['class_type']} 節點")
        spec = info[node["class_type"]]["input"]
        names = set(spec.get("required", {})) | set(spec.get("optional", {}))
        unknown = set(node["inputs"]) - names
        if unknown:
            raise SystemExit(f"{node['class_type']} 沒有這些參數：{unknown}（有 {sorted(names)}）")


def run(g):
    prompt_id = api("/prompt", {"prompt": g, "client_id": str(uuid.uuid4())})["prompt_id"]
    failures = 0
    while True:
        try:
            history = api(f"/history/{prompt_id}")
            failures = 0
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:  # Colab 的通道偶爾斷一下，工作還在跑
            failures += 1
            if failures > 24:
                raise
            print(f"查進度失敗（{e}），5 秒後再試", flush=True)
            time.sleep(5)
            continue
        if prompt_id in history:
            entry = history[prompt_id]
            if entry.get("status", {}).get("status_str") == "error":
                raise SystemExit(json.dumps(entry["status"], ensure_ascii=False)[:2000])
            images = [im for o in entry["outputs"].values() for im in o.get("images", [])]
            if images:
                return images[0]
        time.sleep(5)


def download(im, path):
    query = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im["subfolder"], "type": im["type"]})
    path.write_bytes(fetch(f"/view?{query}"))


def cmd_group(args):
    folder = OUT / f"group_{RUN}"
    folder.mkdir(parents=True, exist_ok=True)
    name = "nmle_cover_collage.png"
    upload(OUT / "collage.png", name)
    check_nodes(graph(name, 0, PROMPT, NEGATIVE))
    for seed in parse_seeds(args.seeds):
        path = folder / f"{model()['tag']}{seed}.png"
        if path.exists():
            continue
        t = time.time()
        download(run(graph(name, seed, PROMPT, NEGATIVE)), path)
        with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "group", "seed": seed, "prompt": PROMPT, "negative": NEGATIVE, "steps": STEPS,
                                "cfg": CFG, "shift": SHIFT, "model": model()["unet"],
                                "time": time.time()}, ensure_ascii=False) + "\n")
        print(f"group seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 步驟 2（另一條路）：修 SDXL 版 ----
# 10/23 Roger 看過 v3：拼貼保留了每張立繪原本的姿勢，看起來像五張立繪擺在一起，不像合照；四件白袍配一套運動服也不協調。
# 他喜歡 SDXL 版（art/cover.py）的合照感和畫風，要兩邊各取優點。所以改成把 SDXL 版當 image 1（構圖、姿勢、畫風照它），
# 角色設定表當 image 2（髮型、長相、服裝照定稿），請模型修掉 SDXL 版的錯誤、把五個人改回定稿的樣子。
# 夏以晴也穿白袍（裡面保留橘色運動外套）；顏緋改回定稿的抱胸，SDXL 版拿筆的手、插進葉縈口袋的手一起消失。
SDXL_SOURCE = OUT.parent / "fix" / "g8_s0.45_1" / "fixed.png"  # SDXL 版疊 Logo 前的圖（2048×1152）
EDIT_PROMPT = (
    "Image 1 is a group photo of five adult women. Image 2 is a character reference sheet of the same five women in "
    "the same left-to-right order. Edit image 1: keep its composition, camera angle, framing, poses, lighting, soft "
    "anime art style and cherry blossom background. Use image 2 only for each woman's hairstyle, face and clothing, "
    "never for poses or layout. Every woman wears an open white lab coat. From left to right: "
    "1) waist-length straight black hair with a side part, blue eyes, thin grey metal glasses, white lab coat over a "
    "dark navy-blue turtleneck; she keeps waving, drawn as a natural open hand with five fingers; "
    "2) short orange bob with a pink hairclip, amber eyes, an open white lab coat worn over her orange track jacket "
    "and white t-shirt, orange track pants, big cheerful smile; "
    "3) long wavy light lavender hair swept back without bangs and gathered in a low side ponytail over her shoulder, "
    "purple droopy eyes, one small beauty mark under her left eye, white lab coat over a lavender knit sweater, long "
    "dark purple skirt, ID badge on a lanyard, gentle smile; "
    "4) long dark green hair in low twintails tied with green ribbons, green eyes, faint dark circles under the eyes, "
    "oversized white lab coat with sleeves covering her fingers over a green crew-neck sweater, sweet smile; "
    "5) medium red hair with a side braid, sharp red eyes, white lab coat over red scrubs, both arms crossed in front "
    "of her chest, pouting and blushing, nothing in her hands. "
    "Keep a small natural gap between neighbouring heads so that no ear, hair or hand overlaps the next woman. Remove "
    "the dark patch behind the shoulders between the third and fourth woman. Correct anatomy, natural hands with five "
    "fingers, clean lineart, no text, title, logo or letters anywhere in the image."
)
EDIT_RUN = "e1"  # 輸出資料夾 edit_<EDIT_RUN>


def cmd_edit(args):
    folder = OUT / f"edit_{EDIT_RUN}"
    folder.mkdir(parents=True, exist_ok=True)
    source, sheet = "nmle_cover_sdxl.png", "nmle_cover_sheet.png"
    upload(SDXL_SOURCE, source)
    upload(OUT / "sheet.png", sheet)
    check_nodes(graph(source, 0, EDIT_PROMPT, NEGATIVE, sheet))
    for seed in parse_seeds(args.seeds):
        path = folder / f"{model()['tag']}{seed}.png"
        if path.exists():
            continue
        t = time.time()
        download(run(graph(source, seed, EDIT_PROMPT, NEGATIVE, sheet)), path)
        with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "edit", "seed": seed, "source": str(SDXL_SOURCE.relative_to(ART)),
                                "prompt": EDIT_PROMPT, "negative": NEGATIVE, "steps": STEPS, "cfg": CFG, "shift": SHIFT,
                                "model": model()["unet"], "time": time.time()},
                               ensure_ascii=False) + "\n")
        print(f"edit seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 步驟 2b：修比例 ----
# 10/23 Roger 看了逐人修正完的版本（person/round2.png）：頭和身體的比例不一致，有些人的肩膀、身體太小。
# 把封面和定稿立繪以臉寬對齊比較，立繪的身體寬了 1.3–1.5 倍：SDXL 版五個人肩並肩、臉的間距只有一個頭寬，
# 身體被擠窄，逐人修正又照指示保留了身體大小。所以整張重畫一次：鏡頭拉遠一點、頭變小、肩膀變寬，
# 比例、臉、髮型、衣服顏色照角色設定表（image 2），姿勢和構圖照原圖。之後再跑一次逐人修正（round_base 換成這張）。
REGROUP_SOURCE = "person/round2.png"
REGROUP_PROMPT = (
    "Image 1 is an anime group photo of five adult women. Image 2 is a character reference sheet of the same five "
    "women in the same left-to-right order, drawn with their correct body proportions. Redraw image 1 with the camera "
    "pulled back a little so that every woman has the adult body proportions of image 2: her head is clearly smaller "
    "relative to her body, with broad adult shoulders and a full torso. Frame them from the top of the head down to "
    "the upper thighs, with some sky above their heads. They stand close together in one row, shoulder to shoulder, "
    "and neighbouring shoulders and sleeves may overlap slightly. Keep the left-to-right order and every woman's pose "
    "and gesture from image 1, the cherry blossom campus background, the lighting and the soft anime art style. Use "
    "image 2 for each woman's face, expression, hairstyle, body proportions and clothing colors, never for poses or "
    "layout. From left to right: "
    "1) waist-length straight black hair fading to blue at the tips, thin grey glasses, calm gentle smile, white lab "
    "coat over a bright royal-blue turtleneck, waving with one open hand; "
    "2) short orange bob with a pink hairclip, big cheerful smile, open white lab coat over her orange track jacket "
    "and white t-shirt; "
    "3) long wavy lavender hair swept back in a low side ponytail on the left side of the image, one beauty mark under "
    "her left eye, white lab coat over a lavender sweater, ID badge on a lanyard; "
    "4) long dark green hair in low twintails with green ribbons, bangs partly covering one eye, half-closed eyes "
    "with faint dark circles and a faint calm smile, oversized white lab coat whose long sleeves cover her hands, "
    "green sweater; "
    "5) medium red hair with a side braid, pouting and blushing, arms crossed, white lab coat over red scrubs. "
    "Every hand belongs to exactly one woman and has five fingers; nobody's hand is in another woman's pocket. "
    "No text, title, logo or letters."
)
REGROUP_RUN = "p1"  # 輸出資料夾 regroup_<REGROUP_RUN>


def cmd_regroup(args):
    folder = OUT / f"regroup_{REGROUP_RUN}"
    folder.mkdir(parents=True, exist_ok=True)
    source, sheet = "nmle_cover_regroup.png", "nmle_cover_sheet.png"
    upload(OUT / REGROUP_SOURCE, source)
    upload(OUT / "sheet.png", sheet)
    check_nodes(graph(source, 0, REGROUP_PROMPT, NEGATIVE, sheet))
    for seed in parse_seeds(args.seeds):
        path = folder / f"{model()['tag']}{seed}.png"
        if path.exists():
            continue
        t = time.time()
        download(run(graph(source, seed, REGROUP_PROMPT, NEGATIVE, sheet)), path)
        with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "regroup", "seed": seed, "source": REGROUP_SOURCE, "prompt": REGROUP_PROMPT,
                                "negative": NEGATIVE, "expressions": EXPRESSIONS, "steps": STEPS, "cfg": CFG,
                                "shift": SHIFT, "model": model()["unet"], "time": time.time()},
                               ensure_ascii=False) + "\n")
        print(f"regroup seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 方向 2，步驟 A：改姿勢 ----
# 10/23 修比例（regroup）沒用：Qwen 的編輯模型守住原圖的輪廓，頭和肩膀一點都沒變。Roger 選了方向 2：
# 不再從 SDXL 合照改，每個人直接拿定稿立繪當起點，只請模型改姿勢（臉、表情、髮型、服裝、身材都照立繪），
# 再照身高用同一個比例尺排版（layout）、統一成一張插畫（unify）、逐人修正（person）。頭和身體的比例就是立繪的比例。
# 姿勢沿用 SDXL 合照裡 Roger 喜歡的。
# a1 看過之後 Roger 的意見（10/23）：
# - 以晴的臉變太多，不像同一個人。所以 a2 起頭部不重畫：遮罩（POSE_HEAD）把頭固定成立繪的像素，只改身體。
# - 站位改成高的在兩側、以晴在正中間（LAYOUT_ORDER）。身體方向從攝影師看過去：左邊兩位朝右、以晴正面、右邊兩位朝左，
#   都朝向中間（a1 是左邊兩位互相、右邊兩位互相）。
# 「turned toward the right side of the image」模型會弄反（10/23 Roger：靜澄朝左、芷薰朝右），改用她自己的左右，
# 再補一句從觀眾看過去的方向和哪一邊肩膀比較靠近鏡頭。
# 結果（a2，seed 1–4 是舊寫法、5–8 是新寫法）：芷薰新寫法 4 張有 3 張朝左；靜澄新寫法 4 張全部朝左（弄反），
# 舊寫法反而有 2 張朝右。兩種寫法模型都不穩，只能多跑幾個 seed 逐張挑（看白袍的中線偏向哪一邊）
# a3（頭不固定）再跑一次新寫法，seed 1 四個人全部弄反。合計新寫法 16 張只對 4 張，舊寫法 16 張對 11 張
# （顏緋 4/4），所以改回舊寫法，再補一句臉看鏡頭（a3 頭不固定，葉縈 seed 1 整個轉成側臉）。
POSE_TURN_RIGHT = ("her body is turned slightly toward the right side of the image, while her face still looks at "
                   "the viewer")
POSE_TURN_LEFT = ("her body is turned slightly toward the left side of the image, while her face still looks at "
                  "the viewer")
POSE_CHANGES = {
    "jingcheng": (
        "she raises the hand on the left side of the image (her right hand) beside her shoulder and waves at the "
        "viewer with a natural open palm and five fingers, while the arm on the right side of the image keeps holding "
        "her book against her side; " + POSE_TURN_RIGHT),
    "ying": (
        "both of her arms hang down at her sides and the long sleeves of her oversized lab coat completely cover her "
        "hands; " + POSE_TURN_RIGHT),
    "yiqing": (
        "she now wears an open white lab coat over her orange track jacket, and the unzipped orange track jacket and "
        "white t-shirt stay clearly visible under the lab coat, with her orange track pants; both of her hands are in "
        "the pockets of the lab coat; her body faces the viewer straight on"),
    "fei": (
        "she keeps her arms crossed in front of her chest; " + POSE_TURN_LEFT),
    "zhixun": (
        "both of her hands are lightly clasped in front of her skirt; " + POSE_TURN_LEFT),
}
POSE_RUN = "a3"  # 輸出資料夾 pose_<POSE_RUN>
# a2 固定頭部（POSE_LOCK_HEAD）：臉一模一樣，但頭的角度、位置是立繪原本身體的，新姿勢的脖子和肩膀接不上，
# 局部修接縫（posefix）也救不回來（10/24 Roger：「很明顯頭跟身體對不上」）。a3 起整個人都讓模型畫，
# 頭身自然一致；臉不像本人的部分交給下一步 face（只重畫五官，參考定稿立繪）。
POSE_LOCK_HEAD = False
POSE_HEAD = (0.5, 0.9, 1.08)  # 固定不動的頭：臉框往左右各擴 0.5 個臉寬、往上 0.9 個臉高（頭髮），往下到 1.08 個臉高（下巴）
POSE_HEAD_FEATHER = 10


def pose_mask(figure):
    """立繪大小的遮罩：頭是黑的（不重畫），其他白的。"""
    x, y, w, h = anime_face(figure)
    mx, top, bottom = POSE_HEAD
    mask = Image.new("L", figure.size, 255)
    ImageDraw.Draw(mask).ellipse((x - mx * w, y - top * h, x + w * (1 + mx), y + bottom * h), fill=0)
    return mask.filter(ImageFilter.GaussianBlur(POSE_HEAD_FEATHER))


def portrait(char):
    """定稿立繪放在白底上（顏緋先把線條調淡，見 POSE_SOFTEN）。"""
    figure = Image.open(DATA / char / f"{EXPRESSIONS[char]}.webp").convert("RGBA")
    source = Image.new("RGBA", figure.size, "white")
    source.alpha_composite(figure)
    source = source.convert("RGB")
    return soften_lines(source, *POSE_SOFTEN[char]) if char in POSE_SOFTEN else source


def pose_prompt(char):
    return (
        f"Edit this anime character illustration. Change only her pose: {POSE_CHANGES[char]}. Keep her head, face, "
        "expression, hairstyle, hair color, eye color, body proportions, height, clothing and the soft anime art "
        "style exactly as in the image. Keep the same framing, standing on a plain white background. Correct "
        "anatomy, natural hands with five fingers, no text.")


def cmd_pose(args):
    folder = OUT / f"pose_{POSE_RUN}"
    folder.mkdir(parents=True, exist_ok=True)
    chars = args.only.split(",") if args.only else LAYOUT_ORDER
    for char in chars:
        source = portrait(char)
        upload(source, f"nmle_pose_{char}.png")
        upload(pose_mask(source).convert("RGB"), f"nmle_pose_mask_{char}.png")
    mask = lambda char: f"nmle_pose_mask_{char}.png" if POSE_LOCK_HEAD else None
    check_nodes(graph(f"nmle_pose_{chars[0]}.png", 0, pose_prompt(chars[0]), NEGATIVE, mask=mask(chars[0])))
    for seed in parse_seeds(args.seeds):  # 同一個 seed 先跑完每個人，早點看得到每個人的第一張
        for char in chars:
            path = folder / f"{char}_{model()['tag']}{seed}.png"
            if path.exists():
                continue
            t = time.time()
            download(run(graph(f"nmle_pose_{char}.png", seed, pose_prompt(char), NEGATIVE, mask=mask(char))), path)
            with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "pose", "char": char, "seed": seed, "expression": EXPRESSIONS[char],
                                    "lock_head": POSE_LOCK_HEAD, "soften": POSE_SOFTEN.get(char),
                                    "prompt": pose_prompt(char), "negative": NEGATIVE, "steps": STEPS, "cfg": CFG,
                                    "shift": SHIFT, "model": model()["unet"], "time": time.time()},
                                   ensure_ascii=False) + "\n")
            print(f"pose {char} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 方向 2，步驟 A'：修補挑好的姿勢（a2 用，已放棄） ----
# 10/24 結論：這條路走不通。接縫修得再乾淨，頭的角度和位置還是立繪的，和新身體的脖子、肩膀對不上。改走 a3 + face。
# 10/23 Roger 看 layout2 的意見：以晴、顏緋、芷薰的頭和身體沒接起來（脖子、領口斷開，以晴的領子上緣有鋸齒狀的橘色），
# 靜澄揮手的食指糊掉、拇指怪怪的，拿書那邊袖子延伸到手下面像有兩隻手，顏緋領口浮著一支筆。
# 前兩個都是 POSE_HEAD 固定頭部的邊緣造成的：頭是立繪原本的像素，身體是新畫的，交界處兩邊對不上
# （以晴立繪的外套領子比較高，被包進固定的範圍；揮手的手剛好伸進橢圓的邊緣，被羽化成半透明）。
# 這一步用挑好的圖當底，只重畫頭部範圍下半圈的接縫、脖子，加上 POSE_FIX 裡指定的方框；臉（POSE_FIX_CORE）不動。
# 第一次用 denoise 1.0（範圍內從純噪聲重畫）：靜澄的書和拿書的手整個不見、白袍領子被抹平成像白上衣，
# 模型把範圍內的東西簡化掉了。改成 denoise < 1，範圍內保留原圖的大致形狀，只重畫細節；脖子的方框也縮小。
POSE_FIX_RING = (0.3, 0.12)  # 接縫：頭部範圍往外 0.3、往內 0.12 個臉寬的一圈，只取眼睛以下
POSE_FIX_NECK = (0.1, 0.95, 0.9, 1.35)  # 脖子的方框（臉框的比例：左、上、右、下）
POSE_FIX_CORE = (0.02, -0.2, 0.98, 1.02)  # 不重畫的臉（同上，橢圓）
# 以晴立繪的外套是拉到脖子的立領（白色鋸齒是拉鍊齒），緊貼下巴兩側，落在上面的範圍裡改不到，所以她的臉縮窄一點
POSE_FIX_CORE_CHAR = {"yiqing": (0.12, -0.2, 0.88, 0.95)}
POSE_FIX_FEATHER = 6
# Roger 也說顏緋的畫風很出戲：線條又粗又黑。量過線條最暗 5% 的亮度：顏緋 17，以晴 50、芷薰 38、葉縈 22
# （靜澄 13，但她頭髮是黑的）。別人的線帶顏色、比較淡。修補前先把她的線調淡、調細（soften_lines），
# 模型畫的時候看到的就是調過的線，畫出來才一致。比較過三種強度（pose_a2/fei_lines2.png），用最強的 F。
# a3 起在 pose 之前就先調（portrait()）。
POSE_SOFTEN = {"fei": (9, 0.8, 0.55)}  # {角色: (抹線的範圍 px, 換成填色的比例, 線條顏色＝填色 × 這個倍率)}


def soften_lines(image, size, alpha, lift):
    """線條換成兩側填色壓暗後的顏色：閉運算（灰階先膨脹再侵蝕）把 size 以內的線抹掉，得到填色；
    線條強度再侵蝕一圈，邊緣的像素多換一點，線看起來比較細。"""
    src = np.asarray(image.convert("RGB")).astype(np.float32)
    fill = cv2.morphologyEx(src, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))
    gray = lambda a: cv2.cvtColor(a.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    w = np.clip((gray(fill) - gray(src) - 10) / 80, 0, 1)
    w = np.minimum(w, cv2.erode(w, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))) * 0.6 + w * 0.4)
    w = (alpha * w)[..., None]
    return Image.fromarray(np.clip(src * (1 - w) + fill * lift * w, 0, 255).astype(np.uint8))


POSE_FIX = {  # {角色: (另外要重畫的方框（pose 輸出的像素座標）, 加在 prompt 的說明)}
    "jingcheng": ([(215, 175, 360, 345), (490, 270, 600, 480)],
                  "her raised right hand on the left side of the image is a clean waving hand with an open palm, four "
                  "clearly separated fingers and one thumb; on the right side of the image her left hand keeps holding "
                  "her dark red book against her side, and the lab coat sleeve ends at that wrist, so there is only "
                  "one sleeve and one hand there"),
    "ying": ([], ""),
    "yiqing": ([], "the stand-up collar of her unzipped orange track jacket frames both sides of her neck and "
                   "continues smoothly down into the open jacket front, with no jagged white edges, no stray orange "
                   "patches and no scarf"),
    "fei": ([(400, 280, 480, 325)], "there is no pen clip or any object floating on her lab coat lapel"),
    "zhixun": ([], "her lavender turtleneck collar wraps around her neck continuously"),
}


def posefix_mask(figure, char):
    x, y, w, h = anime_face(figure)
    head = Image.new("L", figure.size, 0)
    mx, top, bottom = POSE_HEAD
    ImageDraw.Draw(head).ellipse((x - mx * w, y - top * h, x + w * (1 + mx), y + bottom * h), fill=255)
    head = np.asarray(head)
    out_r, in_r = (round(r * w) for r in POSE_FIX_RING)
    ring = (cv2.dilate(head, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * out_r + 1,) * 2)) > 0) & ~(
        cv2.erode(head, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * in_r + 1,) * 2)) > 0)
    ring[:round(y + 0.55 * h)] = False
    mask = Image.fromarray(ring.astype(np.uint8) * 255)
    draw = ImageDraw.Draw(mask)
    l, t, r, b = POSE_FIX_NECK
    draw.rectangle((x + l * w, y + t * h, x + r * w, y + b * h), fill=255)
    for box in POSE_FIX[char][0]:
        draw.rectangle(box, fill=255)
    l, t, r, b = POSE_FIX_CORE_CHAR.get(char, POSE_FIX_CORE)
    draw.ellipse((x + l * w, y + t * h, x + r * w, y + b * h), fill=0)
    return mask.filter(ImageFilter.GaussianBlur(POSE_FIX_FEATHER))


def posefix_prompt(char):
    extra = POSE_FIX[char][1]
    return (
        "Edit this anime character illustration. Fix the drawing so that her neck connects naturally and "
        "continuously from her head down to her collar and shoulders, with the clothing collar wrapping around the "
        f"neck in one consistent piece{'; ' + extra if extra else ''}. Keep her face, expression, hairstyle, hair color, "
        "pose, clothing, colors and the soft anime art style exactly as in the image, standing on a plain white "
        "background. Correct anatomy, natural hands with five fingers, no text.")


def cmd_posefix(args):
    folder = OUT / f"pose_{POSE_RUN}"
    (folder / "fix").mkdir(exist_ok=True)
    chars = args.only.split(",") if args.only else LAYOUT_ORDER
    for char in chars:
        source = Image.open(folder / f"{char}_{POSE_PICKS[char]}.png").convert("RGB")
        if char in POSE_SOFTEN:
            source = soften_lines(source, *POSE_SOFTEN[char])
        mask = posefix_mask(source, char)
        if args.preview:
            red = Image.new("RGB", source.size, (255, 0, 0))
            Image.composite(red, source, mask.point(lambda v: v // 2)).save(folder / "fix" / f"{char}_mask.png")
            continue
        upload(source, f"nmle_posefix_{char}.png")
        upload(mask.convert("RGB"), f"nmle_posefix_mask_{char}.png")
    if args.preview:
        print(f"範圍畫在 {folder / 'fix'}", flush=True)
        return
    for seed in parse_seeds(args.seeds):
        for char in chars:
            path = folder / "fix" / f"{char}_{POSE_PICKS[char]}_d{round(args.denoise * 100)}_{seed}.png"
            if path.exists():
                continue
            t = time.time()
            download(run(graph(f"nmle_posefix_{char}.png", seed, posefix_prompt(char), NEGATIVE,
                               mask=f"nmle_posefix_mask_{char}.png", denoise=args.denoise)), path)
            with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "posefix", "char": char, "source": POSE_PICKS[char], "seed": seed,
                                    "denoise": args.denoise,
                                    "prompt": posefix_prompt(char), "negative": NEGATIVE, "steps": STEPS, "cfg": CFG,
                                    "shift": SHIFT, "model": model()["unet"], "time": time.time()},
                                   ensure_ascii=False) + "\n")
            print(f"posefix {char} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 方向 2，步驟 A''：修臉 ----
# a3 整個人讓模型畫，頭身一致，但臉可能不像本人（a1 的以晴）。這一步只重畫五官（眼睛、眉毛、鼻子、嘴巴），
# 臉的輪廓、頭的角度、頭髮、脖子都不動，再把定稿立繪的頭當第二張參考圖給模型看。
FACE_ZONE = (0.12, 0.12, 0.88, 0.9)  # 重畫的範圍：臉框的比例（左、上、右、下），橢圓，不含下巴和兩頰的輪廓
FACE_FEATHER = 8
FACE_RUN = "b"  # 輸出檔名的前綴。a：prompt 只寫 same expression；b：每個人的表情寫出來（FACE_DETAILS）
FACE_REF = (0.6, 0.7, 0.6, 0.5)  # 參考圖：立繪的頭，臉框往左、上、右、下各擴幾個臉寬／臉高（超出立繪的部分補白）


def face_mask(figure):
    x, y, w, h = anime_face(figure)
    l, t, r, b = FACE_ZONE
    mask = Image.new("L", figure.size, 0)
    ImageDraw.Draw(mask).ellipse((x + l * w, y + t * h, x + r * w, y + b * h), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(FACE_FEATHER))


def face_reference(char):
    source = portrait(char)
    x, y, w, h = anime_face(source)
    l, t, r, b = FACE_REF
    box = (round(x - l * w), round(y - t * h), round(x + w * (1 + r)), round(y + h * (1 + b)))
    ref = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), "white")
    ref.paste(source, (-box[0], -box[1]))
    return ref


# 第一次只寫「same expression」，葉縈、顏緋、芷薰的嘴都被畫成張開（顏緋定稿是鼓臉嘟嘴），芷薰的淚痣不見了，
# 所以每個人的表情和特徵直接寫出來
FACE_DETAILS = {
    "jingcheng": "a calm gentle closed-mouth smile, and her thin silver-rimmed glasses",
    "ying": "sleepy half-lidded eyes with dark circles under her eyes and a faint closed-mouth smile, mouth closed",
    "yiqing": "a bright open-mouthed happy smile",
    "fei": "a pout: puffed cheek, lips pressed together and pushed out, mouth closed, frowning eyebrows and an "
           "embarrassed blush",
    "zhixun": "a gentle smile with slightly parted lips, and a small beauty mark under her left eye",
}


def face_prompt(char):
    return (
        "Edit image 1. Redraw only her eyes, eyebrows, nose and mouth so that her face is identical to the woman in "
        "image 2, who is the same character: same eye shape, eye color, eyelashes and eyebrows, with "
        f"{FACE_DETAILS[char]}, exactly as in image 2. "
        "Keep the head angle, face outline, hair, neck, body, clothing, colors and the soft anime art style of "
        "image 1 exactly as they are. Plain white background, no text.")


def cmd_face(args):
    folder = OUT / f"pose_{POSE_RUN}"
    (folder / "face").mkdir(exist_ok=True)
    chars = args.only.split(",") if args.only else LAYOUT_ORDER
    for char in chars:
        source = Image.open(folder / f"{char}_{POSE_PICKS[char]}.png").convert("RGB")
        mask = face_mask(source)
        if args.preview:
            red = Image.new("RGB", source.size, (255, 0, 0))
            Image.composite(red, source, mask.point(lambda v: v // 2)).save(folder / "face" / f"{char}_mask.png")
            face_reference(char).save(folder / "face" / f"{char}_ref.png")
            continue
        upload(source, f"nmle_face_{char}.png")
        upload(mask.convert("RGB"), f"nmle_face_mask_{char}.png")
        upload(face_reference(char), f"nmle_face_ref_{char}.png")
    if args.preview:
        print(f"範圍畫在 {folder / 'face'}", flush=True)
        return
    for seed in parse_seeds(args.seeds):
        for char in chars:
            path = folder / "face" / f"{char}_{POSE_PICKS[char]}_{FACE_RUN}d{round(args.denoise * 100)}_{seed}.png"
            if path.exists():
                continue
            t = time.time()
            download(run(graph(f"nmle_face_{char}.png", seed, face_prompt(char), NEGATIVE,
                               image2=f"nmle_face_ref_{char}.png", mask=f"nmle_face_mask_{char}.png",
                               denoise=args.denoise)), path)
            with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "face", "char": char, "source": POSE_PICKS[char], "seed": seed,
                                    "denoise": args.denoise, "prompt": face_prompt(char), "negative": NEGATIVE,
                                    "steps": STEPS, "cfg": CFG, "shift": SHIFT, "model": model()["unet"],
                                    "time": time.time()}, ensure_ascii=False) + "\n")
            print(f"face {char} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 方向 2，步驟 A'''：細修臉（本機 3070，不花 CU） ----
# 10/24 Roger 看 a3 排版：髮型、衣服、手都可以，但每個人的表情都很粗糙，跟定稿比幾乎不能看。
# 原因有兩個：Qwen 重畫的眼睛是扁平的色塊（定稿有多層高光、虹膜漸層、睫毛）；姿勢圖的臉只有約 165 px 寬，
# 排版時又放大到約 317 px。這一步先把整個人放大 DETAIL_SCALE 倍（臉和排版上差不多大，排版時不用再放大），
# 再用定稿的模型和流程（outfits.inpaint_face：Animagine XL 4.0，臉裁出來放大到 1024 重畫）和定稿的
# 臉部 tag、表情 tag 重畫臉，畫風就和定稿一樣。
DETAIL_SCALE = 2
DETAIL_PAD = 0.45  # 裁切範圍：臉框往外擴幾個臉寬
DETAIL_BASES = {  # 用哪一張當底：pose 是姿勢原圖，face 是 Qwen 修過臉的圖
    "pose": lambda char: f"{char}_{POSE_PICKS[char]}",
    "face": lambda char: f"face/{char}_{POSE_PICKS[char]}_{FACE_PICKS[char]}",
}


def detail_tags(char):
    """定稿的臉部 tag 和表情 tag（同 outfits.py 的 LOOKS、EXPRESSIONS）。"""
    import outfits
    expressions = {**outfits.EXPRESSIONS, **outfits.EXTRA_EXPRESSIONS.get(char, {})}
    return outfits.LOOKS[char][1], expressions[EXPRESSIONS[char]]


def cmd_detail(args):
    import outfits
    outfits.load_pipe(inpaint=True)
    folder = OUT / f"pose_{POSE_RUN}" / "detail"
    folder.mkdir(exist_ok=True)
    chars = args.only.split(",") if args.only else LAYOUT_ORDER
    for base in args.bases.split(","):
        for char in chars:
            image = Image.open(OUT / f"pose_{POSE_RUN}" / f"{DETAIL_BASES[base](char)}.png").convert("RGB")
            image = image.resize((image.width * DETAIL_SCALE, image.height * DETAIL_SCALE), Image.LANCZOS)
            box = tuple(int(v) for v in anime_face(image))
            face, expression = detail_tags(char)
            o = {"face": face, "face_box": box, "keep_dark": [], "negative": ""}
            for seed in parse_seeds(args.seeds):
                path = folder / f"{char}_{base}_s{round(args.strength * 100)}_{seed}.png"
                if path.exists():
                    continue
                t = time.time()
                result, prompt = outfits.inpaint_face(o, image, expression, seed, args.strength,
                                                      pad=round(DETAIL_PAD * box[2]))
                result.save(path)
                with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                    f.write(json.dumps({"kind": "detail", "char": char, "base": DETAIL_BASES[base](char),
                                        "seed": seed, "strength": args.strength, "face_box": box, "prompt": prompt,
                                        "time": time.time()}, ensure_ascii=False) + "\n")
                print(f"detail {char} {base} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# ---- 方向 2，步驟 A''''：道具（本機 Lightning） ----
# 10/24 Roger：造型要一眼看出人設。白袍維持五人一樣（和遊戲立繪一致），每人加一個遠看就懂的道具。
# 靜澄（解剖所助教）書封畫成解剖圖譜；以晴（醫六）換成短白袍、掛聽診器（Roger：台灣的醫學生穿短白袍，菜鳥的象徵）；
# 葉縈（微免所）手上拿試管；芷薰（臨床藥師）胸前口袋插一排泡殼包裝的藥錠；顏緋（病理科）指間夾玻片
# （原本也加了定稿設定的耳後夾筆，Roger 看了覺得多餘，拿掉）。
# 同時修掉 Roger 和 Claude 檢查出的問題：靜澄揮手的手指太直、靜澄和顏緋翻領上浮著的筆、芷薰口袋上多一張卡、
# 葉縈脖子旁的白色缺口、顏緋糊掉的手（芷薰的手 Roger 說維持原圖）。
# 用姿勢原圖當底，只重畫方框（姿勢圖的座標），避開細修過的臉；over_face 的方框不避開。
PROPS = {  # {角色: ([方框], [over_face 方框], 指令)}
    # 第一次的手的方框（250, 135, 370, 275）太小：新畫的手比較高，指尖超出方框，和原本的指尖疊成半透明
    "jingcheng": ([(225, 95, 380, 280), (322, 278, 372, 328), (380, 555, 610, 720)], [],
                  "Her raised hand on the left side of the image is a natural relaxed waving hand: open palm, gently "
                  "curved fingers of naturally different lengths with visible knuckles, and a thumb. There is no pen "
                  # 10/24 Roger：書封的人體解剖圖太抽象，用素面的書（每次的指令都記在 props/log.jsonl）
                  "or any object on her lab coat lapel, only clean white fabric. The dark red hardcover book she "
                  "holds against her side has a plain cover with no picture, no text and no decoration, and her hand "
                  "holds the book"),
    # 脖子的方框原本是（440, 222, 495, 272），白色缺口在 x 442–449，剛好在左邊界的羽化範圍裡，重畫不到
    "ying": ([(195, 290, 470, 800), (415, 222, 500, 280)], [],
             # 第一次只寫手舉到胸前：袖子彎上來了，下面反摺的大袖口卻還在（一隻手臂兩個袖口），手也整隻露出來
             "Her arm on the left side of the image is bent at the elbow and raised in front of her chest. The "
             "oversized lab coat sleeve of that arm follows the bent arm up to her chest, so no sleeve or cuff hangs "
             "down at her side anymore. The long sleeve still covers most of her hand; only her fingertips peek out "
             "of the sleeve, pinching one small test tube with green liquid. Her green sweater collar meets her neck "
             "cleanly. The small white patch between her neck and her dark green hair is gone: her neck skin meets "
             "her hair directly"),
    "yiqing": ([(285, 175, 555, 435), (235, 430, 605, 880)], [],
               # 第一次（40 步）聽診器很自然，但白袍還是長的：要寫明把白袍剪短
               "She is a medical student, so her long white lab coat is shortened into a short white coat that ends "
               "at her hips. Below the hem of the short coat only her orange track pants are visible, with no white "
               # 第二輪（脖子開放後）管子繞得過脖子了，但中間多垂一條管子（真的聽診器只有兩端），要寫明結構
               # 第三輪 seed 5 的耳塞那一側多畫了螺紋接頭和 T 形橫桿（10/24 Roger 指出），寫明每一端長什麼樣子；
               # 第三輪有一半的圖橘色運動外套不見了，也寫明要留著
               "coat fabric around her thighs. Her open orange track jacket stays as it is under the white coat. "
               "A simple black stethoscope is draped around her neck: its tubing goes around the back of her neck, "
               "visible on both sides of her neck above the coat collar, not tucked under the coat. On one side of "
               "her chest hang the earpieces: the black tube splits into two thin silver ear tubes that end in two "
               "small black ear tips. On the other side hangs one round silver chest piece. The stethoscope has no "
               "other parts, and nothing hangs down the middle of her chest. "
               "Both hands stay in the side pockets of the short white coat, with the orange cuffs of her track "
               "jacket going into the pockets"),
    # 10/24 Roger 看第一輪（40 步）：耳後的黑筆是多的，拿掉（耳朵的方框和指令一起刪）
    # 第二輪的方框（325, 280, 455, 425）太小：玻片伸出方框右邊，變成半透明
    "fei": ([(320, 270, 485, 430)], [],
            # 10/24 Roger 看第三輪 seed 6：拿玻片怪怪的，拿掉；手指也怪，只重畫成自然的手
            "Her arms stay crossed. The hand resting on her upper arm on the right side of the image is a natural "
            "relaxed hand holding nothing: four slender fingers, clearly separated, lightly grip her sleeve, and the "
            "thumb is tucked under the arm. There is no pen or any object on her lab coat lapel"),
    # 10/24 Roger 看第一輪（40 步）：藥錠很突兀（整板比腰還寬、寫實的金屬質感），手也怪（左手手指半透明、
    # 藥錠下面多出手指），口袋上的卡也沒拿掉。第二輪改成手掌大小、一隻手拿，新的手又和原本的手疊出殘影。
    # Roger：藥錠放口袋，手維持原圖。胸前口袋的卡換成藥錠（下面的大口袋在封面上可能被切掉）
    "zhixun": ([(420, 340, 500, 465)], [],
               # 10/24 Roger 看 seed 1：藥錠不夠工整（大小、間距不一），寫明兩排一樣大、等距
               "Remove the card clipped to her lab coat breast pocket. Instead, a neat rectangular blister pack "
               "sticks out of the breast pocket next to the top of one pen: two straight rows of identical round "
               "white tablets, evenly spaced, drawn in the same soft anime style as the rest of the illustration "
               "with clean lines and simple flat shading. The badge on her lanyard stays as it is"),
}
PROPS_FEATHER = 8
# 臉只保護到臉框的這個高度（比例）為止，以下開放重畫。以晴的臉框一直延伸到脖子：第一次整個臉框都不重畫，
# 聽診器沒辦法繞過脖子後面，模型只好把兩邊的管子塞進翻領底下，看起來像斷掉（10/24 Roger 指出）。
# 下巴尖在臉框 0.87 的高度，但脖子兩側從下顎角（約 0.72）就開始，所以裁在 0.75；
# 下巴尖那一小段用模型的輸出（和原圖幾乎一樣）
# 葉縈脖子旁的白色缺口也在臉框裡（第一輪三張都沒改到），下巴在 0.79
PROPS_FACE_CLIP = {"yiqing": 0.75, "ying": 0.8}


def detail_face_box(char):
    """細修重畫過的臉框（放大後的座標），從 detail/log.jsonl 找挑好的那一張。"""
    for line in open(OUT / f"pose_{POSE_RUN}" / "detail" / "log.jsonl", encoding="utf-8"):
        r = json.loads(line)
        if f"{char}_pose_s{round(r['strength'] * 100)}_{r['seed']}" == f"{char}_{DETAIL_PICKS[char]}":
            return r["face_box"]
    raise SystemExit(f"detail/log.jsonl 找不到 {char} {DETAIL_PICKS[char]}")


def props_mask(char, size, only=None):
    """only：只要這幾個方框（boxes 和 over_face 接在一起的編號），PROPS_PICKS 每個方框挑不同 seed 時用。"""
    boxes, over_face, _ = PROPS[char]
    keep = lambda i: only is None or i in only
    mask = Image.new("L", size, 0)
    for i, box in enumerate(boxes):
        if keep(i):
            ImageDraw.Draw(mask).rectangle(box, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(PROPS_FEATHER))
    x, y, w, h = (v / DETAIL_SCALE for v in detail_face_box(char))
    face = Image.new("L", size, 0)
    ImageDraw.Draw(face).ellipse((x - 6, y - 6, x + w + 6, y + h + 6), fill=255)
    if char in PROPS_FACE_CLIP:
        ImageDraw.Draw(face).rectangle((0, y + PROPS_FACE_CLIP[char] * h, *size), fill=0)
    mask = ImageChops.subtract(mask, face.filter(ImageFilter.GaussianBlur(3)))
    extra = Image.new("L", size, 0)
    for i, box in enumerate(over_face, len(boxes)):
        if keep(i):
            ImageDraw.Draw(extra).rectangle(box, fill=255)
    return ImageChops.lighter(mask, extra.filter(ImageFilter.GaussianBlur(4)))


def props_prompt(char):
    return props_prompt_text(PROPS[char][2])


def props_prompt_text(instruction):
    return (f"Edit this anime character illustration. {instruction}. Keep everything else, including her face, "
            "hair, pose, colors and the soft anime art style, exactly as in the image, standing on a plain white "
            "background. Correct anatomy, natural hands with five fingers, no text.")


def cmd_props(args):
    folder = OUT / f"pose_{POSE_RUN}" / "props"
    folder.mkdir(exist_ok=True)
    chars = args.only.split(",") if args.only else LAYOUT_ORDER
    for char in chars:
        source = Image.open(OUT / f"pose_{POSE_RUN}" / f"{DETAIL_BASES['pose'](char)}.png").convert("RGB")
        mask = props_mask(char, source.size)
        if args.preview:
            red = Image.new("RGB", source.size, (255, 0, 0))
            Image.composite(red, source, mask.point(lambda v: v // 2)).save(folder / f"{char}_mask.png")
            continue
        upload(source, f"nmle_props_{char}.png")
        upload(mask.convert("RGB"), f"nmle_props_mask_{char}.png")
    if args.preview:
        print(f"範圍畫在 {folder}", flush=True)
        return
    for seed in parse_seeds(args.seeds):
        for char in chars:
            path = folder / f"{char}_{POSE_PICKS[char]}_{tag()}d{round(args.denoise * 100)}_{seed}.png"
            if path.exists():
                continue
            t = time.time()
            download(run(graph(f"nmle_props_{char}.png", seed, props_prompt(char), NEGATIVE,
                               mask=f"nmle_props_mask_{char}.png", denoise=args.denoise)), path)
            with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "props", "char": char, "source": POSE_PICKS[char], "seed": seed,
                                    "denoise": args.denoise, "boxes": PROPS[char][:2], "prompt": props_prompt(char),
                                    "negative": NEGATIVE, "steps": STEPS, "cfg": CFG, "shift": SHIFT,
                                    "lightning": LIGHTNING, "model": model()["unet"], "time": time.time()},
                                   ensure_ascii=False) + "\n")
            print(f"props {char} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# 挑好的道具（props/<角色>_<POSE_PICKS>_<模型 tag>d<denoise>_<seed>.png 的 <模型 tag>d<denoise>_<seed>），沒寫的不加
# 一個值：所有方框都用那張；串列：每個方框（boxes 接 over_face 的順序）各用哪張，None 是不用。都是 Lightning 8 步。
# 10/24 第一次挑的 Roger 看過後：書的解剖圖太抽象、聽診器耳塞那側多了零件、顏緋拿玻片怪、芷薰的藥錠不工整，重跑後：
# 靜澄的手 seed 1（2、3 和原圖一樣直），書 seed 5（素面；4 留著原本的金色花框）；
# 葉縈的手臂 seed 2 試管最清楚（1、3、4、5 試管幾乎看不到），脖子的缺口用 DETAIL_FILL 補；
# 以晴 seed 5（1、2 中間多垂一條管子，3、4、6 橘色運動外套不見了，7–10 寫明結構後反而有三個末端），
#   耳塞那側多的零件用 PROPS_FIX 局部修；
# 顏緋 seed 7（不拿東西之後；8 手太大，9 手指偏細長）；芷薰 seed 9（7、8 是 2×2 的大顆圓錠，像玩具）
PROPS_PICKS = {
    "jingcheng": ["l8_d100_1", "l8_d100_1", "l8_d100_5"],
    "ying": ["l8_d100_2", None],  # 脖子的缺口改用 DETAIL_FILL 補
    "yiqing": "l8_d100_5",
    "fei": "l8_d100_7",
    "zhixun": "l8_d100_9",
}

# 局部再修：在貼好 PROPS_PICKS 的圖上，只重畫這幾個方框。{角色: ([方框], 指令)}，輸出 props/<角色>_<POSE_PICKS>_<tag>fix_<seed>.png
# 以晴：Roger 說 seed 5 聽診器耳塞那一側多畫了兩個部分（中間一段螺紋接頭、下面的 T 形橫桿和垂著的環）。
# 整個重跑四次（seed 7–10）反而更亂，改成只框那一塊
PROPS_FIX = {
    # 第一次（seed 1–4）只框（300, 318, 362, 465）：Roger 覺得 seed 1 差一點點就對了，但兩根銀管交叉成 X、
    # 拱形裡面留著原本中間那根管子的殘影（在方框上緣外）、耳塞下面多一條細線。方框加上拱形內側，寫明不交叉
    "yiqing": ([(300, 318, 362, 465), (326, 282, 352, 322)],
               "Below the black Y-shaped tube on the left side of her chest, two thin silver ear tubes hang down from "
               "its two lower ends, curving gently toward each other without crossing, and their two small black ear "
               "tips meet at the bottom, pointing toward each other. Remove the ribbed piece, the horizontal bar, the "
               "loop and any line between or below them; inside the black arch there is only the white coat"),
    # 10/25 Roger 同意：交握的雙手手指糊在一起、拇指分不出來，只重畫手指，姿勢和位置不變
    "zhixun": ([(296, 516, 408, 598)],
               "Her two hands stay loosely clasped in front of her waist exactly where they are now, with her right "
               "hand resting over the back of her left hand. Redraw only the hands with clean outlines: each hand has "
               "four clearly separated slender fingers and one distinct thumb, in the same soft anime style"),
}
# 第一次（1–4）：3 兩根細銀管、兩個小黑耳塞，但銀管不是從拱形兩端接下來；1 Roger 覺得差一點點就對了；
# 2 中間多一個像鎖頭的環；4 兩根管子交叉還有橫桿
# 第二次（5–10，方框加上拱形內側）都沒有比較好：5、7 黑管在下面接回來變成封閉的圈，6、9 有模糊殘影，10 多一條斜的黑管，
# 8 和 3 一樣銀管不是從拱形兩端接下來。用 Roger 選的 seed 1，殘影和細線用 DETAIL_FILL 擦掉
# 芷薰 seed 2：姿勢和原本一樣，兩手手指的輪廓變清楚，拇指仍藏在後面（1 有半透明殘影，3 手外圍一圈白邊，
# 4 右下角的指尖數量對不上）
PROPS_FIX_PICKS = {"yiqing": "l8_fix_1", "zhixun": "l8_fix_2"}


def props_apply(char, image):
    """把 PROPS_PICKS（和 PROPS_FIX_PICKS）挑好的結果貼到 image 上：姿勢圖，或放大 DETAIL_SCALE 倍的圖。"""
    pose = Image.open(OUT / f"pose_{POSE_RUN}" / f"{DETAIL_BASES['pose'](char)}.png")
    if char in PROPS_PICKS:
        picks = PROPS_PICKS[char]
        if isinstance(picks, str):
            picks = [picks] * (len(PROPS[char][0]) + len(PROPS[char][1]))
        for pick in dict.fromkeys(p for p in picks if p):
            props = Image.open(OUT / f"pose_{POSE_RUN}" / "props" / f"{char}_{POSE_PICKS[char]}_{pick}.png")
            only = {i for i, p in enumerate(picks) if p == pick}
            mask = props_mask(char, pose.size, only).resize(image.size, Image.LANCZOS)
            image = Image.composite(props.convert("RGB").resize(image.size, Image.LANCZOS), image, mask)
    if char in PROPS_FIX_PICKS:
        fix = Image.open(OUT / f"pose_{POSE_RUN}" / "props" / f"{char}_{POSE_PICKS[char]}_{PROPS_FIX_PICKS[char]}.png")
        mask = props_fix_mask(char, pose.size).resize(image.size, Image.LANCZOS)
        image = Image.composite(fix.convert("RGB").resize(image.size, Image.LANCZOS), image, mask)
    return image


def props_fix_mask(char, size):
    mask = Image.new("L", size, 0)
    for box in PROPS_FIX[char][0]:
        ImageDraw.Draw(mask).rectangle(box, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(PROPS_FEATHER))


def cmd_propsfix(args):
    folder = OUT / f"pose_{POSE_RUN}" / "props"
    chars = args.only.split(",") if args.only else list(PROPS_FIX)
    for char in chars:
        pose = Image.open(OUT / f"pose_{POSE_RUN}" / f"{DETAIL_BASES['pose'](char)}.png").convert("RGB")
        source, mask = props_apply(char, pose), props_fix_mask(char, pose.size)
        if args.preview:
            red = Image.new("RGB", source.size, (255, 0, 0))
            Image.composite(red, source, mask.point(lambda v: v // 2)).save(folder / f"{char}_fixmask.png")
            continue
        upload(source, f"nmle_propsfix_{char}.png")
        upload(mask.convert("RGB"), f"nmle_propsfix_mask_{char}.png")
    if args.preview:
        print(f"範圍畫在 {folder}", flush=True)
        return
    for seed in parse_seeds(args.seeds):
        for char in chars:
            path = folder / f"{char}_{POSE_PICKS[char]}_{tag()}fix_{seed}.png"
            if path.exists():
                continue
            t = time.time()
            prompt = props_prompt_text(PROPS_FIX[char][1])
            download(run(graph(f"nmle_propsfix_{char}.png", seed, prompt, NEGATIVE,
                               mask=f"nmle_propsfix_mask_{char}.png")), path)
            with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "propsfix", "char": char, "base": PROPS_PICKS.get(char), "seed": seed,
                                    "boxes": PROPS_FIX[char][0], "prompt": prompt, "lightning": LIGHTNING,
                                    "model": model()["unet"], "time": time.time()}, ensure_ascii=False) + "\n")
            print(f"propsfix {char} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


# 挑好的細修（detail/<角色>_<這個值>.png）。10/24：Qwen 修過的臉當底會留下它的嘴形（顏緋變成生氣的ㄇ字嘴），
# 用姿勢原圖當底、強度 0.55，五個人的 seed 2 都最接近定稿
DETAIL_PICKS = {char: "pose_s55_2" for char in ["jingcheng", "ying", "yiqing", "fei", "zhixun"]}
# 細修後要貼回原圖的地方（放大後的座標）：以晴的粉紅髮夾在重畫範圍內，被畫成白色
DETAIL_KEEP = {"yiqing": [(865, 125, 975, 215)]}
# 要補掉的地方（姿勢圖的座標）：方框裡的淺色缺口（light，最暗的通道 > 225）或深色線條（dark，灰階 < 222，連反鋸齒的邊一起），
# 往外擴 DETAIL_FILL_GROW 後用四周的顏色往內填（OpenCV inpaint）。
# 葉縈脖子旁的白色缺口，Qwen 重畫三次都不行：缺口留著，或順便把領口改高、和旁邊接不起來（擴 7，連黑色外框一起）。
# 以晴局部修 seed 1 的聽診器拱形裡留著原本中間那根管子的殘影、耳塞下面多一條細線，重畫六次都更亂，直接擦掉。
# 這兩條都是垂直的細線，用 bridge：方框裡每一列換成左右兩側顏色的漸層，只取左右的顏色。
# （第一次用 inpaint，把上方深色的拱形和橫桿往下抹成一團灰，10/25 Roger 指出）
DETAIL_FILL = {
    "ying": [((430, 240, 465, 275), "light")],
    # 殘影的下半段旁邊就是翻領線（從殘影下端接出來），右邊界要越過翻領線，不然漸層會把翻領線的灰拉進來；
    # 被擦掉的那段翻領線由 DETAIL_LINES 補畫。右邊界順著翻領線斜下去（第三項：(y0, x0, 斜率)，每一列的右邊界是
    # max(方框的右邊, x0 + (y - y0) × 斜率)），一開始分成兩個方框，交界處橫向斷一層（10/25 Roger 指出）
    "yiqing": [((333.5, 285, 341, 337), "bridge", (292, 337.5, 0.284)), ((332.5, 391.5, 338.5, 456), "bridge")],
}
# 要補畫的線（姿勢圖的座標）：[(起點, 終點, 寬（放大後的 px）, 顏色)]，取較暗的顏色疊上去（壓到深色的東西不會變淡）。
# 以晴：局部修 seed 1 的翻領線是從殘影管子的下端接出來的，擦掉殘影後上半段跟著不見（10/25 Roger 指出）。
# 照留下那段的位置和斜率（每往下 1 px 往右 0.28）往上接到拱形內側；顏色、寬度量自留下的那段。
# 下端要越過 DETAIL_FILL 混回原圖的那幾列（y 331–337），不然交接處會變淡（10/25 Roger 指出）
DETAIL_LINES = {"yiqing": [((333, 292), (349.5, 350), 3.4, (130, 128, 138))]}
DETAIL_FILL_GROW = {"light": 7, "dark": 4}
DETAIL_BRIDGE_FADE = 6  # 姿勢圖的 px
# 要點上去的淚痣（x, y, 半徑，放大後的座標）。Animagine 的 mole under eye 位置不固定，定稿也是另外點的
# （見 outfits.py）。位置照定稿：左眼虹膜中心往外 0.094、往下 0.107 個臉寬
DETAIL_MOLE = {"zhixun": (910, 399, 2.5)}


def detail_figure(char):
    """排版用的圖：挑好的細修，貼上 PROPS_PICKS 的道具範圍，貼回 DETAIL_KEEP、點上 DETAIL_MOLE。"""
    from outfits import MOLE
    image = Image.open(OUT / f"pose_{POSE_RUN}" / "detail" / f"{char}_{DETAIL_PICKS[char]}.png").convert("RGB")
    image = props_apply(char, image)
    if char in DETAIL_KEEP:
        base = Image.open(OUT / f"pose_{POSE_RUN}" / f"{DETAIL_BASES['pose'](char)}.png").convert("RGB")
        base = base.resize(image.size, Image.LANCZOS)
        mask = Image.new("L", image.size, 0)
        for box in DETAIL_KEEP[char]:
            ImageDraw.Draw(mask).rectangle(box, fill=255)
        image = Image.composite(base, image, mask.filter(ImageFilter.GaussianBlur(4)))
    for box, kind, *edge in DETAIL_FILL.get(char, []):
        l, t, r, b = (round(v * DETAIL_SCALE) for v in box)
        a = np.asarray(image).copy()
        if kind == "bridge":
            for y in range(t, b):
                ry = r
                if edge:
                    y0, x0, slope = edge[0]
                    ry = max(r, round((x0 + (y / DETAIL_SCALE - y0) * slope) * DETAIL_SCALE))
                w = np.linspace(0, 1, ry - l + 2)[1:-1, None]
                fill = a[y, l - 1] * (1 - w) + a[y, ry] * w
                # 最下面 DETAIL_BRIDGE_FADE 列慢慢混回原圖：原圖在方框下面常有一層淡淡的陰影，硬切會留一條橫線
                k = min(1, (b - y) / (DETAIL_BRIDGE_FADE * DETAIL_SCALE))
                a[y, l:ry] = np.round(fill * k + a[y, l:ry] * (1 - k)).astype(np.uint8)
            image = Image.fromarray(a)
            continue
        region = a[t:b, l:r]
        hit = region.min(axis=2) > 225 if kind == "light" else cv2.cvtColor(region, cv2.COLOR_RGB2GRAY) < 222
        mask = np.zeros(a.shape[:2], np.uint8)
        mask[t:b, l:r][hit] = 255
        k = DETAIL_FILL_GROW[kind] * DETAIL_SCALE - 1
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        image = Image.fromarray(cv2.inpaint(a, mask, 4 * DETAIL_SCALE, cv2.INPAINT_TELEA))
    for (x0, y0), (x1, y1), width, color in DETAIL_LINES.get(char, []):
        pad = 8  # 只在線條附近的範圍畫，放大 8 倍畫再縮回來，邊緣才柔和
        box = (round(min(x0, x1) * DETAIL_SCALE) - pad, round(min(y0, y1) * DETAIL_SCALE) - pad,
               round(max(x0, x1) * DETAIL_SCALE) + pad, round(max(y0, y1) * DETAIL_SCALE) + pad)
        size = (box[2] - box[0], box[3] - box[1])
        to = lambda x, y: ((x * DETAIL_SCALE - box[0]) * 8, (y * DETAIL_SCALE - box[1]) * 8)
        mask = Image.new("L", (size[0] * 8, size[1] * 8), 0)
        ImageDraw.Draw(mask).line((*to(x0, y0), *to(x1, y1)), fill=255, width=round(width * 8))
        mask = mask.filter(ImageFilter.GaussianBlur(10)).resize(size, Image.LANCZOS)
        peak = max(1, mask.getextrema()[1])
        mask = mask.point(lambda v: min(255, v * 255 // peak))
        line = Image.composite(Image.new("RGB", size, color), Image.new("RGB", size, "white"), mask)
        image.paste(ImageChops.darker(image.crop(box), line), box[:2])
    if char in DETAIL_MOLE:  # 放大 8 倍畫圓再縮回來，邊緣才柔和（同 outfits.add_dark）
        x, y, r = DETAIL_MOLE[char]
        sc, pad = 8, int(r) + 2
        mask = Image.new("L", ((2 * pad + 1) * sc,) * 2, 0)
        c = (pad + 0.5) * sc
        ImageDraw.Draw(mask).ellipse((c - r * sc, c - r * sc, c + r * sc, c + r * sc), fill=255)
        mask = mask.resize((2 * pad + 1,) * 2, Image.LANCZOS)
        box = (x - pad, y - pad, x + pad + 1, y + pad + 1)
        image.paste(Image.composite(Image.new("RGB", mask.size, MOLE), image.crop(box), mask), box[:2])
    return image


# ---- 方向 2，步驟 B：排版 ----
# 每個人整張等比例縮放（頭和身體的比例就是立繪的），臉的大小只隨身高微調（同 SDXL 版「五位地位相同」的原則），
# 臉的高低照身高差（臉寬約 14 cm 換算）。左右間距沿著去背後的輪廓算：相鄰兩人在肩膀到腰之間最靠近的地方
# 重疊 LAYOUT_OVERLAP 個臉寬，每一對都一樣（只看胸口一列時，衣服、頭髮寬窄不同，間距會忽大忽小）。
# 整排（含揮手的手、頭髮）縮放到佔畫面 LAYOUT_SPAN 寬，最高的頭頂留一點天空。
# 高的站後面（芷薰、靜澄），矮的在前面。背景同 SDXL 版（art/bakeoff/cover/bg/3.png）。
# {角色: pose 輸出檔名後綴}。a1 選的是 靜澄 bf16_7、以晴 bf16_8、芷薰 bf16_4、葉縈 bf16_1、顏緋 bf16_1。
# 顏緋的 a2 是用調色前的立繪跑的，輸出直接套 recolor()（逐像素固定轉換，等同用調好的立繪重跑），原檔在 pose_a2/fei_orig/
# a2 選的是 靜澄 bf16_3、葉縈 bf16_4、以晴 bf16_3、顏緋 bf16_1、芷薰 bf16_6（頭身對不上，已放棄）
POSE_PICKS = {"jingcheng": "bf16_4", "ying": "bf16_1", "yiqing": "bf16_1", "fei": "bf16_2", "zhixun": "bf16_2"}
# 16:9，final 縮成 1920×1080 不用裁。原本 2784×1504（和 person 步驟的底圖同尺寸）比 16:9 寬，final 左右各裁掉約 55 px，
# 會切到靜澄的髮尾（10/25 Roger 要頭髮完整入鏡）
LAYOUT_SIZE = (2688, 1512)
LAYOUT_BG = OUT.parent / "bg" / "3.png"
LAYOUT_TOP_MARGIN = 0.06  # 最高的頭頂離上緣（畫面高度的比例）
LAYOUT_SPAN = 0.97
LAYOUT_OVERLAP = 0.6  # 臉寬的倍數。10/23 Roger：0.3 太鬆
# 個別調整（右邊那位: 和左邊鄰居的重疊）。10/23 Roger：靜澄和其他人分得太開（她背後的長髮和書讓輪廓變寬，
# 兩人身體反而離很遠，臉的間距比其他對多約 40%）；顏緋的右肩被以晴擋掉了，留一點出來
LAYOUT_OVERLAP_PAIR = {"ying": 1.15, "fei": 0.35}
# 修過臉的圖（face 的輸出 pose_<POSE_RUN>/face/<角色>_<POSE_PICKS>_<FACE_RUN>d<denoise>_<seed>.png）
FACE_PICKS = {"jingcheng": "bd75_1", "ying": "bd75_1", "yiqing": "ad75_1", "fei": "bd75_1", "zhixun": "bd75_1"}
LAYOUT_BAND = (0.8, 3.5)  # 算間距的範圍：臉中心往下幾個臉寬（肩膀到腰）
# 10/23 Roger：高的站兩側、靠後，以晴在正中間（中間的人站最前面）
LAYOUT_ORDER = ["jingcheng", "ying", "yiqing", "fei", "zhixun"]
LAYOUT_BACK_TO_FRONT = ["zhixun", "jingcheng", "ying", "fei", "yiqing"]


def anime_face(image):
    casc = cv2.CascadeClassifier(str(OUT.parent / "lbpcascade_animeface.xml"))
    s = max(1, image.height / 1248)  # detail 放大過的圖先縮回姿勢圖的大小再偵測，不然很慢
    small = image.resize((round(image.width / s), round(image.height / s)), Image.LANCZOS) if s > 1 else image
    g = cv2.equalizeHist(cv2.cvtColor(np.asarray(small.convert("RGB")), cv2.COLOR_RGB2GRAY))
    faces = [f for f in casc.detectMultiScale(g, 1.02, 2, minSize=(60, 60)) if f[1] < small.height * 0.35]
    if not faces:
        raise SystemExit("找不到臉")
    return tuple(round(v * s) for v in max(faces, key=lambda f: f[2]))  # x, y, w, h


def place_row(figures, face_w):
    """用臉寬 face_w 排一排。回傳 {角色: [縮放後的圖, (左, 上)]}，垂直已對齊畫面，水平還沒置中。"""
    placed = {}
    for char in LAYOUT_ORDER:
        f = figures[char]
        s = f["k"] * face_w
        image = f["rgba"].resize((round(f["rgba"].width * s), round(f["rgba"].height * s)), Image.LANCZOS)
        face_y = -(HEIGHTS[char] - 163) * face_w / 14
        placed[char] = {"image": image, "alpha": np.asarray(image.getchannel("A")) > 128,
                        "fx": f["cx"] * s, "top": face_y - f["cy"] * s, "face_y": face_y, "x": 0.0}
    for a_, b_ in zip(LAYOUT_ORDER, LAYOUT_ORDER[1:]):
        A, B = placed[a_], placed[b_]
        y0 = round(max(A["face_y"], B["face_y"]) + LAYOUT_BAND[0] * face_w)
        y1 = round(min(A["face_y"], B["face_y"]) + LAYOUT_BAND[1] * face_w)
        need = []
        for y in range(y0, y1):
            ra, rb = round(y - A["top"]), round(y - B["top"])
            if not (0 <= ra < A["alpha"].shape[0] and 0 <= rb < B["alpha"].shape[0]):
                continue
            ca, cb = np.flatnonzero(A["alpha"][ra]), np.flatnonzero(B["alpha"][rb])
            if len(ca) and len(cb):  # B 的臉中心要在 A 的臉中心右邊多遠，這一列才剛好碰到
                need.append((ca[-1] - A["fx"]) - (cb[0] - B["fx"]))
        B["x"] = A["x"] + max(need) - LAYOUT_OVERLAP_PAIR.get(b_, LAYOUT_OVERLAP) * face_w
    top = min(p["top"] + np.flatnonzero(p["alpha"].any(axis=1))[0] for p in placed.values())
    dy = LAYOUT_SIZE[1] * LAYOUT_TOP_MARGIN - top
    for p in placed.values():
        p["top"] += dy
    return placed


def row_extent(placed):
    """畫面高度內看得到的部分，整排最左、最右的 x。"""
    lefts, rights = [], []
    for p in placed.values():
        r0, r1 = max(0, round(-p["top"])), min(p["alpha"].shape[0], round(LAYOUT_SIZE[1] - p["top"]))
        cols = np.flatnonzero(p["alpha"][r0:r1].any(axis=0))
        lefts.append(p["x"] - p["fx"] + cols[0])
        rights.append(p["x"] - p["fx"] + cols[-1])
    return min(lefts), max(rights)


def edge_colors(rgba, erode=3):
    """去背的邊緣：去掉白底，保留描線。
    動畫風格的人物最外圈是深色描線，剛好落在 bria-rmbg 判定為半透明的那一圈，所以那一圈不能換顏色。
    10/25 試過兩種都會壞：art/defringe.py 用透明度反推前景色，細髮絲變成鏈條狀的鋸齒；邊緣換成旁邊的顏色，
    描線被抹掉變成斑駁的雙線（Roger 指出每個人的邊緣都很怪）。
    現在用「顏色轉透明」：姿勢圖的背景是純白，邊緣每個像素比白底暗多少，就有多不透明，顏色扣掉混進來的白。
    放回白底上和原圖一模一樣，描線和反鋸齒都保留。白袍和白底一樣白，所以 bria-rmbg 的遮罩往內縮 erode px
    的範圍維持不透明，只有最外圈用顏色轉透明。"""
    from defringe import smooth_fill
    a = np.array(rgba).astype(float)
    rgb, alpha = a[..., :3], a[..., 3] / 255
    white = smooth_fill(rgb, alpha < 0.02, 6)  # 原本的白底（每個位置平滑地推過來）
    darker = np.clip(((white - rgb) / np.maximum(white, 1)).max(-1), 0, 1)
    core = cv2.erode(alpha, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * erode + 1,) * 2))
    near = cv2.dilate((alpha > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    new = np.where(near, np.maximum(core, darker), 0)
    fg = np.clip((rgb - (1 - new[..., None]) * white) / np.maximum(new[..., None], 1e-3), 0, 255)
    keep = new >= 0.999
    fg[keep] = rgb[keep]
    a[..., :3], a[..., 3] = fg, new * 255
    return Image.fromarray(a.round().astype(np.uint8), "RGBA")


def figure_mask(image, session):
    """去背的遮罩，依圖的內容存在 layout2/masks/（同一張圖不用再跑一次 bria-rmbg）。"""
    import hashlib
    from rembg import remove
    path = OUT / "layout2" / "masks" / f"{hashlib.md5(image.tobytes()).hexdigest()}.png"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        remove(image, session=session(), only_mask=True).convert("L").save(path)
    return Image.open(path).convert("L")


def layout_figures():
    """每個人去背、去白邊後的圖，和臉的位置（排版、手機版共用）。"""
    from functools import cache
    from rembg import new_session
    session = cache(lambda: new_session("bria-rmbg"))
    figures = {}
    for char in LAYOUT_ORDER:
        image = detail_figure(char)
        fx, fy, fw, fh = anime_face(image)
        rgba = image.convert("RGBA")
        rgba.putalpha(figure_mask(image, session))
        rgba = edge_colors(rgba)  # 去白邊
        k = (HEIGHTS[char] / 163) ** 0.5 / fw  # 乘上共同的臉寬就是縮放倍率
        figures[char] = {"rgba": rgba, "k": k, "cx": fx + fw / 2, "cy": fy + fh / 2}
    return figures


def cmd_layout2(args):
    global LAYOUT_TOP_MARGIN
    if args.top_margin is not None:
        LAYOUT_TOP_MARGIN = args.top_margin
    figures = layout_figures()
    # 水平置中看臉：最左、最右兩張臉的中點對齊畫面中心。10/25 Roger：看起來偏右。原本用整排最左、最右的像素
    # 置中，靜澄往左飄的長髮和揮手的手把人推到右邊，臉的中點偏右 146 px。
    # 臉寬照「臉的中點到整排最左、最右比較遠的那一邊」算，兩邊都留在畫面的 LAYOUT_SPAN 以內（Roger：頭髮要完整入鏡）
    face_w = 300.0
    for _ in range(6):  # 看得到的範圍會隨臉寬變（頭頂對齊、下緣切掉的地方不同），算幾次就收斂
        placed = place_row(figures, face_w)
        left, right = row_extent(placed)
        mid = (placed[LAYOUT_ORDER[0]]["x"] + placed[LAYOUT_ORDER[-1]]["x"]) / 2
        face_w *= LAYOUT_SIZE[0] * LAYOUT_SPAN / 2 / max(mid - left, right - mid)
    placed = place_row(figures, face_w)
    faces = [placed[c]["x"] for c in LAYOUT_ORDER]
    shift = LAYOUT_SIZE[0] / 2 - (faces[0] + faces[-1]) / 2
    bg = Image.open(LAYOUT_BG).convert("RGB")
    scale = max(LAYOUT_SIZE[0] / bg.width, LAYOUT_SIZE[1] / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.LANCZOS)
    canvas = bg.crop((0, 0, *LAYOUT_SIZE)).convert("RGBA")
    folder = OUT / "layout2"
    (folder / "layers").mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(folder / "layers" / "bg.png")  # unify 用的圖層：背景和每個人（去背、縮放好的）
    info = {}
    for char in LAYOUT_BACK_TO_FRONT:
        p = placed[char]
        pos = (round(p["x"] + shift - p["fx"]), round(p["top"]))
        canvas.alpha_composite(p["image"], pos)
        p["image"].save(folder / "layers" / f"{char}.png")
        info[char] = {"pick": POSE_PICKS[char], "detail": DETAIL_PICKS[char], "pos": pos, "size": p["image"].size}
    canvas.convert("RGB").save(folder / "layout.png")
    (folder / "layout.json").write_text(json.dumps({"face_w": face_w, "figures": info}, ensure_ascii=False, indent=1))
    print(f"排版在 {folder / 'layout.png'}（臉寬約 {face_w:.0f} px）", flush=True)


# ---- 手機版（直式） ----
# 10/25 Roger：手機上把橫的封面縮在中間很奇怪，要專門做一個手機版。一排五個人縮到手機寬，臉只有約 40 px；
# 改成前後兩排：前排葉縈、以晴、顏緋，後排抬高的靜澄、芷薰（高的站後面），臉約 1.7 倍大，每個人的道具都還看得到。
# 方向不變（左邊朝右、中間正面、右邊朝左）。Logo 在上方的天空。
# 1080×2340 是 19.5:9（現在多數手機的比例）；網站用 object-fit: cover 靠上對齊，比較寬的手機裁掉下面的腿。
PORTRAIT_SIZE = (1080, 2340)
PORTRAIT_FACE = 190  # 163 cm 的臉寬
PORTRAIT_FRONT_Y = 1180  # 以晴（前排、163 cm）的臉中心高度；其他人照身高差上下
# 後排再抬高幾個臉寬。1.35 時芷薰交握的手剛好卡在以晴脖子和肩膀之間的凹處，看起來像以晴脖子上多了幾條線；
# 再低的話後排的臉會被前排的頭髮蓋到
PORTRAIT_BACK_LIFT = 1.2
PORTRAIT_X = {"ying": 0.2, "jingcheng": 0.33, "yiqing": 0.5, "zhixun": 0.69, "fei": 0.8}  # 臉中心（畫面寬的比例）
PORTRAIT_BACK = ("jingcheng", "zhixun")
# 後排在這條線（前排臉中心往下幾個臉寬，約前排的胯下）以下淡掉：後排站得比較高，裙擺會從以晴兩腿之間露出來，
# 而且比前排的腳高很多，看起來像浮在空中
PORTRAIT_BACK_CUT = (3.0, 0.3)  # （位置，淡出的長度），都是臉寬
# 要擦掉的東西（姿勢圖的座標，多邊形），用旁邊的顏色補（OpenCV inpaint）。10/25 Roger：手機版把書拿掉。
# 靜澄的書在葉縈的肩膀和以晴的手臂之間只露出一角、看不到拿書的手；書後面是她的白袍
PORTRAIT_ERASE = {"jingcheng": [(388, 599), (496, 566), (508, 572), (508, 688), (440, 715), (383, 610)]}
PORTRAIT_BACK_TO_FRONT = ["zhixun", "jingcheng", "ying", "fei", "yiqing"]
PORTRAIT_BG_X = 0.45  # 背景放大到畫面高度後，取哪裡當中心（醫學院大樓在中間偏左）


def cmd_portrait(args):
    figures = layout_figures()
    W, H = PORTRAIT_SIZE
    f = PORTRAIT_FACE
    bg = Image.open(LAYOUT_BG).convert("RGB")
    scale = H / bg.height
    bg = bg.resize((round(bg.width * scale), H), Image.LANCZOS)
    x0 = round(bg.width * PORTRAIT_BG_X - W / 2)
    canvas = bg.crop((x0, 0, x0 + W, H)).convert("RGBA")
    folder = OUT / "portrait"
    (folder / "layers").mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(folder / "layers" / "bg.png")
    info = {}
    for char in PORTRAIT_BACK_TO_FRONT:
        fig = figures[char]
        s = fig["k"] * f
        image = fig["rgba"].resize((round(fig["rgba"].width * s), round(fig["rgba"].height * s)), Image.LANCZOS)
        face_y = PORTRAIT_FRONT_Y - (HEIGHTS[char] - 163) * f / 14 - (PORTRAIT_BACK_LIFT * f if char in PORTRAIT_BACK else 0)
        pos = (round(PORTRAIT_X[char] * W - fig["cx"] * s), round(face_y - fig["cy"] * s))
        if char in PORTRAIT_ERASE:
            k = s * DETAIL_SCALE  # 姿勢圖 → 這張圖
            mask = Image.new("L", image.size, 0)
            ImageDraw.Draw(mask).polygon([(x * k, y * k) for x, y in PORTRAIT_ERASE[char]], fill=255)
            mask = cv2.dilate(np.asarray(mask), np.ones((5, 5), np.uint8))
            rgba = np.asarray(image).copy()
            rgba[..., :3] = cv2.inpaint(np.ascontiguousarray(rgba[..., :3]), mask, 6, cv2.INPAINT_TELEA)
            image = Image.fromarray(rgba, "RGBA")
        if char in PORTRAIT_BACK:
            cut, fade = (v * f for v in PORTRAIT_BACK_CUT)
            y = np.arange(image.height, dtype=np.float32)[:, None] + pos[1]
            keep = np.clip((PORTRAIT_FRONT_Y + cut - y) / fade, 0, 1)
            alpha = np.asarray(image.getchannel("A")).astype(np.float32) * keep
            image.putalpha(Image.fromarray(alpha.round().astype(np.uint8)))
        bottom = pos[1] + np.flatnonzero(np.asarray(image.getchannel("A")).any(axis=1))[-1]
        if char not in PORTRAIT_BACK and bottom < H:
            print(f"注意：{char} 的圖在畫面下緣以上就結束了（{bottom} < {H}），腿會斷掉", flush=True)
        canvas.alpha_composite(image, pos)
        image.save(folder / "layers" / f"{char}.png")
        info[char] = {"pos": pos, "size": image.size}
    canvas.convert("RGB").save(folder / "layout.png")
    (folder / "layout.json").write_text(json.dumps({"face_w": f, "order": PORTRAIT_BACK_TO_FRONT, "figures": info},
                                                   ensure_ascii=False, indent=1))
    print(f"手機版排版在 {folder / 'layout.png'}", flush=True)


# ---- 方向 2，步驟 C：統一光線和畫風 ----
# 10/25：五個人花了很多次修好臉、手、道具（聽診器、翻領線是逐像素修的），整張重畫（舊版 cover.py 的 SDXL img2img）
# 會把這些都改掉，所以只做合成：每個像素還是原本畫的，只調光線和層次。貼上去的感覺來自三件事：
# 背景是左上方的陽光、暖色，人物是平均打光；前面的人疊在後面的人身上沒有陰影；背景柔、人物銳利。
# 對應的處理（數值在 UNIFY，可以並排比較幾組）：
#   bg_blur / bg_haze：背景稍微糊、蒙一層天空色，做出景深
#   shadow：每個人在後面的人身上投下柔和的陰影，往右下偏（光從左上來），帶一點紫灰色（動畫的陰影色）
#   light：人物從左上到右下的光線漸層（左上偏暖、右下偏冷暗）
#   wrap：人物邊緣吃到身後背景的顏色（light wrap）
#   rim：人物朝左上的邊緣加一點陽光的輪廓光
#   bloom：亮部往外暈開一點
UNIFY = {
    "a": {"bg_blur": 2.0, "bg_haze": 0.06, "shadow": 0.35, "shadow_blur": 16, "shadow_offset": (10, 8),
          "light": 0.05, "wrap": 0.35, "wrap_width": 5, "rim": 0.25, "bloom": 0.15},
    "b": {"bg_blur": 3.0, "bg_haze": 0.10, "shadow": 0.5, "shadow_blur": 20, "shadow_offset": (14, 10),
          "light": 0.08, "wrap": 0.5, "wrap_width": 7, "rim": 0.4, "bloom": 0.25},
    # a、b 的問題：靜澄的細髮絲整根落在邊緣帶裡，被背景色蓋成灰白的殘影（改成只作用在有厚度的邊緣，thick）；
    # 光從左上來，影子都往右下落，左半邊的重疊處（葉縈疊在靜澄前、以晴疊在葉縈前）沒有陰影（加不分方向的 ao）；
    # b 的光線漸層讓以晴的臉泛白
    "c": {"bg_blur": 2.5, "bg_haze": 0.08, "shadow": 0.45, "shadow_blur": 18, "shadow_offset": (12, 9),
          "ao": 0.3, "ao_blur": 8, "light": 0.05, "wrap": 0.35, "wrap_width": 6, "rim": 0.3, "thick": True,
          "bloom": 0.15},
    "c0": {"bg_blur": 2.5, "bg_haze": 0.08, "shadow": 0.45, "shadow_blur": 18, "shadow_offset": (12, 9),
           "ao": 0.3, "ao_blur": 8, "light": 0.05, "wrap": 0, "wrap_width": 6, "rim": 0, "thick": True,
           "bloom": 0.15},
}
SHADOW_TINT = np.array([0.72, 0.70, 0.84])  # 陰影乘上的顏色（偏紫灰）
SUN = np.array([255, 246, 228]) / 255  # 輪廓光的顏色


def screen(base, top):
    return 1 - (1 - base) * (1 - top)


def blur(a, sigma):
    return cv2.GaussianBlur(a, (0, 0), sigma) if sigma > 0 else a


def cmd_unify(args):
    folder = OUT / args.layout
    layout = json.loads((folder / "layout.json").read_text(encoding="utf-8"))
    info = layout["figures"]
    order = layout.get("order", LAYOUT_BACK_TO_FRONT)
    bg0 = np.asarray(Image.open(folder / "layers" / "bg.png").convert("RGB")).astype(np.float32) / 255
    H, W = bg0.shape[:2]
    out_folder = OUT / "unify" if args.layout == "layout2" else folder / "unify"
    out_folder.mkdir(exist_ok=True)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    toward_light = 1 - (xx / W * 0.6 + yy / H * 0.4)  # 左上 1、右下 0
    for name in args.variants.split(","):
        u = UNIFY[name]
        bg = blur(bg0, u["bg_blur"])
        sky = np.array([0.86, 0.90, 0.97], np.float32)
        bg = bg * (1 - u["bg_haze"]) + sky * u["bg_haze"]
        wrap_src = blur(bg, 25)
        rgb = np.zeros((H, W, 3), np.float32)  # 人物層（已經疊好的人），預乘透明度前的顏色
        alpha = np.zeros((H, W), np.float32)
        for char in order:
            layer = Image.open(folder / "layers" / f"{char}.png").convert("RGBA")
            x0, y0 = info[char]["pos"]
            full = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            full.paste(layer, (x0, y0))
            f = np.asarray(full).astype(np.float32) / 255
            fa, frgb = f[..., 3], f[..., :3]
            # 這個人在已經疊好的人身上投下陰影
            dx, dy = u["shadow_offset"]
            m = blur(np.roll(np.roll(fa, dy, axis=0), dx, axis=1), u["shadow_blur"]) * u["shadow"]
            if u.get("ao"):
                m = np.maximum(m, blur(fa, u["ao_blur"]) * u["ao"])
            rgb *= 1 - m[..., None] * (1 - SHADOW_TINT)
            k = u["wrap_width"]
            # 有厚度的地方才加邊緣光：附近一大片都是這個人的才算（細髮絲、手指的周圍大多是透明的）
            gate = np.clip((blur(fa, 3 * k) - 0.5) / 0.3, 0, 1) if u.get("thick") else 1
            # 輪廓光：朝左上的邊緣（左上方鄰居是透明的地方）
            edge_ul = np.clip(fa - np.roll(np.roll(fa, k, axis=0), k, axis=1), 0, 1)
            rim = blur(edge_ul, k / 2) * fa * gate * u["rim"]
            frgb = screen(frgb, SUN * rim[..., None])
            # light wrap：邊緣一圈吃到身後的背景色
            inner = cv2.erode(fa, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1,) * 2))
            band = blur(np.clip(fa - inner, 0, 1), k / 2) * fa * gate * u["wrap"]
            frgb = screen(frgb, wrap_src * band[..., None])
            rgb = rgb * (1 - fa[..., None]) + frgb * fa[..., None]
            alpha = alpha + fa * (1 - alpha)
        # 光線漸層：左上偏暖亮、右下偏冷暗，只套在人物上
        gain = 1 + u["light"] * (toward_light[..., None] * np.array([1.0, 0.6, -0.2])
                                  - (1 - toward_light)[..., None] * np.array([0.8, 0.8, 0.2]))
        rgb = np.clip(rgb * gain, 0, 1)
        img = bg * (1 - alpha[..., None]) + rgb * alpha[..., None]
        # bloom：亮部往外暈開
        lum = img.mean(axis=2, keepdims=True)
        glow = blur(img * np.clip((lum - 0.75) / 0.25, 0, 1), 30)
        img = screen(img, glow * u["bloom"])
        Image.fromarray((np.clip(img, 0, 1) * 255).round().astype(np.uint8)).save(out_folder / f"{name}.png")
        with open(out_folder / "log.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"kind": "unify", "variant": name, "params": u, "time": time.time()},
                                ensure_ascii=False) + "\n")
        print(f"unify {name} 在 {out_folder / f'{name}.png'}", flush=True)


# ---- 步驟 3：放大 ----
# 1392×752 直接放大到 1920×1080 線條會糊。用 Real-ESRGAN 的動漫模型（BSD-3-Clause，xinntao/Real-ESRGAN v0.2.2.4）
# 放大 4 倍，final 再縮回 1920×1080。這一步只放大、不重畫，不會多出新的錯誤。
UPSCALER = "RealESRGAN_x4plus_anime_6B.pth"  # 放在 C:\Users\USER\ComfyUI\models\upscale_models


def cmd_upscale(args):
    source = OUT / args.source
    name = "nmle_cover_upscale.png"
    upload(source, name)
    g = {
        "1": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": UPSCALER}},
        "2": {"class_type": "LoadImage", "inputs": {"image": name}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["1", 0], "image": ["2", 0]}},
        "4": {"class_type": "SaveImage", "inputs": {"images": ["3", 0], "filename_prefix": "nmle_cover_upscale"}},
    }
    check_nodes(g)
    folder = OUT / "upscale"
    folder.mkdir(exist_ok=True)
    path = folder / f"{source.parent.name}_{source.stem}.png"
    download(run(g), path)
    print(f"放大的圖在 {path}（{Image.open(path).size}）", flush=True)


# ---- 步驟 4：局部修正 ----
# 放大後還有小錯（多一顆痣、髮色不對）時，裁出那一塊請 Qwen-Image-Edit 只改那裡，再用羽化的橢圓貼回去，
# 其他地方完全不動。座標都用大合照（1392×752）的座標，程式自己換算到放大圖。
# box 要是正方形：FluxKontextImageScale 會把 1:1 縮成 1024×1024，其他比例會被裁掉邊，貼回去就對不齊。
GROUP_SIZE = (1392, 752)
FIXES = {}  # {名稱: {"box": 正方形, "ellipses": [要換掉的範圍], "prompt": 修改指令}}
FIX_PICKS = {}  # {名稱: 挑好的輸出檔名後綴}，例如 "2"（本機 seed 2）、"bf16_2"（Colab seed 2）


def parse_seeds(text):
    first, _, last = text.partition("-")
    return range(int(first), int(last or first) + 1)


def fix_box(name, k):
    x0, y0, x1, y1 = FIXES[name]["box"]
    assert x1 - x0 == y1 - y0, f"{name} 的 box 不是正方形"
    return tuple(round(v * k) for v in (x0, y0, x1, y1))


def fix_mask(name, k):
    box = fix_box(name, k)
    mask = Image.new("L", (box[2] - box[0], box[3] - box[1]), 0)
    for e in FIXES[name]["ellipses"]:
        ImageDraw.Draw(mask).ellipse([round(v * k) - box[i % 2] for i, v in enumerate(e)], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(round(2 * k)))  # 大合照上約 2 px 的羽化


def cmd_fix(args):
    image = Image.open(OUT / args.source).convert("RGB")
    k = image.width / GROUP_SIZE[0]
    folder = OUT / "fix" / Path(args.source).stem
    folder.mkdir(parents=True, exist_ok=True)
    names = args.only.split(",") if args.only else list(FIXES)
    if args.preview:  # 先看範圍對不對：紅框是 box，藍圈是會換掉的地方
        preview = image.resize(GROUP_SIZE, Image.LANCZOS)
        draw = ImageDraw.Draw(preview)
        for name in names:
            draw.rectangle(FIXES[name]["box"], outline="red", width=2)
            for e in FIXES[name]["ellipses"]:
                draw.ellipse(e, outline="blue", width=2)
        preview.save(folder / "preview.png")
        print(f"範圍預覽在 {folder / 'preview.png'}", flush=True)
        return
    for name in names:
        crop_name = "nmle_cover_fix.png"
        upload(image.crop(fix_box(name, k)), crop_name)
        for seed in parse_seeds(args.seeds):
            path = folder / f"{name}_{model()['tag']}{seed}.png"
            if path.exists():
                continue
            t = time.time()
            download(run(graph(crop_name, seed, FIXES[name]["prompt"], NEGATIVE)), path)
            with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "fix", "name": name, "seed": seed, **FIXES[name], "model": model()["unet"],
                                    "time": time.time()}, ensure_ascii=False) + "\n")
            print(f"{name} seed {seed}：{time.time() - t:.0f} 秒", flush=True)


def cmd_fix_apply(args):
    """把挑好的局部修正貼回放大圖（只貼橢圓範圍），存成 fix/<來源>/fixed.png。"""
    image = Image.open(OUT / args.source).convert("RGB")
    k = image.width / GROUP_SIZE[0]
    folder = OUT / "fix" / Path(args.source).stem
    for name, seed in FIX_PICKS.items():
        box = fix_box(name, k)
        patch = Image.open(folder / f"{name}_{seed}.png").convert("RGB")
        patch = patch.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
        image.paste(patch, box[:2], fix_mask(name, k))
    image.save(folder / "fixed.png")
    print(f"修好的圖在 {folder / 'fixed.png'}", flush=True)


# ---- 步驟 4（人物）：一次修一個人 ----
# 10/23 Roger 選了 edit_e1 seed 2（SDXL 版的合照感，靜澄的手、顏緋抱胸已經修好），要全部修好：
# 髮型改成定稿、以晴加白袍、浮空的筆、芷薰和葉縈肩膀後的深色色塊、葉縈左肩有兩個、手伸進顏緋的口袋、
# 靜澄和以晴之間的頭髮。整張一起改時模型顧不過來（edit_e1 另外三張），所以一次只改一個人：
# 以她的臉為中心裁一塊 2:3（FluxKontextImageScale 剛好縮成 832×1248，不會裁邊），image 2 給她的定稿立繪，
# 改完只把她的範圍（和左右鄰居的中點再往外 ZONE_MARGIN）羽化貼回去。
# 相鄰兩人不在同一輪：第 1 輪改 1、3、5 號，第 2 輪在第 1 輪的結果上改 2、4 號。第 2 輪的範圍蓋過第 1 輪的邊緣，
# 交界處都是看得到兩邊的那一次生成畫的，不會有兩個版本拼起來的接縫。
# 第一版沒有遮罩、生成完才整塊貼回：模型會順手改背景（天空變成櫻花），貼回時範圍邊緣有接縫；靜澄和顏緋還被往旁邊推，
# 空出來的地方多畫了別人。所以改用遮罩（--mask，graph 的 SetLatentNoiseMask），範圍外每一步都固定成原圖。
# 芷薰那張（沒遮罩的 seed 2）人畫得好就留著，她範圍邊緣在天空的接縫落在第 2 輪以晴、葉縈的遮罩裡，會被重畫掉。
PERSON_SOURCE = "upscale/edit_e1_2.png"
PERSON_SCALE = 0.5  # 放大 4 倍的圖縮成一半（2784×1504）再修：一個人裁 1003×1504，接近模型原生的 1 MP
FACE_X = {"jingcheng": 296, "yiqing": 504, "zhixun": 720, "ying": 926, "fei": 1130}  # edit_e1/2.png 偵測到的臉中心
ROUNDS = [["jingcheng", "zhixun", "fei"], ["yiqing", "ying"]]
ZONE_MARGIN = 100  # 貼回範圍超過和鄰居中點的距離（2784 寬的座標）
EDGE_REACH = 380  # 最左、最右兩人往畫面外側只到臉中心外這麼遠，不留空位讓模型多畫一個人
ZONE_FEATHER = 24
PERSON_CHANGES = {
    "jingcheng": (
        "redraw her hair to match image 2: very long straight black hair reaching her waist, parted on the side, no "
        "blunt bangs, her forehead partly visible. Keep her grey thin-framed glasses, blue eyes and gentle smile, and "
        "her white lab coat over a dark navy turtleneck. Her raised hand keeps waving with a natural open palm and "
        "five fingers. Her hair stays behind her own shoulders and does not touch the woman on the right"),
    "yiqing": (
        "redraw her hair to match image 2: short orange bob with side-swept bangs and a pink hairclip. Keep her amber "
        "eyes and big cheerful open-mouth smile. She now wears an open white lab coat over her orange track jacket and "
        "white t-shirt, with orange track pants. Her hair and ear are drawn cleanly and stay separate from the black "
        "hair of the woman on the left"),
    "zhixun": (
        "redraw her hair to match image 2: long wavy light lavender hair swept back from her forehead without bangs, "
        "gathered into a low side ponytail that rests in front of her right shoulder (on the left side of the image). "
        "Keep her purple droopy eyes, the single small beauty mark under her left eye, her gentle smile, her white lab "
        "coat over a lavender knit sweater, her dark purple skirt and the ID badge on a lanyard. Remove the dark brown "
        "patch behind her left shoulder"),
    "ying": (
        "redraw her hair to match image 2: long dark green hair with side-swept bangs, tied into two low twintails "
        "with green ribbons hanging in front of her shoulders. Keep her green eyes with only faint dark circles and "
        "her sweet smile. Oversized white lab coat over a green crew-neck sweater, sleeves covering her fingers. She "
        "has exactly one left shoulder and her left arm hangs straight down at her side with the hand hidden inside "
        "her long sleeve; her hands are not in any pocket. Remove the dark brown patch behind her right shoulder"),
    "fei": (
        "redraw her hair to match image 2: medium-length bright red hair with side-swept bangs and a single side braid "
        "as in image 2. Keep her expression from image 1: a sulky pout with closed lips, blushing cheeks and sharp red "
        "eyes. Both of her arms are crossed in front of her chest and she has only two hands; white lab coat over red "
        "scrubs. Nothing floats in the air behind her shoulders. No hand is in any coat pocket"),
}
# 送進模型前先抹掉的東西（底圖 2784 寬的座標矩形），只改送出去的裁切圖，base.png 不動。
# 顏緋肩膀後浮空的筆：prompt 寫了要拿掉，模型還是照原圖畫回來（10/23 bf16 seed 1），所以先用周圍的背景補掉
PERSON_CLEANUP = {"fei": [(2362, 630, 2516, 690)]}
# {角色: 輸出檔名後綴}，person-apply 用。"2" 是沒遮罩的 seed 2，"m1" 是有遮罩的 seed 1，"bf16_m1" 是 Colab 畫的
PERSON_PICKS = {"jingcheng": "bf16_m5", "zhixun": "bf16_m7", "fei": "bf16_m7", "yiqing": "bf16_m4", "ying": "bf16_m1"}
# 範圍的右緣改成沿著右邊鄰居的輪廓走（[(y, x), ...] 折線，底圖 2784 寬的座標），羽化也改窄（RIGHT_FEATHER）。
# 羽化帶是新舊兩張混在一起的地方，細節落在裡面會糊成重影：直線的右緣（x 2156）切過顏緋抱胸的左手肘，
# 只在貼回時縮進來又會把重影移到兩件白袍上（10/23）。所以葉縈的範圍停在顏緋第 1 輪輪廓的左邊約 10 px，
# 顏緋整個人留第 1 輪的。
RIGHT_EDGE = {"ying": [(0, 2080), (540, 2080), (620, 2030), (700, 2010), (830, 1985), (950, 1985), (1000, 2020),
                       (1200, 2000), (1400, 1980), (1504, 1970)]}
RIGHT_FEATHER = 8


def person_prompt(char):
    # 最左、最右兩人的裁切框外側只有背景。10/23 原本都寫「keep the other women at the edges」，
    # 顏緋的三張都在她右後方多畫了一個人（模型照字面在右邊補了一位），人也放大了。所以兩端改寫明哪一邊才有人
    i = ORDER.index(char)
    if 0 < i < len(ORDER) - 1:
        others = "Keep the other women at the edges of image 1"
    else:
        side, empty = ("right", "left") if i == 0 else ("left", "right")
        others = (f"She is the {empty}most woman of the group: only one other woman is partly visible, at the {side} "
                  f"edge of image 1, and the {empty} side of image 1 shows only the background, with no other person "
                  "behind or beside her. Do not add any person, and do not zoom in or enlarge her. Keep the woman at "
                  f"the {side} edge")
    return (
        "Image 1 is a crop from an anime group photo of five adult women standing close together. Image 2 is the "
        "character design of the woman standing in the middle of image 1. Edit only the woman in the middle of image "
        f"1: {PERSON_CHANGES[char]}. Keep her pose, body size, head position, head tilt and the camera angle from "
        f"image 1. {others}, the cherry blossom background, the lighting and the soft anime art style exactly "
        "unchanged. Correct anatomy, natural hands with five fingers, no text or letters.")


def person_box(char, size):
    width, height = size
    x = round(FACE_X[char] * width / GROUP_SIZE[0])
    w = round(height * 832 / 1248)
    left = min(max(x - w // 2, 0), width - w)
    return (left, 0, left + w, height)


def person_zone(char, width):
    xs = [FACE_X[c] * width / GROUP_SIZE[0] for c in ORDER]
    i = ORDER.index(char)
    left = (xs[i - 1] + xs[i]) / 2 - ZONE_MARGIN if i > 0 else max(xs[i] - EDGE_REACH, 0)
    right = (xs[i] + xs[i + 1]) / 2 + ZONE_MARGIN if i < len(ORDER) - 1 else min(xs[i] + EDGE_REACH, width)
    return round(left), round(right)


def person_mask(char, size):
    """裁切框大小的灰階遮罩：她的範圍是白色，邊緣羽化。生成（--mask）和貼回都用這一張。"""
    box = person_box(char, size)
    zone = person_zone(char, size[0])
    w, h = box[2] - box[0], box[3] - box[1]
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rectangle((zone[0] - box[0], -ZONE_FEATHER * 3, zone[1] - box[0] - 1, h + ZONE_FEATHER * 3),
                                   fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(ZONE_FEATHER))
    if char in RIGHT_EDGE:  # 右緣換成折線：折線右邊清成 0，另外羽化後只取這一側
        k = size[0] / 2784
        edge = [(x * k - box[0], y * k - box[1]) for y, x in RIGHT_EDGE[char]]
        right = Image.new("L", (w, h), 0)
        ImageDraw.Draw(right).polygon([(-10, -10)] + [(x, y) for x, y in edge] + [(-10, h + 10)], fill=255)
        right = right.filter(ImageFilter.GaussianBlur(RIGHT_FEATHER))
        mask = ImageChops.multiply(mask, right)
    return mask


def cleanup(char, crop, box):
    if char not in PERSON_CLEANUP:
        return crop
    mask = np.zeros((crop.height, crop.width), np.uint8)
    for x0, y0, x1, y1 in PERSON_CLEANUP[char]:
        mask[max(y0 - box[1], 0):max(y1 - box[1], 0), max(x0 - box[0], 0):max(x1 - box[0], 0)] = 255
    return Image.fromarray(cv2.inpaint(np.asarray(crop), mask, 7, cv2.INPAINT_TELEA))


def round_base(r):
    folder = OUT / "person"
    if r == 1:
        path = folder / "base.png"
        if not path.exists():
            folder.mkdir(parents=True, exist_ok=True)
            image = Image.open(OUT / PERSON_SOURCE).convert("RGB")
            size = (round(image.width * PERSON_SCALE), round(image.height * PERSON_SCALE))
            image.resize(size, Image.LANCZOS).save(path)
        return path
    path = folder / f"round{r - 1}.png"
    if not path.exists():
        raise SystemExit(f"還沒有 {path}，先跑 person-apply --round {r - 1}")
    return path


def cmd_person(args):
    base_path = round_base(args.round)
    base = Image.open(base_path).convert("RGB")
    folder = OUT / "person"
    chars = args.only.split(",") if args.only else ROUNDS[args.round - 1]
    assert set(chars) <= set(ROUNDS[args.round - 1]), f"第 {args.round} 輪只有 {ROUNDS[args.round - 1]}"
    names = {}
    for char in chars:
        mask_name = f"nmle_mask_{char}.png" if args.mask else None
        names[char] = (f"nmle_person_{char}.png", f"nmle_ref_{char}.png", mask_name)
        box = person_box(char, base.size)
        upload(cleanup(char, base.crop(box), box), names[char][0])
        ref = Image.new("RGBA", reference(char).size, "white")
        ref.alpha_composite(reference(char))
        upload(ref.convert("RGB"), names[char][1])
        if args.mask:
            upload(person_mask(char, base.size).convert("RGB"), names[char][2])
    check_nodes(graph(names[chars[0]][0], 0, person_prompt(chars[0]), NEGATIVE, *names[chars[0]][1:]))
    for seed in parse_seeds(args.seeds):  # 同一個 seed 先跑完這一輪每個人，早點看得到每個人的第一張
        for char in chars:
            suffix = (model()["tag"] + ("m" if args.mask else "") + str(seed)
                      + ("" if args.steps == STEPS else f"_s{args.steps}"))
            path = folder / f"r{args.round}_{char}_{suffix}.png"
            if path.exists():
                continue
            t = time.time()
            g = graph(names[char][0], seed, person_prompt(char), NEGATIVE, *names[char][1:], steps=args.steps)
            download(run(g), path)
            with open(folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "person", "round": args.round, "char": char, "seed": seed,
                                    "mask": args.mask, "steps": args.steps, "base": base_path.name,
                                    "box": person_box(char, base.size), "zone": person_zone(char, base.width),
                                    "cleanup": PERSON_CLEANUP.get(char), "prompt": person_prompt(char),
                                    "negative": NEGATIVE, "model": model()["unet"], "time": time.time()},
                                   ensure_ascii=False) + "\n")
            print(f"第 {args.round} 輪 {char} {suffix}：{time.time() - t:.0f} 秒", flush=True)


def measure_shift(original, patch, zone, box):
    """用沒改到的左右兩條（範圍外面）估計模型輸出整體偏移了幾 px（phase correlation）。"""
    a = np.asarray(original.convert("L"), np.float32)
    b = np.asarray(patch.convert("L"), np.float32)
    strips = [(0, zone[0] - box[0]), (zone[1] - box[0], box[2] - box[0])]
    shifts = []
    for x0, x1 in strips:
        x0, x1 = max(x0, 0), min(x1, a.shape[1])
        if x1 - x0 >= 64:
            (dx, dy), _ = cv2.phaseCorrelate(a[:, x0:x1], b[:, x0:x1])
            shifts.append((dx, dy))
    return tuple(np.mean(shifts, axis=0)) if shifts else (0.0, 0.0)


def cmd_person_apply(args):
    """把這一輪挑好的人貼回去，存成 person/round<r>.png。"""
    image = Image.open(round_base(args.round)).convert("RGB")
    folder = OUT / "person"
    for char in ROUNDS[args.round - 1]:
        box = person_box(char, image.size)
        zone = person_zone(char, image.width)
        size = (box[2] - box[0], box[3] - box[1])
        patch = Image.open(folder / f"r{args.round}_{char}_{PERSON_PICKS[char]}.png").convert("RGB")
        patch = patch.resize(size, Image.LANCZOS)
        dx, dy = measure_shift(image.crop(box), patch, zone, box)
        if abs(dx) >= 0.5 or abs(dy) >= 0.5:  # 對齊回原圖再貼，交界處才不會有重影
            patch = patch.transform(size, Image.AFFINE, (1, 0, dx, 0, 1, dy), Image.BICUBIC)
        image.paste(patch, box[:2], person_mask(char, image.size))
        print(f"{char}：seed {PERSON_PICKS[char]}，偏移 ({dx:+.2f}, {dy:+.2f}) px，貼回 x {zone[0]}–{zone[1]}", flush=True)
    path = folder / f"round{args.round}.png"
    image.save(path)
    print(f"第 {args.round} 輪的結果在 {path}", flush=True)


# ---- 步驟 5：疊上 Logo、輸出 ----
FINAL = (1920, 1080)
LOGO = OUT.parent / "logo.png"  # art/cover_logo.html 截出來的透明圖（截法見 art/cover.py）
# Logo 的位置：{名稱: (佔畫面寬度的比例, "top" 或 "bottom", 和上緣或下緣的距離（畫面高度的比例）)}。
# final 每一種都輸出 cover_<名稱>.png 給 Roger 挑，挑好的寫進 LOGO_PICK 再輸出 cover.png、cover.webp
LOGO_LAYOUTS = {
    "bottom48": (0.48, "bottom", 0.015),  # 同 SDXL 版
    "bottom40": (0.40, "bottom", 0.02),
    "top40": (0.40, "top", 0.01),
}
# 10/25 Roger 選下方 48%（上方要把整排往下移才放得下，以晴的短白袍下襬會出畫面）
LOGO_PICK = "bottom48"


def cmd_final(args):
    base = Image.open(OUT / args.source).convert("RGB").resize(FINAL, Image.LANCZOS)  # 排版已經是 16:9
    names = [LOGO_PICK] if LOGO_PICK else list(LOGO_LAYOUTS)
    for name in names:
        width, anchor, margin = LOGO_LAYOUTS[name]
        image = base.convert("RGBA")
        logo = Image.open(LOGO).convert("RGBA")
        w = round(FINAL[0] * width)
        logo = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
        y = round(FINAL[1] * margin) if anchor == "top" else FINAL[1] - logo.height - round(FINAL[1] * margin)
        image.alpha_composite(logo, ((FINAL[0] - w) // 2, y))
        image = image.convert("RGB")
        if LOGO_PICK:
            image.save(OUT / "cover.png")
            image.save(OUT / "cover.webp", "WEBP", quality=88, method=6)
            print(f"封面在 {OUT / 'cover.webp'}（{(OUT / 'cover.webp').stat().st_size // 1024} KB）", flush=True)
        else:
            image.save(OUT / f"cover_{name}.png")
            print(f"封面在 {OUT / f'cover_{name}.png'}", flush=True)


LOGO_MOBILE = (0.92, 70)  # 手機版：Logo 佔畫面寬度的比例、和上緣的距離（px）


def cmd_final_mobile(args):
    image = Image.open(OUT / args.source).convert("RGBA")
    logo = Image.open(LOGO).convert("RGBA")
    w = round(image.width * LOGO_MOBILE[0])
    logo = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
    image.alpha_composite(logo, ((image.width - w) // 2, LOGO_MOBILE[1]))
    image = image.convert("RGB")
    image.save(OUT / "cover_mobile.png")
    image.save(OUT / "cover_mobile.webp", "WEBP", quality=86, method=6)
    print(f"手機版封面在 {OUT / 'cover_mobile.webp'}（{(OUT / 'cover_mobile.webp').stat().st_size // 1024} KB）", flush=True)


def main():
    global SERVER, LIGHTNING
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--lightning", type=int, default=0, choices=[0, 4, 8], help="加 Lightning LoRA，4 或 8 步（見 LIGHTNING）")
    ap.add_argument("--server", default=SERVER, help="ComfyUI 的網址，Colab 的話是 SSH 通道轉到本機的埠（見 art/cover_colab.py）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("collage")
    sub.add_parser("sheet")
    p = sub.add_parser("group")
    p.add_argument("--seeds", default="1-4")
    p = sub.add_parser("edit")
    p.add_argument("--seeds", default="1-4")
    p = sub.add_parser("regroup")
    p.add_argument("--seeds", default="1-6")
    p = sub.add_parser("pose")
    p.add_argument("--seeds", default="1-4")
    p.add_argument("--only", help="只跑這幾個人，逗號分隔")
    p = sub.add_parser("posefix")
    p.add_argument("--seeds", default="1-3")
    p.add_argument("--only", help="只跑這幾個人，逗號分隔")
    p.add_argument("--denoise", type=float, default=0.65, help="範圍內重畫的強度，1.0 是從純噪聲重畫")
    p.add_argument("--preview", action="store_true", help="只畫出範圍，不生成")
    p = sub.add_parser("face")
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--only", help="只跑這幾個人，逗號分隔")
    p.add_argument("--denoise", type=float, default=0.75, help="五官重畫的強度")
    p.add_argument("--preview", action="store_true", help="只畫出範圍和參考圖，不生成")
    p = sub.add_parser("detail")
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--only", help="只跑這幾個人，逗號分隔")
    p.add_argument("--bases", default="face", help="底圖，逗號分隔（DETAIL_BASES）")
    p.add_argument("--strength", type=float, default=0.55, help="臉部重畫的強度")
    p = sub.add_parser("props")
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--only", help="只跑這幾個人，逗號分隔")
    p.add_argument("--denoise", type=float, default=1.0, help="範圍內重畫的強度")
    p.add_argument("--preview", action="store_true", help="只畫出範圍，不生成")
    p = sub.add_parser("propsfix")
    p.add_argument("--seeds", default="1-3")
    p.add_argument("--only", help="只跑這幾個人，逗號分隔")
    p.add_argument("--preview", action="store_true", help="只畫出範圍，不生成")
    p = sub.add_parser("layout2")
    p.add_argument("--top-margin", type=float, help=f"最高的頭頂離上緣（畫面高度的比例），預設 {LAYOUT_TOP_MARGIN}")
    p = sub.add_parser("unify")
    p.add_argument("--variants", default="a,b", help="UNIFY 的哪幾組，逗號分隔")
    p.add_argument("--layout", default="layout2", choices=["layout2", "portrait"], help="電腦版或手機版的排版")
    sub.add_parser("portrait")
    p = sub.add_parser("final-mobile")
    p.add_argument("source", help="art/bakeoff/cover/qwen/ 底下的圖，例如 portrait/unify/c.png")
    p = sub.add_parser("upscale")
    p.add_argument("source", help="art/bakeoff/cover/qwen/ 底下的圖，例如 group_v3/2.png")
    p = sub.add_parser("fix")
    p.add_argument("source", help="放大後的圖，例如 upscale/group_v3_2.png")
    p.add_argument("--seeds", default="1-3")
    p.add_argument("--only", help="只跑這幾個，逗號分隔")
    p.add_argument("--preview", action="store_true", help="只畫出範圍，不生成")
    p = sub.add_parser("fix-apply")
    p.add_argument("source", help="同 fix 的 source")
    p = sub.add_parser("person")
    p.add_argument("--round", type=int, required=True, choices=[1, 2])
    p.add_argument("--seeds", default="1-2")
    p.add_argument("--mask", action="store_true", help="範圍外每一步都固定成原圖（輸出檔名加 m）")
    p.add_argument("--only", help="只跑這一輪的這幾個人，逗號分隔")
    p.add_argument("--steps", type=int, default=STEPS, help="試跑用，少於 40 步時輸出檔名加 _s<步數>")
    p = sub.add_parser("person-apply")
    p.add_argument("--round", type=int, required=True, choices=[1, 2])
    p = sub.add_parser("final")
    p.add_argument("source", help="art/bakeoff/cover/qwen/ 底下的圖，例如 fix/group_v3_2/fixed.png")
    args = ap.parse_args()
    SERVER = args.server.rstrip("/")
    LIGHTNING = args.lightning
    {"collage": cmd_collage, "sheet": cmd_sheet, "group": cmd_group, "edit": cmd_edit, "regroup": cmd_regroup,
     "pose": cmd_pose, "posefix": cmd_posefix, "face": cmd_face, "detail": cmd_detail, "props": cmd_props, "propsfix": cmd_propsfix, "layout2": cmd_layout2, "unify": cmd_unify, "portrait": cmd_portrait, "final-mobile": cmd_final_mobile, "upscale": cmd_upscale, "fix": cmd_fix, "fix-apply": cmd_fix_apply,
     "person": cmd_person, "person-apply": cmd_person_apply, "final": cmd_final}[args.cmd](args)


if __name__ == "__main__":
    main()
