# 看 Colab 總控（colab_run.py）的進度（Ctrl+C 離開，不會中斷總控）。
# 用法：nmle-run-log      或  .\pipeline\explain\watch-run.ps1
# 從 Mac：ssh rog "powershell -NoProfile -File C:\Users\USER\NMLE\pipeline\explain\watch-run.ps1"
param([int]$Tail = 30)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$log = Join-Path $PSScriptRoot "out\colab\run\run.log"
if (-not (Test-Path $log)) { New-Item -ItemType File -Force $log | Out-Null }
$task = Get-ScheduledTask -TaskName "NMLE Colab 總控" -ErrorAction SilentlyContinue
if ($task) { Write-Host "總控排程狀態：$($task.State)" }
Get-Content $log -Wait -Tail $Tail -Encoding UTF8