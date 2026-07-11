@echo off
title Prompter
cd /d "%~dp0"

echo.
echo   Prompter
echo   --------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed.
  echo   Get it here ^(LTS^): https://nodejs.org
  echo.
  pause
  exit /b 1
)

node start.js
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
pause
