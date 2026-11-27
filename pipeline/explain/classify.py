"""用本機模型把每題歸到學科底下的一個次主題（pipeline/subtopics.json），匯出到 data/subtopics.json。

用法：
    python pipeline/explain/classify.py run all                  # 全部考卷（中斷後重跑會接著做）
    python pipeline/explain/classify.py run 115090_1 --limit 10  # 先試幾題
    python pipeline/explain/classify.py sample 4                 # 每科隨機 4 題，印出來人工核對
    python pipeline/explain/classify.py export                   # 匯出網站用的 data/subtopics.json

做法：學科由題號區段決定（每份考卷都人工看過分界），模型只在那個學科的次主題裡選一個；
用 Ollama 的 JSON schema 限制只能回清單裡的 id，溫度 0、不開 thinking。
11/20 Roger 決定用 qwen3.5:35b-a3b（22 GB，大部分在系統記憶體，跑之前關掉 Docker Desktop）。
只給題目和正解、不附詳解：11/20 試過附上 AI 詳解，44 題只有 2 題改變（1 對 1 錯），分錯的主因是範圍說明有缺。

每題記下分類時的版本（提示詞加上那科的次主題清單），pipeline/subtopics.json 的範圍說明或 SYSTEM 改了之後
重跑 run，只有改到的學科會重新分類。

模型明顯分錯的題目寫在 pipeline/subtopic_overrides.json（要寫原因），export 時蓋掉模型結果。
"""
import argparse
import hashlib
import json
import random
import sys

from common import (OUT, ROOT, SUBJECTS, Progress, all_exam_ids, chat, format_question, load_exam,
                    read_json, write_json)

TAXONOMY = ROOT / "pipeline" / "subtopics.json"
OVERRIDES = ROOT / "pipeline" / "subtopic_overrides.json"  # 人工修正，export 時蓋掉模型結果
DEST = ROOT / "data" / "subtopics.json"
MODEL = "qwen3.5:35b-a3b"
MODEL_NAME = "Qwen3.5-35B-A3B"

SYSTEM = """你是臺灣的醫學系教師，負責把醫師國考第一階段的考題歸到次主題，讓學生可以分章節練習。

規則：
1. 只能從給你的清單選一個次主題，回傳它的 id。
2. 選這題主要在考的知識。題目跨好幾個範圍時（例如臨床情境題），選答對這題需要的那個知識所在的章節。
3. 只看題目內容，不要因為某個名詞出現就歸類：例如藥理題提到心臟，但在考受體機轉，就歸自主神經或總論。
4. 總論和各論（器官系統）都符合時：題目以某個器官的疾病為主（例如肺氣腫的成因、肝炎病毒），選那個器官；考的是不限器官的一般機轉（例如壞死的種類、發炎介質），才選總論。
5. 過敏、自體免疫、免疫缺陷、移植排斥這類免疫造成的疾病，歸免疫疾病，不歸後天免疫。
6. 只回 JSON：{"subtopic": "<id>"}。"""


def taxonomy():
    return json.loads(TAXONOMY.read_text(encoding="utf-8"))["subjects"]


def load_overrides(tax):
    """pipeline/subtopic_overrides.json：{(考卷 id, 題號): {"subtopic", "subjects"}}。subjects 是有這個 id 的學科
    （endocrine、inflammation 這類 id 好幾科都有），匯出時再確認題目的學科在裡面。"""
    owner = {}
    for subj, subs in tax.items():
        for s in subs:
            owner.setdefault(s["id"], []).append(subj)
    fixes = {}
    for exam_id, items in json.loads(OVERRIDES.read_text(encoding="utf-8"))["papers"].items():
        for num, fix in items.items():
            if not fix.get("reason"):
                sys.exit(f"{OVERRIDES.name}：{exam_id} #{num} 沒寫原因")
            if fix["subtopic"] not in owner:
                sys.exit(f"{OVERRIDES.name}：{exam_id} #{num} 的次主題 {fix['subtopic']} 不存在")
            fixes[(exam_id, int(num))] = {"subtopic": fix["subtopic"], "subjects": owner[fix["subtopic"]]}
    return fixes


def versions(tax):
    """每科分類依據的版本：SYSTEM 加上那科的次主題清單（含範圍說明）的雜湊。"""
    return {subj: hashlib.sha1(json.dumps([SYSTEM, subs], ensure_ascii=False).encode()).hexdigest()[:10]
            for subj, subs in tax.items()}


def prompt_for(q, subtopics):
    choices = "\n".join(f"- {s['id']}：{s['name']}（{s['includes']}）" for s in subtopics)
    answers = "、".join(q["answers"]) if not q["free_point"] else "（本題送分）"
    return (f"學科：{SUBJECTS.get(q['subject'], q['subject'])}\n\n可以選的次主題：\n{choices}\n\n"
            f"題目：\n{format_question(q)}\n\n正確答案：{answers}")


def classify(q, subtopics, model):
    ids = [s["id"] for s in subtopics]
    schema = {"type": "object", "properties": {"subtopic": {"type": "string", "enum": ids}}, "required": ["subtopic"]}
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt_for(q, subtopics)}]
    text, stats = chat(messages, model=model, schema=schema, temperature=0)
    try:
        sub = json.loads(text)["subtopic"]
    except (ValueError, KeyError, TypeError):
        sub = None
    return (sub if sub in ids else None), stats


def folder_for(model):
    return OUT / "subtopics" / model.replace(":", "_")


def run(items, model):
    """items：[(考卷 id, 題目)]。已經用同一版分類過的跳過，每題存一次。"""
    tax = taxonomy()
    version = versions(tax)
    folder = folder_for(model)
    todo = []
    for exam_id, q in items:
        out = read_json(folder / f"{exam_id}.json", {"model": model, "questions": {}})
        got = out["questions"].get(str(q["number"]))
        if not got or got.get("version") != version[q["subject"]]:
            todo.append((exam_id, q))
    progress = Progress(f"次主題分類（{model}）", len(todo))
    for exam_id, q in todo:
        path = folder / f"{exam_id}.json"
        out = read_json(path, {"model": model, "questions": {}})
        sub, stats = classify(q, tax[q["subject"]], model)
        out["questions"][str(q["number"])] = {"subtopic": sub, "version": version[q["subject"]], "seconds": stats["seconds"]}
        write_json(path, out)
        progress.step(f"{exam_id} #{q['number']} {q['subject']}.{sub} {stats['seconds']}s")
    progress.finish(f"分類 {len(todo)} 題 → {folder.relative_to(ROOT)}")


def questions_of(exam_ids):
    return [(e, q) for e in exam_ids for q in load_exam(e)["questions"] if q["valid"] and q["subject"]]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("exams", nargs="+", help="考卷 id，或 all")
    r.add_argument("--limit", type=int)
    r.add_argument("--model", default=MODEL)
    s = sub.add_parser("sample")
    s.add_argument("per_subject", type=int)
    s.add_argument("--seed", type=int, default=1)
    s.add_argument("--model", default=MODEL)
    e = sub.add_parser("export")
    e.add_argument("--model", default=MODEL)
    args = ap.parse_args()

    if args.cmd == "run":
        exam_ids = all_exam_ids() if args.exams == ["all"] else args.exams
        items = questions_of(exam_ids)
        if args.limit:
            items = items[: args.limit]
        run(items, args.model)

    elif args.cmd == "sample":
        # 每科隨機幾題先跑，印出題目和結果讓人核對（結果一樣存起來，正式跑時不會重跑）
        rng = random.Random(args.seed)
        by_subject = {}
        for item in questions_of(all_exam_ids()):
            by_subject.setdefault(item[1]["subject"], []).append(item)
        picked = [x for items in by_subject.values() for x in rng.sample(items, args.per_subject)]
        run(picked, args.model)
        tax = taxonomy()
        names = {(subj, s["id"]): s["name"] for subj, subs in tax.items() for s in subs}
        folder = folder_for(args.model)
        for exam_id, q in picked:
            got = read_json(folder / f"{exam_id}.json", {})["questions"][str(q["number"])]["subtopic"]
            print(f"{exam_id} #{q['number']:>3} {SUBJECTS[q['subject']]}／{names.get((q['subject'], got), got)}｜{q['stem'][:60]}")

    else:
        # data/subtopics.json：每份考卷一個陣列，第 n 個是第 n 題的次主題 id（沒分類的是空字串）
        tax = taxonomy()
        folder = folder_for(args.model)
        fixes = load_overrides(tax)
        papers, missing, applied, same = {}, 0, 0, []
        for exam_id in all_exam_ids():
            exam = load_exam(exam_id)
            got = read_json(folder / f"{exam_id}.json", {"questions": {}})["questions"]
            row = []
            for q in exam["questions"]:
                sub = (got.get(str(q["number"])) or {}).get("subtopic") or ""
                fix = fixes.pop((exam_id, q["number"]), None)
                if fix:
                    if q["subject"] not in fix["subjects"]:
                        sys.exit(f"{OVERRIDES.name}：{exam_id} #{q['number']} 是 {q['subject']}，次主題 {fix['subtopic']} 不在這科")
                    if fix["subtopic"] == sub:
                        same.append(f"{exam_id} #{q['number']}")
                    sub = fix["subtopic"]
                    applied += 1
                if q["valid"] and not sub:
                    missing += 1
                row.append(sub)
            papers[exam_id] = row
        if fixes:
            sys.exit(f"{OVERRIDES.name} 有題庫裡找不到的題目：{sorted(fixes)}")
        print(f"人工修正 {applied} 題" + (f"（其中 {len(same)} 題模型已經分對，可以刪掉：{'、'.join(same)}）" if same else ""))
        out = {
            "_說明": "每題的次主題（pipeline/explain/classify.py 產生，不要手改）。papers 的第 n 個是第 n 題，id 對照 subjects 裡那一科的清單；空字串是還沒分類。",
            "model": MODEL_NAME,
            "subjects": {subj: [{"id": s["id"], "name": s["name"]} for s in subs] for subj, subs in tax.items()},
            "papers": papers,
        }
        DEST.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
        print(f"→ {DEST.relative_to(ROOT)}（{DEST.stat().st_size // 1024} KB），還沒分類 {missing} 題")


if __name__ == "__main__":
    main()
