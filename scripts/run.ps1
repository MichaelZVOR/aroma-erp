param([ValidateSet('frontend', 'retail')][string]$Component = 'frontend')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($Component -eq 'retail') {
    Push-Location (Join-Path $projectRoot 'next-retail')
    try {
        if (-not (Test-Path '.next/BUILD_ID') -or -not (Test-Path 'data/local-auth.json')) {
            throw 'Run scripts/build.ps1 first'
        }
        $previousPort = $env:PORT
        try {
            $env:PORT = '8791'
            node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 8791
            if ($LASTEXITCODE -ne 0) { throw 'Retail server failed' }
        } finally { $env:PORT = $previousPort }
    } finally { Pop-Location }
    return
}
if (-not (Test-Path (Join-Path $projectRoot 'web/index.html'))) { throw 'Run scripts/build.ps1 first' }
Push-Location $projectRoot
try { python server.py --no-browser } finally { Pop-Location }
