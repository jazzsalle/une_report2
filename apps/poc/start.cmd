@echo off
REM POC 서버·웹을 독립 콘솔 없이 띄운다. 로그: data\server.log, data\web.log
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":3100 .*LISTENING :5300 .*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "poc-server" /min cmd /c "cd server && npx tsx src\main.ts > ..\data\server.log 2>&1"
start "poc-web" /min cmd /c "cd web && npx vite --host --port 5300 --strictPort > ..\data\web.log 2>&1"
echo started. server :3100, web :5300
