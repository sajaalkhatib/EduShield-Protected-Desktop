@echo off
title EduShield - Close All
echo ========================================================
echo   Stopping All EduShield Instances
echo ========================================================
echo.
echo [*] Terminating EduShield processes and freeing port 5078...
taskkill /F /IM EduShield.Api.exe >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5078" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

echo.
echo [OK] All EduShield processes terminated and port 5078 is free!
timeout /t 2 /nobreak >nul
