"""把題庫正解匯出成 SQL，給 Supabase 的 question_keys 表（資料庫用它判斷作答對錯）。

用法：
    python pipeline/export_keys.py

輸出 supabase/seed/question_keys.sql，在 Supabase SQL Editor 執行。
題庫有更新（新年度、更正答案、人工修正）就重跑一次再執行；重複執行是安全的。
最後會用新的正解重新判斷已經存在的作答紀錄。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "supabase" / "seed" / "question_keys.sql"


def main():
    rows = []
    for path in sorted((ROOT / "data" / "questions").glob("*.json")):
        for q in json.loads(path.read_text(encoding="utf-8"))["questions"]:
            # 沒出題的題目不會有人作答；但官方一律給分的仍要匯入，模擬考滿分才會是 100 分
            if not q["valid"] and not q["free_point"]:
                continue
            answers = "{" + ",".join(q["answers"]) + "}"
            rows.append(f"('{q['id']}', '{answers}', {'true' if q['free_point'] else 'false'})")

    sql = [
        "-- 由 pipeline/export_keys.py 產生，不要手動修改",
        f"-- {len(rows)} 題",
        "insert into public.question_keys (question_id, answers, free_point) values",
        ",\n".join(rows),
        "on conflict (question_id) do update set answers = excluded.answers, free_point = excluded.free_point;",
        "",
        "-- 用正解重新判斷所有作答紀錄（包含匯入正解之前就同步上來的）",
        "update public.answers a",
        "set correct = (k.free_point or a.picked = any (k.answers)), graded = true",
        "from public.question_keys k",
        "where k.question_id = a.question_id;",
        "",
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(sql), encoding="utf-8")
    print(f"{len(rows)} 題 → {OUT.relative_to(ROOT)}（{OUT.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
