@echo off
REM Windows double-click launcher.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Install the LTS version from https://nodejs.org then try again.
  echo.
  pause
  exit /b 1
)

REM Open the browser, then start the server (Ctrl+C or close window to stop).
start "" http://localhost:3000
echo   Starting order tracker... (close this window or press Ctrl+C to stop)
node server/index.js
