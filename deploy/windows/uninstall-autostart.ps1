<#
.SYNOPSIS
    Remove the "FileNexus-Docker" scheduled task. Run from an Administrator PowerShell.
#>

$ErrorActionPreference = 'Stop'
$TaskName = 'FileNexus-Docker'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task '$TaskName' removed." -ForegroundColor Green
} else {
    Write-Host "Task '$TaskName' not found." -ForegroundColor Yellow
}
