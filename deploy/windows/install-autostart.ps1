<#
.SYNOPSIS
    Register the "FileNexus-Docker" scheduled task that starts the backend at boot.

.DESCRIPTION
    Run once from an elevated (Administrator) PowerShell. The task runs
    start-filenexus.ps1 at system startup as the given Windows account,
    whether or not anyone is logged on, and retries on failure. Windows asks
    for that account's password once to store the credentials for the task.
#>

$ErrorActionPreference = 'Stop'

$TaskName = 'FileNexus-Docker'
$StartScript = Join-Path $PSScriptRoot 'start-filenexus.ps1'

$principalCheck = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Please run this script from an Administrator PowerShell.'
}
if (-not (Test-Path $StartScript)) {
    throw "Start script not found: $StartScript"
}

$credential = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" `
    -Message 'Password of the Windows account that runs Docker Desktop (needed to run without login)'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$StartScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT1M'   # give networking/WSL a minute after boot
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Replacing existing task '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Description 'Start Docker Desktop and the FileNexus backend at boot' `
    -Action $action -Trigger $trigger -Settings $settings `
    -User $credential.UserName -Password $credential.GetNetworkCredential().Password `
    -RunLevel Highest | Out-Null

Write-Host "Task '$TaskName' registered (runs at startup, with or without login)." -ForegroundColor Green
Write-Host "Test now with:  Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Cyan
Write-Host "Log file:       $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'logs\autostart.log')" -ForegroundColor Cyan
