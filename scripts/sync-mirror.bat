@echo off
REM CNC_RecruitMirror scheduled task (every 30 min)
REM Old sync-mirror.cjs referenced dead tabs (RAW DATA_정리본(test)/_src) and failed every run.
REM Replaced with surgical reconcile: updates only 현황(N) / 입사예정(P) by 채용요청번호.
REM Never touches grouping, row order, 채용필요인원(O), or 생산1/2팀 fixed cells.
cd /d C:\Users\user\Desktop\CNC-Recruit-App\scripts
node reconcile-chaeyong.cjs --apply >> sync-mirror.log 2>&1
