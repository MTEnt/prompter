@echo off
REM Double-click this on Windows.
REM Installs dependencies if needed, starts Prompter, opens your browser.

cd /d "%~dp0"
echo.
echo   Prompter
echo   --------
echo   One-click start (installs deps if needed).
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed yet (one-time).
  echo   1. Open https://nodejs.org
  echo   2. Download LTS and install
  echo   3. Double-click this file again
  echo.
  pause
  exit /b 1
)

node start.js
if errorlevel 1 (
  echo.
  echo   Something went wrong.
  pause
  exit /b 1
)

echo.
pause
