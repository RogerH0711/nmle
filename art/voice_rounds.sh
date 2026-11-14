#!/usr/bin/env bash
# 配音量產：每輪每句多念 6 次、辨識，還不完美（念錯率不是 0 或多停）的下一輪再念，最多 ROUNDS 輪，最後匯出。
# 在 Windows 的 Git Bash 執行（BreezyVoice 透過 wsl 跑）：
#   bash art/voice_rounds.sh fei B_s1
# 已經念過、辨識過的不重做，中斷後重跑同一行會接著做。一次念約 9 秒（3070 Laptop），第一輪 64 句約 1 小時。
set -euo pipefail
cd "$(dirname "$0")/.."
cid=$1 ref=$2 tag=final ROUNDS=${ROUNDS:-4} PER=6
for ((r = 1; r <= ROUNDS; r++)); do
  if ((r == 1)); then
    lines=(--all)
  else
    todo=$(art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_export.py "$cid" "$ref-$tag" --todo)
    [[ -z $todo ]] && break
    lines=(--lines $todo)
  fi
  echo "== 第 $r 輪：${lines[*]}"
  wsl -e bash -lc "cd /mnt/c/Users/USER/NMLE && ~/code/BreezyVoice/.venv/bin/python art/voice_breezy.py $cid $ref --tag $tag --takes $((PER * r)) ${lines[*]} 2>&1 | grep -E '^[0-9]+/|Error|Traceback' || true"
  .venv-tts/Scripts/python.exe -X utf8 art/voice_check.py breezy > art/bakeoff/voice/breezy/check.log 2>&1
done
art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_export.py "$cid" "$ref-$tag"
