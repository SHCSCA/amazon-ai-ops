@echo off
chcp 65001 >nul
echo ========================================
echo   Amazon AI Ops Agent 1.5.1
echo   编译 + 启动
echo ========================================
echo.

cd /d "%~dp0"

echo [1/5] pnpm install（如需要）...
call pnpm install
if errorlevel 1 (
    echo [错误] pnpm install 失败
    pause
    exit /b 1
)

echo.
echo [2/5] 编译主进程...
call pnpm --filter @amazon-ai-ops/desktop run build:main
if errorlevel 1 (
    echo [错误] build:main 失败
    pause
    exit /b 1
)

echo.
echo [3/5] 编译 preload...
call pnpm --filter @amazon-ai-ops/desktop run build:preload
if errorlevel 1 (
    echo [错误] build:preload 失败
    pause
    exit /b 1
)

echo.
echo [4/5] 编译渲染进程...
call pnpm --filter @amazon-ai-ops/desktop run build:renderer
if errorlevel 1 (
    echo [错误] build:renderer 失败
    pause
    exit /b 1
)

echo.
echo [5/5] 启动 Electron...
echo.
call pnpm --filter @amazon-ai-ops/desktop run dev
