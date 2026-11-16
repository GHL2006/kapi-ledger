@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器：http://127.0.0.1:5500/
echo 按 Ctrl+C 停止
py -3 -m http.server 5500
if errorlevel 1 python -m http.server 5500
pause
