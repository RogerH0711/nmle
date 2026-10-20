# 即時看 Claude（或自己）下過的 Colab CLI 指令和輸出（Ctrl+C 離開）。
# 用法：nmle-colab-log      或  .\pipeline\explain\watch-colab.ps1
param([int]$Tail = 40)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$log = Join-Path $PSScriptRoot "out\colab\commands.log"
if (-not (Test-Path $log)) { New-Item -ItemType File -Force $log | Out-Null }
Get-Content $log -Wait -Tail $Tail -Encoding UTF8
