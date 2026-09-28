$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    Write-Host "Node.js 20 or newer and npm were not found." -ForegroundColor Red
    Write-Host "Install Node.js, reopen VS Code, and run this task again." -ForegroundColor Yellow
    exit 1
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Host "Node.js 20 or newer is required; found $(node --version)." -ForegroundColor Red
    exit 1
}

$mongoReachable = Get-NetTCPConnection -State Listen -LocalPort 27017 -ErrorAction SilentlyContinue
if (-not $mongoReachable) {
    Write-Host "MongoDB is not listening on 127.0.0.1:27017." -ForegroundColor Red
    Write-Host "Start MongoDB, then run the launcher again." -ForegroundColor Yellow
    exit 1
}

$envPath = Join-Path $backendDir ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
    Write-Host "Creating backend/.env from the example..." -ForegroundColor Cyan
    Copy-Item (Join-Path $backendDir ".env.example") $envPath
    $secret = node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
    $content = (Get-Content $envPath -Raw) -replace 'SESSION_SECRET=.*', "SESSION_SECRET=$secret"
    [System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))
}

foreach ($item in @(
    @{ Name = "backend"; Path = $backendDir },
    @{ Name = "frontend"; Path = $frontendDir }
)) {
    if (-not (Test-Path (Join-Path $item.Path "node_modules"))) {
        Write-Host "Installing $($item.Name) dependencies..." -ForegroundColor Cyan
        Push-Location $item.Path
        try { npm install } finally { Pop-Location }
    }
}

Write-Host "Starting Express API..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; npm start" -WorkingDirectory $backendDir
Write-Host "Starting Vite frontend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm run dev" -WorkingDirectory $frontendDir
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "Backend: http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host "MongoDB: 127.0.0.1:27017" -ForegroundColor Cyan
