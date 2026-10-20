"""把開 thinking 的比對搬到 Colab 的 A100 上，用 vLLM 一次跑一大批。

本機和 Colab 的分工：
    prepare：用和 check.py 相同的提示詞產生 requests.jsonl（含學生詳解，只上傳到 Colab 的暫時 VM）
    Colab  ：colab_vllm.py 跑完全部請求，輸出 results.jsonl（模型原始輸出）
    collect：用 check.py 的同一套解析規則，存成 out/<模型>/<考卷>.check.<label>.json

用法：
    python pipeline/explain/colab_batch.py prepare 110020_1 --limit 20 --model qwen3.5:35b-a3b
    python pipeline/explain/colab_batch.py collect --label colab-qwen3.5-35b-think
    python pipeline/explain/colab_batch.py prepare-gen 110020_1 --limit 20        # 生成用
    python pipeline/explain/colab_batch.py collect-gen --model qwen3.6:27b --think
流程與 Colab CLI 指令見 pipeline/explain/README.md。
"""
import argparse
import json
import sys

from check import build_messages, parse_verdict
from common import MODEL, OUT, REFERENCE_SPLIT, all_exam_ids, load_exam, out_dir, read_json, write_json
from generate import SYSTEM as GEN_SYSTEM, prompt_for, skip_reason, to_traditional

WORK = OUT / "colab"
# Ollama 用 format 參數強制 JSON；vLLM 開 thinking 時不能整段套 JSON 格式（會連推理過程一起限制），改用文字要求
FORMAT_NOTE = ('\n\n想清楚之後，最後只輸出一行 JSON，不要其他文字：'
               '{"sentences": [{"index": 1, "status": "consistent"}, …]}，'
               'status 只能是 consistent、contradicts、not_mentioned。')


def prepare(args):
    exam_ids = all_exam_ids() if args.exams == ["all"] else args.exams
    folder = out_dir(args.model, args.gen_think)
    rows = []
    for exam_id in exam_ids:
        generated = read_json(folder / f"{exam_id}.json", {"questions": {}})["questions"]
        reference = read_json(REFERENCE_SPLIT / f"{exam_id}.json", {})
        for q in load_exam(exam_id)["questions"][: args.limit]:
            key = str(q["number"])
            gen, ref = generated.get(key), reference.get(key)
            if not gen or "text" not in gen or not ref or not ref["matched"]:
                continue
            # 生成時被截斷的只有推理草稿、沒有詳解（例如卡在「1+1+1…」），比對沒有意義，要先重新生成
            if gen.get("done_reason") == "length":
                print(f"略過 {exam_id}/{key}：生成被截斷")
                continue
            messages, n_sents = build_messages(q, gen["text"], ref["text"])
            messages[-1]["content"] += FORMAT_NOTE
            rows.append({"id": f"{exam_id}/{key}", "attempt": gen["attempt"], "n_sents": n_sents,
                         "messages": messages})
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "requests.jsonl"
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    write_json(WORK / "meta.json", {"folder": folder.name, "count": len(rows)})
    print(f"{len(rows)} 題 → {path}")


def collect(args):
    meta = read_json(WORK / "meta.json", {})
    folder = OUT / meta["folder"]
    requests = {r["id"]: r for r in map(json.loads, (WORK / "requests.jsonl").read_text(encoding="utf-8").splitlines())}
    by_exam = {}
    for line in (WORK / "results.jsonl").read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        req = requests[r["id"]]
        exam_id, key = r["id"].split("/")
        # 只看推理結束之後的部分，避免把推理過程裡的草稿當成答案
        answer = r["text"].rsplit("</think>", 1)[-1]
        verdict = parse_verdict(answer, req["n_sents"])
        by_exam.setdefault(exam_id, {})[key] = verdict | {
            "attempt": req["attempt"], "output_tokens": r["output_tokens"], "done_reason": r["finish_reason"]}
    for exam_id, results in by_exam.items():
        path = folder / f"{exam_id}.check.{args.label}.json"
        write_json(path, read_json(path, {}) | results)
        verdicts = [v["verdict"] for v in results.values()]
        print(exam_id, {v: verdicts.count(v) for v in sorted(set(verdicts))}, "→", path.name)


def prepare_gen(args):
    """生成用的請求：提示詞和本機 generate.py 完全相同，跳過送分題和有圖的題目。"""
    exam_ids = all_exam_ids() if args.exams == ["all"] else args.exams
    rows = []
    for exam_id in exam_ids:
        for q in load_exam(exam_id)["questions"][: args.limit]:
            if skip_reason(q):
                continue
            rows.append({"id": f"{exam_id}/{q['number']}", "messages": [
                {"role": "system", "content": GEN_SYSTEM}, {"role": "user", "content": prompt_for(q)}]})
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "gen_requests.jsonl"
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(f"{len(rows)} 題 → {path}")


def collect_gen(args):
    """存成 out/<模型>[-think]/<考卷>.json，格式和本機 generate.py 的產出相同，之後可以直接比對。"""
    folder = out_dir(args.model, args.think)
    by_exam = {}
    for line in (WORK / "gen_results.jsonl").read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        exam_id, key = r["id"].split("/")
        by_exam.setdefault(exam_id, {})[key] = {
            "text": to_traditional(r["text"].rsplit("</think>", 1)[-1].strip()), "attempt": 0,
            "output_tokens": r["output_tokens"], "done_reason": r["finish_reason"]}
    for exam_id, generated in by_exam.items():
        path = folder / f"{exam_id}.json"
        out = read_json(path, {"model": args.model, "think": args.think, "questions": {}})
        out["questions"] |= generated
        write_json(path, out)
        print(exam_id, len(generated), "題 →", path.relative_to(OUT))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("exams", nargs="+", help="考卷 id，或 all 代表全部")
    p.add_argument("--limit", type=int)
    p.add_argument("--model", default=MODEL, help="要比對哪個模型生成的詳解")
    p.add_argument("--gen-think", action="store_true")
    c = sub.add_parser("collect")
    c.add_argument("--label", required=True, help="結果檔名用的標籤，例如 colab-qwen3.5-35b-think")
    pg = sub.add_parser("prepare-gen")
    pg.add_argument("exams", nargs="+", help="考卷 id，或 all 代表全部")
    pg.add_argument("--limit", type=int)
    cg = sub.add_parser("collect-gen")
    cg.add_argument("--model", required=True, help="Colab 上用的模型，決定存到哪個資料夾")
    cg.add_argument("--think", action="store_true")
    args = ap.parse_args()
    {"prepare": prepare, "collect": collect, "prepare-gen": prepare_gen, "collect-gen": collect_gen}[args.cmd](args)


if __name__ == "__main__":
    main()
