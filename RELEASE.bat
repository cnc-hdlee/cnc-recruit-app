@echo off
cd /d "%~dp0"

echo ============================================
echo   CNC Recruit - Push to Team
echo ============================================
echo.

echo [0/4] Clean .git/desktop.ini (Windows artifacts)...
del /q /s /a:hs ".git\desktop.ini" >nul 2>&1
for /r ".git" %%f in (desktop.ini) do (if exist "%%f" del /q /a:hs "%%f" >nul 2>&1)
echo   done
echo.

echo [1/4] git status:
git status --short
echo.

echo [2/4] commit...
git add -A
git diff --cached --quiet
if errorlevel 1 (
  echo   - changes found, normal commit
  git commit -m "update %date% %time:~0,5%"
) else (
  echo   - no changes, empty commit to trigger rebuild
  git commit --allow-empty -m "chore: force rebuild %date% %time:~0,5%"
)
if errorlevel 1 (
  echo.
  echo   [X] commit failed. See message above.
  pause
  exit /b 1
)
echo.

echo [3/4] pull --rebase...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo   [X] pull failed. Check conflict or network.
  echo   Run: git status, then git rebase --continue or --abort
  pause
  exit /b 1
)
echo.

echo [4/4] push...
git push origin main
if errorlevel 1 (
  echo.
  echo   [X] push failed. Check network or auth.
  echo   Run: gh auth status
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   DONE - Pushed to GitHub
echo ============================================
echo.
echo   GitHub Actions auto-builds and publishes (5-7 min).
echo   Team PCs get update popup within 5 min polling.
echo.
echo   Progress: https://github.com/cnc-hdlee/cnc-recruit-app/actions
echo.
timeout /t 5 >nul
