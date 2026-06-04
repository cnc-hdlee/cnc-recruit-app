@echo off
REM CNC michungwon (unfilled headcount) auto sync - ASCII only
set NODE="C:\Program Files\nodejs\node.exe"
set DIR=%~dp0
%NODE% "%DIR%sync-michungwon.cjs" >> "%DIR%sync-michungwon.log" 2>&1
