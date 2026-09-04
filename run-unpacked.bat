@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo Amazon AI Ops Agent 1.5.1
echo Win-Unpacked Launcher
echo ========================================
echo.

set "EXE=%~dp0apps\desktop\release\win-unpacked\AmazonAIOpsAgent.exe"

if not exist "%EXE%" (
    echo [ERROR] Executable not found:
    echo %EXE%
    echo Build the Windows package before using this launcher.
    pause
    exit /b 1
)

echo [START] %EXE%
rem Keep the canonical Electron user-data path required by the safety gate.
start "" "%EXE%" --disable-gpu --no-sandbox
if errorlevel 1 (
    echo [ERROR] Failed to start the application.
    pause
    exit /b 1
)

echo [OK] Application process started.
exit /b 0
