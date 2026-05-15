@echo off
cd /d "%~dp0apps\desktop"
echo Starting Electron in development mode...
echo (Make sure you have run build first: npm run build:main ^&^& npm run build:renderer)
echo.
call npx electron .