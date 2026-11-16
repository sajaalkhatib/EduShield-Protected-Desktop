@echo off
cd /d "%~dp0frontend"
if not exist node_modules\@angular\cli (
  echo Installing Angular dependencies for first run...
  call npm install
  if errorlevel 1 goto :end
)
call npm start
:end
pause
