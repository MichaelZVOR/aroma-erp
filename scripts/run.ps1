$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $projectRoot 'web/index.html'))) { throw 'Run scripts/build.ps1 first' }
Push-Location $projectRoot
try { python server.py } finally { Pop-Location }
