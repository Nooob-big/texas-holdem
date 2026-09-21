@echo off
chcp 65001 >nul
title 德州扑克 (Texas Hold'em) - 局域网联机服务端
cd /d "%~dp0"

echo ================================================================
echo   ♠ 德州扑克 (Texas Hold'em) - 启动器 ♠
echo ================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 运行环境！请前往 https://nodejs.org 安装 Node.js。
    echo 按任意键打开 Node.js 官网...
    pause >nul
    start https://nodejs.org/
    exit /b 1
)

echo 正在启动局域网对战服务端并打开浏览器...
echo 游戏运行期间请保持本窗口打开，按 Ctrl+C 可退出。
echo.

start "" "http://localhost:3000"
node server.js

pause
