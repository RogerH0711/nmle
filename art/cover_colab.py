"""在 Colab 的 VM 上準備封面用的 ComfyUI，讓 ROG 上的 art/cover_qwen.py 用 --server 把工作送過來。

10/23 起用 Colab 的 A100 畫封面：本機 3070 一張要 20–50 分鐘，每個人只抽得起兩三個 seed；A100 快很多，可以多抽幾個再挑，
模型也換成原始精度 bf16。全程用 Colab CLI（WSL 裡的 colab，Google 官方的命令列工具，10/20 已登入）操作，不用開網頁。
指令都在 WSL 執行（CLI 不支援 Windows），cover_qwen.py 照樣在 Windows 跑：

    colab new -s nmle --gpu A100 --high-mem
    colab exec -s nmle -f art/cover_colab.py --timeout 3600      # 裝 ComfyUI、下載模型、在背景啟動（約 10 分鐘）
    K=~/.ssh/id_ed25519_colab; ssh -N -i $K -o IdentitiesOnly=yes -o StrictHostKeyChecking=no \\
        -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \\
        -o ControlMaster=yes -o ControlPath=~/.ssh/colab-nmle.sock \\
        -o "ProxyCommand=$HOME/.local/bin/colab ssh --proxy-mode -s nmle -i $K" -L 127.0.0.1:8190:127.0.0.1:8188 root@nmle
    .venv-gpu\\Scripts\\python.exe art\\cover_qwen.py --server http://127.0.0.1:8190 person --round 1 --mask --seeds 1-8
    colab stop -s nmle                                              # 用完一定要停，閒置也會扣運算單元

ComfyUI 只聽 VM 的 127.0.0.1，從 ROG 經 colab ssh 的 SSH 通道轉到本機的 8190 埠（WSL 的 localhost 在 Windows 也連得到），
不開公開的網址。VM 每次都是新的，host key 不用記。colab ssh 同一時間只能連一條，要在 VM 上下指令就共用通道那條：
ssh -S ~/.ssh/colab-nmle.sock root@nmle '<指令>'。runtime 的 token 一小時過期，通道會斷，要自己重連；
但 colab ssh --proxy-mode -s nmle 在 session 不存在時會自己開一台新的，所以重連前要先用 colab sessions 確認 session 還在
（10/23 閒置自動關機後，重連的迴圈開了一台 CPU VM 沒人用）。

10/23 實測：A100 + high-mem 是 A100-SXM4-80GB、167 GB RAM、硬碟 236 GB，每小時 6.77 運算單元（bf16 整個放得進顯存）；
這個帳號沒有 H100、G4 的權限。Hugging Face 下載約 130 MB/s。
Colab FAQ：繞過 notebook 介面、透過 web UI 操作，只有付費而且運算單元餘額大於 0 時允許。
重跑這支會跳過已經做完的步驟。
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download

COMFY = Path("/content/ComfyUI")
COMFY_COMMIT = "1a82e6d01f395b43275c77acd289af1eb7090bb9"  # 和 ROG 本機同一版，節點的參數才會一樣
# Comfy-Org 在 Hugging Face 上的公開檔案（Apache-2.0），不需要 HF token。檔名要和 cover_qwen.py 的 MODELS 一致
MODELS = [  # (repo, 檔案, ComfyUI 的資料夾)
    ("Comfy-Org/Qwen-Image-Edit", "split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors",
     "diffusion_models"),
    ("Comfy-Org/Qwen-Image", "split_files/text_encoders/qwen_2.5_vl_7b.safetensors", "text_encoders"),
    ("Comfy-Org/Qwen-Image", "split_files/vae/qwen_image_vae.safetensors", "vae"),
]
ESRGAN = ("https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
          "upscale_models")  # BSD-3-Clause
SERVER = "http://127.0.0.1:8188"


def log(text):
    print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)


def install():
    if not COMFY.exists():
        subprocess.run(["git", "clone", "-q", "https://github.com/comfyanonymous/ComfyUI.git", str(COMFY)], check=True)
    subprocess.run(["git", "-C", str(COMFY), "checkout", "-q", COMFY_COMMIT], check=True)
    # ComfyUI 在另一個行程執行，kernel 已經載入的套件不受影響，裝完不用重啟
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(COMFY / "requirements.txt")], check=True)
    log(f"ComfyUI {COMFY_COMMIT[:7]} 裝好了")


def download():
    for repo, path, folder in MODELS:
        dest = COMFY / "models" / folder / Path(path).name
        if not dest.exists():
            t = time.time()
            os.replace(hf_hub_download(repo, path, local_dir="/content/hf"), dest)
            log(f"下載 {dest.name}：{dest.stat().st_size / 1e9:.1f} GB，{time.time() - t:.0f} 秒")
    url, folder = ESRGAN
    dest = COMFY / "models" / folder / Path(url).name
    if not dest.exists():
        urllib.request.urlretrieve(url, dest)
    log("模型都下載好了")


def running():
    try:
        with urllib.request.urlopen(f"{SERVER}/system_stats", timeout=2) as r:
            return json.loads(r.read())
    except OSError:
        return None


def start():
    if not running():
        # start_new_session：這次 exec 結束後 ComfyUI 繼續在背景跑
        subprocess.Popen([sys.executable, "main.py", "--listen", "127.0.0.1", "--port", "8188"], cwd=COMFY,
                         stdout=open("/content/comfy.log", "a"), stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(300):
            if running():
                break
            time.sleep(2)
        else:
            raise SystemExit("ComfyUI 10 分鐘內沒有啟動，看 /content/comfy.log")
    for d in running()["devices"]:
        log(f"ComfyUI 已啟動：{d['name']}，顯存 {d['vram_total'] / 2**30:.0f} GiB")


log(subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                   capture_output=True, text=True).stdout.strip())
install()
download()
start()
