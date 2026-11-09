$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $projectRoot 'frontend')
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Next.js build failed' }
    $exportRoot = Join-Path $projectRoot 'frontend/.next-release'
    if (-not (Test-Path (Join-Path $exportRoot 'index.html'))) { throw 'Static export missing' }
    $webRoot = Join-Path $projectRoot 'web'
    New-Item -ItemType Directory -Path $webRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $exportRoot '*') -Destination $webRoot -Recurse -Force
} finally { Pop-Location }

Push-Location (Join-Path $projectRoot 'next-retail')
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Retail npm ci failed' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Retail build failed' }
    npm run local:prepare
    if ($LASTEXITCODE -ne 0) { throw 'Local authentication setup failed' }
} finally { Pop-Location }
