"""在 Colab 的 A100 上用 vLLM 跑請求檔（生成、比對、名詞判斷都可以），輸出原始結果。只在 Colab VM 上執行。

    python colab_vllm.py --model Qwen/Qwen3.6-27B-FP8 --queue /content/queue --results /content/results

佇列模式：模型只載入一次（約 8 分鐘），之後一直等工作。本機的 colab_run.py 把請求檔放進 queue/<名稱>.jsonl，
這支依檔名順序處理，結果寫到 results/<名稱>.jsonl，做完寫 results/<名稱>.done。
請求裡已經是組好的 messages，這支只負責丟給模型（開 thinking）、收回原始輸出，解析在本機做。

- 分批跑、每批寫檔：本機每批下載一次當紀錄點。換一台 VM 時本機會把已下載的結果放回 results/，這裡會跳過已完成的題目
- 輸出到上限被截斷的題目（例如推理卡在重複的「1+1+1…」），整個檔做完後換 seed 重跑一次
- 請求可以帶 seed（預設 0，截斷重跑用 seed + 1）：同一題重新生成時換 seed，才不會得到一樣的結果
- 佇列空著超過 --idle-min 分鐘就結束（印 QUEUE_IDLE_EXIT），colab_job.py 看到後會釋放執行環境，避免本機掛掉時一直扣運算單元
- 安裝與啟動由 colab_job.py 負責，設定的由來見 docs/design.md「詳解與題目正確率」
"""
import argparse
import glob
import json
import os
import time

from vllm import LLM, SamplingParams


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def run(llm, rows, params, path):
    """跑一批並把結果附加到 path，回傳輸出 token 數。params 是每題一個 SamplingParams 的 list。"""
    outputs = llm.chat([r["messages"] for r in rows], params,
                       chat_template_kwargs={"enable_thinking": True}, use_tqdm=False)
    tokens = 0
    with open(path, "a", encoding="utf-8") as f:
        for r, o in zip(rows, outputs):
            out = o.outputs[0]
            tokens += len(out.token_ids)
            f.write(json.dumps({"id": r["id"], "text": out.text, "output_tokens": len(out.token_ids),
                                "finish_reason": out.finish_reason}, ensure_ascii=False) + "\n")
    return tokens


def load(path):
    """讀已完成的結果；同一題出現多次時以最後一筆為準（重跑的會寫在後面）。最後一行寫到一半（VM 中斷）就略過。"""
    done = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            done[r["id"]] = r
    return done


def process(llm, args, name, make_params):
    rows = [json.loads(line) for line in open(os.path.join(args.queue, name + ".jsonl"), encoding="utf-8")]
    out = os.path.join(args.results, name + ".jsonl")
    done = load(out)
    todo = [r for r in rows if r["id"] not in done]
    log(f"開始 {name}：共 {len(rows)} 題，已完成 {len(done)}，這次跑 {len(todo)} 題")
    start, total = time.time(), 0
    for i in range(0, len(todo), args.chunk):
        chunk = todo[i:i + args.chunk]
        total += run(llm, chunk, [make_params(r, args.temperature, r.get("seed", 0)) for r in chunk], out)
        elapsed = time.time() - start
        n = i + len(chunk)
        log(f"{name} 已完成 {len(done) + n}/{len(rows)} 題，{elapsed / 60:.0f} 分，{total / elapsed:.0f} tok/s，"
            f"剩約 {elapsed / n * (len(todo) - n) / 60:.0f} 分")

    # 被截斷的題目換 seed、稍微提高溫度重跑一次；重跑結果附加在檔尾，讀取時以最後一筆為準
    truncated = [r for r in rows if load(out).get(r["id"], {}).get("finish_reason") == "length"]
    if truncated:
        log(f"{name} 重跑被截斷的 {len(truncated)} 題：{[r['id'] for r in truncated][:20]}")
        retry = [make_params(r, max(args.temperature, 0.6), r.get("seed", 0) + 1) for r in truncated]
        total += run(llm, truncated, retry, out)
    still = [k for k, v in load(out).items() if v["finish_reason"] == "length"]
    open(os.path.join(args.results, name + ".done"), "w").write(json.dumps({"truncated": still}))
    log(f"JOB_DONE {name}：{(time.time() - start) / 60:.0f} 分，輸出 {total} tokens；仍被截斷 {len(still)} 題 {still[:20]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--queue", default="/content/queue")
    ap.add_argument("--results", default="/content/results")
    ap.add_argument("--max-model-len", type=int, default=16384)
    ap.add_argument("--max-tokens", type=int, default=12000)
    # 10/20 用 Ollama 測 qwen3.6:27b thinking 時是 0.3，結果很好；Qwen 官方建議 thinking 用 0.6–1.0，
    # 太低可能無限重複（vLLM 99 題中有 1 題卡住），由截斷重跑處理
    ap.add_argument("--temperature", type=float, default=0.3)
    ap.add_argument("--kv-gb", type=float, default=5, help="KV cache 大小（GB），一題 16K 約需 1.3 GB")
    ap.add_argument("--max-num-seqs", type=int, default=32, help="最多同時處理幾題")
    ap.add_argument("--chunk", type=int, default=200, help="每跑完幾題寫一次檔（本機的紀錄點）")
    ap.add_argument("--idle-min", type=float, default=30, help="佇列空著幾分鐘就結束")
    args = ap.parse_args()
    os.makedirs(args.queue, exist_ok=True)
    os.makedirs(args.results, exist_ok=True)

    start = time.time()
    log(f"載入 {args.model}")
    # A100 40GB 上用 gpu_memory_utilization 控制不準（10/20 實測：0.92 配置時記憶體不足、0.85 只剩
    # 0.35 GB 給 KV cache），改成直接指定 KV cache 大小；模型本身 27.9 GB。每批 token 數調低，減少預留的運算記憶體
    llm = LLM(model=args.model, max_model_len=args.max_model_len,
              kv_cache_memory_bytes=int(args.kv_gb * 1024**3), max_num_batched_tokens=2048,
              max_num_seqs=args.max_num_seqs, limit_mm_per_prompt={"image": 0, "video": 0})
    log(f"載入完成 {time.time() - start:.0f} 秒，等待工作")

    # 輸出上限每題各自算：提示詞加輸出不能超過 max_model_len（比對的提示詞含兩份詳解，長的有 4K token）
    tokenizer = llm.get_tokenizer()

    def make_params(r, temperature, seed):
        text = tokenizer.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=True,
                                             enable_thinking=True)
        budget = min(args.max_tokens, args.max_model_len - len(tokenizer.encode(text, add_special_tokens=False)) - 16)
        return SamplingParams(temperature=temperature, top_p=0.95, top_k=20, max_tokens=budget, seed=seed)

    idle_since = time.time()
    while True:
        pending = [os.path.basename(p)[:-6] for p in sorted(glob.glob(os.path.join(args.queue, "*.jsonl")))
                   if not os.path.exists(os.path.join(args.results, os.path.basename(p)[:-6] + ".done"))]
        if pending:
            process(llm, args, pending[0], make_params)
            idle_since = time.time()
        elif time.time() - idle_since > args.idle_min * 60:
            log(f"QUEUE_IDLE_EXIT：佇列空了 {args.idle_min:.0f} 分鐘")
            return
        else:
            time.sleep(10)


if __name__ == "__main__":
    main()
