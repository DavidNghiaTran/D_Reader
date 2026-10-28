@echo off
chcp 65001 >nul
title D_Reader - Dang khoi dong...
cd /d "%~dp0"

REM 1. Kiem tra neu D_Reader dang chay san thi mo luon giao dien ngay lap tuc
curl -s -f -o nul --connect-timeout 1 http://localhost:8080/api/health
if %errorlevel% equ 0 (
    goto OPEN_BROWSER
)

REM 2. Dam bao dich vu MySQL da duoc bat
net start MySQL80 >nul 2>&1
net start MySQL >nul 2>&1

REM 3. Neu chua co file .jar trong target thi tu dong dong goi
if not exist "%~dp0target\dreader-0.0.1-SNAPSHOT.jar" (
    echo [D_Reader] Dang dong goi ung dung, vui long doi giay lat...
    call "%~dp0mvnw.cmd" clean package -DskipTests
)

REM 4. Khoi chay may chu ngam bang javaw
echo [D_Reader] Dang khoi dong may chu ngam...
start "" javaw -Xms128m -Xmx384m -jar "%~dp0target\dreader-0.0.1-SNAPSHOT.jar"

REM 5. Cho may chu khoi dong thanh cong va san sang phan hoi (toi da 35 giay)
set /a retries=0
:WAIT_LOOP
set /a retries+=1
if %retries% gtr 35 goto OPEN_BROWSER
ping 127.0.0.1 -n 2 >nul
curl -s -f -o nul --connect-timeout 1 http://localhost:8080/api/health
if %errorlevel% neq 0 goto WAIT_LOOP

:OPEN_BROWSER
REM 6. Mo Google Chrome o che do cua so ung dung (App Mode)
echo [D_Reader] May chu da san sang, dang mo giao dien...
start "" chrome.exe --app=http://localhost:8080
exit