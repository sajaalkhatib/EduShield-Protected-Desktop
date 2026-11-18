@echo off
title EduShield - Secure Desktop Player
cd /d "%~dp0"
set DOTNET_CLI_TELEMETRY_OPTOUT=1
set ASPNETCORE_ENVIRONMENT=Development

echo ========================================================
echo   EduShield 100%% Hardware Protected Desktop Player
echo ========================================================
echo.

:: 1. Check if backend is already listening on port 5078
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5078 -State Listen -ErrorAction SilentlyContinue).Count -gt 0" | findstr "True" >nul 2>&1
if errorlevel 1 (
  echo [*] Backend API is offline. Starting backend on port 5078...
  taskkill /F /IM EduShield.Api.exe >nul 2>&1
  start "EduShield - Backend API (Port 5078)" "%~dp0start-backend.bat"
  
  :wait_loop
  timeout /t 1 /nobreak >nul
  powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5078 -State Listen -ErrorAction SilentlyContinue).Count -gt 0" | findstr "True" >nul 2>&1
  if errorlevel 1 goto :wait_loop
  echo [*] Backend API is ONLINE and ready!
) else (
  echo [*] Backend API is already running on port 5078.
)

:: 2. Close previous electron window if any and launch fresh
cd /d "%~dp0desktop-app"
taskkill /F /IM electron.exe >nul 2>&1
echo.
echo [*] Launching Secure Desktop Player (Hardware WDA Protected)...
call ".\node_modules\.bin\electron.cmd" .
if errorlevel 1 (
  echo.
  echo [!] Error launching desktop player.
  pause
)
