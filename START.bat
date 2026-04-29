@echo off
chcp 65001 >nul
title CNC 채용 커맨드센터 - Dev
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else (
        echo Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS를 설치해주세요.
        pause
        exit /b 1
    )
)

if not exist node_modules (
    echo 처음 실행 - 의존성 설치 중...
    call npm install
)

echo Vite + Electron 실행 중...
call npm run dev
pause
