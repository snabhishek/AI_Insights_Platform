@echo off
setlocal
title AI Insights Platform - Desktop Builder

echo ============================================================
echo   AI Insights Platform - Desktop Builder (Tauri)
echo ============================================================
echo.

cd /d "%~dp0src\ai-insights-desktop"
node scripts\build.mjs

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Desktop build failed! Check errors above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [SUCCESS] Build completed successfully!
pause
