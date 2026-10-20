"""把學生編寫的詳解（NMLE_DE/*.md）切成一題一段，存到 NMLE_DE/split/<考卷 id>.json。

用法：
    python pipeline/explain/split_reference.py

輸出也在 NMLE_DE/ 底下，不進 repo。順便抽出詳解寫的答案，和題庫的正解比對，不一致的列出來人工看。
"""
import json
import re
import sys

from common import QUESTIONS, REFERENCE_DIR, REFERENCE_SPLIT, ROOT, normalize, write_json

SESSIONS = {"第一次": 1, "第二次": 2}
# 大部分考卷：「題號」單獨一行，下一行是數字
HEADER_A = re.compile(r"^\s*題號\s*\n\s*(\d{1,3})\s*$", re.M)
# 111 年第一次：「第2 題」單獨一行
HEADER_B = re.compile(r"^\s*第\s*(\d{1,3})\s*題\s*$", re.M)
# 「公告答案 D」「答案(C)」「答案\n(B) ……」
ANSWER = re.compile(r"(?:公告)?答案\s*[:：]?\s*\n?\s*[（(]?\s*([A-D](?:\s*[、,，或/]\s*[A-D])*)")


def find_exam(year, session, paper):
    index = json.loads((ROOT / "data" / "index.json").read_text(encoding="utf-8"))
    for p in index["papers"]:
        if p["year"] == year and p["session"] == session and p["paper"] == paper:
            return p["id"]
    return None


def stem_overlap(stem, body):
    """題幹的相鄰兩字有多少比例出現在詳解段落裡，用來抓檔案放錯、題號切錯的段落。"""
    chars = re.sub(r"[\W_]", "", normalize(stem))
    pairs = {chars[i:i + 2] for i in range(len(chars) - 1)}
    flat = re.sub(r"[\W_]", "", body)
    return sum(p in flat for p in pairs) / len(pairs) if pairs else 0


def split(text):
    text = normalize(re.sub(r"<!-- page \d+ -->", "", text))
    headers = list(HEADER_A.finditer(text)) or list(HEADER_B.finditer(text))
    blocks = {}
    for i, m in enumerate(headers):
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        number = int(m.group(1))
        # 少數考卷題號重複（目錄或勘誤），保留比較長的那段
        body = re.sub(r"\n\s*\n+", "\n", text[m.start():end]).strip()
        if len(body) > len(blocks.get(number, "")):
            blocks[number] = body
    return blocks


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    name_re = re.compile(r"(\d{3})年(第[一二]次)(醫學\([一二]\))詳解")
    for path in sorted(REFERENCE_DIR.glob("*.md")):
        m = name_re.fullmatch(normalize(path.stem))
        if not m:
            print(f"略過（檔名看不懂）：{path.name}")
            continue
        exam_id = find_exam(int(m.group(1)), SESSIONS[m.group(2)], m.group(3))
        if not exam_id:
            print(f"略過（題庫沒有這份考卷）：{path.name}")
            continue

        blocks = split(path.read_text(encoding="utf-8"))
        questions = {q["number"]: q for q in json.loads((QUESTIONS / f"{exam_id}.json").read_text(encoding="utf-8"))["questions"]}
        out, mismatches, unmatched, no_answer = {}, [], [], 0
        for number, body in sorted(blocks.items()):
            q = questions.get(number)
            if not q:
                continue
            overlap = stem_overlap(q["stem"], body)
            # 對不上題幹的段落不拿來比對（檔案放錯或題號切錯），留著方便人工檢查
            matched = overlap >= 0.6
            a = ANSWER.search(body)
            answers = sorted(set(re.findall(r"[A-D]", a.group(1)))) if a else []
            out[str(number)] = {"matched": matched, "stem_overlap": round(overlap, 2), "answers": answers, "text": body}
            if not matched:
                unmatched.append(number)
            elif not answers:
                no_answer += 1
            # 更正答案常有多個正解，詳解只寫其中一個不算不一致
            elif not q["free_point"] and not set(answers) <= set(q["answers"]):
                mismatches.append(f"{number}（詳解 {''.join(answers)}／題庫 {''.join(q['answers'])}）")
        write_json(REFERENCE_SPLIT / f"{exam_id}.json", out)

        missing = sorted(set(questions) - set(blocks))
        print(f"{exam_id} {path.stem}：{len(blocks)} 題"
              + (f"，缺 {missing}" if missing else "")
              + (f"，{no_answer} 題抓不到答案" if no_answer else "")
              + (f"\n    題幹對不上（不比對）：{unmatched if len(unmatched) < 20 else f'{len(unmatched)} 題，檔案可能放錯'}" if unmatched else "")
              + (f"\n    答案不一致：{'、'.join(mismatches)}" if mismatches else ""))


if __name__ == "__main__":
    main()
