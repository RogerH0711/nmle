#!/bin/bash
# Colab CLI 的包裝：照常執行 colab，同時把「時間、指令、輸出」記到 out/colab/commands.log，
# 讓 Roger 可以即時看到正在做什麼（nmle-colab-log）。在 WSL 裡執行：
#   bash pipeline/explain/colab.sh usage
#   bash pipeline/explain/colab.sh exec -s nmle -f 某個.py      # .py 開頭的 BOM 會自動拿掉
# NMLE_QUIET=1：不把 -f 檔案的內容記進 log（colab_run.py 每幾分鐘查一次狀態，內容都一樣）
source ~/.local/bin/env
LOG="$(dirname "$0")/out/colab/commands.log"
mkdir -p "$(dirname "$LOG")"

args=("$@")
# Windows 的工具常在檔案開頭加 BOM，Colab 的 Python 會因此報錯，exec -f 前先去掉
for i in "${!args[@]}"; do
  if [[ "${args[$i]}" == "-f" && "${args[$((i+1))]}" == *.py ]]; then
    tmp=$(mktemp --suffix=.py)
    sed '1s/^\xEF\xBB\xBF//' "${args[$((i+1))]}" > "$tmp"
    shown="${args[$((i+1))]}"
    args[$((i+1))]="$tmp"
  fi
done

{
  echo ""
  echo "===== $(date '+%m-%d %H:%M:%S')  colab $*"
  if [[ -n "$shown" && -z "$NMLE_QUIET" ]]; then echo "----- $shown 的內容："; sed '1s/^\xEF\xBB\xBF//' "$shown"; echo "-----"; fi
} >> "$LOG"
COLUMNS=150 colab "${args[@]}" 2>&1 | tee -a "$LOG"
status=${PIPESTATUS[0]}
[[ -n "$tmp" ]] && rm -f "$tmp"
exit $status
