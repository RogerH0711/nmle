"""下載並解析一份考選部考卷，輸出題目 JSON。

用法：
    python pipeline/build_exam.py --exam 115090 --subject 0101   # 單一份
    python pipeline/build_exam.py --years 110 115                # 依 pipeline/exams.json 批次處理

流程：下載試題(Q)、答案(S)、更正答案(M) PDF → 抽文字切題 → 對答案並套用更正
→ 裁切圖片題 → 自動檢查 → 輸出 data/questions/<exam>_<1|2>.json

科目代號每幾年會換（0101/11/55 都是醫學(一)），所以輸出檔名用醫學(一)/(二) 的 1、2 編號。
"""
import argparse
import bisect
import itertools
import json
import re
import sys
from pathlib import Path

import pymupdf
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw"
DATA_DIR = ROOT / "data"
FILE_URL = "https://wwwq.moex.gov.tw/exam/wHandExamQandA_File.ashx?t={t}&code={exam}&c={cls}&s={subject}&q=1"

CLASS_CODE = "301"  # 醫師(一)
EXAMS_FILE = Path(__file__).resolve().parent / "exams.json"
EXPECTED_COUNT = 100
LETTERS = "ABCD"
FULLWIDTH = str.maketrans("ＡＢＣＤ", "ABCD")


# ---------- 下載 ----------

def download(exam: str, subject: str) -> dict:
    """下載 Q/S/M 三種 PDF，回傳 {類型: 路徑}；不存在的類型（例如沒有更正答案）不會出現。"""
    out_dir = RAW_DIR / exam
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for t in "QSM":
        path = out_dir / f"{CLASS_CODE}_{subject}_{t}.pdf"
        if not path.exists():
            url = FILE_URL.format(t=t, exam=exam, cls=CLASS_CODE, subject=subject)
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
            r.raise_for_status()
            if not r.content.startswith(b"%PDF"):
                continue  # 沒有這個檔案時考選部回傳的是 HTML
            path.write_bytes(r.content)
        paths[t] = path
    return paths


# ---------- 試題 ----------

Q_START = re.compile(r"^(\d{1,3})\s*[.．]\s*(.*)$")
OPT_START = re.compile(r"^([A-DＡ-Ｄ])\s*[.．]\s*(.*)$")


SUP = str.maketrans("0123456789+-−()n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁽⁾ⁿ")
SUB = str.maketrans("0123456789+-−()", "₀₁₂₃₄₅₆₇₈₉₊₋₋₍₎")
SCRIPT_RATIO_STRONG = 0.6  # 字級不到旁邊文字 60%：一定是上下標
SCRIPT_RATIO_WEAK = 0.9    # 不到 90% 且基線有位移：也是上下標
SCRIPT_SHIFT = 1.0         # pt
ADJACENT_GAP = 1.5         # pt；上下標和本體字之間的最大間距
ADJACENT_OVERLAP = 4.0     # pt；斜體字（V、k）的字框會往右凸，下標常和它重疊
SCRIPT_TEXT = re.compile(r"[0-9A-Za-z+\-−–=/.,()α-ωΑ-Ω]{1,6}")  # 上下標只會是短的符號，不會有中文
SCRIPT_BASE = re.compile(r"[0-9A-Za-zα-ωΑ-ΩＡ-Ｚａ-ｚ)\]）］]")


def script_text(text, table, marker):
    """轉成 Unicode 上下標；有無法轉換的字元時改用 ^(...) 或 _(...)。"""
    core = text.strip()
    lead, trail = text[: len(text) - len(text.lstrip())], text[len(text.rstrip()):]
    converted = core.translate(table)
    if all(c != o or not c.isalnum() for c, o in zip(converted, core)):
        return lead + converted + trail
    if len(core) <= 3 and core.isalnum():
        return f"{lead}{marker}{core}{trail}"  # 例：V_A
    return f"{lead}{marker}({core}){trail}"


FAKE_BOLD_TOLERANCE = 1.5  # pt
# 中文後面接英數字時，考卷排版會留約 2.8 pt 的空隙（「第 2 天」），但 PDF 裡沒有空白字元，只是把字往右挪；
# 英數字後面接中文時才是真的空白字元。所以中文和英數字之間空隙超過這個值就補一個空白。
# 量過 110–115 年全部考卷：正常相連的字空隙都是 0，中文接中文沒有一處超過 1.5 pt
CJK_LATIN_GAP = 1.5  # pt


def is_cjk(c):
    return "\u4e00" <= c <= "\u9fff"


def dedupe_fake_bold(blocks):
    """移除假粗體造成的重複文字。

    有些年度的 PDF 用「同一段字錯開零點幾 pt 重畫好幾次」做出粗體效果，
    抽文字時會變成「醫學醫學醫學醫學」，而且每份拷貝切 span 的位置不一樣，
    所以要逐字比對：同一頁上同一個字、位置幾乎重疊的只留第一個。
    blocks 要用 rawdict 取得（每個 span 有 chars），處理完補上 span["text"]。
    """
    seen = {}
    for block in blocks:
        for line in block.get("lines", []):
            for span in line["spans"]:
                kept = []
                for ch in span["chars"]:
                    c, (x, y) = ch["c"], ch["origin"]
                    if not c.isspace():
                        gx, gy = round(x / FAKE_BOLD_TOLERANCE), round(y / FAKE_BOLD_TOLERANCE)
                        if any(seen.get((c, gx + dx, gy + dy)) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                            continue
                        seen[(c, gx, gy)] = True
                    kept.append(ch)
                span["chars"] = kept
                span["text"] = "".join(ch["c"] for ch in kept)
                if kept:
                    r = pymupdf.Rect(kept[0]["bbox"])
                    for ch in kept[1:]:
                        r |= ch["bbox"]
                    span["bbox"] = tuple(r)
            line["spans"] = [s for s in line["spans"] if s["text"]]
            if line["spans"]:  # 去掉重複字後，行的範圍也要跟著縮
                r = pymupdf.Rect(line["spans"][0]["bbox"])
                for s in line["spans"][1:]:
                    r |= s["bbox"]
                line["bbox"] = tuple(r)
        block["lines"] = [l for l in block.get("lines", []) if any(s["text"].strip() for s in l["spans"])]


def iter_lines(doc):
    """依閱讀順序產生 (頁碼, 行文字, 行的 bbox)。

    考卷的上標（Na⁺、³²P）和下標（T₃、PGI₂）是縮小的字，抽文字時會變成一般大小；
    這裡拿同一列、左右最近且字級較大的字當基準還原。上標常被拆成獨立的一「行」，
    所以基準從整頁找，不限同一行。
    """
    for pno, page in enumerate(doc):
        blocks = page.get_text("rawdict")["blocks"]
        dedupe_fake_bold(blocks)
        spans = [s for b in blocks for l in b.get("lines", []) for s in l["spans"] if s["text"].strip()]

        scripts = classify_scripts(spans)

        lines = []
        for block in blocks:
            for line in block.get("lines", []):
                text = ""
                prev = None  # 上一個不是空白的字（量空隙用）
                for span in line["spans"]:
                    kind = scripts.get(id(span))
                    if kind:
                        text = text.rstrip()  # 「N ¹⁰」：本體字後面的空白屬於版面，不是內容
                        text += script_text(span["text"], *((SUP, "^") if kind == "sup" else (SUB, "_")))
                    else:
                        for ch in span["chars"]:
                            c = ch["c"]
                            if (prev and is_cjk(prev["c"]) and c.isascii() and c.isalnum() and not text[-1:].isspace()
                                    and ch["bbox"][0] - prev["bbox"][2] > CJK_LATIN_GAP):
                                text += " "
                            text += c
                            if not c.isspace():
                                prev = ch
                        continue
                    chars = [ch for ch in span["chars"] if not ch["c"].isspace()]
                    if chars:  # 上下標：記下最後一個字，後面接中文時才量得到空隙
                        prev = chars[-1]
                lines.append((pymupdf.Rect(line["bbox"]), text))
        for bbox, text in reading_order(lines):
            yield pno, text, bbox


def ink_edges(span):
    """span 去掉前後空白後實際有字的左右邊界（空白也有寬度，會讓間距量錯）。"""
    chars = [c for c in span["chars"] if not c["c"].isspace()]
    if not chars:
        return span["bbox"][0], span["bbox"][2]
    return chars[0]["bbox"][0], chars[-1]["bbox"][2]


def classify_scripts(spans):
    """找出一頁裡的上下標 span，回傳 {id(span): "sup" | "sub"}。

    上下標一定緊貼著較大的拉丁或希臘字母（CO₂、³²P、K_M、β₃）；
    緊貼在另一個上下標後面的也算（NH₄⁺ 的 ⁺ 貼著 ₄）。
    """
    edges = {id(s): ink_edges(s) for s in spans}

    def same_row(a, b):
        return a["bbox"][1] < b["bbox"][3] and b["bbox"][1] < a["bbox"][3]

    def touching(a, b):
        """b 緊貼在 a 的左邊或右邊，回傳 b 靠近 a 那一側的字。"""
        ax0, ax1 = edges[id(a)]
        bx0, bx1 = edges[id(b)]
        text = b["text"].strip()
        if -ADJACENT_OVERLAP <= ax0 - bx1 <= ADJACENT_GAP:
            return text[-1]
        if -ADJACENT_OVERLAP <= bx0 - ax1 <= ADJACENT_GAP:
            return text[0]
        return None

    candidates = [s for s in spans if SCRIPT_TEXT.fullmatch(s["text"].strip()) and s["size"] >= 1]
    result, refs = {}, {}
    for span in candidates:
        bases = []
        for n in spans:
            if n is span or n["size"] <= span["size"] * 1.1 or not same_row(span, n):
                continue
            ch = touching(span, n)
            if ch and SCRIPT_BASE.match(ch):
                gap = min(abs(edges[id(span)][0] - edges[id(n)][1]), abs(edges[id(n)][0] - edges[id(span)][1]))
                bases.append((gap, n))
        if not bases:
            continue
        ref = min(bases, key=lambda t: t[0])[1]
        ratio = span["size"] / ref["size"]
        shift = span["origin"][1] - ref["origin"][1]  # 基線位移，正數代表比較低
        # 中英文混排時英文常比中文小一號但基線相同，所以「稍小」還要有基線位移才算
        if ratio < SCRIPT_RATIO_STRONG:
            is_sup = (span["bbox"][1] + span["bbox"][3]) / 2 < (ref["bbox"][1] + ref["bbox"][3]) / 2
        elif ratio < SCRIPT_RATIO_WEAK and abs(shift) > SCRIPT_SHIFT:
            is_sup = shift < 0
        else:
            continue
        result[id(span)] = "sup" if is_sup else "sub"
        refs[id(span)] = ref

    # 第二輪：貼著已確認上下標的同字級 span
    changed = True
    while changed:
        changed = False
        for span in candidates:
            if id(span) in result:
                continue
            for other in candidates:
                if (id(other) in result and same_row(span, other) and touching(span, other)
                        and abs(other["size"] - span["size"]) < 0.5):
                    ref = refs[id(other)]
                    is_sup = (span["bbox"][1] + span["bbox"][3]) / 2 < (ref["bbox"][1] + ref["bbox"][3]) / 2
                    result[id(span)] = "sup" if is_sup else "sub"
                    refs[id(span)] = ref
                    changed = True
                    break
    return result


def reading_order(lines):
    """PDF 內的行順序不一定等於閱讀順序（例如行尾的「）」被放在整頁最後），
    所以先依垂直位置分列，同一列再由左到右。上下標和本文高度重疊，會歸在同一列。"""
    rows = []
    for bbox, text in sorted(lines, key=lambda l: (l[0].y0 + l[0].y1) / 2):
        if rows:
            r = rows[-1]["range"]
            overlap = min(r[1], bbox.y1) - max(r[0], bbox.y0)
            if overlap > 0.5 * min(r[1] - r[0], bbox.height):
                rows[-1]["lines"].append((bbox, text))
                rows[-1]["range"] = (min(r[0], bbox.y0), max(r[1], bbox.y1))
                continue
        rows.append({"range": (bbox.y0, bbox.y1), "lines": [(bbox, text)]})
    for row in rows:
        yield from sorted(row["lines"], key=lambda l: l[0].x0)


WORD = re.compile(r"[A-Za-z0-9]+")
_vocab = None


def vocab():
    """所有已下載考卷裡「沒有被斷行切到」的英文字（每行頭尾的字可能是半截，不算）。"""
    global _vocab
    if _vocab is None:
        _vocab = set()
        for path in RAW_DIR.glob("*/*_Q.pdf"):
            with pymupdf.open(path) as doc:
                for _, text, _ in iter_lines(doc):
                    _vocab.update(w.lower() for w in WORD.findall(text)[1:-1])
    return _vocab


def join_text(parts):
    """把斷行接回來。

    中文直接相接。英文斷行有兩種：在字中間斷（「tota|l oxygen」）和在字與字之間斷
    （「of pituitary|gland」），PDF 上看不出差別，所以查字彙：接起來是一個字就直接接，
    兩邊各自是字才補空白。
    """
    text = ""
    for p in parts:
        p = p.rstrip("\n")
        if text and text[-1].isascii() and text[-1].isalnum() and p[:1].isascii() and p[:1].isalnum():
            a, b = WORD.findall(text)[-1].lower(), WORD.match(p).group(0).lower()
            if a + b not in vocab() and a in vocab() and b in vocab():
                text += " "
        text += p
    return re.sub(r"[ \t\u3000]+", " ", text).strip()


def parse_questions(doc):
    """切出題號、題幹、四個選項，並記錄每題開始的位置（之後判斷附圖屬於哪一題）。"""
    questions = []
    cur = None
    field = None  # "stem" 或 選項字母

    started = False
    for pno, text, bbox in iter_lines(doc):
        stripped = text.strip()
        m = Q_START.match(stripped)
        expected = len(questions) + 1
        if m and int(m.group(1)) == expected and (cur is None or field == "D"):
            started = True
            cur = {"number": expected, "stem": [m.group(2)], "options": {}, "start": (pno, bbox.y0)}
            questions.append(cur)
            field = "stem"
        elif not started:
            continue  # 卷首的考試名稱、注意事項
        else:
            om = OPT_START.match(stripped)
            next_letter = LETTERS[len(cur["options"])] if len(cur["options"]) < 4 else None
            if om and om.group(1).translate(FULLWIDTH) == next_letter:
                field = next_letter
                cur["options"][field] = [om.group(2)]
            elif stripped:
                (cur["stem"] if field == "stem" else cur["options"][field]).append(text)

    for q in questions:
        q["stem"] = join_text(q["stem"])
        q["options"] = [join_text(q["options"].get(l, [])) for l in LETTERS]
    return questions


INLINE_MAX_HEIGHT = 30  # pt；比兩行字矮的圖片視為行內公式（例如 PaO₂），不是附圖
PNG_MAX_BYTES = 300_000  # 超過就改存 JPEG


def page_figures(page):
    """一頁上的圖片與向量繪圖範圍（去重）。

    有些年度每頁都有一個橫跨整份文件的隱形裁切框，所以超出頁面或蓋住半頁以上的繪圖不算。
    """
    area = page.rect.width * page.rect.height
    rects = [pymupdf.Rect(info["bbox"]) for info in page.get_image_info()]
    rects += [d["rect"] for d in page.get_drawings()
              if d["rect"].width > 5 and d["rect"].height > 5
              and d["rect"] in page.rect and d["rect"].width * d["rect"].height < area / 2]
    return list({tuple(round(v) for v in r): r for r in rects}.values())  # 同一張圖可能被列兩次


def crop_images(doc, questions, key):
    """把題目的附圖裁成圖檔（線條圖 PNG、照片 JPEG）。

    圖片歸給「閱讀順序上在它之前最後開始的那一題」：附圖常放在題幹和選項之間，
    或是換頁後的頁首，不一定落在題目文字的範圍內。
    行內的小圖片通常是公式或罕用字，抽文字時會直接消失，所以不裁圖，改記在 inline_figures
    讓檢查步驟擋下來，等人工在 overrides 補上文字。
    """
    img_dir = DATA_DIR / "images" / key
    for q in questions:
        q["images"], q["inline_figures"] = [], []

    starts = [q["start"] for q in questions]
    for pno, page in enumerate(doc):
        owned = {}
        for r in page_figures(page):
            idx = bisect.bisect_right(starts, (pno, (r.y0 + r.y1) / 2)) - 1
            if idx < 0:
                continue  # 卷首，第 1 題之前
            q = questions[idx]
            if r.height < INLINE_MAX_HEIGHT:
                q["inline_figures"].append(f"第 {pno + 1} 頁 ({r.x0:.0f}, {r.y0:.0f})")
            else:
                owned.setdefault(idx, []).append(r)
        for idx, rects in owned.items():
            q = questions[idx]
            clip = pymupdf.Rect(rects[0])
            for r in rects[1:]:
                clip |= r
            clip = (clip + (-4, -4, 4, 4)) & page.rect
            img_dir.mkdir(parents=True, exist_ok=True)
            # 線條圖用 PNG 比較清楚；病理切片這類照片 PNG 會到好幾 MB，改存 JPEG
            pix = page.get_pixmap(clip=clip, dpi=200)
            data, ext = pix.tobytes("png"), "png"
            if len(data) > PNG_MAX_BYTES:
                data, ext = pix.tobytes("jpeg", jpg_quality=85), "jpg"
            name = f"q{q['number']:03d}_p{pno + 1}.{ext}"
            (img_dir / name).write_bytes(data)
            q["images"].append(f"images/{key}/{name}")


# ---------- 答案 ----------

def parse_answer_letters(doc):
    """標準答案 PDF 依題號順序列出全形 Ａ–Ｄ；更正答案 PDF 用「＃」標示有更正的題目。"""
    text = "".join(p.get_text() for p in doc)
    # 只取單獨成行的答案（「答案Ｃ」或「Ｃ」），避開說明文字和備註裡的字母
    letters = re.findall(r"(?m)^\s*(?:答案)?\s*([ＡＢＣＤ＃#])\s*$", text)
    return letters, text


def parse_corrections(text):
    """解析備註裡的更正說明，回傳 {題號: {"answers": [...], "note": 原文}}。"""
    notes = text.split("備　　註：", 1)[-1] if "備　　註：" in text else text
    notes = re.sub(r"\s+", "", notes)  # 備註常在句中斷行
    result = {}
    # 每段說明到下一個「第N題」為止，例：「第10題，答Ｂ或Ｃ…均給分。」「第65題除未作答者不給分外，其餘均給分，」
    for m in re.finditer(r"第(\d+)題[，,、]?(.*?)(?=第\d+題|$)", notes):
        num, desc = int(m.group(1)), m.group(2).strip("，,。、 ")
        if "一律給分" in desc or "其餘均給分" in desc:
            answers = list(LETTERS)
            kind = "free"
        else:
            # 例：「答Ｂ或Ｄ或BD者均給分」、「更正為Ｃ」
            desc_ascii = desc.translate(FULLWIDTH)
            answers = sorted(set(re.findall(r"(?<![A-D])([A-D])(?![A-D])", desc_ascii)))
            kind = "multiple" if len(answers) > 1 else "corrected"
        result[num] = {"answers": answers, "kind": kind, "note": f"第{num}題{desc}"}
    return result


def attach_answers(questions, paths):
    with pymupdf.open(paths["S"]) as d:
        letters, _ = parse_answer_letters(d)
    official = [l.translate(FULLWIDTH) for l in letters]

    corrections = {}
    if "M" in paths:
        with pymupdf.open(paths["M"]) as d:
            m_letters, m_text = parse_answer_letters(d)
        corrections = parse_corrections(m_text)
        flagged = {i + 1 for i, l in enumerate(m_letters) if l in "＃#"}
        missing = flagged - corrections.keys()
        if missing:
            raise ValueError(f"更正答案標了＃但備註解析不到：{sorted(missing)}")
        # 更正答案 PDF 會把全部答案再列一次；沒有＃的題目應該和標準答案一致，
        # 不一致代表其中一份解析錯位，不能默默採用
        mismatched = [i + 1 for i, l in enumerate(m_letters)
                      if l not in "＃#" and i < len(official) and l.translate(FULLWIDTH) != official[i]]
        if mismatched or len(m_letters) != len(official):
            raise ValueError(f"標準答案與更正答案對不上（題號 {mismatched}，題數 {len(official)}/{len(m_letters)}）")

    for q in questions:
        n = q["number"]
        q["answers"] = [official[n - 1]] if n <= len(official) else []
        q["answer_note"] = None
        q["free_point"] = False
        if n in corrections:
            c = corrections[n]
            q["answers"] = c["answers"]
            q["answer_note"] = c["note"]
            q["free_point"] = c["kind"] == "free"
    return len(official)


# ---------- 人工修正 ----------

def apply_overrides(questions, key):
    """套用 pipeline/overrides/<key>.json 的人工修正。

    格式：{"62": {"stem": "...", "options": {"B": "..."}, "reason": "..."}}
    """
    path = Path(__file__).resolve().parent / "overrides" / f"{key}.json"
    if not path.exists():
        return
    overrides = json.loads(path.read_text(encoding="utf-8"))
    by_number = {q["number"]: q for q in questions}
    for num, fix in overrides.items():
        q = by_number[int(num)]
        if "stem" in fix:
            q["stem"] = fix["stem"]
        for letter, text in fix.get("options", {}).items():
            q["options"][LETTERS.index(letter)] = text
        q["override_reason"] = fix.get("reason")


SUBJECTS = {
    "anatomy": "解剖學",
    "embryology": "胚胎及發育生物學",
    "histology": "組織學",
    "physiology": "生理學",
    "biochemistry": "生物化學",
    "microbiology": "微生物免疫學",
    "parasitology": "寄生蟲學",
    "pharmacology": "藥理學",
    "pathology": "病理學",
    "public_health": "公共衛生學",
}


def assign_subjects(questions, key):
    """依 pipeline/subject_ranges.json 的題號區段粗分學科。"""
    path = Path(__file__).resolve().parent / "subject_ranges.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    ranges = config.get(key) or config.get(f"default_{key.rsplit('_', 1)[1]}", {})
    for q in questions:
        q["subject"] = next((s for s, (lo, hi) in ranges.items() if lo <= q["number"] <= hi), None)
        assert q["subject"] is None or q["subject"] in SUBJECTS, q["subject"]


# ---------- 檢查 ----------

def validate(questions, answer_count):
    problems = []
    if len(questions) != EXPECTED_COUNT:
        problems.append(f"試卷題數 {len(questions)}，應為 {EXPECTED_COUNT}")
    if answer_count != EXPECTED_COUNT:
        problems.append(f"答案數 {answer_count}，應為 {EXPECTED_COUNT}")
    for q in questions:
        issues = []
        if not q["stem"]:
            issues.append("題幹為空")
        for l, opt in zip(LETTERS, q["options"]):
            if not opt:
                issues.append(f"選項 {l} 缺漏")
        if not q["answers"] or any(a not in LETTERS for a in q["answers"]):
            issues.append(f"答案無效：{q['answers']}")
        # 題幹或選項裡又出現下一題的題號，表示可能切錯
        if re.search(rf"(^|\s){q['number'] + 1}\s*[.．]", " ".join(q["options"])):
            issues.append("選項內疑似混入下一題")
        # 字型私用區字元（罕用字常這樣存）在網頁上會顯示成空白或方塊
        if re.search(r"[\ue000-\uf8ff\ufffd]", q["stem"] + "".join(q["options"])):
            issues.append("含字型私用區字元（多半是罕用字），需人工補字")
        if q["inline_figures"] and "override_reason" not in q:
            issues.append(f"含行內公式圖片，文字可能缺漏，需人工補字：{'、'.join(q['inline_figures'])}")
        q["issues"] = issues
        q["valid"] = not issues
    return problems


# ---------- 主程式 ----------

def subject_runs(questions):
    """每題的學科壓成連續區段 [起, 迄, 學科]，前端不用載入整份考卷就能查題目的學科（算好感度用）。"""
    runs = []
    for q in sorted(questions, key=lambda q: q["number"]):
        if not q["subject"]:
            continue
        if runs and runs[-1][2] == q["subject"] and runs[-1][1] == q["number"] - 1:
            runs[-1][1] = q["number"]
        else:
            runs.append([q["number"], q["number"], q["subject"]])
    return runs


def write_index():
    """data/index.json：前端用來列出有哪些考卷、學科名稱，以及各考卷題號對應的學科。"""
    papers = []
    # 新的考試在前；同一次考試醫學(一) 在醫學(二) 前
    files = sorted((DATA_DIR / "questions").glob("*.json"), key=lambda p: (-int(p.stem.split("_")[0]), p.stem))
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        e = data["exam"]
        papers.append({
            "id": e["id"], "year": e["year"], "session": e["session"], "paper": e["paper"],
            "file": f"questions/{path.name}",
            "count": sum(q["valid"] for q in data["questions"]),
            "subject_runs": subject_runs(data["questions"]),
        })
    index = {"subjects": SUBJECTS, "papers": papers}
    (DATA_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")


def read_header(doc):
    """從試題第一頁讀出梯次、醫學(一)/(二)、試題代號。"""
    # 經過假粗體去重；卷首常被切成碎行，直接接起來
    head = "".join(text for pno, text, _ in itertools.takewhile(lambda t: t[0] == 0, iter_lines(doc)))
    m = re.search(r"第([一二])次", head)
    session = "一二".index(m.group(1)) + 1 if m else None
    m = re.search(r"科目名稱[：:]\s*醫學\s*[（(]\s*([一二])\s*[)）]", head)
    paper_no = "一二".index(m.group(1)) + 1 if m else None
    m = re.search(r"代\s*號[：:]\s*(\d+)", head)
    return session, paper_no, m.group(1) if m else None


def build(exam: str, subject: str):
    paths = download(exam, subject)
    if "Q" not in paths or "S" not in paths:
        print(f"{exam} {subject} 找不到試題或答案 PDF：{sorted(paths)}")
        return False

    with pymupdf.open(paths["Q"]) as doc:
        session, paper_no, paper_code = read_header(doc)
        if paper_no is None:
            print(f"{exam} {subject} 讀不到科目名稱，跳過")
            return False
        key = f"{exam}_{paper_no}"
        questions = parse_questions(doc)
        crop_images(doc, questions, key)
    answer_count = attach_answers(questions, paths)
    apply_overrides(questions, key)
    assign_subjects(questions, key)
    problems = validate(questions, answer_count)
    year = int(exam[:3])

    out = {
        "exam": {
            "id": key,
            "exam_code": exam,
            "year": year,
            "session": session,
            "paper": f"醫學({'一二'[paper_no - 1]})",
            "paper_code": paper_code,
            "sources": {t: FILE_URL.format(t=t, exam=exam, cls=CLASS_CODE, subject=subject) for t in paths},
        },
        "problems": problems,
        "questions": [
            {
                "id": f"{key}_{q['number']:03d}",
                "number": q["number"],
                "subject": q["subject"],  # 學科 ID，對照 SUBJECTS
                "subject_status": "range" if q["subject"] else "unlabeled",  # range：依題號區段粗分，未逐題確認
                "stem": q["stem"],
                "options": q["options"],
                "answers": q["answers"],  # 一題多解時有多個；一律給分時為 A–D
                "free_point": q["free_point"],
                "answer_note": q["answer_note"],
                "override_reason": q.get("override_reason"),
                "images": q["images"],
                "explanation": None,
                "explanation_status": "none",
                "valid": q["valid"],
                "issues": q["issues"],
            }
            for q in questions
        ],
    }

    out_path = DATA_DIR / "questions" / f"{key}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    invalid = [q for q in out["questions"] if not q["valid"]]
    noted = [q for q in out["questions"] if q["answer_note"]]
    with_img = [q for q in out["questions"] if q["images"]]
    print(f"{key}  {year} 年第 {session} 次  {out['exam']['paper']}")
    print(f"  題數 {len(questions)}、答案 {answer_count}、圖片題 {len(with_img)}、更正 {len(noted)}、檢查不過 {len(invalid)}")
    for p in problems:
        print(f"  [試卷] {p}")
    for q in noted:
        print(f"  [更正] {q['answer_note']} → {q['answers']}")
    for q in invalid:
        print(f"  [題目 {q['number']}] {'；'.join(q['issues'])}")
    return not problems and not invalid


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--exam", help="考試代碼，例如 115090")
    ap.add_argument("--subject", help="科目代號，例如 0101")
    ap.add_argument("--years", nargs=2, type=int, metavar=("FROM", "TO"), help="依 exams.json 批次處理的民國年範圍")
    args = ap.parse_args()

    if args.years:
        lo, hi = args.years
        jobs = [(e["exam"], e["subject"]) for e in json.loads(EXAMS_FILE.read_text(encoding="utf-8"))
                if lo <= e["year"] <= hi]
    elif args.exam and args.subject:
        jobs = [(args.exam, args.subject)]
    else:
        ap.error("需要 --exam 加 --subject，或 --years")

    # 先把所有 PDF 下載好再解析：英文斷行要不要補空白是查所有考卷的字彙（vocab），
    # 邊下載邊解析的話，前面幾份查到的字彙不完整，第一次在新電腦上跑會和之後的結果不同
    for exam, subject in jobs:
        download(exam, subject)

    failed = []
    for exam, subject in jobs:
        try:
            if not build(exam, subject):
                failed.append(f"{exam} {subject}")
        except Exception as e:  # 一份壞掉不要擋住其他份
            print(f"{exam} {subject} 發生錯誤：{e!r}")
            failed.append(f"{exam} {subject}")
    write_index()
    print(f"\n完成 {len(jobs) - len(failed)} / {len(jobs)} 份；需要處理：{failed or '無'}")
    sys.exit(1 if failed else 0)
