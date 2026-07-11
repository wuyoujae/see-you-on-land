$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = (Get-Command python -ErrorAction Stop).Source
$Log = Join-Path $Root "current-affairs-update.log"

Set-Location -LiteralPath $Root
& $Python (Join-Path $Root "update_current_affairs.py") --backfill 2>&1 |
  Tee-Object -FilePath $Log -Append
& $Python (Join-Path $Root "update_current_affairs.py") --force 2>&1 |
  Tee-Object -FilePath $Log -Append
