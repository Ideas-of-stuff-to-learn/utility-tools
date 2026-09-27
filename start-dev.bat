@echo off
setlocal

set "ROOT=%~dp0"
set "CONFIG=%ROOT%dev.config.env"

:: ── Read dev.config.env ────────────────────────────────────────────────────
for /f "usebackq tokens=1,2 delims==" %%A in ("%CONFIG%") do set "%%A=%%B"

:: ── Detect local IP ────────────────────────────────────────────────────────
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do (
    if not defined LOCAL_IP set "LOCAL_IP=%%A"
)
for /f "tokens=* delims= " %%A in ("%LOCAL_IP%") do set "LOCAL_IP=%%A"

if not defined LOCAL_IP (
    echo ERROR: Could not detect a local IP. Make sure you are on WiFi.
    pause
    exit /b 1
)

echo [config] Detected IP: %LOCAL_IP%
echo [config] Ports: backend=%BACKEND_PORT% cashflow=%CASHFLOW_PORT% landing=%LANDING_PORT% admin=%ADMIN_PORT%

:: ── Write shared Cashflow .env ─────────────────────────────────────────────
(
    echo VITE_LOCAL_DEV=true
    echo VITE_LOCAL_IP=localhost
    echo LOCAL_IP=localhost
    echo LOCAL_IP_NETWORK=%LOCAL_IP%
    echo VITE_BACKEND_PORT=%BACKEND_PORT%
    echo BACKEND_PORT=%BACKEND_PORT%
    echo VITE_ADMIN_PORT=%ADMIN_PORT%
) > "%ROOT%tools\cashflow\.env"

:: ── Write landing .env ─────────────────────────────────────────────────────
(
    echo VITE_LOCAL_DEV=true
    echo VITE_LOCAL_IP=localhost
    echo VITE_BACKEND_PORT=%BACKEND_PORT%
    echo VITE_ADMIN_PORT=%ADMIN_PORT%
) > "%ROOT%landing\.env"

:: ── Write admin .env ───────────────────────────────────────────────────────
(
    echo VITE_LOCAL_DEV=true
    echo VITE_LOCAL_IP=localhost
    echo VITE_BACKEND_PORT=%BACKEND_PORT%
    echo VITE_ADMIN_PORT=%ADMIN_PORT%
    echo VITE_ADMIN_ACCOUNT_MIN_LEVEL=%ADMIN_ACCOUNT_MIN_LEVEL%
    echo VITE_ADMIN_LEVEL_OVERRIDE_MIN=%ADMIN_LEVEL_OVERRIDE_MIN%
    echo VITE_ADMIN_AUDIT_MIN_LEVEL=%ADMIN_AUDIT_MIN_LEVEL%
) > "%ROOT%admin\.env"

echo [config] Written .env files for cashflow, landing, admin

:: ── Launch all four in separate terminals ──────────────────────────────────
start "Backend (Flask :%BACKEND_PORT%)"    cmd /k "cd /d "%ROOT%tools\cashflow\API" && python backend.py"
start "Cashflow Web (:%CASHFLOW_PORT%)"    cmd /k "cd /d "%ROOT%tools\cashflow\WebUI" && npm run dev -- --host"
start "Landing Page (:%LANDING_PORT%)"     cmd /k "cd /d "%ROOT%landing" && npm run dev"
start "Admin Panel (:%ADMIN_PORT%)"        cmd /k "cd /d "%ROOT%admin" && npm run dev"

echo.
echo All four started in separate terminals.
echo   Backend:  http://localhost:%BACKEND_PORT%
echo   Cashflow: http://localhost:%CASHFLOW_PORT%
echo   Landing:  http://localhost:%LANDING_PORT%
echo   Admin:    http://localhost:%ADMIN_PORT%
echo.
pause
