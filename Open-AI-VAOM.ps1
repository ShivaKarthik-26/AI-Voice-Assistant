$ErrorActionPreference = "Stop"

$workspaceRoot = $PSScriptRoot
$appRoot = Join-Path $workspaceRoot "ai-vaom"
$pidPath = Join-Path $appRoot ".local-preview.pid"
$logPath = Join-Path $appRoot ".local-preview.log"
$errPath = Join-Path $appRoot ".local-preview.err"
$url = "http://127.0.0.1:4173"

function Test-PreviewReady {
  param(
    [string]$TargetUrl
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $TargetUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

Set-Location $appRoot

Write-Host "Building AI-VAOM for local preview..."
& npm.cmd run build

if ($LASTEXITCODE -ne 0) {
  throw "Build failed. The preview server was not started."
}

$serverRunning = $false

if (Test-PreviewReady -TargetUrl $url) {
  Start-Process $url
  Write-Host "AI-VAOM is already running at $url"
  exit 0
}

if (Test-Path $pidPath) {
  $existingPid = Get-Content $pidPath -Raw

  if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue

    if ($existingProcess -and (Test-PreviewReady -TargetUrl $url)) {
      $serverRunning = $true
    } else {
      Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not $serverRunning) {
  Write-Host "Starting local preview server on $url ..."

  if (Test-Path $logPath) {
    Clear-Content $logPath
  }

  if (Test-Path $errPath) {
    Clear-Content $errPath
  }

  $previewProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "preview:local") `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logPath `
    -RedirectStandardError $errPath `
    -PassThru

  Set-Content -Path $pidPath -Value $previewProcess.Id -Encoding utf8

  $ready = $false

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500

    if (Test-PreviewReady -TargetUrl $url) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "Preview server did not become ready. Check ai-vaom\\.local-preview.err for details."
  }
}

Start-Process $url
Write-Host "AI-VAOM is available at $url"
