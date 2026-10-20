"""用本地模型生成詳解，存到 pipeline/explain/out/<考卷 id>.json。

用法：
    python pipeline/explain/generate.py 110020_1            # 整份考卷
    python pipeline/explain/generate.py 110020_1 --limit 10 # 先跑前 10 題
    python pipeline/explain/generate.py 110020_1 --redo 3 17  # 重新生成指定題號
    python pipeline/explain/generate.py 110020_1 --model qwen3.5:35b-a3b  # 換模型，產出放在 out/<模型>/
    python pipeline/explain/generate.py all --model qwen3.5:35b-a3b       # 全部考卷

模型只看得到題目和正解，看不到學生詳解（界線見 docs/design.md「詳解與題目正確率」）。
已經生成的題目會跳過，中斷後重跑會接著做。送分題和有圖的題目先不生成。
"""
import argparse
import sys

import opencc

from common import (MODEL, QUESTIONS, SUBJECTS, Progress, all_exam_ids, chat, format_question, load_exam, out_dir,
                    read_json, write_json)

S2TW = opencc.OpenCC("s2tw")
# 考選部題目用過的字一定是正確的繁體字（含回、干、岩、腭這些 OpenCC 會誤轉的字）
BANK_CHARS = {ch for path in QUESTIONS.glob("*.json")
              for q in read_json(path, {})["questions"] for ch in q["stem"] + "".join(q["options"])}


def to_traditional(text):
    """把模型混進來的簡體字（动、脉、节、网）轉成繁體。

    整段丟給 OpenCC 會把繁體本來就有的字也改掉（回流→迴流、干擾→幹擾、前列腺→攝護腺、
    蝶腭→蝶顎），所以逐字處理，題庫出現過的字一律不動。
    """
    return "".join(ch if ch in BANK_CHARS else S2TW.convert(ch) for ch in text)

SYSTEM = """你是臺灣的醫學系教師，替準備醫師國考第一階段的學生寫考題詳解。

規則：
1. 使用繁體中文與臺灣用語；醫學名詞第一次出現時用「中文（English）」。
2. 正確答案已經給你，照這個答案解釋，不要質疑或改答案。
3. 只寫你有把握的教科書內容。不確定的細節就不要寫，絕對不要編造症候群名稱、數字、人名或文獻。
4. 一句話只講一件事，句子要短，方便逐句核對。
5. 全文 250–450 字，用下面的格式，不要加其他段落：

**答案：（字母）**

**關鍵觀念**
（2–4 句，說明這題考的核心機轉或原則）

**選項解析**
- (A) （這個選項對或錯，以及原因）
- (B) …
- (C) …
- (D) …"""


def prompt_for(q):
    answers = "、".join(q["answers"])
    note = f"（本題更正答案，{answers} 都給分）" if len(q["answers"]) > 1 else ""
    return (f"科目：{SUBJECTS.get(q['subject'], q['subject'])}\n\n"
            f"{format_question(q)}\n\n正確答案：{answers}{note}")


def skip_reason(q):
    if not q["valid"]:
        return "題目無效"
    if q["free_point"]:
        return "送分題"
    if q["images"]:
        return "有圖（文字模型看不到圖）"
    return None


def generate(q, model, attempt=0, think=False):
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt_for(q)}]
    # 重新生成時換 seed、稍微提高溫度，得到不同的寫法
    text, stats = chat(messages, model=model, temperature=0.3 + 0.2 * min(attempt, 2), seed=attempt, think=think)
    # 模型偶爾混入簡體字（动脉、节前），統一轉成臺灣繁體；原本是繁體的字不受影響
    return to_traditional(text.strip()), stats


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("exams", nargs="+", help="考卷 id，或 all 代表全部")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--redo", type=int, nargs="*", default=[])
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--think", action="store_true", help="生成時開 thinking，產出放在 out/<模型>-think/")
    args = ap.parse_args()

    exam_ids = all_exam_ids() if args.exams == ["all"] else args.exams
    folder = out_dir(args.model, args.think)
    todo = []
    for exam_id in exam_ids:
        path = folder / f"{exam_id}.json"
        out = read_json(path, {"model": args.model, "think": args.think, "questions": {}})
        for q in load_exam(exam_id)["questions"][: args.limit]:
            key = str(q["number"])
            entry = out["questions"].get(key)
            if entry and q["number"] not in args.redo:
                continue
            reason = skip_reason(q)
            if reason:
                out["questions"][key] = {"skipped": reason}
                continue
            todo.append((exam_id, q, entry))
        write_json(path, out)

    progress = Progress(f"生成 {len(exam_ids)} 份考卷（{folder.name}）", len(todo))
    for exam_id, q, entry in todo:
        path = folder / f"{exam_id}.json"
        out = read_json(path, {})
        attempt = entry.get("attempt", 0) + 1 if entry else 0
        text, stats = generate(q, args.model, attempt, args.think)
        out["questions"][str(q["number"])] = {"text": text, "attempt": attempt, **stats}
        write_json(path, out)  # 每題存一次，中斷後重跑會接著做
        progress.step(f"{exam_id} #{q['number']} {stats['seconds']}s {stats['output_tokens']} tokens")
    progress.finish(f"生成 {len(todo)} 題 → {folder.relative_to(folder.parents[2])}")


if __name__ == "__main__":
    main()
