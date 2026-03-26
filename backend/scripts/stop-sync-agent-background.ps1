param()

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir
$pidFile = Join-Path $backendDir ".sync-agent.pid"

function Stop-AgentProcess {
  param([int]$AgentPid)

  if (-not $AgentPid) { return $false }

  try {
    $process = Get-Process -Id $AgentPid -ErrorAction Stop
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
    Write-Output "stopped:$($process.Id)"
    return $true
  } catch {
    return $false
  }
}

$stopped = $false

if (Test-Path $pidFile) {
  $existingPid = 0
  try {
    $existingPid = [int](Get-Content -Path $pidFile -Raw).Trim()
  } catch {
    $existingPid = 0
  }

  $stopped = Stop-AgentProcess -AgentPid $existingPid
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not $stopped) {
  try {
    $candidates = Get-CimInstance Win32_Process | Where-Object {
      $_.Name -match "^node(\.exe)?$" -and $_.CommandLine -match "folder-sync-agent\.js"
    }
  } catch {
    $candidates = @()
  }

  foreach ($candidate in $candidates) {
    $result = Stop-AgentProcess -AgentPid ([int]$candidate.ProcessId)
    if ($result) {
      $stopped = $true
    }
  }
}

if (-not $stopped) {
  Write-Output "not-running"
}
