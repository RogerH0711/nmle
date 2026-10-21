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
    python pipeline/explain/colab_batch.py prepare-regen --model qwen3.6:27b-fp8-v2 --label vllm-27b-think --seed 2
    python pipeline/explain/colab_batch.py merge-regen --model qwen3.6:27b-fp8-v2 --regen-model qwen3.6:27b-fp8-v2-regen --label vllm-27b-think
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


def prepare_regen(args):
    """重新生成的請求：和參考詳解衝突（verdict fail）或被截斷的題目，提示詞相同、換 seed。

    結果另外存（collect-gen 用另一個 --model 名稱），比對、名詞檢查之後再用 merge-regen 決定要不要換掉原本的。
    """
    folder = out_dir(args.model, True)
    rows, counts = [], {"fail": 0, "length": 0}
    for exam_id in all_exam_ids():
        generated = read_json(folder / f"{exam_id}.json", {"questions": {}})["questions"]
        checks = read_json(folder / f"{exam_id}.check.{args.label}.json", {})
        for q in load_exam(exam_id)["questions"]:
            key = str(q["number"])
            if key not in generated:
                continue
            why = ("length" if generated[key].get("done_reason") == "length"
                   else "fail" if (checks.get(key) or {}).get("verdict") == "fail" else None)
            if not why:
                continue
            counts[why] += 1
            rows.append({"id": f"{exam_id}/{key}", "seed": args.seed, "messages": [
                {"role": "system", "content": GEN_SYSTEM}, {"role": "user", "content": prompt_for(q)}]})
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "gen_requests.jsonl"
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(f"{len(rows)} 題（衝突 {counts['fail']}、截斷 {counts['length']}），seed {args.seed} → {path}")


def merge_regen(args):
    """重新生成的題目：比對通過就換掉原本的生成、比對、名詞結果；原本被截斷的，新的沒被截斷就換。

    其他（還是衝突、沒有比對結果）維持原本的。被換掉的原版備份在 regen 資料夾的 <考卷>.replaced.json，
    已經備份過的題目不再覆蓋備份，所以重跑這個指令也安全。
    """
    main_dir, regen_dir = out_dir(args.model, True), out_dir(args.regen_model, True)
    totals = {"換成新的": 0, "維持原本": 0}
    for exam_id in all_exam_ids():
        new_gen = read_json(regen_dir / f"{exam_id}.json", {"questions": {}})["questions"]
        if not new_gen:
            continue
        new_check = read_json(regen_dir / f"{exam_id}.check.{args.label}.json", {})
        new_terms = read_json(regen_dir / f"{exam_id}.terms.json", {})
        paths = {"gen": main_dir / f"{exam_id}.json", "check": main_dir / f"{exam_id}.check.{args.label}.json",
                 "terms": main_dir / f"{exam_id}.terms.json"}
        gen, check, terms = read_json(paths["gen"], None), read_json(paths["check"], {}), read_json(paths["terms"], {})
        backup_path = regen_dir / f"{exam_id}.replaced.json"
        backup = read_json(backup_path, {})
        for key, g in new_gen.items():
            old = gen["questions"].get(key, {})
            if old == g:
                continue  # 已經換過了
            new_ok = g.get("done_reason") != "length"
            passed = (new_check.get(key) or {}).get("verdict") == "pass"
            if not (new_ok and (passed or old.get("done_reason") == "length")):
                totals["維持原本"] += 1
                continue
            backup.setdefault(key, {"gen": old, "check": check.get(key), "terms": terms.get(key)})
            gen["questions"][key] = g
            for table, new in ((check, new_check), (terms, new_terms)):
                if key in new:
                    table[key] = new[key]
                else:
                    table.pop(key, None)
            totals["換成新的"] += 1
        write_json(paths["gen"], gen)
        write_json(paths["check"], check)
        write_json(paths["terms"], terms)
        write_json(backup_path, backup)
    print(totals)


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
    pr = sub.add_parser("prepare-regen")
    pr.add_argument("--model", required=True, help="原本生成的模型（開 thinking 的資料夾）")
    pr.add_argument("--label", required=True, help="比對結果的標籤，用來找出衝突的題目")
    pr.add_argument("--seed", type=int, default=2, help="第一次生成用 seed 0、截斷重跑用 1，重新生成要換別的")
    mr = sub.add_parser("merge-regen")
    mr.add_argument("--model", required=True)
    mr.add_argument("--regen-model", required=True, help="重新生成的結果放在哪個模型名稱的資料夾")
    mr.add_argument("--label", required=True)
    args = ap.parse_args()
    {"prepare": prepare, "collect": collect, "prepare-gen": prepare_gen, "collect-gen": collect_gen,
     "prepare-regen": prepare_regen, "merge-regen": merge_regen}[args.cmd](args)


if __name__ == "__main__":
    main()
