# Compatibility entry point for existing Windows scheduled tasks.
& (Join-Path $PSScriptRoot "scripts/update-current-affairs.ps1") @args
