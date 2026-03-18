$ErrorActionPreference = "Stop"

$workspaceRoot = $PSScriptRoot
$appRoot = Join-Path $workspaceRoot "ai-vaom"
$pidPath = Join-Path $appRoot ".local-preview.pid"
$port = 4173

function Stop-PreviewByPort {
  param(
    [int]$TargetPort
  )

  try {
    $listener = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction Stop |
      Select-Object -First 1

    if ($listener) {
      Stop-Process -Id $listener.OwningProcess -Force
      Write-Host "Stopped the AI-VAOM preview server on port $TargetPort."
      return $true
    }
  } catch {
    return $false
  }

  return $false
}

if (-not (Test-Path $pidPath)) {
  if (-not (Stop-PreviewByPort -TargetPort $port)) {
    Write-Host "No saved AI-VAOM preview process was found."
  }
  exit 0
}

$savedPid = Get-Content $pidPath -Raw

if (-not $savedPid) {
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Host "The saved preview PID file was empty, so it was cleared."
  exit 0
}

$process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue

if ($process) {
  Stop-Process -Id $savedPid -Force
  Write-Host "Stopped the AI-VAOM preview server."
} else {
  if (-not (Stop-PreviewByPort -TargetPort $port)) {
    Write-Host "The saved preview process was already closed."
  }
}

Remove-Item $pidPath -Force -ErrorAction SilentlyContinue

Stop-PreviewByPort -TargetPort $port | Out-Null
