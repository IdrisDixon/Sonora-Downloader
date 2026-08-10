@echo off
setlocal
cd /d "%~dp0"
title Sonora Windows Builder

echo.
echo ========================================
echo   Sonora Windows x64 Builder
echo ========================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"
if errorlevel 1 (
  echo.
  echo Build failed. Please copy the error above and send it to the developer.
  pause
  exit /b 1
)

echo.
echo Build complete. Open the release-windows folder to find the EXE files.
start "" "%~dp0release-windows"
pause
