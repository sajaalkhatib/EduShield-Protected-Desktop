@echo off
title EduShield - Building Windows Executable (.exe)
cd /d "%~dp0"

echo [1/3] Building Angular Frontend Production Bundle...
cd frontend
call npm run build
if errorlevel 1 goto :error

echo [2/3] Installing Desktop App Builder Dependencies...
cd ..\desktop-app
if not exist node_modules (
  call npm install
)

echo [3/3] Packaging Standalone Windows Portable .exe...
call npm run pack:exe
if errorlevel 1 goto :error

echo ========================================================
echo [SUCCESS] Standalone Protected .exe Created Successfully!
echo Location: desktop-app\dist-installer\EduShield Player.exe
echo ========================================================
goto :end

:error
echo [ERROR] Build failed! Check messages above.

:end
pause
