#!/bin/bash
# 下載結果、關機、確認沒有還在計費的機器。在 WSL 執行：
#   bash pipeline/explain/colab_finish.sh <Colab 上的輸出檔名> <本機存放路徑>
#   bash pipeline/explain/colab_finish.sh gen_vllm.jsonl pipeline/explain/out/colab/gen_results.jsonl
# 下載失敗就不關機（避免結果跟著消失），先處理下載的問題。
cd "$(dirname "$0")"
C=./colab.sh
dest="$2"; [[ "$dest" == /* ]] || dest="$OLDPWD/$dest"
bash $C download -s nmle "/content/$1" "$dest" || { echo "下載失敗，沒有關機"; exit 1; }
bash $C download -s nmle /content/vllm.log "${dest%.jsonl}.log" || true
bash $C stop -s nmle
bash $C sessions
bash $C usage
