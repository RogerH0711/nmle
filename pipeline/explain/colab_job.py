"""在 Colab notebook kernel 裡執行（colab exec -f），在背景安裝 vLLM 並跑 colab_vllm.py。

用 colab exec 的 --env 傳參數：
    JOB_INPUT=gen_requests.jsonl  JOB_OUTPUT=gen_vllm.jsonl  DEADLINE_MIN=150

保險：開機滿 DEADLINE_MIN 分鐘就自己釋放執行環境，避免 Claude 斷線時一直扣運算單元。
時限到時還沒下載的結果會跟著消失，所以要估得比工作時間長（2,399 題生成約 7 小時，設 540）。
進度寫在 /content/vllm.log；跑完會在最後一行寫 JOB_DONE。
"""
import os
import subprocess
import threading
import time

inp = os.environ.get("JOB_INPUT", "gen_requests.jsonl")
out = os.environ.get("JOB_OUTPUT", "gen_vllm.jsonl")
deadline = int(os.environ.get("DEADLINE_MIN", "150"))
model = os.environ.get("JOB_MODEL", "Qwen/Qwen3.6-27B-FP8")

script = f"""
cd /content
[ -x /content/venv/bin/python ] || bash colab_setup.sh
export PATH=/content/venv/bin:$PATH
python colab_vllm.py --model {model} --input {inp} --output {out}
echo JOB_DONE
"""
open("/content/job.sh", "w").write(script)
subprocess.Popen("nohup bash /content/job.sh >> /content/vllm.log 2>&1 &", shell=True)


def watchdog():
    time.sleep(deadline * 60)
    with open("/content/vllm.log", "a") as f:
        f.write(f"\nWATCHDOG：開機滿 {deadline} 分鐘，自動釋放執行環境\n")
    from google.colab import runtime
    runtime.unassign()


# 執行緒留在 notebook kernel 裡，exec 結束後仍會繼續計時
threading.Thread(target=watchdog, daemon=True).start()
print(f"started：{inp} → {out}，{deadline} 分鐘後自動釋放")
