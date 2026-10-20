"""在 Colab 的 A100 上用 vLLM 跑請求檔（生成或比對都可以），輸出原始結果。只在 Colab VM 上執行。

    python colab_vllm.py --model Qwen/Qwen3.6-27B-FP8 --input gen_requests.jsonl --output gen_vllm.jsonl

請求裡已經是組好的 messages，這支只負責丟給模型（開 thinking）、收回原始輸出，
解析在本機的 colab_batch.py collect / collect-gen 做。

- 分批跑、每批寫檔：中途斷掉重跑時跳過已完成的題目（全部 2,399 題約 7 小時，不能最後才寫檔）
- 輸出到上限被截斷的題目（例如推理卡在重複的「1+1+1…」），全部跑完後換 seed 重跑一次
- 一般安裝與啟動由 colab_job.py 負責，設定的由來見 docs/design.md「詳解與題目正確率」
"""
import argparse
import json
import os
import time

from vllm import LLM, SamplingParams


def run(llm, rows, params, path):
    """跑一批並把結果附加到 path，回傳輸出 token 數。"""
    outputs = llm.chat([r["messages"] for r in rows], params,
                       chat_template_kwargs={"enable_thinking": True}, use_tqdm=True)
    tokens = 0
    with open(path, "a", encoding="utf-8") as f:
        for r, o in zip(rows, outputs):
            out = o.outputs[0]
            tokens += len(out.token_ids)
            f.write(json.dumps({"id": r["id"], "text": out.text, "output_tokens": len(out.token_ids),
                                "finish_reason": out.finish_reason}, ensure_ascii=False) + "\n")
    return tokens


def load(path):
    """讀已完成的結果；同一題出現多次時以最後一筆為準（重跑的會寫在後面）。"""
    done = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            r = json.loads(line)
            done[r["id"]] = r
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--input", default="requests.jsonl")
    ap.add_argument("--output", default="results.jsonl")
    ap.add_argument("--max-model-len", type=int, default=16384)
    ap.add_argument("--max-tokens", type=int, default=12000)
    # 10/20 用 Ollama 測 qwen3.6:27b thinking 時是 0.3，結果很好；Qwen 官方建議 thinking 用 0.6–1.0，
    # 太低可能無限重複（vLLM 99 題中有 1 題卡住），由下面的自動重跑處理
    ap.add_argument("--temperature", type=float, default=0.3)
    ap.add_argument("--kv-gb", type=float, default=5, help="KV cache 大小（GB），一題 16K 約需 1.3 GB")
    ap.add_argument("--max-num-seqs", type=int, default=32, help="最多同時處理幾題")
    ap.add_argument("--chunk", type=int, default=200, help="每跑完幾題寫一次檔")
    args = ap.parse_args()

    rows = [json.loads(line) for line in open(args.input, encoding="utf-8")]
    done = load(args.output)
    todo = [r for r in rows if r["id"] not in done]
    print(f"共 {len(rows)} 題，已完成 {len(done)}，這次跑 {len(todo)} 題，載入 {args.model}", flush=True)

    start = time.time()
    # A100 40GB 上用 gpu_memory_utilization 控制不準（10/20 實測：0.92 配置時記憶體不足、0.85 只剩
    # 0.35 GB 給 KV cache），改成直接指定 KV cache 大小；模型本身 27.9 GB。每批 token 數調低，減少預留的運算記憶體
    llm = LLM(model=args.model, max_model_len=args.max_model_len,
              kv_cache_memory_bytes=int(args.kv_gb * 1024**3), max_num_batched_tokens=2048,
              max_num_seqs=args.max_num_seqs, limit_mm_per_prompt={"image": 0, "video": 0})
    print(f"載入完成 {time.time() - start:.0f} 秒", flush=True)

    params = SamplingParams(temperature=args.temperature, top_p=0.95, top_k=20, max_tokens=args.max_tokens, seed=0)
    start, total = time.time(), 0
    for i in range(0, len(todo), args.chunk):
        total += run(llm, todo[i:i + args.chunk], params, args.output)
        elapsed = time.time() - start
        n = min(i + args.chunk, len(todo))
        print(f"已完成 {n}/{len(todo)} 題，{elapsed / 60:.0f} 分，{total / elapsed:.0f} tok/s，"
              f"剩約 {elapsed / n * (len(todo) - n) / 60:.0f} 分", flush=True)

    # 被截斷的題目換 seed、稍微提高溫度重跑一次；重跑結果附加在檔尾，讀取時以最後一筆為準
    truncated = [r for r in rows if load(args.output).get(r["id"], {}).get("finish_reason") == "length"]
    if truncated:
        print(f"重跑被截斷的 {len(truncated)} 題：{[r['id'] for r in truncated]}", flush=True)
        retry = SamplingParams(temperature=max(args.temperature, 0.6), top_p=0.95, top_k=20,
                               max_tokens=args.max_tokens, seed=1)
        total += run(llm, truncated, retry, args.output)
    still = [k for k, v in load(args.output).items() if v["finish_reason"] == "length"]
    print(f"完成，{(time.time() - start) / 60:.0f} 分，輸出 {total} tokens；仍被截斷：{still}", flush=True)


if __name__ == "__main__":
    main()
