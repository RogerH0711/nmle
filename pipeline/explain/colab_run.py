"""在本機（Windows）總控一整批 Colab 工作：開一次 A100、模型載入一次，依序跑完所有階段。

    .venv-gpu\\Scripts\\python.exe pipeline\\explain\\colab_run.py          # 由工作排程器「NMLE Colab 總控」啟動
    .venv-gpu\\Scripts\\python.exe pipeline\\explain\\colab_run.py --dry     # 只列出各階段狀態

階段（STAGES）：本機產生請求檔 → 放進 Colab 佇列 → 跑完下載 → 本機整理結果；後面的階段等前面的整理完才產生請求。
紀錄點：
- Colab 上每 200 題寫一次檔，這裡每次查狀態發現有新結果就下載到 out/colab/run/<階段>.out.jsonl
- 各階段的進度記在 out/colab/run/state.json；這支程式中斷後重跑，會從記錄的地方接著做
- Colab 執行環境不見了（斷線、到時限）：重開一台，把已下載的結果放回去，colab_vllm.py 會跳過已完成的題目
進度寫在 out/colab/run/run.log（nmle-run-log）；Colab CLI 的每個指令另外記在 out/colab/commands.log。
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PY = str(ROOT / ".venv-gpu" / "Scripts" / "python.exe")
WORK = HERE / "out" / "colab"
RUN = WORK / "run"
STATE = RUN / "state.json"
LOG = RUN / "run.log"

POLL_SEC = 300          # 查狀態的間隔；也讓 Colab 知道執行環境還在用
DEADLINE_MIN = 1320     # Colab 上的保險時限（22 小時；Colab Pro 的單次上限約 24 小時，不保證）
GEN_MODEL = "qwen3.6:27b-fp8-v2"   # v2：10/21 改過提示詞（每個專有名詞都附英文）
OLD_MODEL = "qwen3.6:27b-fp8-vllm"
# 10/22：和參考詳解衝突、被截斷的題目換 seed 重新生成，結果先放在另一個資料夾，比對通過的再用 merge-regen 換進去
REGEN_MODEL = "qwen3.6:27b-fp8-v2-regen"


def batch(*args):
    return [PY, str(HERE / "colab_batch.py"), *args]


def terms(*args):
    return [PY, str(HERE / "terms.py"), *args]


# 每個階段：名稱（決定佇列順序）、需要先完成的階段、產生請求的指令與產出檔、下載後放到哪裡、整理結果的指令
STAGES = [
    {"name": "1_terms_test", "needs": [],
     "prepare": [terms("scan", "110020_1", "--model", OLD_MODEL, "--think"),
                 terms("prepare", "110020_1", "--model", OLD_MODEL, "--think")],
     "request": WORK / "terms_requests.jsonl", "result": WORK / "terms_results.jsonl",
     "collect": [terms("collect", "--model", OLD_MODEL, "--think")]},
    {"name": "2_gen", "needs": [],
     "prepare": [batch("prepare-gen", "all")],
     "request": WORK / "gen_requests.jsonl", "result": WORK / "gen_results.jsonl",
     "collect": [batch("collect-gen", "--model", GEN_MODEL, "--think")]},
    {"name": "3_check", "needs": ["2_gen"],
     "prepare": [batch("prepare", "all", "--model", GEN_MODEL, "--gen-think")],
     "request": WORK / "requests.jsonl", "result": WORK / "results.jsonl",
     "collect": [batch("collect", "--label", "vllm-27b-think")]},
    {"name": "4_terms", "needs": ["2_gen", "1_terms_test"],
     "prepare": [terms("scan", "all", "--model", GEN_MODEL, "--think"),
                 terms("prepare", "all", "--model", GEN_MODEL, "--think")],
     "request": WORK / "terms_requests.jsonl", "result": WORK / "terms_results.jsonl",
     "collect": [terms("collect", "--model", GEN_MODEL, "--think")]},
    {"name": "5_regen", "needs": ["3_check"],
     "prepare": [batch("prepare-regen", "--model", GEN_MODEL, "--label", "vllm-27b-think", "--seed", "2")],
     "request": WORK / "gen_requests.jsonl", "result": WORK / "gen_results.jsonl",
     "collect": [batch("collect-gen", "--model", REGEN_MODEL, "--think")]},
    {"name": "6_recheck", "needs": ["5_regen"],
     "prepare": [batch("prepare", "all", "--model", REGEN_MODEL, "--gen-think")],
     "request": WORK / "requests.jsonl", "result": WORK / "results.jsonl",
     "collect": [batch("collect", "--label", "vllm-27b-think")]},
    {"name": "7_reterms", "needs": ["5_regen"],
     "prepare": [terms("scan", "all", "--model", REGEN_MODEL, "--think"),
                 terms("prepare", "all", "--model", REGEN_MODEL, "--think")],
     "request": WORK / "terms_requests.jsonl", "result": WORK / "terms_results.jsonl",
     "collect": [terms("collect", "--model", REGEN_MODEL, "--think")]},
]


def log(msg):
    line = f"{time.strftime('%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def wsl_path(p):
    p = Path(p).resolve()
    return "/mnt/" + p.drive[0].lower() + p.as_posix()[2:]


def colab(*args, quiet=False, timeout=600):
    """經過 colab.sh 呼叫 Colab CLI（在 WSL 裡），回傳 (exit code, 輸出)。stdin 接 /dev/null，避免卡住等輸入。"""
    env = ["env", "NMLE_QUIET=1"] if quiet else []
    cmd = ["wsl", "-e", *env, "bash", wsl_path(HERE / "colab.sh"), *args]
    try:
        r = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "逾時"
    return r.returncode, (r.stdout + r.stderr).decode("utf-8", "replace")


def run_local(cmd):
    r = subprocess.run(cmd, capture_output=True, cwd=ROOT)
    out = (r.stdout + r.stderr).decode("utf-8", "replace").strip()
    log(f"  本機 {Path(cmd[1]).name} {' '.join(cmd[2:])}：{out.splitlines()[-1] if out else ''}")
    if r.returncode:
        raise RuntimeError(f"本機指令失敗：{' '.join(cmd)}\n{out}")


def load_state():
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}


def save_state(state):
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")


def session_alive():
    code, out = colab("sessions", quiet=True, timeout=120)
    return code == 0 and "nmle" in out and "No active sessions" not in out


def open_session(state):
    """排 A100（排不到每 5 分鐘再試，最多 6 小時），上傳程式並啟動。所有未完成的階段要重新放進佇列。"""
    for i in range(72):
        code, out = colab("new", "-s", "nmle", "--gpu", "A100")
        if "Session READY" in out:
            log(f"排到 A100（第 {i + 1} 次）")
            break
        log(f"A100 排不到（第 {i + 1} 次），5 分鐘後再試：{out.strip().splitlines()[-1] if out.strip() else code}")
        time.sleep(300)
    else:
        raise RuntimeError("6 小時都排不到 A100")
    for f in ("colab_vllm.py", "colab_setup.sh"):
        colab("upload", "-s", "nmle", wsl_path(HERE / f), f"/content/{f}")
    start_runner()
    for s in state.values():
        s["submitted"] = False


def start_runner():
    code, out = colab("exec", "-s", "nmle", "--timeout", "60", "--env", f"DEADLINE_MIN={DEADLINE_MIN}",
                      "-f", wsl_path(HERE / "colab_job.py"))
    log(f"啟動 Colab 上的程式：{out.strip().splitlines()[-1] if out.strip() else code}")


def status():
    code, out = colab("exec", "-s", "nmle", "--timeout", "60", "-f", wsl_path(HERE / "colab_status.py"),
                      quiet=True, timeout=180)
    for line in out.splitlines():
        if line.startswith("STATUS "):
            return json.loads(line[7:])
    log(f"查狀態失敗（{code}）：{out.strip()[-200:]}")
    return None


def submit(stage, s):
    """上傳請求檔；本機已有部分結果（上一台 VM 跑到一半）就先放回去，Colab 會接著做。"""
    name = stage["name"]
    req, out = RUN / f"{name}.req.jsonl", RUN / f"{name}.out.jsonl"
    colab("exec", "-s", "nmle", "--timeout", "60", "-f", wsl_path(HERE / "colab_mkdir.py"), quiet=True)
    if out.exists():
        colab("upload", "-s", "nmle", wsl_path(out), f"/content/results/{name}.jsonl")
    code, text = colab("upload", "-s", "nmle", wsl_path(req), f"/content/incoming/{name}.jsonl")
    if code:
        raise RuntimeError(f"上傳 {name} 失敗：{text}")
    s["submitted"] = True
    log(f"{name}：放進佇列（{sum(1 for _ in open(req, encoding='utf-8'))} 題"
        + (f"，帶著已完成的 {sum(1 for _ in open(out, encoding='utf-8'))} 筆" if out.exists() else "") + "）")


def download(name):
    tmp = RUN / f"{name}.out.tmp"
    code, text = colab("download", "-s", "nmle", f"/content/results/{name}.jsonl", wsl_path(tmp))
    if code or not tmp.exists():
        log(f"{name}：下載失敗，下次再試：{text.strip()[-150:]}")
        return False
    tmp.replace(RUN / f"{name}.out.jsonl")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    RUN.mkdir(parents=True, exist_ok=True)
    state = load_state()
    for st in STAGES:
        state.setdefault(st["name"], {"prepared": False, "submitted": False, "lines": 0, "done": False,
                                      "collected": False})
    if args.dry:
        print(json.dumps(state, ensure_ascii=False, indent=1))
        return
    log("===== 開始總控 =====")
    restarts = 0
    while not all(s["collected"] for s in state.values()):
        # 1. 前置階段都整理完的，在本機產生請求檔
        for st in STAGES:
            s = state[st["name"]]
            if not s["prepared"] and all(state[n]["collected"] for n in st["needs"]):
                log(f"{st['name']}：產生請求檔")
                for cmd in st["prepare"]:
                    run_local(cmd)
                shutil.copy(st["request"], RUN / f"{st['name']}.req.jsonl")
                s["prepared"] = True
                save_state(state)
        # 2. 確認 Colab 執行環境還在，不在就重開
        if not session_alive():
            log("沒有 Colab 執行環境，開一台")
            open_session(state)
            save_state(state)
        # 3. 還沒放進這台 VM 佇列的放進去
        for st in STAGES:
            s = state[st["name"]]
            if s["prepared"] and not s["done"] and not s["submitted"]:
                submit(st, s)
                save_state(state)
        # 4. 查狀態：有新結果就下載（紀錄點），做完的下載後在本機整理
        info = status()
        if info:
            for line in info["tail"][-1:]:
                log(f"  Colab：{line}")
            for st in STAGES:
                s, job = state[st["name"]], info["jobs"].get(st["name"])
                if not job or s["done"]:
                    continue
                if job["lines"] > s["lines"] or job["done"]:
                    if download(st["name"]):
                        s["lines"] = job["lines"]
                        log(f"{st['name']}：已下載 {job['lines']} 筆")
                        if job["done"]:
                            s["done"] = True
                save_state(state)
            pending = [n for n, s in state.items() if s["prepared"] and not s["done"]]
            if pending and not info["alive"]:
                restarts += 1
                if restarts > 3:
                    raise RuntimeError("Colab 上的程式已重新啟動 3 次還是停掉，看 vllm.log")
                log(f"Colab 上的程式停了，重新啟動（第 {restarts} 次）")
                start_runner()
        # 5. 下載完的在本機整理
        for st in STAGES:
            s = state[st["name"]]
            if s["done"] and not s["collected"]:
                shutil.copy(RUN / f"{st['name']}.out.jsonl", st["result"])
                log(f"{st['name']}：整理結果")
                for cmd in st["collect"]:
                    run_local(cmd)
                s["collected"] = True
                save_state(state)
        # 有階段剛好可以產生請求（前置剛整理完）就馬上進下一輪，否則等一下再查
        ready = any(not state[st["name"]]["prepared"] and all(state[n]["collected"] for n in st["needs"])
                    for st in STAGES)
        if not ready and not all(s["collected"] for s in state.values()):
            time.sleep(POLL_SEC)
    log("全部完成，下載 log 並關機")
    colab("download", "-s", "nmle", "/content/vllm.log", wsl_path(RUN / "vllm.log"))
    colab("stop", "-s", "nmle")
    log(colab("sessions")[1].strip())
    log(colab("usage")[1].strip())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except Exception as e:
        # 出錯就不再自動處理；Colab 那邊有保險（程式停 20 分鐘或到時限會自己釋放）
        log(f"總控停止：{type(e).__name__}: {e}")
        raise
