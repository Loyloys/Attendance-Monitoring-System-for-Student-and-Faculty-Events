$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"

function Get-PythonCommand {
    foreach ($candidate in @("py", "python")) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) {
            return $candidate
        }
    }

    return $null
}

$pythonCommand = Get-PythonCommand

if (-not $pythonCommand) {
    Write-Host "Python was not found on this machine. Install Python 3.11+ and make sure 'py' or 'python' is available in PATH." -ForegroundColor Red
    Write-Host "Then reopen VS Code and press F5 again." -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "Starting Django backend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; & '$pythonCommand' -3 manage.py runserver" -WorkingDirectory $root

if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm install" -WorkingDirectory $frontendDir
    Start-Sleep -Seconds 8
}

Write-Host "Starting Vite frontend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npm run dev" -WorkingDirectory $frontendDir

Write-Host "The app is starting." -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "Backend: http://127.0.0.1:8000" -ForegroundColor Cyan
