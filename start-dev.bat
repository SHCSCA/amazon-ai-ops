@echo off
cd /d "%~dp0"
echo ========================================
echo Amazon AI Ops Agent - Development Mode
echo ========================================
echo.

cd apps\desktop
echo [1/3] Building main process with esbuild...
call node scripts\build-main.js
call node -e "require('fs').copyFileSync('dist/main/index.cjs','dist/main/index.js')"

echo.
echo [2/3] Building preload script...
call node scripts\build-preload.js
call node -e "require('fs').copyFileSync('dist/preload/index.cjs','dist/preload/index.js')"

echo.
echo [3/3] Building renderer with Vite (dev mode)...
call npx vite --mode development

echo.
echo ========================================
echo Starting Electron...
echo ========================================
call npx electron .