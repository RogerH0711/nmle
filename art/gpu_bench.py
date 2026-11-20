"""本機 GPU 的速度基準（11/18 Roger：試 nv-uefi-unlocker 之前先記下現在的速度，解鎖後用同一個指令再跑一次比較）。

    .venv-gpu\\Scripts\\python.exe -X utf8 art\\gpu_bench.py matmul          # 矩陣乘法（PyTorch → cuBLAS），約 1 分鐘
    .venv-gpu\\Scripts\\python.exe -X utf8 art\\gpu_bench.py sdxl            # Animagine 一張 1024×1024、28 步（和立繪同設定）
    wsl -e bash -lc "cd /mnt/c/Users/USER/NMLE && ~/code/breeze-tts/.venv/bin/python art/gpu_bench.py breeze"   # Breeze TTS 2 念一句

結果附加在 art/gpu_bench.md（日期、驅動、時脈、功耗一起記）。跑之前確認 GPU 沒有別的工作（nvidia-smi），效能模式記在 --note
（極速／靜音，見 memory 的 rog-power-mode）。
"""
import argparse
import datetime
import subprocess
import sys
import threading
import time
from pathlib import Path

ART = Path(__file__).resolve().parent
RESULT = ART / "gpu_bench.md"


class Sampler:
    """跑的時候每 0.5 秒讀一次 nvidia-smi 的時脈和功耗，記最高和平均"""
    def __init__(self):
        self.rows, self.stop = [], False

    def __enter__(self):
        def loop():
            while not self.stop:
                try:
                    out = subprocess.run(["nvidia-smi", "--query-gpu=clocks.gr,power.draw,utilization.gpu",
                                          "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout
                    clk, pw, util = (float(x) for x in out.strip().split(","))
                    self.rows.append((clk, pw, util))
                except Exception:
                    pass
                time.sleep(0.5)
        self.thread = threading.Thread(target=loop, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *a):
        self.stop = True
        self.thread.join()

    def summary(self):
        busy = [r for r in self.rows if r[2] >= 50] or self.rows
        if not busy:
            return "（沒讀到 nvidia-smi）"
        avg = lambda i: sum(r[i] for r in busy) / len(busy)  # noqa: E731
        return f"GPU 忙碌時平均 {avg(0):.0f} MHz、{avg(1):.0f} W（最高 {max(r[0] for r in busy):.0f} MHz、{max(r[1] for r in busy):.0f} W）"


def gpu_info():
    out = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
                         capture_output=True, text=True).stdout.strip()
    return out


def record(kind, lines, note):
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    text = f"\n## {stamp}　{kind}　{note}\n\n{gpu_info()}\n\n" + "\n".join(f"- {l}" for l in lines) + "\n"
    if not RESULT.exists():
        RESULT.write_text("# 本機 GPU 速度紀錄\n\n`art/gpu_bench.py` 的結果，新的接在最後。\n", encoding="utf-8")
    with open(RESULT, "a", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(text)


def bench_matmul(note):
    import torch
    torch.backends.cuda.matmul.allow_tf32 = False
    lines = []
    with Sampler() as s:
        for dtype, name in ((torch.float16, "fp16"), (torch.bfloat16, "bf16"), (torch.float32, "fp32（不用 TF32）")):
            n = 8192
            a = torch.randn(n, n, device="cuda", dtype=dtype)
            b = torch.randn(n, n, device="cuda", dtype=dtype)
            for _ in range(3):
                a @ b
            torch.cuda.synchronize()
            iters = 20 if dtype != torch.float32 else 6
            t = time.perf_counter()
            for _ in range(iters):
                a @ b
            torch.cuda.synchronize()
            dt = (time.perf_counter() - t) / iters
            lines.append(f"矩陣乘法 {n}×{n} {name}：{2 * n ** 3 / dt / 1e12:.1f} TFLOPS")
            del a, b
            torch.cuda.empty_cache()
    lines.append(s.summary())
    lines.append(f"PyTorch {torch.__version__}、CUDA {torch.version.cuda}")
    record("matmul", lines, note)


def bench_sdxl(note):
    import torch
    sys.path.insert(0, str(ART))
    import outfits
    pipe = outfits.load_pipe()  # 和立繪、封面一樣：model cpu offload（8 GB 放不下整個 SDXL）
    prompt = "1girl, solo, original, labcoat, standing, looking at viewer, simple background" + outfits.SUFFIX
    pipe(prompt=prompt, negative_prompt=outfits.NEGATIVE, width=1024, height=1024, num_inference_steps=4)  # 暖機
    times = []
    with Sampler() as s:
        for seed in (1, 2):
            t = time.perf_counter()
            pipe(prompt=prompt, negative_prompt=outfits.NEGATIVE, width=1024, height=1024,
                 num_inference_steps=outfits.STEPS, guidance_scale=outfits.CFG,
                 generator=torch.Generator("cpu").manual_seed(seed))
            times.append(time.perf_counter() - t)
    lines = [f"Animagine XL 4.0，1024×1024、{outfits.STEPS} 步：{' / '.join(f'{x:.1f}' for x in times)} 秒"
             f"（平均 {sum(times) / len(times) / outfits.STEPS:.2f} 秒／步，含 cpu offload 的搬移）", s.summary()]
    record("sdxl", lines, note)


def bench_breeze(note):
    """固定一句、固定 seed 念 2 次，記每次的秒數（不寫音檔）"""
    import torch
    sys.argv = sys.argv[:1]
    sys.path[:0] = [str(ART), str(Path.home() / "code" / "breeze-tts")]
    from breeze_infer.runtime import load_runtime, set_all_seeds, update_generation_config_for_breeze
    from breeze_infer.templates import get_template, prepare_inputs, select_template_name
    from models.fast_streaming import FastBreezeStreamingRuntime, FastStreamingConfig
    from voice_breeze2 import CKPT
    from voice_breezy import REF_TEXT
    tokenizer, model, audio_tokenizer = load_runtime(CKPT, device="cuda:0", attn_implementation="eager")
    update_generation_config_for_breeze(model)
    runtime = FastBreezeStreamingRuntime(model, audio_tokenizer, FastStreamingConfig(
        max_new_tokens=1500, max_seq_len=2048, fast_all=False, fast_text_encoder=False, fast_backbone_prefill=False,
        fast_backbone_decode=False, fast_depth_decoder=False, fast_codec=False, repetition_penalty=1.1), tokenizer=tokenizer)
    ref = ART / "bakeoff" / "voice" / "fei" / "B_s1.wav"
    text = "心肌梗塞是凝固性壞死，腦梗塞是液化性壞死，考試很愛把這兩個對調。"
    times, secs = [], []
    with Sampler() as s:
        for k in (1, 2):
            set_all_seeds(k)
            req = {"id": f"bench{k}", "text": text, "speaker": "S0", "ref_audio_path": str(ref), "ref_text": REF_TEXT[("fei", "B_s1")]}
            inputs = prepare_inputs(tokenizer, audio_tokenizer, model, [req], get_template(select_template_name(req)),
                                    guidance_scale=1.0, guidance_scale_ref=None, guidance_scale_ins=None)
            t = time.perf_counter()
            n = sum(len(c.audio) for c in runtime.iter_audio_chunks(inputs, request_id=f"bench{k}", seed=k))
            times.append(time.perf_counter() - t)
            secs.append(n / runtime.sample_rate)
    lines = [f"Breeze TTS 2 念一句（{len(text)} 字）：{' / '.join(f'{x:.1f}' for x in times)} 秒，"
             f"念出 {' / '.join(f'{x:.1f}' for x in secs)} 秒的語音（每秒語音要 {sum(times) / sum(secs):.2f} 秒）",
             s.summary(), f"PyTorch {torch.__version__}"]
    record("breeze", lines, note)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["matmul", "sdxl", "breeze"])
    ap.add_argument("--note", default="", help="例如「解鎖前、極速模式」")
    args = ap.parse_args()
    {"matmul": bench_matmul, "sdxl": bench_sdxl, "breeze": bench_breeze}[args.kind](args.note)


if __name__ == "__main__":
    main()
