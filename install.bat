@echo off
setlocal enabledelayedexpansion

:: ============================================================================
::  TradeBooks Installer
::  One-click setup for Windows 10/11
:: ============================================================================

title TradeBooks Installer

echo.
echo  ============================================
echo       TradeBooks Installer
echo  ============================================
echo.
echo  Simple bookkeeping for contractors.
echo  This will install TradeBooks on your computer.
echo.
echo  ============================================
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\TradeBooks"
set "DESKTOP=%USERPROFILE%\Desktop"
set "NODE_MSI=%TEMP%\node-installer.msi"
set "REPO_ZIP=%TEMP%\tradebooks.zip"
set "REPO_URL=https://github.com/BryanRalston/tradebooks"

:: ============================================================================
::  Step 0: Check if already installed
:: ============================================================================
if exist "%INSTALL_DIR%\server.js" (
    echo  [!] TradeBooks is already installed at:
    echo      %INSTALL_DIR%
    echo.
    set /p REINSTALL="  Do you want to update/reinstall? (Y/N): "
    if /i "!REINSTALL!" neq "Y" (
        echo.
        echo  Installation cancelled.
        echo.
        pause
        exit /b 0
    )
    echo.
    echo  [*] Updating existing installation...
    echo.
    :: Keep the database and uploads safe during reinstall
    if exist "%INSTALL_DIR%\tradebooks.db" (
        echo  [*] Backing up your data...
        copy /y "%INSTALL_DIR%\tradebooks.db" "%TEMP%\tradebooks_backup.db" >nul 2>nul
        if exist "%INSTALL_DIR%\uploads" (
            xcopy /e /i /y "%INSTALL_DIR%\uploads" "%TEMP%\tradebooks_uploads_backup" >nul 2>nul
        )
        set "HAD_BACKUP=1"
    )
)

:: ============================================================================
::  Step 1: Check for Node.js
:: ============================================================================
echo  [1/6] Checking for Node.js...

where node >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
    echo         Node.js found: !NODE_VER!
    echo.
) else (
    echo         Node.js not found. Downloading installer...
    echo.
    echo  -----------------------------------------------
    echo   Node.js is required and will be installed now.
    echo   You may see a Windows installer progress bar.
    echo  -----------------------------------------------
    echo.

    :: Download Node.js LTS
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi' -OutFile '%NODE_MSI%' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"

    if not exist "%NODE_MSI%" (
        echo.
        echo  [ERROR] Failed to download Node.js.
        echo          Please check your internet connection and try again.
        echo          Or install Node.js manually from https://nodejs.org
        echo.
        pause
        exit /b 1
    )

    echo         Download complete. Installing Node.js...
    echo         (A progress window will appear - please wait)
    echo.

    :: Install Node.js (passive = shows progress bar, no clicking needed)
    msiexec /i "%NODE_MSI%" /passive /norestart

    if !errorlevel! neq 0 (
        echo.
        echo  [ERROR] Node.js installation failed.
        echo          Try running this installer as Administrator,
        echo          or install Node.js manually from https://nodejs.org
        echo.
        pause
        exit /b 1
    )

    :: Clean up MSI
    del "%NODE_MSI%" >nul 2>nul

    :: Refresh PATH so we can find node in this session
    set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"

    :: Verify installation
    where node >nul 2>nul
    if !errorlevel! neq 0 (
        echo.
        echo  [ERROR] Node.js was installed but cannot be found.
        echo          Please close this window, open a new one, and
        echo          run the installer again.
        echo.
        pause
        exit /b 1
    )

    for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
    echo         Node.js installed successfully: !NODE_VER!
    echo.
)

:: ============================================================================
::  Step 2: Create app directory
:: ============================================================================
echo  [2/6] Setting up install directory...

if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    if !errorlevel! neq 0 (
        echo.
        echo  [ERROR] Could not create directory: %INSTALL_DIR%
        echo.
        pause
        exit /b 1
    )
)

echo         Directory: %INSTALL_DIR%
echo.

:: ============================================================================
::  Step 3: Download TradeBooks
:: ============================================================================
echo  [3/6] Downloading TradeBooks...

:: Try git first
where git >nul 2>nul
if %errorlevel% equ 0 (
    echo         Using git...
    if exist "%INSTALL_DIR%\.git" (
        :: Already a git repo, pull updates
        pushd "%INSTALL_DIR%"
        git pull origin master >nul 2>nul
        popd
        echo         Updated from GitHub.
    ) else (
        :: Fresh clone into temp, then copy
        if exist "%TEMP%\tradebooks-clone" rmdir /s /q "%TEMP%\tradebooks-clone" >nul 2>nul
        git clone "%REPO_URL%.git" "%TEMP%\tradebooks-clone" >nul 2>nul
        if !errorlevel! neq 0 (
            echo         Git clone failed, falling back to ZIP download...
            goto :download_zip
        )
        xcopy /e /y /i "%TEMP%\tradebooks-clone\*" "%INSTALL_DIR%" >nul 2>nul
        rmdir /s /q "%TEMP%\tradebooks-clone" >nul 2>nul
        echo         Downloaded via git.
    )
    goto :download_done
)

:download_zip
echo         Using ZIP download...

:: Download ZIP from GitHub
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%REPO_URL%/archive/refs/heads/master.zip' -OutFile '%REPO_ZIP%' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"

if not exist "%REPO_ZIP%" (
    echo.
    echo  [ERROR] Failed to download TradeBooks.
    echo          Please check your internet connection and try again.
    echo.
    pause
    exit /b 1
)

:: Extract ZIP
if exist "%TEMP%\tradebooks-extract" rmdir /s /q "%TEMP%\tradebooks-extract" >nul 2>nul
powershell -Command "try { Expand-Archive -Path '%REPO_ZIP%' -DestinationPath '%TEMP%\tradebooks-extract' -Force } catch { Write-Host $_.Exception.Message; exit 1 }"

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Failed to extract TradeBooks files.
    echo.
    pause
    exit /b 1
)

:: Move contents from extracted folder (GitHub ZIPs nest in a subfolder)
for /d %%D in ("%TEMP%\tradebooks-extract\tradebooks-*") do (
    xcopy /e /y /i "%%D\*" "%INSTALL_DIR%" >nul 2>nul
)

:: Clean up
del "%REPO_ZIP%" >nul 2>nul
rmdir /s /q "%TEMP%\tradebooks-extract" >nul 2>nul

echo         Downloaded and extracted.

:download_done
echo.

:: ============================================================================
::  Step 4: Restore backup data if we had it
:: ============================================================================
if defined HAD_BACKUP (
    echo  [*] Restoring your data...
    copy /y "%TEMP%\tradebooks_backup.db" "%INSTALL_DIR%\tradebooks.db" >nul 2>nul
    if exist "%TEMP%\tradebooks_uploads_backup" (
        xcopy /e /i /y "%TEMP%\tradebooks_uploads_backup" "%INSTALL_DIR%\uploads" >nul 2>nul
        rmdir /s /q "%TEMP%\tradebooks_uploads_backup" >nul 2>nul
    )
    del "%TEMP%\tradebooks_backup.db" >nul 2>nul
    echo         Data restored.
    echo.
)

:: ============================================================================
::  Step 5: Install Node.js dependencies
:: ============================================================================
echo  [4/6] Installing dependencies (this may take a minute)...

pushd "%INSTALL_DIR%"
call npm install --production
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Failed to install dependencies.
    echo          Try running this installer again.
    echo.
    popd
    pause
    exit /b 1
)
popd

echo         Dependencies installed.
echo.

:: ============================================================================
::  Step 6: Create desktop shortcut
:: ============================================================================
echo  [5/6] Creating desktop shortcut...

set "LAUNCHER=%INSTALL_DIR%\TradeBooks.bat"

:: Verify the launcher bat exists (it should have been downloaded with the app)
if not exist "%LAUNCHER%" (
    echo         [!] Launcher script not found, creating it...
    call :create_launcher
)

:: Create .lnk shortcut via PowerShell
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%DESKTOP%\TradeBooks.lnk'); $sc.TargetPath = '%LAUNCHER%'; $sc.WorkingDirectory = '%INSTALL_DIR%'; $sc.Description = 'TradeBooks - Simple bookkeeping for contractors'; $sc.WindowStyle = 7; $sc.Save()"

if exist "%DESKTOP%\TradeBooks.lnk" (
    echo         Shortcut created on Desktop.
) else (
    echo         [!] Could not create desktop shortcut.
    echo             You can run TradeBooks from:
    echo             %LAUNCHER%
)

echo.

:: ============================================================================
::  Step 7: Create uploads directory
:: ============================================================================
echo  [6/6] Final setup...

if not exist "%INSTALL_DIR%\uploads\receipts" (
    mkdir "%INSTALL_DIR%\uploads\receipts" >nul 2>nul
)

echo         Ready!
echo.

:: ============================================================================
::  Done!
:: ============================================================================
echo.
echo  ============================================
echo       Installation Complete!
echo  ============================================
echo.
echo  TradeBooks has been installed to:
echo    %INSTALL_DIR%
echo.
echo  To start TradeBooks:
echo    Double-click "TradeBooks" on your Desktop
echo.
echo  Your browser will open automatically to:
echo    http://localhost:3143
echo.
echo  First time? You'll set up a password, then
echo  you're ready to start tracking your business.
echo.
echo  ============================================
echo.

pause
exit /b 0

:: ============================================================================
::  Subroutine: Create launcher if not found in download
::  Writes a minimal launcher. The full TradeBooks.bat should come from the
::  repo download; this is only a safety net.
:: ============================================================================
:create_launcher
> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo title TradeBooks
>> "%LAUNCHER%" echo cd /d "%INSTALL_DIR%"
>> "%LAUNCHER%" echo start /b "" node server.js
>> "%LAUNCHER%" echo timeout /t 2 /nobreak ^>nul
>> "%LAUNCHER%" echo start "" "http://localhost:3143"
>> "%LAUNCHER%" echo echo.
>> "%LAUNCHER%" echo echo  TradeBooks is running on http://localhost:3143
>> "%LAUNCHER%" echo echo  Close this window to stop.
>> "%LAUNCHER%" echo echo.
>> "%LAUNCHER%" echo pause ^>nul
>> "%LAUNCHER%" echo taskkill /f /im node.exe ^>nul 2^>^&1
goto :eof
