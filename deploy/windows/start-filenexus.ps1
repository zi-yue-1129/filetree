<#
.SYNOPSIS
    Start Docker Desktop and the FileNexus backend at boot (no interactive login needed).

.DESCRIPTION
    Run by the "FileNexus-Docker" scheduled task (see install-autostart.ps1).
    1. Starts Docker Desktop if it is not already running.
    2. Waits (bounded) until the Docker engine answers.
    3. Runs `docker compose up -d` in the repository root.
    Every step is logged to <repo>\logs\autostart.log. Exits non-zero on failure
    so Task Scheduler records the error and can retry.
#>

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LogDir = Join-Path $RepoRoot 'logs'
$LogFile = Join-Path $LogDir 'autostart.log'
$DockerDesktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$DockerCli = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$EngineWaitSeconds = 300

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
    <#
    .SYNOPSIS
        Append a timestamped line to the autostart log.
    .PARAMETER Message
        Text to record.
    #>
    param([Parameter(Mandatory = $true)][string]$Message)
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Test-DockerEngine {
    <#
    .SYNOPSIS
        Return $true when the Docker engine responds to `docker info`.
    #>
    # Windows PowerShell 5.1 turns native stderr into terminating errors when
    # $ErrorActionPreference is 'Stop'; judge success by the exit code instead.
    $ErrorActionPreference = 'Continue'
    $null = & $DockerCli info --format '{{.ServerVersion}}' 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Invoke-ComposeUp {
    <#
    .SYNOPSIS
        Run `docker compose up -d` in the repository root.
    .OUTPUTS
        Hashtable with ExitCode and Output (compose writes progress to stderr).
    #>
    $ErrorActionPreference = 'Continue'
    Push-Location $RepoRoot
    try {
        $output = & $DockerCli compose up -d 2>&1 | Out-String
        return @{ ExitCode = $LASTEXITCODE; Output = $output }
    } finally {
        Pop-Location
    }
}

try {
    Write-Log "=== Autostart begin (user: $env:USERNAME, repo: $RepoRoot) ==="

    if (-not (Test-Path $DockerCli)) {
        throw "Docker CLI not found at $DockerCli"
    }

    if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        if (-not (Test-Path $DockerDesktopExe)) {
            throw "Docker Desktop not found at $DockerDesktopExe"
        }
        Write-Log 'Starting Docker Desktop...'
        Start-Process -FilePath $DockerDesktopExe
    } else {
        Write-Log 'Docker Desktop already running.'
    }

    $deadline = (Get-Date).AddSeconds($EngineWaitSeconds)
    while (-not (Test-DockerEngine)) {
        if ((Get-Date) -gt $deadline) {
            throw "Docker engine did not become ready within $EngineWaitSeconds seconds"
        }
        Start-Sleep -Seconds 5
    }
    Write-Log 'Docker engine is ready.'

    $compose = Invoke-ComposeUp
    Write-Log ("docker compose up -d (exit $($compose.ExitCode)):`r`n" + $compose.Output.Trim())
    if ($compose.ExitCode -ne 0) {
        throw "docker compose up -d failed with exit code $($compose.ExitCode)"
    }

    Write-Log '=== Autostart finished OK ==='
    exit 0
} catch {
    Write-Log ("ERROR: " + $_.Exception.Message)
    exit 1
}
