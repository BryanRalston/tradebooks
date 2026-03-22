@echo off
title TradeBooks
setlocal

:: Change to app directory (where this bat file lives)
cd /d "%~dp0"

:: Make sure uploads directory exists
if not exist "uploads\receipts" mkdir "uploads\receipts"

:: Kill any existing TradeBooks server on port 3143
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3143" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: Start the server in the background
start /b "" node server.js

:: Give the server a moment to start
timeout /t 2 /nobreak >nul

:: Open the browser
start "" "http://localhost:3143"

echo.
echo  ============================================
echo    TradeBooks is running!
echo.
echo    Open your browser to:
echo    http://localhost:3143
echo  ============================================
echo.
echo  Close this window to stop TradeBooks.
echo.

:: Wait for user to close the window or press a key
pause >nul

:: Clean up: kill the node process on our port
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3143" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

exit /b 0
