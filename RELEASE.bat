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

echo [2/4] commit 중...
git add -A
git diff --cached --quiet
if errorlevel 1 (
  rem 스테이지에 변경사항 있음 → 일반 commit
  echo   변경사항 발견 → 일반 commit 생성
  git commit -m "update %date% %time:~0,5%"
) else (
  rem 변경사항 없음 → 빈 commit으로 GitHub Actions 강제 트리거
  echo   변경사항 없음 → 빈 commit으로 강제 재배포 트리거
  git commit --allow-empty -m "chore: 강제 재배포 %date% %time:~0,5%"
)
if errorlevel 1 (
  echo.
  echo   X commit 실패. 위 메시지 확인.
  pause
  exit /b 1
)
echo.

echo [3/4] 원격 동기화 (pull --rebase)...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo   X pull 실패. 충돌이 있거나 네트워크 문제.
  echo   git status 확인 후 git rebase --continue 또는 --abort 하세요.
  pause
  exit /b 1
)
echo.

echo [4/4] GitHub 로 push...
git push origin main
if errorlevel 1 (
  echo.
  echo   X push 실패. 네트워크 또는 인증 문제.
  echo   gh auth status 로 토큰 상태 확인.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   완료!
echo ============================================
echo.
echo   GitHub Actions 가 자동으로 빌드+publish 시작합니다.
echo   약 5~7분 후 팀원 PC 에서 자동 업데이트 팝업이 떠요. (5분 polling)
echo.
echo   진행 확인: https://github.com/cnc-hdlee/cnc-recruit-app/actions
echo.
timeout /t 5 >nul
