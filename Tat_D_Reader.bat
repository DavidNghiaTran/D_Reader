@echo off
chcp 65001 >nul
echo [D_Reader] Dang tat may chu tren cong 8080...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
exit