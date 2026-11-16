@echo off
title EduShield - Backend API (Port 5078)
set DOTNET_CLI_TELEMETRY_OPTOUT=1
set ASPNETCORE_ENVIRONMENT=Development
cd /d "%~dp0"

echo ========================================================
echo   EduShield Protected Video Backend API (Port 5078)
echo ========================================================
echo.

echo [*] Freeing port 5078 and stopping previous instances...
taskkill /F /IM EduShield.Api.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5078" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

echo [*] Compiling latest backend code...
cd /d "%~dp0backend"
dotnet build --nologo -v q

echo.
echo [*] Starting EduShield Protected Video API on http://127.0.0.1:5078...
cd /d "%~dp0backend\bin\Debug\net10.0"
EduShield.Api.exe --urls "http://127.0.0.1:5078"
if errorlevel 1 (
  echo.
  echo [!] Trying fallback dotnet run...
  cd /d "%~dp0backend"
  dotnet run --launch-profile EduShield.Api
)
pause
