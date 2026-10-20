"""詳解生成與比對共用的設定與小工具。

詳解只在本機用 Ollama 跑（Windows 版，http://127.0.0.1:11434），不呼叫付費 API。
學生編寫的詳解放在 NMLE_DE/（不進 repo），只拿來比對結論，界線見 docs/design.md「詳解與題目正確率」。
"""
import json
import re
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUESTIONS = ROOT / "data" / "questions"
REFERENCE_DIR = ROOT / "NMLE_DE"
REFERENCE_SPLIT = REFERENCE_DIR / "split"
OUT = ROOT / "pipeline" / "explain" / "out"

OLLAMA = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3.5:9b"
# 生成和比對用同一個 context 長度，避免 Ollama 在兩者之間重新載入模型
NUM_CTX = 8192
# 35B 有四分之三放在系統記憶體，context 開太大會不夠；實測 thinking 約 1,000 輸入 + 7,200 輸出，16K 留一倍餘裕
THINK_CTX = 16384

SUBJECTS = {
    "anatomy": "解剖學", "embryology": "胚胎學", "histology": "組織學", "physiology": "生理學",
    "biochemistry": "生物化學", "microbiology": "微生物學", "parasitology": "寄生蟲學",
    "public_health": "公共衛生", "pharmacology": "藥理學", "pathology": "病理學",
}


def normalize(text):
    """PDF 轉出來的文字混有康熙部首（⾆、⼒）等相容字元，統一成一般字元。"""
    return unicodedata.normalize("NFKC", text)


def load_exam(exam_id):
    return json.loads((QUESTIONS / f"{exam_id}.json").read_text(encoding="utf-8"))


def format_question(q):
    options = "\n".join(f"({c}) {o}" for c, o in zip("ABCD", q["options"]))
    return f"{q['stem']}\n{options}"


def out_dir(model, think=False):
    """每個模型的產出分開放，方便比較：out/qwen3.5_9b/110020_1.json；開 thinking 生成的放 out/<模型>-think/。"""
    return OUT / (re.sub(r"[^\w.-]+", "_", model.split("/")[-1]) + ("-think" if think else ""))


def all_exam_ids():
    index = json.loads((ROOT / "data" / "index.json").read_text(encoding="utf-8"))
    return sorted(p["id"] for p in index["papers"])


def chat(messages, *, model=MODEL, schema=None, temperature=0.3, seed=None, think=False):
    """呼叫 Ollama，回傳 (文字, 統計)。生成時關掉 thinking：實測只會變慢四倍，正確性沒有比較好。"""
    # thinking 可能想到 7,000 tokens 以上，8K context 會在輸出答案前就被截斷（10/20 實測），所以放大。
    # 生成和比對的 context 不同時 Ollama 會重新載入模型，所以同一批次盡量不要混用
    options = {"num_ctx": THINK_CTX if think else NUM_CTX, "temperature": temperature}
    if seed is not None:
        options["seed"] = seed
    body = {"model": model, "messages": messages, "stream": False, "options": options}
    # 不支援 thinking 的模型（例如 Llama 3）帶 think 參數會報錯，只在要開的時候才帶
    if think:
        body["think"] = True
    elif model.startswith("qwen"):
        body["think"] = False
    if schema:
        body["format"] = schema
    req = urllib.request.Request(OLLAMA, json.dumps(body).encode(), {"Content-Type": "application/json"})
    start = time.time()
    # 整晚跑的批次不要因為一次連線錯誤就停掉：等一下再試，最多三次
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=3600) as resp:
                r = json.load(resp)
            break
        except OSError as e:
            if attempt == 2:
                raise
            print(f"Ollama 連線錯誤（{e}），60 秒後重試", flush=True)
            time.sleep(60)
    stats = {"seconds": round(time.time() - start, 1), "output_tokens": r.get("eval_count"),
             "done_reason": r.get("done_reason")}
    return r["message"]["content"], stats


class Progress:
    """把每題的進度寫進 out/progress.log，長時間批次可以另開終端機看：
    Get-Content pipeline/explain/out/progress.log -Wait -Tail 20
    """

    LOG = OUT / "progress.log"

    def __init__(self, label, total):
        self.label, self.total, self.done, self.start = label, total, 0, time.time()
        self.write(f"開始 {label}：{total} 題")

    def step(self, message):
        self.done += 1
        elapsed = time.time() - self.start
        left = elapsed / self.done * (self.total - self.done)
        eta = time.strftime("%H:%M", time.localtime(time.time() + left))
        self.write(f"[{self.done}/{self.total}] {message}（剩約 {left / 60:.0f} 分，預計 {eta} 完成）")

    def finish(self, message):
        self.write(f"完成 {self.label}：{message}，共 {(time.time() - self.start) / 60:.1f} 分")

    def write(self, line):
        line = f"{time.strftime('%m-%d %H:%M:%S')} {line}"
        print(line, flush=True)
        self.LOG.parent.mkdir(parents=True, exist_ok=True)
        with self.LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def read_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
