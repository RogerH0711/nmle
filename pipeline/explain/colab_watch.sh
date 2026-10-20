#!/bin/bash
# 每 60 秒看一次 Colab 上的 /content/vllm.log，只在出現新的關鍵行時輸出；
# JOB_DONE、保險時限到、出錯或機器不見了就結束。給 Claude 的 Monitor 用，也可以自己在 WSL 跑。
source ~/.local/bin/env
prev=""
while true; do
  out=$(echo 'import subprocess; print(subprocess.run("grep -aE \"INSTALL_DONE|^共 [0-9]+ 題|載入完成|已完成 [0-9]+/|重跑被截斷|^完成，|JOB_DONE|WATCHDOG|Traceback|out of memory|Error:\" /content/vllm.log | tail -3 | cut -c1-200", shell=True, capture_output=True, text=True).stdout)' | colab exec -s nmle --timeout 60 2>&1)
  if echo "$out" | grep -qiE "no active session|session .* not found"; then echo "$(date +%H:%M) 找不到 Colab session"; exit 1; fi
  if [[ "$out" != "$prev" ]]; then echo "$(date +%H:%M) $(echo "$out" | tail -1)"; prev="$out"; fi
  if echo "$out" | grep -qE "JOB_DONE|WATCHDOG|Traceback|out of memory"; then exit 0; fi
  sleep 60
done
