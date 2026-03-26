param()

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir
$pidFile = Join-Path $backendDir ".sync-agent.pid"
$logFile = Join-Path $backendDir ".sync-agent.log"
$errFile = Join-Path $backendDir ".sync-agent.err.log"

$agentPid = 0
if (Test-Path $pidFile) {
  try {
    $agentPid = [int](Get-Content -Path $pidFile -Raw).Trim()
  } catch {
    $agentPid = 0
  }
}

$process = $null
if ($agentPid) {
  try {
    $process = Get-Process -Id $agentPid -ErrorAction Stop
  } catch {
    $process = $null
  }
}

if ($process) {
  Write-Output "status:running"
  Write-Output "pid:$($process.Id)"
  Write-Output "started:$($process.StartTime.ToString('s'))"
} else {
  Write-Output "status:stopped"
  if ($agentPid) {
    Write-Output "stale-pid:$agentPid"
  }
}

if (Test-Path $logFile) {
  Write-Output "log-tail:"
  Get-Content -Path $logFile -Tail 20
}

if (Test-Path $errFile) {
  $errTail = Get-Content -Path $errFile -Tail 20
  if ($errTail) {
    Write-Output "err-tail:"
    $errTail
  }
}
