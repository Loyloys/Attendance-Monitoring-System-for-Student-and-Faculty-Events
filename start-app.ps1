$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$pythonExe = $null
$pythonArgs = @()
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

if (Test-Path -LiteralPath $venvPython) {
    $pythonExe = $venvPython
} else {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        & $py.Source -3 -c "import sys; print(sys.executable)" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $pythonExe = $py.Source; $pythonArgs = @("-3") }
    }
    if (-not $pythonExe) {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if ($python) {
            & $python.Source -c "import sys; print(sys.executable)" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $pythonExe = $python.Source; $pythonArgs = @() }
        }
    }
}
if (-not $pythonExe) {
    Write-Host "A working Python 3.12+ interpreter was not found." -ForegroundColor Red
    Write-Host "Install Python, reopen VS Code, and run this task again." -ForegroundColor Yellow
    exit 1
}

$pythonCommand = "& '$pythonExe' $($pythonArgs -join ' ')"
Write-Host "Starting Django backend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; $pythonCommand manage.py runserver" -WorkingDirectory $root
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm install" -WorkingDirectory $frontendDir
    Start-Sleep -Seconds 8
}
Write-Host "Starting Vite frontend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm run dev" -WorkingDirectory $frontendDir
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "Backend: http://127.0.0.1:8000" -ForegroundColor Cyan
