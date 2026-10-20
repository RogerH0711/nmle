# 10/20 晚上的批次：先測 thinking 能不能提高正確率，再把全部考卷生成一次。
# 用法（先關掉 Docker）：Start-ScheduledTask -TaskName "NMLE 詳解批次"
# 由工作排程器啟動，不屬於任何終端機，關掉 VS Code、Claude 或 SSH 都不會中斷；進度看 watch.ps1。
# 排程怎麼建的見 pipeline/explain/README.md。

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$py = ".venv-gpu\Scripts\python.exe"
$model = "qwen3.5:35b-a3b"

# 35B 有四分之三放在系統記憶體，Docker／WSL 開著會不夠
# Ollama 的模型如果已經載入（llama-server），它佔的記憶體也算可用，不然會誤報
$ollamaGB = ((Get-Process llama-server -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum) / 1GB
$freeGB = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB + $ollamaGB, 1)
if ($freeGB -lt 14) { Write-Host "警告：可用記憶體只有 $freeGB GB，35B 可能跑不動，先關掉 Docker Desktop" }

# 1. 比對開 thinking：同樣 20 題，看能不能抓到 #4、#5 這種漏掉的錯
& $py pipeline\explain\check.py 110020_1 --limit 20 --model $model --judge $model --think
# 2. 生成開 thinking：同樣 20 題，看錯誤會不會變少
& $py pipeline\explain\generate.py 110020_1 --limit 20 --model $model --think
# 3. 用同一套比對（不開 thinking）比對第 2 步的產出，方便和原本那批比較
& $py pipeline\explain\check.py 110020_1 --limit 20 --model $model --gen-think --judge $model
# 4. 全部考卷生成（不開 thinking，約 7–8 小時）；明天依上面的結果決定要不要改用 thinking 重跑
& $py pipeline\explain\generate.py all --model $model
