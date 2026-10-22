"""檢查生成詳解裡的名詞：「中文（English）」的中文是不是那個英文的正確譯名。

比對（check.py）只看結論，擋不住「肩胛下肌（supraspinatus muscle）」這種中英對不上的錯（10/21 實測），
所以另外查名詞。對照表三層：
    1. 國家教育研究院學術名詞（政府資料開放授權條款第 1 版，要標出處）：out/terms/naer/*.csv，用 download 下載
    2. 題庫題目與選項裡的「中文（English）」：考選部用語
    3. 學生詳解裡的「中文（English）」：只抽名詞配對，不用內文（名詞沒有著作權，10/21 Roger 同意）
對不上、或三層都查不到的名詞，交給模型判斷是同義詞還是譯錯（在 Colab 跑，見 README）。

用法：
    python pipeline/explain/terms.py download
    python pipeline/explain/terms.py scan 110020_1 --model qwen3.6:27b-fp8-vllm --think
    python pipeline/explain/terms.py prepare 110020_1 --model qwen3.6:27b-fp8-vllm --think   # 產生 Colab 請求檔
    python pipeline/explain/terms.py collect --model qwen3.6:27b-fp8-vllm --think
"""
import argparse
import csv
import json
import re
import subprocess
import sys
import urllib.parse
from collections import defaultdict

from common import OUT, REFERENCE_SPLIT, all_exam_ids, load_exam, normalize, out_dir, read_json, write_json

TERMS = OUT / "terms"
NAER = TERMS / "naer"
WORK = OUT / "colab"
# 國教院開放資料的檔名（data.gov.tw 上「國家教育研究院-○○學術名詞」）；生理、生化、微免目前沒有單獨的名詞集
NAER_SETS = ["人體解剖學", "醫學", "病理學", "藥學", "化學名詞-化學術語", "動物學", "獸醫學", "兩岸對照名詞-醫學"]

# 中文緊接著括號英文；中文那段會連前面的字一起抓（「支配棘下肌」），比對時看結尾。
# 名詞中間可以夾英文、數字、希臘字母（IP3受器、γ運動神經元、琥珀醯CoA合成酶），10/21 只抓中文時會被切成「受器」。
# 英數和中文之間可以有空格（CD8 T淋巴細胞、TSC2 基因、第 2 型），10/22 之前會被切成「T淋巴細胞」「基因」「型」；
# 比對前把英數和中文之間的空格拿掉，對照表裡寫的是「T淋巴球」。10/21–22 跑的名詞判斷用的是舊規則
PAIR = re.compile(r"((?:(?:[A-Za-z0-9α-ωΑ-Ω\-]{1,12} ?){0,3}[一-鿿]+){1,4})\s*[（(]\s*([A-Za-z][A-Za-z0-9 ,.'\-]{2,70}?)\s*[)）]")
LATIN_SPACE = re.compile(r"(?<=[A-Za-z0-9α-ωΑ-Ω\-]) (?=[一-鿿])")


def download():
    """國教院網站的憑證缺 Subject Key Identifier，新版 Python 的 ssl 不接受，用系統的 curl 下載。"""
    NAER.mkdir(parents=True, exist_ok=True)
    for name in NAER_SETS:
        path = urllib.parse.quote(f"學術名詞/國家教育研究院-{name}學術名詞.csv")
        subprocess.run(["curl", "-sSf", "-o", str(NAER / f"{name}.csv"), "https://opendata.naer.edu.tw/" + path],
                       check=True)
        print("下載", name)


def en_key(en):
    """英文正規化成查表用的 key：小寫、去冠詞、英式拼法、簡單的單複數。"""
    en = normalize(en).lower().strip(" .,()")
    en = re.sub(r"[\-_/]", " ", en)
    en = re.sub(r"^(the|a|an) ", "", en)
    en = en.replace("fibre", "fiber").replace("haem", "hem").replace("oedem", "edem").replace("oesoph", "esoph")
    words = []
    for w in en.split():
        if w.endswith("ies") and len(w) > 4:
            w = w[:-3] + "y"
        elif w == "nuclei":
            w = "nucleus"
        elif w == "ganglia":
            w = "ganglion"
        elif w.endswith("s") and not w.endswith(("ss", "us", "is")) and len(w) > 3:
            w = w[:-1]
        words.append(w)
    return " ".join(words)


def keys_for(en):
    """查表時試的 key：原樣，以及去掉結尾 muscle（解剖名詞常省略）。"""
    k = en_key(en)
    alt = re.sub(r" muscle$", "", k)
    return [k] if alt == k else [k, alt]


def pairs(text):
    for zh, en in PAIR.findall(normalize(text)):
        if re.fullmatch(r"[A-Z0-9\- ]{1,6}", en.strip()):  # 純縮寫（ATP、CN III）不查
            continue
        yield LATIN_SPACE.sub("", zh), en.strip()


def build():
    """回傳 (乾淨的國教院名詞 {key: {中文}}, 題庫與學生詳解抓到的原始配對 {key: {中文（含前文）}}, 國教院全部中文)。"""
    naer, naer_zh = defaultdict(set), set()
    for f in sorted(NAER.glob("*.csv")):
        with open(f, encoding="utf-8-sig", newline="") as fp:
            for row in csv.reader(fp):
                if len(row) < 3 or not row[1].strip():
                    continue
                for zh in re.split(r"[；;、，,]", normalize(row[2])):
                    zh = re.sub(r"[（(].*?[)）]", "", zh).strip()
                    if re.fullmatch(r"[一-鿿]{1,20}", zh):
                        naer[en_key(row[1])].add(zh)
                        naer_zh.add(zh)
    raw = defaultdict(set)
    for exam_id in all_exam_ids():
        for q in load_exam(exam_id)["questions"]:
            for zh, en in pairs(q["stem"] + "\n" + "\n".join(q["options"])):
                raw[en_key(en)].add(zh)
    for f in REFERENCE_SPLIT.glob("*.json"):
        for block in read_json(f, {}).values():
            for zh, en in pairs(block["text"]):
                raw[en_key(en)].add(zh)
    return naer, raw, naer_zh


def common_suffix(a, b):
    n = 0
    while n < min(len(a), len(b)) and a[-1 - n] == b[-1 - n]:
        n += 1
    return a[len(a) - n:]


def classify(zh, en, naer, raw, naer_zh):
    """回傳 (狀態, 對照表裡的譯名)。狀態：ok、mismatch（查得到但對不上）、unknown（查不到）。"""
    known = set()
    for k in keys_for(en):
        known |= naer.get(k, set())
        if any(zh.endswith(c) for c in naer.get(k, ())):
            return "ok", []
        for c in raw.get(k, ()):
            # 原始配對兩邊都帶前文，共同結尾本身要是完整名詞（國教院收錄，或就是其中一邊的全部）才算對上。
            # 寧可多標、交給模型判斷，也不要漏：10/21 試過放寬（共同結尾 3 字以上、或先取結尾的國教院名詞），
            # 「額外肌纖維」會因為和「…到梭外肌纖維」同樣以「外肌纖維／肌纖維」結尾而被放過
            s = common_suffix(zh, c)
            if len(s) >= 2 and (s in naer_zh or s in (zh, c)):
                return "ok", []
            known.add(c)
    return ("mismatch" if known else "unknown"), sorted(known)[:6]


def scan_exam(exam_id, folder, tables):
    generated = read_json(folder / f"{exam_id}.json", {"questions": {}})["questions"]
    result = {}
    for key, g in generated.items():
        if g.get("done_reason") == "length" or "text" not in g:
            continue
        seen, items = set(), []
        for zh, en in pairs(g["text"]):
            if (zh, en) in seen:
                continue
            seen.add((zh, en))
            status, known = classify(zh, en, *tables)
            if status != "ok":
                items.append({"zh": zh, "en": en, "status": status, "known": known})
        result[key] = {"pairs": len(seen), "flagged": items}
    return result


def scan(args):
    tables = build()
    folder = out_dir(args.model, args.think)
    exam_ids = all_exam_ids() if args.exams == ["all"] else args.exams
    for exam_id in exam_ids:
        result = scan_exam(exam_id, folder, tables)
        total = sum(r["pairs"] for r in result.values())
        counts = defaultdict(int)
        for r in result.values():
            for i in r["flagged"]:
                counts[i["status"]] += 1
        write_json(folder / f"{exam_id}.terms.json", result)
        print(exam_id, f"{total} 組名詞", dict(counts))
        if args.show:
            for k, r in sorted(result.items(), key=lambda x: int(x[0])):
                for i in r["flagged"]:
                    print(f"  #{k} {i['status']:8} {i['zh']}（{i['en']}） 對照：{'、'.join(i['known'])}")


JUDGE = """你是臺灣醫學名詞的審稿人。下面是一份醫學考題詳解裡的「中文（English）」名詞配對。
中文那段可能連著前面幾個字（例如「支配棘下肌」），只看結尾的名詞本身。
對每一組判斷：中文名詞是不是這個英文在臺灣醫學教科書的正確譯名。
- ok：正確，或是臺灣常見的同義譯名（例如胸管／胸導管、內側蹄系／內側丘系）
- wrong：譯錯，指的是另一個構造或概念（例如把 supraspinatus 寫成肩胛下肌），
  或是不存在的名詞、有錯字（例如把膠狀質寫成膠質質、把肌鈣蛋白寫成肌鈣質），或是中國用語而臺灣另有通用譯名
有「參考譯名」時，中文和參考譯名不同就要特別小心：只有確定是臺灣教科書也在用的同義詞才算 ok。
參考譯名不一定完整，沒有參考譯名時依你對臺灣醫學教科書的了解判斷。

想清楚之後，最後只輸出一行 JSON，不要其他文字：
{"terms": [{"index": 1, "status": "ok"}, {"index": 2, "status": "wrong", "correct": "棘上肌"}, …]}"""


def prepare(args):
    folder = out_dir(args.model, args.think)
    exam_ids = all_exam_ids() if args.exams == ["all"] else args.exams
    rows = []
    for exam_id in exam_ids:
        for key, r in read_json(folder / f"{exam_id}.terms.json", {}).items():
            if not r["flagged"]:
                continue
            lines = [f"{n}. {i['zh']}（{i['en']}）" + (f"　參考譯名：{'、'.join(i['known'])}" if i["known"] else "")
                     for n, i in enumerate(r["flagged"], 1)]
            rows.append({"id": f"{exam_id}/{key}", "messages": [
                {"role": "system", "content": JUDGE}, {"role": "user", "content": "\n".join(lines)}]})
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "terms_requests.jsonl"
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(f"{len(rows)} 題、{sum(len(r['messages'][1]['content'].splitlines()) for r in rows)} 組名詞 → {path}")


def collect(args):
    folder = out_dir(args.model, args.think)
    by_exam = defaultdict(dict)
    for line in (WORK / "terms_results.jsonl").read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        exam_id, key = r["id"].split("/")
        answer = r["text"].rsplit("</think>", 1)[-1]
        m = re.search(r"\{.*\}", answer, re.S)
        try:
            verdicts = {t["index"]: t for t in json.loads(m.group(0))["terms"]}
        except (AttributeError, ValueError, KeyError, TypeError):
            verdicts = None
        by_exam[exam_id][key] = verdicts
    for exam_id, results in by_exam.items():
        path = folder / f"{exam_id}.terms.json"
        data = read_json(path, {})
        wrong = errors = 0
        for key, verdicts in results.items():
            for n, item in enumerate(data[key]["flagged"], 1):
                v = (verdicts or {}).get(n)
                item["judge"] = v["status"] if v else "error"
                if v and v.get("correct"):
                    item["correct"] = v["correct"]
                wrong += item["judge"] == "wrong"
                errors += item["judge"] == "error"
        write_json(path, data)
        print(exam_id, f"判定譯錯 {wrong} 組，解析失敗 {errors} 組 →", path.name)
        for key, r in sorted(data.items(), key=lambda x: int(x[0])):
            for i in r["flagged"]:
                if i.get("judge") == "wrong":
                    print(f"  #{key} {i['zh']}（{i['en']}） → {i.get('correct', '?')}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("download")
    for name in ("scan", "prepare"):
        p = sub.add_parser(name)
        p.add_argument("exams", nargs="+", help="考卷 id，或 all 代表全部")
        p.add_argument("--model", required=True)
        p.add_argument("--think", action="store_true")
        if name == "scan":
            p.add_argument("--show", action="store_true", help="列出每一組被標出來的名詞")
    c = sub.add_parser("collect")
    c.add_argument("--model", required=True)
    c.add_argument("--think", action="store_true")
    args = ap.parse_args()
    {"download": lambda a: download(), "scan": scan, "prepare": prepare, "collect": collect}[args.cmd](args)


if __name__ == "__main__":
    main()
