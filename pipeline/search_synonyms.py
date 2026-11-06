"""題庫搜尋的中英同義表：data/search/synonyms.json（web/src/search.ts 的 expandTerms 讀）。

搜「腎上腺素」也找只寫 epinephrine 的題目，反過來也一樣。對照只取兩邊都確定的：
題庫裡「中文（English）」的寫法（考選部用語），英文查得到國教院學術名詞（樂詞網），
而且題庫的中文結尾是樂詞網的某個譯名，才收那個譯名。正規表示式會把前面的字一起抓進來
（「造成內側延腦症候群」），對上樂詞網的譯名剛好把多的切掉。
樂詞網的 CSV 在 pipeline/explain/out/terms/naer/（`python pipeline/explain/terms.py download`，不進 repo）。

用法：python pipeline/search_synonyms.py
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAER = ROOT / "pipeline" / "explain" / "out" / "terms" / "naer"
OUT = ROOT / "data" / "search" / "synonyms.json"
# 醫學相關的名詞集；動物學、獸醫學的譯名常和醫學不同，不收
SETS = ["人體解剖學", "醫學", "病理學", "藥學", "化學名詞-化學術語", "兩岸對照名詞-醫學"]

# 太籠統、一詞多義或會誤中別的字的（搜尋是子字串比對、略過空白），11/06 從兩個字以內的中文逐一看過挑出來
STOP = {
    "activity", "amino", "amino group", "canaliculi", "capitulum", "colloid", "conformation", "depression", "diameter",
    "efficacy", "efficiency", "element", "empowerment", "engineering", "environment", "growth", "heart", "hormone",
    "input", "kinase", "ligand", "lipid", "matrix", "modification", "molar", "monomer", "neutralization", "parallel",
    "plasma", "primer", "probe", "receptor", "recovery", "response", "reversal", "slope", "sorting", "splitting",
    "stress", "template", "vector",
}
# 樂詞網有、但和這個英文不是同一個意思的譯名：腺苷酸是 AMP；網膜也指大網膜（omentum）
WRONG_ZH = {"adenosine": {"腺苷酸"}, "retina": {"網膜"}}

PAIR = re.compile(r"([一-鿿]{2,16})\s*[（(]\s*([A-Za-z][A-Za-z0-9 ,.'\-]{2,60}?)\s*[)）]")


def en_key(en: str) -> str:
    return re.sub(r"\s+", " ", en.strip().lower())


def load_naer() -> dict[str, set[str]]:
    naer = defaultdict(set)
    for name in SETS:
        with open(NAER / f"{name}.csv", encoding="utf-8-sig", newline="") as fp:
            for row in csv.reader(fp):
                if len(row) < 3 or not row[1].strip():
                    continue
                for zh in re.split(r"[；;、，,]", row[2]):
                    zh = re.sub(r"[（(].*?[)）]", "", zh).strip()
                    if re.fullmatch(r"[一-鿿]{2,20}", zh):
                        naer[en_key(row[1])].add(zh)
    return naer


def main():
    if not NAER.exists():
        sys.exit(f"找不到樂詞網名詞：{NAER}（先跑 python pipeline/explain/terms.py download）")
    naer = load_naer()
    groups: dict[str, set[str]] = defaultdict(set)
    for path in sorted((ROOT / "data" / "questions").glob("*.json")):
        for q in json.loads(path.read_text(encoding="utf-8"))["questions"]:
            text = "\n".join([q["stem"], *q["options"]])
            for zh_raw, en in PAIR.findall(text):
                key = en_key(en)
                # 英文太短的（縮寫、單一字母）比對時容易誤中，不收
                if len(key) < 5 or key not in naer or key in STOP:
                    continue
                # 取最長的、題庫中文結尾對得上的譯名
                names = naer[key] - WRONG_ZH.get(key, set())
                hits = sorted((zh for zh in names if zh_raw.endswith(zh)), key=len, reverse=True)
                if hits:
                    groups[key].add(hits[0])
    out = [[en, *sorted(zh)] for en, zh in sorted(groups.items())]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "_說明": "題庫搜尋的中英同義（pipeline/search_synonyms.py 產生，不要手改）。每組第一個是英文，後面是題庫用過、"
                "也是國家教育研究院學術名詞的中文譯名；搜尋框的字和其中一個相同，就一起找整組。",
                "groups": out,
            },
            ensure_ascii=False,
            indent=0,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"{len(out)} 組，寫到 {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
