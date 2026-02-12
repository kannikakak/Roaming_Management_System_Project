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

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir
$envPath = Join-Path $backendDir ".env.agent"
$envValues = Parse-EnvFile -Path $envPath

$watchDir = if ($envValues.Contains("AGENT_WATCH_DIR")) {
  $envValues["AGENT_WATCH_DIR"]
} else {
  "C:\RoamingDropZone\Reports"
}

if ([string]::IsNullOrWhiteSpace($watchDir)) {
  $watchDir = "C:\RoamingDropZone\Reports"
}

New-Item -ItemType Directory -Path $watchDir -Force | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "agent-test-$stamp.csv"
$filePath = Join-Path $watchDir $fileName

$rows = @(
  "Partner,Country,Revenue,Usage,Date",
  "Cellcard,KH,1200.5,540,2026-02-12",
  "PartnerA,TH,980.2,420,2026-02-12",
  "PartnerB,VN,860.0,390,2026-02-12"
)

Set-Content -Path $filePath -Value $rows -Encoding UTF8

Write-Host "Created test file:"
Write-Host "  $filePath"
Write-Host ""
Write-Host "If sync agent is running, this file should be ingested within your scan interval."
