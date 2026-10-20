@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo Installing dependencies...
  call npm install || goto :error
)
call npm start
goto :eof

:error
echo.
echo Installing dependencies failed. Make sure Node.js is installed: https://nodejs.org
pause
