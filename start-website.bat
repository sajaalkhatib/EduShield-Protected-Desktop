@echo off
title EduShield - Web Academy Platform
cd /d "%~dp0"

echo ========================================================
echo   EduShield Academy - Web Portal Launcher
echo ========================================================
echo.

:: 1. Ensure Backend API is running on port 5078
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5078 -State Listen -ErrorAction SilentlyContinue).Count -gt 0" | findstr "True" >nul 2>&1
if errorlevel 1 (
  echo [*] Starting Backend API on port 5078...
  start "EduShield - Backend API (Port 5078)" "%~dp0start-backend.bat"
  
  :wait_backend
  timeout /t 1 /nobreak >nul
  powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5078 -State Listen -ErrorAction SilentlyContinue).Count -gt 0" | findstr "True" >nul 2>&1
  if errorlevel 1 goto :wait_backend
  echo [*] Backend API is ONLINE on port 5078!
) else (
  echo [*] Backend API is already running on port 5078.
)

:: 2. Check if Frontend Server is already listening on port 4200
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue).Count -gt 0" | findstr "True" >nul 2>&1
if errorlevel 1 (
  echo [*] Starting Frontend Server on http://localhost:4200...
  cd /d "%~dp0frontend"
  start "EduShield - Frontend (Port 4200)" cmd /c "npm start"
  
  :wait_frontend
  timeout /t 2 /nobreak >nul
  powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue).Count -gt 0" | findstr "True" >nul 2>&1
  if errorlevel 1 goto :wait_frontend
  echo [*] Frontend Server is ONLINE!
) else (
  echo [*] Frontend Server is already running.
)

:: 3. Open browser at http://localhost:4200
echo.
echo [*] Opening EduShield Academy Website in your browser...
start http://localhost:4200
echo.
echo ========================================================
echo   EduShield Academy is running at: http://localhost:4200
echo   - Student: student
echo   - Password: LabOnly_2026!
echo ========================================================
timeout /t 3 /nobreak >nul
