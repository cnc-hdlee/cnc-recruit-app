@echo on
title CNC Recruit App - Build
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else (
        echo Node.js not found!
        pause
        exit /b 1
    )
)

echo Installing dependencies...
call npm install
echo Building Windows app...
call npx electron-builder --win portable --x64
echo.
echo Build complete! Check dist folder.
pause
