"""從考選部考畢試題查詢平臺找出醫師一階的考試代碼與科目代號。

用法：
    python pipeline/list_exams.py 110 115

輸出每次考試的 exam code、類科代號、科目代號與名稱，並存成 pipeline/exams.json。
"""
import html
import json
import re
import sys
from pathlib import Path

import requests

URL = "https://wwwq.moex.gov.tw/exam/wFrmExamQandASearch.aspx"
PREFIX = "ctl00$holderContent$"


def hidden_fields(page):
    return dict(re.findall(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page))


def post(session, page, extra):
    fields = hidden_fields(page)
    fields.update(extra)
    r = session.post(URL, data=fields, timeout=60)
    r.encoding = "utf-8"
    return r.text


def exams_of_year(session, roc_year):
    """切換年度後，回傳該年度下拉選單裡的 (code, 名稱)。"""
    r = session.get(URL, timeout=60)
    r.encoding = "utf-8"
    ad = str(roc_year + 1911)
    page = post(session, r.text, {
        PREFIX + "wUctlExamYearStart$ddlExamYear": ad,
        PREFIX + "wUctlExamYearEnd$ddlExamYear": ad,
        PREFIX + "btnYear": "依考試年度設定考試簡稱",
    })
    options = re.findall(r'<option[^>]*value="(\d{6})"[^>]*>([^<]*)</option>', page)
    return page, [(code, html.unescape(name)) for code, name in options]


def subjects_of_exam(session, page, roc_year, code):
    """查詢一次考試，回傳 {類科代號: (類科名稱, [(科目代號, 科目名稱, 有更正答案)])}。"""
    ad = str(roc_year + 1911)
    result = html.unescape(post(session, page, {
        PREFIX + "wUctlExamYearStart$ddlExamYear": ad,
        PREFIX + "wUctlExamYearEnd$ddlExamYear": ad,
        PREFIX + "ddlExamCode": code,
        PREFIX + "btnSearch": "查詢",
    }))
    classes = {}
    for cls, name in re.findall(rf'<label for="ctl00_holderContent_chk_{code}_(\d+)">([^<]*)</label>', result):
        classes[cls] = (name, [])
    for cls, subj, name in re.findall(
            rf'<label for="ctl00_holderContent_chk_{code}_(\d+)_(\d+)" class="exam-title">([^<]*)</label>', result):
        has_m = f"t=M&code={code}&c={cls}&s={subj}&" in result
        classes.setdefault(cls, ("?", []))[1].append((subj, name, has_m))
    return classes


def main(start, end):
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"
    rows = []
    for year in range(end, start - 1, -1):
        page, exams = exams_of_year(session, year)
        for code, name in exams:
            if "醫師" not in name or "分階段" not in name:
                continue
            for cls, (cls_name, subjects) in sorted(subjects_of_exam(session, page, year, code).items()):
                # 只要「醫師(一)」：排除牙醫師、中醫師
                if not re.search(r"(?<![牙中])醫師[（(]一[)）]", cls_name):
                    continue
                for subj, subj_name, has_m in subjects:
                    paper = re.match(r"醫學[（(][一二][)）]", subj_name)
                    paper = paper.group(0).replace("（", "(").replace("）", ")") if paper else subj_name[:20]
                    rows.append({"year": year, "exam": code, "class": cls, "subject": subj,
                                 "paper": paper, "corrected": has_m, "name": name})
                    print(year, code, cls, subj, paper, "更正" if has_m else "", cls_name)
    out = Path(__file__).resolve().parent / "exams.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
