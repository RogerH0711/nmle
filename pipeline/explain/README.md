# 詳解生成與比對

用家裡 3070 筆電上的本地模型生成詳解，再和學生編寫的詳解比對結論。做法、界線和試跑結果見 `docs/design.md`「詳解與題目正確率」。

- 模型：Windows 版 Ollama，`qwen3.5:35b-a3b`（約 22 GB，四分之三放在系統記憶體，**跑之前要關掉 Docker Desktop**）。
- Python：`.venv-gpu`（只在 3070 筆電上，需要 `opencc`）。
- 學生詳解：`NMLE_DE/`，產出：`pipeline/explain/out/`，兩者都不進 repo。

## 常用指令（在專案根目錄的 PowerShell）

看進度（Ctrl+C 離開，不會中斷批次）：

```powershell
nmle-log                              # profile 裡設好的簡寫
.\pipeline\explain\watch.ps1          # 沒有簡寫時
```

從 Mac 遠端看進度：

```bash
ssh rog "powershell -NoProfile -File C:\Users\USER\NMLE\pipeline\explain\watch.ps1"
```

開始批次（由工作排程器啟動，關掉 VS Code、Claude 或 SSH 都不會中斷）：

```powershell
Start-ScheduledTask -TaskName "NMLE 詳解批次"      # Windows
ssh rog 'schtasks /run /tn "NMLE 詳解批次"'          # 從 Mac
```

中途要停：`Stop-ScheduledTask -TaskName "NMLE 詳解批次"`（Mac：`ssh rog 'schtasks /end /tn "NMLE 詳解批次"'`）。之後重新開始會接著做，已經完成的題目不會重跑。

## Ollama 與工作排程（10/20 設定）

Windows 版 Ollama 程式（系統匣那個）在這台電腦上起不了伺服器，所以改用工作排程器直接跑 `ollama serve`：

- 「NMLE Ollama」：登入時自動執行 `ollama.exe serve`。沒在跑時用 `Start-ScheduledTask -TaskName "NMLE Ollama"` 啟動。
- 「NMLE 詳解批次」：執行 `overnight.ps1`，只會手動啟動。
- Ollama 程式的開機捷徑移到了 `shell:startup\已停用\`：它啟動時會關掉已經在跑的 Ollama，會和排程衝突。
- 移除：`Unregister-ScheduledTask -TaskName "NMLE*" -Confirm:$false`，再把捷徑移回 `shell:startup`。

## Colab（A100）

Colab CLI 只支援 Linux／macOS，這台電腦上裝在 WSL（`uv tool install google-colab-cli`），登入用 `colab usage` 觸發、照提示貼授權碼。指令一律經過 `colab.sh`，它會把時間、指令和輸出記到 `out/colab/commands.log`：

```powershell
nmle-colab-log                         # 即時看 Claude 下了哪些 Colab 指令（Windows）
```

### 用 vLLM 跑一整批（總控，10/21 起）

模型 `Qwen/Qwen3.6-27B-FP8`，安裝寫在 `colab_setup.sh`，記憶體與取樣設定在 `colab_vllm.py`，由來見 `docs/design.md`。
開一次 A100、模型只載入一次，依序跑完 `colab_run.py` 裡 `STAGES` 列的階段（目前：名詞判斷測試 → 全部生成 → 比對＋名詞判斷）：

```powershell
Start-ScheduledTask -TaskName "NMLE Colab 總控"     # 開始；Mac：ssh rog 'schtasks /run /tn "NMLE Colab 總控"'
nmle-run-log                                        # 看進度；Mac：ssh rog "powershell -NoProfile -File C:\Users\USER\NMLE\pipeline\explain\watch-run.ps1"
& .venv-gpu\Scripts\python.exe pipeline\explain\colab_run.py --dry   # 各階段狀態
```

- 分工：本機 `colab_run.py`（工作排程器啟動，關掉 VS Code 或 Claude 都不影響）產生請求、上傳、每 5 分鐘查一次狀態並下載新結果；Colab 上 `colab_job.py` 啟動佇列模式的 `colab_vllm.py`，`colab_status.py` 回報狀態。
- 紀錄點：Colab 每 200 題寫檔，本機發現有新結果就下載到 `out/colab/run/<階段>.out.jsonl`，各階段進度記在 `out/colab/run/state.json`。總控中斷後重新啟動會接著做；Colab 執行環境不見了會重開一台，把已下載的結果放回去續跑。
- 保險：Colab 上的程式佇列空了 30 分鐘會自己結束，結束後 20 分鐘沒人重新啟動就釋放執行環境；開機滿 22 小時也會釋放。
- 要中途停：`Stop-ScheduledTask -TaskName "NMLE Colab 總控"`，再手動 `colab stop`（見下方）。只停總控的話，Colab 會照上面的保險自己關，但正在跑的階段會先跑完、結果沒人下載。
- 要重跑某個階段：改 `state.json` 裡那個階段的欄位，或刪掉整個 `out/colab/run/` 從頭來。

### 手動操作

`C=pipeline/explain/colab.sh`：

```bash
bash $C usage                              # 餘額與目前每小時扣多少（開著機器時 A100 約 5.3/hr）
bash $C new -s nmle --gpu A100             # 開機器，從這裡開始計費；--high-mem 常常排不到
bash $C upload -s nmle 本機檔案 /content/檔名
bash $C exec -s nmle --timeout 60 -f 某個.py  # 在 Colab 上執行 Python；長時間的工作要在裡面用 nohup 背景跑
bash $C download -s nmle /content/結果 本機路徑
bash $C stop -s nmle                       # 一定要關，不然閒置也一直扣
bash $C sessions                           # 確認沒有忘了關的機器
```

10/20 實測：A100 分到的是 40GB（放不下 Qwen 3.5 35B 的 FP8 版）；Ollama 對 Qwen 3.5／3.6 架構不支援同時處理多題（log：`model architecture does not currently support parallel requests`），只能一題一題跑，所以改用 vLLM。

## 各支腳本

```powershell
$py = ".venv-gpu\Scripts\python.exe"
& $py pipeline\explain\split_reference.py                     # 學生詳解切成一題一段（NMLE_DE 有更新時重跑）
& $py pipeline\explain\generate.py 110020_1 --model qwen3.5:35b-a3b          # 生成一份考卷
& $py pipeline\explain\generate.py all --model qwen3.5:35b-a3b               # 生成全部
& $py pipeline\explain\generate.py 110020_1 --model qwen3.5:35b-a3b --redo 4 5  # 重新生成指定題號
& $py pipeline\explain\check.py all --model qwen3.5:35b-a3b --judge qwen3.5:35b-a3b  # 比對
```

`--limit N` 只跑前 N 題；`--think` 開 thinking（生成的產出放在 `out/<模型>-think/`，比對時要加 `--gen-think`）。
