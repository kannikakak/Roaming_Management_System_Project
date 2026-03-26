param()

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir
$pidFile = Join-Path $backendDir ".sync-agent.pid"
$logFile = Join-Path $backendDir ".sync-agent.log"
$errFile = Join-Path $backendDir ".sync-agent.err.log"

function Get-AgentProcess {
  param([int]$AgentPid)

  if (-not $AgentPid) { return $null }

  try {
    $process = Get-Process -Id $AgentPid -ErrorAction Stop
  } catch {
    return $null
  }

  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $AgentPid"
    if ($cim.CommandLine -and $cim.CommandLine -match "folder-sync-agent\.js") {
      return $process
    }
  } catch {
    # ignore CIM lookup failure and fall back to process presence only
  }

  return $process
}

if (Test-Path $pidFile) {
  $existingPid = 0
  try {
    $existingPid = [int](Get-Content -Path $pidFile -Raw).Trim()
  } catch {
    $existingPid = 0
  }

  $existingProcess = Get-AgentProcess -Pid $existingPid
  if ($existingProcess) {
    Write-Output "already-running:$($existingProcess.Id)"
    exit 0
  }

  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
$nodeCommand = Get-Command node -ErrorAction Stop
$nodePath = $nodeCommand.Source
$escapedBackendDir = $backendDir.Replace('"', '\"')
$escapedNodePath = $nodePath.Replace('"', '\"')
$escapedLogFile = $logFile.Replace('"', '\"')
$escapedErrFile = $errFile.Replace('"', '\"')
$cmdLine = "cd /d ""$escapedBackendDir"" && ""$escapedNodePath"" scripts\\folder-sync-agent.js >> ""$escapedLogFile"" 2>> ""$escapedErrFile"""

$started = Start-Process `
  -FilePath "cmd.exe" `
  -ArgumentList "/d", "/c", $cmdLine `
  -WindowStyle Hidden `
  -PassThru

Set-Content -Path $pidFile -Value $started.Id -Encoding ASCII
Write-Output "started:$($started.Id)"
