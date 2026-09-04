@echo off
chcp 65001 >nul
echo ========================================
echo   Amazon AI Ops Agent 1.5.1
echo   直接运行模式（非打包）
echo ========================================
echo.

cd /d "%~dp0apps\desktop"

echo [1/2] 确认构建产物...
if not exist "dist\main\index.js" (
    echo [错误] dist\main\index.js 未找到，请先运行: pnpm --filter @amazon-ai-ops/desktop run build:main
    pause
    exit /b 1
)
if not exist "dist\renderer\index.html" (
    echo [错误] dist\renderer\index.html 未找到，请先运行: pnpm --filter @amazon-ai-ops/desktop run build:renderer
    pause
    exit /b 1
)
if not exist "dist\preload\index.js" (
    echo [错误] dist\preload\index.js 未找到，请先运行: pnpm --filter @amazon-ai-ops/desktop run build:preload
    pause
    exit /b 1
)
echo [OK] 构建产物完整

echo.
echo [2/2] 启动 Electron（使用预编译界面）...
echo.
call pnpm --filter @amazon-ai-ops/desktop run dev
