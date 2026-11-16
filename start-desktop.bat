@echo off
title EduShield - Secure Desktop Player
cd /d "%~dp0"
set DOTNET_CLI_TELEMETRY_OPTOUT=1
set ASPNETCORE_ENVIRONMENT=Development

echo ========================================================
echo   EduShield 100%% Hardware Protected Desktop Player
echo ========================================================
echo.

:: 1. Free port 5078 and clean previous instances
echo [*] Freeing port 5078 and closing previous instances...
taskkill /F /IM EduShield.Api.exe >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5078" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

:: 2. Launch Backend API in its own window so it remains visible and running
echo [*] Launching Backend API in dedicated window...
start "EduShield - Backend API (Port 5078)" "%~dp0start-backend.bat"

:: 3. Wait until port 5078 is ACTUALLY listening
echo [*] Waiting for Backend API on port 5078 to be ready...
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":5078" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto :wait_loop
echo [*] Backend API is ONLINE and ready!

:: 4. Launch Secure Desktop Player
cd /d "%~dp0desktop-app"
echo.
echo [*] Launching Secure Desktop Player (Hardware WDA Protected)...
call ".\node_modules\.bin\electron.cmd" .
if errorlevel 1 (
  echo.
  echo [!] Error launching desktop player.
  pause
)
