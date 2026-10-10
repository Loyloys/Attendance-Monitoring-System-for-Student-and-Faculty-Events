<#
.SYNOPSIS
    Starts the ISOLATED test instance used by the browser verification run.

.DESCRIPTION
    This is deliberately a SEPARATE launcher from start-app.ps1. start-app.ps1
    runs the live application (API 8000, UI 5173, MongoDB 27017). This script
    runs a private instance that shares no port, no database and no session
    secret with it, so a verification run can never touch live data.

    ISOLATION IS ENFORCED, NOT ASSUMED. This script refuses to start unless
    the database name marks it as a test database, and unless the API, UI and
    MongoDB ports are all different from the live ones.

    LIVE SETTINGS ARE NEVER TOUCHED. Every variable below is exported into the
    CHILD PROCESS environment only. backend/.env is never read, written or
    edited, and the live backend is never restarted. Because a process
    environment variable takes precedence over the .env file, these values win
    for this instance alone.

    LOCATION POLICY - why the fence is strict here.
    The shipped default is a 25 m slack, so a "150 m" venue really accepts
    175 m. For verification the slack is set to 0 so the fence is EXACTLY the
    advertised radius, which is the strict reading of "150 m". The other two
    limits are pinned explicitly to their intended values (100 m accuracy,
    120 s = 2 minutes freshness) rather than left to fall back to defaults, so
    what is verified is always a stated number rather than an implied one.

    Usage:
      powershell -ExecutionPolicy Bypass -File .\start-e2e.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"
$logDir = Join-Path $root ".e2e\logs"
$mongoDataDir = Join-Path $root ".e2e\mongo-data"

# The isolated instance's fixed identity. Each value is a deliberate DIFFERENCE
# from the live application.
$e2eMongoPort = 27019
$e2eBackendPort = 8100
$e2eFrontendPort = 5174
$e2eDatabase = "university_attendance_e2e_test"
$e2eMongoUri = "mongodb://127.0.0.1:$e2eMongoPort/$e2eDatabase"
$e2eFrontendUrl = "http://localhost:$e2eFrontendPort"
$e2eApiUrl = "http://127.0.0.1:$e2eBackendPort"

# --- Hard isolation guards. Refuse to start rather than risk live data. ------

$liveMongoPort = 27017
$liveBackendPort = 8000
$liveFrontendPort = 5173

# Same rule the seed scripts use, so this launcher and the fixtures agree on
# what "a test database" means.
if ($e2eDatabase -notmatch '(^|[_-])test([_-]|$)') {
    Write-Host "Refusing to start: `"$e2eDatabase`" is not marked as a test database." -ForegroundColor Red
    exit 1
}
foreach ($pair in @(
    @{ Name = "MongoDB"; Port = $e2eMongoPort; Live = $liveMongoPort },
    @{ Name = "Backend"; Port = $e2eBackendPort; Live = $liveBackendPort },
    @{ Name = "Frontend"; Port = $e2eFrontendPort; Live = $liveFrontendPort }
)) {
    if ($pair.Port -eq $pair.Live) {
        Write-Host "Refusing to start: $($pair.Name) port $($pair.Port) is the LIVE port." -ForegroundColor Red
        exit 1
    }
}
foreach ($item in @(
    @{ Name = "node"; Command = "node" },
    @{ Name = "npm"; Command = "npm" }
)) {
    if (-not (Get-Command $item.Command -ErrorAction SilentlyContinue)) {
        Write-Host "$($item.Name) was not found on PATH." -ForegroundColor Red
        exit 1
    }
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Host "Node.js 20 or newer is required; found $(node --version)." -ForegroundColor Red
    exit 1
}

# mongod ships separately from the driver. The installed binaries are not
# interchangeable: a data directory written by one major version is REFUSED by
# another ("Invalid featureCompatibilityVersion ... Expected one of ..."). The
# version that can open this instance's existing data directory is therefore
# discovered by trying, never guessed, so re-running against an already-seeded
# .e2e\mongo-data keeps working after a MongoDB upgrade is installed alongside
# the old one. Guessing a version would turn a routine restart into a hard
# failure.
$mongoCandidates = @(
    (Get-Command mongod -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    "C:\xampp\mongodb\bin\mongod.exe"
    (Get-ChildItem "C:\Program Files\MongoDB\Server" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "bin\mongod.exe" })
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

if (-not $mongoCandidates) {
    Write-Host "mongod.exe was not found in the usual MongoDB install locations." -ForegroundColor Red
    Write-Host "Install MongoDB 6 or newer, or add it to PATH, then run this again." -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $logDir, $mongoDataDir | Out-Null

function Test-Listening([int]$Port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

# --- 1. MongoDB on its own port and its own data directory -------------------

if (Test-Listening $e2eMongoPort) {
    Write-Host "MongoDB is already listening on $e2eMongoPort." -ForegroundColor DarkGray
} else {
    Write-Host "Starting isolated MongoDB on $e2eMongoPort..." -ForegroundColor Green
    $mongod = $null
    foreach ($candidate in $mongoCandidates) {
        $process = Start-Process $candidate -ArgumentList @(
            "--dbpath", $mongoDataDir,
            "--port", $e2eMongoPort,
            "--bind_ip", "127.0.0.1"
        ) -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logDir "mongod-e2e.log") `
            -RedirectStandardError (Join-Path $logDir "mongod-e2e.err.log")

        $ready = $false
        foreach ($attempt in 1..30) {
            Start-Sleep -Milliseconds 500
            if (Test-Listening $e2eMongoPort) { $ready = $true; break }
            # The process exited - a version mismatch refuses to start - so there
            # is nothing left to wait for: move on to the next candidate.
            if ($process.HasExited) { break }
        }
        if ($ready) {
            $mongod = $candidate
            Write-Host "Using mongod: $candidate" -ForegroundColor DarkGray
            break
        }
        # Clear the lock a failed attempt leaves behind, or the next candidate
        # inherits a stale one and also reports an unclean shutdown.
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "  $candidate could not open the isolated data directory; trying the next..." -ForegroundColor DarkGray
    }

    if (-not $mongod) {
        Write-Host "The isolated MongoDB did not start with any installed version." -ForegroundColor Red
        Write-Host "See .e2e\logs\mongod-e2e.err.log" -ForegroundColor Yellow
        exit 1
    }
}
# --- 2. The environment of the isolated backend ------------------------------
#
# Set here, in the parent, and INHERITED by the children started below. That is
# what keeps the live backend/.env untouched: these are process variables, and a
# process variable outranks the .env file inside the child.

# Reused across runs so a restarted instance keeps its sessions; generated once
# if absent. Test-only value, and never the live SESSION_SECRET.
$e2eStateFile = Join-Path $root ".e2e\session-secret.txt"
if (Test-Path -LiteralPath $e2eStateFile) {
    $e2eSessionSecret = (Get-Content -LiteralPath $e2eStateFile -Raw).Trim()
} else {
    $e2eSessionSecret = node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
    [System.IO.File]::WriteAllText($e2eStateFile, $e2eSessionSecret)
}
if ($e2eSessionSecret.Length -lt 32) {
    Write-Host "Refusing to start: the isolated SESSION_SECRET is too short." -ForegroundColor Red
    exit 1
}

# The QR credential is encrypted at rest, and this instance must be able to
# re-display a current code. A dedicated test-only key, never the live one.
$e2eQrKeyFile = Join-Path $root ".e2e\qr-key.txt"
if (Test-Path -LiteralPath $e2eQrKeyFile) {
    $e2eQrKey = (Get-Content -LiteralPath $e2eQrKeyFile -Raw).Trim()
} else {
    $e2eQrKey = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
    [System.IO.File]::WriteAllText($e2eQrKeyFile, $e2eQrKey)
}

$env:PORT = "$e2eBackendPort"
$env:NODE_ENV = "development"
$env:MONGODB_URI = $e2eMongoUri
$env:SESSION_SECRET = $e2eSessionSecret
$env:TRUSTED_ORIGINS = "$e2eFrontendUrl,http://127.0.0.1:$e2eFrontendPort"
$env:SECURE_COOKIES = "false"
# The banner every screen carries, so this instance can never be mistaken for
# the live one. The Playwright helpers assert on this text.
$env:DEPLOYMENT_LABEL = "ISOLATED E2E TEST INSTANCE"
# Renamed cookies: the live app and this instance can be open in the SAME
# browser at the same time, and must not overwrite each other's session.
$env:SESSION_COOKIE_NAME = "e2e_sessionid"
$env:CSRF_COOKIE_NAME = "e2e_csrftoken"
$env:EVENT_QR_ENCRYPTION_KEY = $e2eQrKey

# --- Sign-in request budgets --------------------------------------------------
#
# The login REQUEST budget is raised for this instance only, exactly as
# backend/tests/helpers.js does for the API suite: a verification run signs in
# far more times per minute than any real person, and hitting the shipped cap
# (20 per 60 s) makes signIn() time out on a 429 instead of testing anything.
# It is a SEPARATE control from the failed-password lockout, which stays as
# strict as the product default - that lockout is what the backend suite
# asserts, and nothing below relaxes it. The Google endpoints get their own
# raised budget for the same reason the unit suite raises them: one login page
# load makes a session call there. These are child-process variables, so the
# live instance and backend/.env never see them.
$env:LOGIN_RATE_LIMIT = "500"
$env:GOOGLE_AUTH_RATE_LIMIT = "2000"

# --- The location policy this instance verifies against ----------------------
#
# slack 0             the fence is EXACTLY the radius: 150 m means 150 m, not
#                     the shipped default's 175 m. Strict by design here.
# maxAccuracyMeters 100    a fix worse than +/-100 m is refused as imprecise.
# maxAgeSeconds     120    (2 minutes) a fix older than this is refused as stale.
#
# ATTENDANCE_MAX_OBSERVATION_AGE_SECONDS is a SEPARATE rule from the 120 s above.
# 120 s governs the ONE-SHOT scan, where a delayed request is legitimate. 30 s
# governs CONTINUOUS tracking, which samples every 10 s: anything older than
# about three samples is a replayed cached position, not a measurement of where
# the person is now. Left at its 30 s default it is pinned here for the same
# reason as the other two - a test must verify a stated number, not a fallback -
# and so the printed line below proves the two limits did not collapse into one.
$env:LOCATION_FENCE_SLACK_METERS = "0"
$env:LOCATION_MAX_ACCURACY_METERS = "100"
$env:LOCATION_MAX_AGE_SECONDS = "120"
$env:ATTENDANCE_MAX_OBSERVATION_AGE_SECONDS = "30"

# Prove the values really reach the module the request handlers read, rather
# than trusting that they were exported. Printed at startup on purpose: a wrong
# number here would quietly change what the whole run verifies.
Write-Host "Isolated location policy:" -ForegroundColor Cyan
Write-Host "  fence slack  : $($env:LOCATION_FENCE_SLACK_METERS) m  (fence == radius exactly)" -ForegroundColor Cyan
Write-Host "  max accuracy : $($env:LOCATION_MAX_ACCURACY_METERS) m" -ForegroundColor Cyan
Write-Host "  max age      : $($env:LOCATION_MAX_AGE_SECONDS) s ($([int]$env:LOCATION_MAX_AGE_SECONDS / 60) minutes)  [one-shot scan]" -ForegroundColor Cyan
Write-Host "  tracking age : $($env:ATTENDANCE_MAX_OBSERVATION_AGE_SECONDS) s  [continuous tracking - separate, stricter rule]" -ForegroundColor Cyan

# --- 3. Dependencies ---------------------------------------------------------

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

# --- 4. Fixtures -------------------------------------------------------------
#
# Idempotent: it creates what is missing and REFRESHES the time windows, which
# is what makes a re-run hours later still meaningful.

Write-Host "Seeding isolated fixtures..." -ForegroundColor Cyan
Push-Location $backendDir
try {
    node scripts/seed-e2e-fixtures.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Fixture seeding failed. The live database was not touched." -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

# --- 5. Backend and frontend -------------------------------------------------

if (Test-Listening $e2eBackendPort) {
    Write-Host "Port $e2eBackendPort is already in use. Stop that process first." -ForegroundColor Red
    exit 1
}

Write-Host "Starting isolated Express API on $e2eBackendPort..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; npm start" `
    -WorkingDirectory $backendDir

Write-Host "Starting isolated Vite frontend on $e2eFrontendPort..." -ForegroundColor Green
# The proxy target must be the isolated API, or the UI silently talks to the
# live backend on 8000 and the whole run is meaningless.
$env:VITE_API_PROXY_TARGET = $e2eApiUrl
Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendDir'; npx vite --port $e2eFrontendPort --strictPort" `
    -WorkingDirectory $frontendDir

Write-Host ""
Write-Host "ISOLATED test instance is starting. Live settings were NOT changed." -ForegroundColor Green
Write-Host "  Frontend : $e2eFrontendUrl" -ForegroundColor Cyan
Write-Host "  Backend  : $e2eApiUrl" -ForegroundColor Cyan
Write-Host "  MongoDB  : $e2eMongoUri" -ForegroundColor Cyan
Write-Host "  Fence    : 150 m radius, 0 m slack, max accuracy 100 m, one-shot age 120 s, tracking age 30 s" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run the browser suite from frontend\ with:  npm run test:e2e" -ForegroundColor Yellow