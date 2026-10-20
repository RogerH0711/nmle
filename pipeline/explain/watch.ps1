# 即時看詳解批次的進度（Ctrl+C 離開）。
# 用法：.\pipeline\explain\watch.ps1        或在 profile 設好後直接打 nmle-log
param([int]$Tail = 20)

# Windows PowerShell 5.1 預設用 Big5 讀檔、輸出，log 是 UTF-8，兩邊都要指定
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$log = Join-Path $PSScriptRoot "out\progress.log"
if (-not (Test-Path $log)) { Write-Host "還沒有 log：$log"; exit }
Get-Content $log -Wait -Tail $Tail -Encoding UTF8
