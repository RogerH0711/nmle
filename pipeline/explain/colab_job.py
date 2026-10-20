"""在 Colab notebook kernel 裡執行（colab exec -f），在背景安裝 vLLM 並啟動佇列模式的 colab_vllm.py。

用 colab exec 的 --env 傳參數：DEADLINE_MIN=1200（保險時限，分鐘）、JOB_MODEL（預設 Qwen/Qwen3.6-27B-FP8）。
可以重複執行：程式還在跑就不會再開一個（本機 colab_run.py 發現程式停了會再呼叫一次）。

保險（避免本機或 Claude 斷線時一直扣運算單元）：
- 開機滿 DEADLINE_MIN 分鐘就釋放執行環境
- colab_vllm.py 停了（佇列空了自己結束，或出錯）超過 GRACE_MIN 分鐘沒人重新啟動，也釋放
結果每批都會被本機下載，釋放時最多損失最後一批還沒下載的部分。進度寫在 /content/vllm.log。
"""
import builtins
import os
import subprocess
import threading
import time

deadline = int(os.environ.get("DEADLINE_MIN", "150"))
grace = int(os.environ.get("GRACE_MIN", "20"))
model = os.environ.get("JOB_MODEL", "Qwen/Qwen3.6-27B-FP8")

script = f"""
cd /content
[ -x /content/venv/bin/python ] || bash colab_setup.sh || {{ echo SETUP_FAILED; exit 1; }}
export PATH=/content/venv/bin:$PATH
python colab_vllm.py --model {model} --queue /content/queue --results /content/results
echo RUNNER_EXIT $?
"""


def alive():
    """用行程名稱判斷（安裝中或 colab_vllm.py 在跑都算），kernel 重啟過也不會重複啟動。"""
    return subprocess.run(["pgrep", "-f", "bash /content/job.sh"], capture_output=True).returncode == 0


state = getattr(builtins, "_nmle", None)
if state is None:
    state = builtins._nmle = {"proc": None, "start": time.time(), "deadline": deadline}
state["deadline"] = deadline

if alive():
    print("程式還在跑，不重複啟動")
else:
    open("/content/job.sh", "w").write(script)
    state["proc"] = subprocess.Popen(["bash", "/content/job.sh"], stdout=open("/content/vllm.log", "a"),
                                     stderr=subprocess.STDOUT, start_new_session=True)
    print(f"started pid {state['proc'].pid}")


def release(reason):
    with open("/content/vllm.log", "a") as f:
        f.write(f"\nWATCHDOG：{reason}，自動釋放執行環境\n")
    from google.colab import runtime
    runtime.unassign()


def watchdog():
    stopped_since = None
    while True:
        time.sleep(60)
        if time.time() - state["start"] > state["deadline"] * 60:
            return release(f"開機滿 {state['deadline']} 分鐘")
        if alive():
            stopped_since = None
        else:
            stopped_since = stopped_since or time.time()
            if time.time() - stopped_since > grace * 60:
                return release(f"程式停了 {grace} 分鐘沒有重新啟動")


# 執行緒留在 notebook kernel 裡，exec 結束後仍會繼續；只開一個
if not state.get("watchdog"):
    state["watchdog"] = True
    threading.Thread(target=watchdog, daemon=True).start()
print(f"保險時限 {state['deadline']} 分鐘（從第一次啟動算），程式停止 {grace} 分鐘後釋放")
