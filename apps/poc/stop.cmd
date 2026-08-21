@echo off
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":3100 .*LISTENING :5300 .*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
echo stopped.
