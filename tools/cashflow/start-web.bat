@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%API"
set "FRONTEND_DIR=%SCRIPT_DIR%WebUI"
set "ENV_FILE=%SCRIPT_DIR%.env"

:: ── Detect local IP ───────────────────────────────────────────────────────────
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do (
    if not defined LOCAL_IP set "LOCAL_IP=%%A"
)
:: Strip leading space
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

:: ── Write .env (Vite only — Flask reads API\.env separately) ──────────
:: VITE_LOCAL_IP is always localhost for browser dev — the network IP is
:: only needed for React Native on a physical device (start-rn.bat writes it).
(
    echo VITE_LOCAL_DEV=true
    echo VITE_LOCAL_IP=localhost
    echo LOCAL_IP=localhost
    echo LOCAL_IP_NETWORK=%LOCAL_IP%
) > "%ENV_FILE%"

echo [config] Written %ENV_FILE%

:: ── Launch Flask + Vite ───────────────────────────────────────────────────────
start "utility-tools - Backend" cmd /k "cd /d "%BACKEND_DIR%" && python backend.py"
start "utility-tools - Web Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev -- --host"

echo.
echo Started Backend and Web Frontend.
echo Open your browser at http://localhost:5173 (or the port Vite prints).
echo Network IP for React Native: %LOCAL_IP%
echo.
