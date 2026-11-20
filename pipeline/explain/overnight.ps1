# 長時間的詳解批次。由工作排程器啟動：Start-ScheduledTask -TaskName "NMLE 詳解批次"
# 不屬於任何終端機，關掉 VS Code、Claude 或 SSH 都不會中斷；進度看 watch.ps1（或 nmle-log）。
# 排程怎麼建的見 pipeline/explain/README.md。中途停：Stop-ScheduledTask -TaskName "NMLE 詳解批次"，
# 之後重新開始會接著做，已經完成的題目不會重跑。
#
# 11/20：105–109 年 18 份考卷的詳解，本機 3070 跑 qwen3.5:35b-a3b 開 thinking（每題約 3.5 分鐘，全部約 4.5 天）。
# 原本用 qwen3.6:27b（和 110–115 年同一個模型），本機每題 12–19 分鐘、要 18 天，Roger 決定改用 35B；
# 兩者的比較見 docs/design.md「詳解與題目正確率」。提示詞同一套（generate.py 的 SYSTEM）。
# 次主題分類 11/20 上午跑完；之後補了 4 科的範圍說明，詳解跑完後 classify.py 只重分改到的學科（約 1,800 題、70 分鐘）。
# 跑之前：ROG 切到極速模式、螢幕不要關（電源設定），Docker Desktop 沒在用就關掉騰出記憶體。
# 學生詳解只有 110–115 年，這批不比對（網站標「未經比對」）；名詞檢查、export_web.py 之後另外跑。

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$py = ".venv-gpu\Scripts\python.exe"
$model = "qwen3.5:35b-a3b"

# Ollama 的模型如果已經載入（llama-server），它佔的記憶體也算可用，不然會誤報
$ollamaGB = ((Get-Process llama-server -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum) / 1GB
$freeGB = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB + $ollamaGB, 1)
if ($freeGB -lt 18) { Write-Host "警告：可用記憶體只有 $freeGB GB，35B 可能跑不動，先關掉 Docker Desktop" }

# 105–109 年的詳解（被截斷的題目 generate.py 會自動換 seed 重試）
$exams = @(
  "109100_1", "109100_2", "109020_1", "109020_2",
  "108100_1", "108100_2", "108030_1", "108030_2",
  "107100_1", "107100_2", "107020_1", "107020_2",
  "106100_1", "106100_2", "106020_1", "106020_2",
  "105020_1", "105020_2"
)
& $py pipeline\explain\generate.py @exams --model $model --think

# 次主題分類（獨立一步，不看詳解）：分類表改過的學科重分，再匯出 data/subtopics.json
& $py pipeline\explain\classify.py run all
& $py pipeline\explain\classify.py export
