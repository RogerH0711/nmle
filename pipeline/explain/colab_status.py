"""在 Colab notebook kernel 裡執行（colab exec -f），由本機 colab_run.py 每幾分鐘呼叫一次。

1. 把上傳完成的 /content/incoming/*.jsonl 移進佇列（直接上傳到佇列，colab_vllm.py 可能讀到傳一半的檔）
2. 印一行 STATUS {...}：程式是否還在跑、每個工作的結果行數與是否完成、log 最後幾行重點
定期呼叫也讓 Colab 知道這個執行環境還在用，不會因為閒置被收回。
"""
import glob
import json
import os
import shutil
import subprocess

os.makedirs("/content/queue", exist_ok=True)
os.makedirs("/content/results", exist_ok=True)
for p in glob.glob("/content/incoming/*.jsonl"):
    shutil.move(p, os.path.join("/content/queue", os.path.basename(p)))

# 用行程名稱判斷，不靠 kernel 裡的變數（kernel 重啟後變數就沒了，但背景程式可能還在跑）
alive = subprocess.run(["pgrep", "-f", "bash /content/job.sh"], capture_output=True).returncode == 0
jobs = {}
for p in sorted(glob.glob("/content/queue/*.jsonl")):
    name = os.path.basename(p)[:-6]
    out = f"/content/results/{name}.jsonl"
    lines = sum(1 for _ in open(out, encoding="utf-8")) if os.path.exists(out) else 0
    jobs[name] = {"lines": lines, "done": os.path.exists(f"/content/results/{name}.done")}
tail = subprocess.run(
    "grep -aE 'INSTALL_DONE|SETUP_FAILED|載入|開始 |已完成 [0-9]+/|重跑被截斷|JOB_DONE|QUEUE_IDLE_EXIT|RUNNER_EXIT|WATCHDOG|Traceback|Error|out of memory' "
    "/content/vllm.log | tail -4 | cut -c1-200", shell=True, capture_output=True, text=True).stdout.strip().splitlines()
print("STATUS " + json.dumps({"alive": alive, "jobs": jobs, "tail": tail},
                             ensure_ascii=False))
