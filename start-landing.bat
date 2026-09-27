@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LANDING_DIR=%SCRIPT_DIR%landing"
set "ENV_FILE=%LANDING_DIR%\.env"

:: ── Detect local IP ───────────────────────────────────────────────────────────
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do (
    if not defined LOCAL_IP set "LOCAL_IP=%%A"
)
for /f "tokens=* delims= " %%A in ("%LOCAL_IP%") do set "LOCAL_IP=%%A"

if not defined LOCAL_IP (
    echo.
    echo ERROR: Could not detect a local IP address.
    echo Make sure you are connected to WiFi and try again.
    echo.
    pause
    exit /b 1
)

echo [config] Detected IP: %LOCAL_IP%

:: ── Write landing/.env ─────────────────────────────────────────────────────
(
    echo VITE_LOCAL_DEV=true
    echo VITE_LOCAL_IP=localhost
    echo VITE_LOCAL_IP_NETWORK=%LOCAL_IP%
) > "%ENV_FILE%"

echo [config] Written %ENV_FILE%

if not exist "%LANDING_DIR%\node_modules" (
    echo [setup] node_modules not found -- running npm install first...
    cd /d "%LANDING_DIR%"
    npm install
)

start "utility-tools - Landing Page" cmd /k "cd /d "%LANDING_DIR%" && npm run dev -- --port 5174"

echo.
echo Started Landing Page dev server.
echo Open your browser at http://localhost:5174
echo.
