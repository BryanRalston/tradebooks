@echo off
title TradeBooks
echo ================================
echo   TradeBooks - Starting...
echo ================================
echo.

cd /d "%~dp0"

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Download it from https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

:: Start server
echo Starting TradeBooks server...
echo.
echo ================================
echo   Open in browser:
echo   http://localhost:3143
echo ================================
echo.
echo Press Ctrl+C to stop the server.
echo.

node server.js
pause
