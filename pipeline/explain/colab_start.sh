#!/bin/bash
# 排 A100（排不到每 5 分鐘再試，最多 3 小時）→ 上傳 → 在背景安裝 vLLM 並開始跑。在 WSL 執行：
#   bash pipeline/explain/colab_start.sh <本機請求檔> <Colab 上的輸出檔名> <保險時限（分鐘）>
#   bash pipeline/explain/colab_start.sh pipeline/explain/out/colab/gen_requests.jsonl gen_vllm.jsonl 150
# 排到之後就開始計費；跑完用 colab_finish.sh 下載並關機。保險時限到了 Colab 會自己關機（未下載的結果會消失）。
set -e
cd "$(dirname "$0")"
C=./colab.sh
req="$1"; out="$2"; deadline="${3:-150}"
[[ -f "$OLDPWD/$req" ]] && req="$OLDPWD/$req"
[[ -f "$req" ]] || { echo "找不到請求檔 $req"; exit 1; }

for i in $(seq 1 36); do
  if bash $C new -s nmle --gpu A100 2>&1 | grep -q "Session READY"; then
    echo "$(date +%H:%M) 第 $i 次排到 A100"
    for f in "$req:/content/$(basename "$req")" colab_vllm.py:/content/colab_vllm.py \
             colab_setup.sh:/content/colab_setup.sh; do
      bash $C upload -s nmle "${f%%:*}" "${f#*:}"
    done
    bash $C exec -s nmle --timeout 60 --env "JOB_INPUT=$(basename "$req")" --env "JOB_OUTPUT=$out" \
      --env "DEADLINE_MIN=$deadline" -f colab_job.py
    exit 0
  fi
  echo "$(date +%H:%M) 第 $i 次：A100 排不到，5 分鐘後再試"
  sleep 300
done
echo "3 小時都排不到，停止嘗試"
exit 1
