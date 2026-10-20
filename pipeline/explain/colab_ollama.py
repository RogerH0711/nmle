"""在 Colab VM 上對本機的 Ollama 同時送多個比對請求，輸出 results.jsonl。只在 Colab VM 上執行。

    python colab_ollama.py --workers 6                                   # 比對（thinking）
    python colab_ollama.py --mode generate --model qwen3.6:27b --think   # 生成

用的模型、量化版本、提示詞和本機完全相同（qwen3.5:35b-a3b，Q4），結果可以直接和本機對照。
A100 40GB 放不下 vLLM 要用的 FP8 版（約 35 GB）再加多題同時處理的空間，所以改用 Ollama
（OLLAMA_NUM_PARALLEL 決定同時處理幾題）。每完成一題就寫一行，斷掉重跑會跳過已完成的題目。
"""
import argparse
import json
import os
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SCHEMA = {
    "type": "object",
    "properties": {"sentences": {"type": "array", "items": {"type": "object", "properties": {
        "index": {"type": "integer"},
        "status": {"type": "string", "enum": ["consistent", "contradicts", "not_mentioned"]}},
        "required": ["index", "status"]}}},
    "required": ["sentences"],
}


def ask(row, model, num_ctx, mode, think):
    # check：固定開 thinking、用 JSON 格式、溫度 0，和本機 check.py --think 相同
    # generate：和本機 generate.py 相同（溫度 0.3、不限格式），thinking 由參數決定
    if mode == "check":
        body = {"think": True, "format": SCHEMA, "options": {"num_ctx": num_ctx, "temperature": 0}}
    else:
        body = {"think": think, "options": {"num_ctx": num_ctx, "temperature": 0.3, "seed": 0}}
    body |= {"model": model, "messages": row["messages"], "stream": False}
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=3600) as resp:
        r = json.load(resp)
    return {"id": row["id"], "text": r["message"]["content"], "output_tokens": r.get("eval_count"),
            "finish_reason": r.get("done_reason")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen3.5:35b-a3b")
    ap.add_argument("--input", default="requests.jsonl")
    ap.add_argument("--output", default="results.jsonl")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--num-ctx", type=int, default=16384)
    ap.add_argument("--mode", choices=["check", "generate"], default="check")
    ap.add_argument("--think", action="store_true", help="generate 模式要不要開 thinking（check 一律開）")
    args = ap.parse_args()

    rows = [json.loads(line) for line in open(args.input, encoding="utf-8")]
    done = set()
    if os.path.exists(args.output):
        done = {json.loads(line)["id"] for line in open(args.output, encoding="utf-8")}
    todo = [r for r in rows if r["id"] not in done]
    print(f"共 {len(rows)} 題，已完成 {len(done)}，這次跑 {len(todo)} 題", flush=True)

    lock, start, count, tokens = threading.Lock(), time.time(), [0], [0]

    def work(row):
        try:
            result = ask(row, args.model, args.num_ctx, args.mode, args.think)
        except Exception as e:  # 單題失敗不要拖垮整批，下次重跑會補
            print(f"{row['id']} 失敗：{e}", flush=True)
            return
        with lock:
            with open(args.output, "a", encoding="utf-8") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")
            count[0] += 1
            tokens[0] += result["output_tokens"] or 0
            elapsed = time.time() - start
            print(f"[{count[0]}/{len(todo)}] {row['id']} {result['output_tokens']} tokens，"
                  f"累計 {tokens[0] / elapsed:.0f} tok/s，剩約 {elapsed / count[0] * (len(todo) - count[0]) / 60:.0f} 分",
                  flush=True)

    with ThreadPoolExecutor(args.workers) as pool:
        list(pool.map(work, todo))
    print(f"完成，{(time.time() - start) / 60:.1f} 分", flush=True)


if __name__ == "__main__":
    main()
