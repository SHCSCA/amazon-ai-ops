@echo off
chcp 65001 >nul
echo ========================================
echo   Amazon AI Ops Agent 1.5.1
echo   Win-Unpacked 直接启动
echo   (非打包模式，用于日常开发/测试)
echo ========================================
echo.

set "EXE=%~dp0apps\desktop\release\win-unpacked\AmazonAIOpsAgent.exe"

if not exist "%EXE%" (
    echo [错误] 未找到: %EXE%
    echo 请先运行: pnpm --filter @amazon-ai-ops/desktop run build:win
    pause
    exit /b 1
)

echo [启动] %EXE%
echo.
echo ========================================
echo   启动后请在应用内登录 Lingxing 和 Ads
echo   按 Ctrl+C 或关闭窗口即可退出
echo ========================================
echo.

rem 注意：不传 --user-data-dir，S7 安全门要求使用规范用户数据路径
start "" "%EXE%" --disable-gpu --no-sandbox

echo [完成] 进程已启动
pause
