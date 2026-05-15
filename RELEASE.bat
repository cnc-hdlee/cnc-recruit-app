@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   CNC 채용 커맨드센터 — 팀원에게 반영
echo ============================================
echo.

rem [0/4] .git 안의 desktop.ini 자동 정리 — Windows 폴더 옵션 변경 시 만들어진 desktop.ini가
rem .git\refs\ 안에 들어가면 git fetch/push가 "fatal: bad object refs/desktop.ini" 로 실패함.
echo [0/4] .git 안 desktop.ini 정리...
del /q /s /a:hs ".git\desktop.ini" >nul 2>&1
for /r ".git" %%f in (desktop.ini) do (if exist "%%f" del /q /a:hs "%%f" >nul 2>&1)
echo   완료
echo.

echo [1/4] 현재 변경 사항
git status --short
echo.

echo [2/4] 커밋 중...
git add -A
git commit -m "update %date% %time:~0,5%"
if errorlevel 1 (
  echo.
  echo   변경사항이 없거나 commit 실패. 위 메시지 확인 후 종료합니다.
  echo.
  pause
  exit /b 0
)
echo.

echo [3/4] 원격 변경 가져오기 (rebase)...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo   ❌ pull 실패. 충돌이 있거나 네트워크 문제입니다.
  echo   git status 확인 후 git rebase --continue 또는 --abort 하세요.
  pause
  exit /b 1
)
echo.

echo [4/4] GitHub로 푸시 (이후 클라우드에서 자동 빌드+배포)...
git push origin main
if errorlevel 1 (
  echo.
  echo   ❌ push 실패. 네트워크 또는 인증 문제일 수 있습니다.
  echo   gh auth status 로 토큰 확인하세요.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   ✅ 완료!
echo ============================================
echo.
echo   클라우드에서 자동 빌드+publish가 시작되었습니다.
echo   약 5~7분 후 팀원들 앱에서 자동으로 업데이트 팝업이 뜹니다.
echo   (체크 주기: 5분)
echo.
echo   진행 확인: https://github.com/cnc-hdlee/cnc-recruit-app/actions
echo.
timeout /t 5 >nul
