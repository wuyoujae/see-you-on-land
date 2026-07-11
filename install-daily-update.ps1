$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $Root "update-current-affairs.ps1"
$TaskName = "SummerPoliticsDailyUpdate"
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`"" `
  -WorkingDirectory $Root
$Triggers = 6..23 | ForEach-Object {
  New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($_))
}

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Triggers `
  -Settings $Settings `
  -Force | Out-Null

Write-Output "Installed scheduled task: $TaskName (hourly from 06:00 to 23:00)."
