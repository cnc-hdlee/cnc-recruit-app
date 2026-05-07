@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   CNC 채용 커맨드센터 — 팀원에게 반영
echo ============================================
echo.
echo [1/3] 현재 변경 사항
git status --short
echo.

echo [2/3] 커밋 중...
git add .
git commit -m "update %date% %time:~0,5%" >nul 2>&1
if errorlevel 1 (
  echo   변경사항이 없습니다. 종료합니다.
  echo.
  timeout /t 3 >nul
  exit /b 0
)

echo [3/3] GitHub로 푸시 (이후 클라우드에서 자동 빌드+배포)...
git push
if errorlevel 1 (
  echo.
  echo   ❌ push 실패. 네트워크 또는 인증 문제일 수 있습니다.
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
echo   약 5~7분 후 팀원들 앱은 자동 업데이트를 다운로드합니다.
echo.
echo   진행 확인: https://github.com/cnc-hdlee/cnc-recruit-app/actions
echo.
timeout /t 5 >nul
