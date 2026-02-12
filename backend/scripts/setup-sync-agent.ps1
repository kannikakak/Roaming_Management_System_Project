param(
  [switch]$RunAfterSetup
)

$ErrorActionPreference = "Stop"

function Parse-EnvFile {
  param([string]$Path)

  $map = [ordered]@{}
  if (-not (Test-Path $Path)) {
    return $map
  }

  foreach ($line in Get-Content $Path) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.TrimStart().StartsWith("#")) { continue }

    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { continue }

    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)
    if (-not [string]::IsNullOrWhiteSpace($key)) {
      $map[$key] = $value
    }
  }

  return $map
}

function Write-EnvFile {
  param(
    [string]$Path,
    [hashtable]$Values
  )

  $lines = @()
  foreach ($entry in $Values.GetEnumerator()) {
    $lines += "$($entry.Key)=$($entry.Value)"
  }
  Set-Content -Path $Path -Value $lines -Encoding UTF8
}

function Prompt-WithDefault {
  param(
    [string]$Label,
    [string]$Default
  )

  if ([string]::IsNullOrWhiteSpace($Default)) {
    return Read-Host "$Label"
  }

  $input = Read-Host "$Label [$Default]"
  if ([string]::IsNullOrWhiteSpace($input)) {
    return $Default
  }
  return $input
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir

$examplePath = Join-Path $scriptDir ".env.agent.example"
$envPath = Join-Path $backendDir ".env.agent"

if (-not (Test-Path $envPath)) {
  if (-not (Test-Path $examplePath)) {
    throw "Template file not found: $examplePath"
  }
  Copy-Item -Path $examplePath -Destination $envPath -Force
}

$values = Parse-EnvFile -Path $envPath
if ($values.Count -eq 0) {
  $values = Parse-EnvFile -Path $examplePath
}

Write-Host ""
Write-Host "Sync Agent Setup" -ForegroundColor Cyan
Write-Host "This will update: $envPath"
Write-Host ""

$apiBase = Prompt-WithDefault -Label "Render backend URL (no /api at end)" -Default ($values["AGENT_API_BASE_URL"])
$sourceId = Prompt-WithDefault -Label "Data source ID" -Default ($values["AGENT_SOURCE_ID"])
$apiKey = Prompt-WithDefault -Label "Agent API key" -Default ($values["AGENT_API_KEY"])
$watchDir = Prompt-WithDefault -Label "Drop-zone folder path" -Default ($values["AGENT_WATCH_DIR"])
$scanSeconds = Prompt-WithDefault -Label "Scan interval seconds" -Default ($values["AGENT_SCAN_SECONDS"])

$values["AGENT_API_BASE_URL"] = ($apiBase.TrimEnd("/"))
$values["AGENT_SOURCE_ID"] = $sourceId.Trim()
$values["AGENT_API_KEY"] = $apiKey.Trim()
$values["AGENT_WATCH_DIR"] = $watchDir.Trim()
$values["AGENT_SCAN_SECONDS"] = $scanSeconds.Trim()

if (-not $values.Contains("AGENT_STABLE_SECONDS")) { $values["AGENT_STABLE_SECONDS"] = "15" }
if (-not $values.Contains("AGENT_RECURSIVE")) { $values["AGENT_RECURSIVE"] = "true" }
if (-not $values.Contains("AGENT_ALLOWED_EXTENSIONS")) { $values["AGENT_ALLOWED_EXTENSIONS"] = ".csv,.xlsx,.xls" }
if (-not $values.Contains("AGENT_MAX_RETRIES")) { $values["AGENT_MAX_RETRIES"] = "5" }
if (-not $values.Contains("AGENT_RETRY_DELAY_SECONDS")) { $values["AGENT_RETRY_DELAY_SECONDS"] = "15" }
if (-not $values.Contains("AGENT_REQUEST_TIMEOUT_MS")) { $values["AGENT_REQUEST_TIMEOUT_MS"] = "120000" }
if (-not $values.Contains("AGENT_STATE_FILE")) { $values["AGENT_STATE_FILE"] = ".sync-agent-state.json" }

Write-EnvFile -Path $envPath -Values $values

$dropPath = $values["AGENT_WATCH_DIR"]
if (-not [string]::IsNullOrWhiteSpace($dropPath)) {
  New-Item -ItemType Directory -Path $dropPath -Force | Out-Null
}

Write-Host ""
Write-Host "Saved .env.agent and ensured drop-zone folder exists." -ForegroundColor Green
Write-Host "Next commands:"
Write-Host "  npm run sync-agent:test-file"
Write-Host "  npm run sync-agent"
Write-Host ""

if ($RunAfterSetup.IsPresent) {
  Push-Location $backendDir
  try {
    npm run sync-agent
  } finally {
    Pop-Location
  }
}
