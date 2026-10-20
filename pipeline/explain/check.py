"""把生成的詳解和學生詳解比對，結果存到 pipeline/explain/out/<考卷 id>.check.json。

用法：
    python pipeline/explain/check.py 110020_1
    python pipeline/explain/check.py 110020_1 --limit 10
    python pipeline/explain/check.py 110020_1 --model qwen3.5:9b --judge qwen3.5:35b-a3b

做法：程式先把我們的詳解切成編號的句子，模型讀學生詳解後，只回每一句的狀態
（一致／矛盾／未提及），不輸出任何文字，所以學生詳解的內容不會流進我們的產出。
有任何一句「矛盾」就判定不通過，交給 generate.py --redo 在看不到學生詳解的情況下重寫。
"""
import argparse
import json
import re
import sys

from common import (MODEL, REFERENCE_SPLIT, Progress, all_exam_ids, chat, format_question, load_exam, out_dir,
                    read_json, write_json)

SYSTEM = """你是醫學考題詳解的審稿人。你會拿到一道考題、一份「參考詳解」，以及一份「待審詳解」切成的編號句子。
請逐句判斷待審句子和參考詳解的關係：
- consistent：參考詳解有提到相同的事實，而且內容一致。
- contradicts：和參考詳解的說法互相矛盾（例如左右側、增加／減少、藥物或病原體、數字不同）。
- not_mentioned：參考詳解沒有提到這件事，無法判斷。
只根據參考詳解判斷，不要用你自己的知識補充。一般性的格式句子（例如「答案：C」）若和參考答案一致就算 consistent。"""

SCHEMA = {
    "type": "object",
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "status": {"type": "string", "enum": ["consistent", "contradicts", "not_mentioned"]},
                },
                "required": ["index", "status"],
            },
        }
    },
    "required": ["sentences"],
}


def sentences(text):
    """切成要核對的單位：選項解析一行一個（避免切出「(A) 錯。」這種沒內容的短句），其他依句號切。"""
    out = []
    for line in text.splitlines():
        line = re.sub(r"[*#>]+", "", line).strip(" -")
        if not line or line in ("關鍵觀念", "選項解析") or line.startswith("答案"):
            continue
        if re.match(r"[（(][A-D][)）]", line):
            out.append(line)
        else:
            out += [s.strip() for s in re.split(r"(?<=[。；！？])", line) if len(s.strip()) > 1]
    return out


def build_messages(q, generated, reference):
    """回傳 (messages, 句數)。Ollama 和 Colab（colab_batch.py）共用同一份提示詞。"""
    sents = sentences(generated)
    numbered = "\n".join(f"{i}. {s}" for i, s in enumerate(sents, 1))
    user = (f"【考題】\n{format_question(q)}\n正確答案：{'、'.join(q['answers'])}\n\n"
            f"【參考詳解】\n{reference}\n\n【待審詳解（共 {len(sents)} 句）】\n{numbered}")
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], len(sents)


def parse_verdict(text, n_sents):
    # 開 thinking 時 Ollama 偶爾吐出不完整的 JSON，直接抓每一組 index／status
    status = {int(i): s for i, s in re.findall(r'"index"\s*:\s*(\d+)\s*,\s*"status"\s*:\s*"(\w+)"', text)}
    if not status:
        # 沒抓到任何結果（輸出被截斷或格式壞掉）不能當成通過
        return {"verdict": "error", "contradicts": [], "counts": {}}
    result = [status.get(i, "not_mentioned") for i in range(1, n_sents + 1)]
    return {
        "verdict": "fail" if "contradicts" in result else "pass",
        "contradicts": [i for i, s in enumerate(result, 1) if s == "contradicts"],
        "counts": {k: result.count(k) for k in ("consistent", "contradicts", "not_mentioned")},
    }


def check(q, generated, reference, judge, think):
    messages, n_sents = build_messages(q, generated, reference)
    text, stats = chat(messages, model=judge, schema=SCHEMA, temperature=0, think=think)
    return parse_verdict(text, n_sents) | {"attempt": None, **stats}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("exams", nargs="+", help="考卷 id，或 all 代表全部")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--model", default=MODEL, help="要比對哪個模型生成的詳解")
    ap.add_argument("--gen-think", action="store_true", help="比對開 thinking 生成的那一版（out/<模型>-think/）")
    ap.add_argument("--judge", default=MODEL, help="由哪個模型來比對")
    ap.add_argument("--think", action="store_true", help="比對時開 thinking（9B 實測比較準，但每題約 170 秒）")
    args = ap.parse_args()

    exam_ids = all_exam_ids() if args.exams == ["all"] else args.exams
    folder = out_dir(args.model, args.gen_think)
    suffix = f"check.{out_dir(args.judge).name}{'-think' if args.think else ''}"
    todo, all_results = [], {}
    for exam_id in exam_ids:
        generated = read_json(folder / f"{exam_id}.json", {"questions": {}})["questions"]
        reference = read_json(REFERENCE_SPLIT / f"{exam_id}.json", {})
        path = folder / f"{exam_id}.{suffix}.json"
        results = all_results[exam_id] = read_json(path, {})
        for q in load_exam(exam_id)["questions"][: args.limit]:
            key = str(q["number"])
            gen, ref = generated.get(key), reference.get(key)
            if not gen or "text" not in gen:
                continue
            # 同一版詳解比過就不再比；重新生成後 attempt 會變，才重比
            if key in results and results[key].get("attempt") == gen["attempt"] and results[key]["verdict"] != "error":
                continue
            if not ref or not ref["matched"]:
                results[key] = {"verdict": "no_reference", "attempt": gen["attempt"]}
                continue
            todo.append((exam_id, q, gen, ref))
        write_json(path, results)

    progress = Progress(f"比對 {len(exam_ids)} 份考卷（{folder.name}，由 {args.judge}{' thinking' if args.think else ''} 比對）", len(todo))
    for exam_id, q, gen, ref in todo:
        r = check(q, gen["text"], ref["text"], args.judge, args.think) | {"attempt": gen["attempt"]}
        all_results[exam_id][str(q["number"])] = r
        write_json(folder / f"{exam_id}.{suffix}.json", all_results[exam_id])
        progress.step(f"{exam_id} #{q['number']} {r['verdict']} {r['counts']} {r['seconds']}s")

    verdicts = [r["verdict"] for results in all_results.values() for r in results.values()]
    progress.finish(str({v: verdicts.count(v) for v in sorted(set(verdicts))}))


if __name__ == "__main__":
    main()
