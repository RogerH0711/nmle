"""把生成的詳解連同比對、名詞檢查的結果匯出成網站用的 data/explanations/<考卷>.json。

用法：
    python pipeline/explain/export_web.py all
    python pipeline/explain/export_web.py 110020_1 --model qwen3.6:27b-fp8-vllm --check-label colab-qwen3.6-27b-fp8-vllm-think

分級（網站依此標示，做法見 docs/design.md「詳解與題目正確率」）：
- checked：和參考詳解比對沒有衝突，名詞檢查也沒有判定譯錯
- terms：比對沒有衝突，但有名詞被判定譯錯（附上建議的譯名）
- conflict：和參考詳解的結論衝突
- unchecked：沒有參考詳解可以比對，或比對失敗
生成被截斷的題目不匯出，網站上那題維持只有「問 AI」。
只匯出模型生成的文字和判定結果，不含學生詳解的任何內容。
"""
import argparse
import re
import sys

from common import ROOT, all_exam_ids, out_dir, read_json, write_json

DEST = ROOT / "data" / "explanations"
MODEL = "qwen3.6:27b-fp8-v2"
CHECK_LABEL = "vllm-27b-think"
MODEL_NAME = "Qwen3.6-27B"

# 「中文（English）」的括號；前面要是中文字，避免動到選項代號 (A)
EN_PAREN = re.compile(r"(?<=[一-鿿])\s*[（(]\s*([A-Za-z][A-Za-z0-9 ,.'\-]{2,70}?)\s*[)）]")


def drop_repeated_english(text):
    """模型每次提到名詞都附英文，只留第一次出現的，其餘的括號拿掉。"""
    seen = set()

    def repl(m):
        key = m.group(1).lower()
        if key in seen:
            return ""
        seen.add(key)
        return m.group(0)

    return EN_PAREN.sub(repl, text)


def level_of(check, wrong_terms):
    verdict = (check or {}).get("verdict")
    if verdict == "fail":
        return "conflict"
    if verdict == "pass":
        return "terms" if wrong_terms else "checked"
    return "unchecked"


def export(exam_id, args):
    folder = out_dir(args.model, think=True)
    gen = read_json(folder / f"{exam_id}.json", None)
    if not gen:
        return None
    checks = read_json(folder / f"{exam_id}.check.{args.check_label}.json", {})
    terms = read_json(folder / f"{exam_id}.terms.json", {})
    questions, skipped = {}, 0
    for key, g in sorted(gen["questions"].items(), key=lambda x: int(x[0])):
        if g.get("done_reason") == "length" or not g.get("text"):
            skipped += 1
            continue
        wrong = [{"en": t["en"], "correct": t["correct"]} for t in terms.get(key, {}).get("flagged", [])
                 if t.get("judge") == "wrong" and t.get("correct")]
        item = {"text": drop_repeated_english(g["text"]), "level": level_of(checks.get(key), wrong)}
        if wrong:
            item["terms"] = wrong
        questions[key] = item
    write_json(DEST / f"{exam_id}.json", {"model": MODEL_NAME, "questions": questions})
    counts = {}
    for q in questions.values():
        counts[q["level"]] = counts.get(q["level"], 0) + 1
    return len(questions), skipped, counts


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("exams", nargs="+", help="考卷 id，或 all 代表全部")
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--check-label", default=CHECK_LABEL)
    args = ap.parse_args()
    exams = all_exam_ids() if args.exams == ["all"] else args.exams
    DEST.mkdir(parents=True, exist_ok=True)
    for exam_id in exams:
        r = export(exam_id, args)
        if r is None:
            print(exam_id, "沒有生成結果，略過")
            continue
        n, skipped, counts = r
        print(exam_id, n, "題", counts, f"（略過截斷 {skipped} 題）" if skipped else "")


if __name__ == "__main__":
    main()
