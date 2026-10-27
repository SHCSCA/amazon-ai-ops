@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node scripts/start-local-simulation.mjs %*
set "simulationExit=%errorlevel%"
if not "%simulationExit%"=="0" pause
exit /b %simulationExit%
