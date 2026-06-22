@echo off
REM Auto update (every 30min via Task Scheduler): foreign RAW DATA + chaeyong progress
set "NODE_PATH=C:\Users\user\Desktop\CNC-Recruit-App\node_modules"
cd /d "C:\Users\user\Desktop\CNC-Recruit-App\scripts"
echo ===== %DATE% %TIME% ===== >> update-all.log
"C:\Program Files\nodejs\node.exe" update-all.cjs >> update-all.log 2>&1
