# CNC 채용 커맨드센터 — Defender 예외 영구 등록
# 빌드 실패(spawn UNKNOWN)와 실행 차단을 막기 위해 다음을 영구 예외 처리:
#   1) 소스 폴더, 설치 폴더, 배포 폴더 (경로 예외)
#   2) 앱/빌드 도구 실행파일 (프로세스 예외)

$ErrorActionPreference = 'Stop'

$paths = @(
    'C:\Users\user\Desktop\CNC-Recruit-App',
    'C:\Users\user\AppData\Local\Programs\cnc-recruit-app',
    'C:\Users\user\AppData\Roaming\cnc-recruit-app',
    'C:\Users\user\Desktop\CNC-Recruit-배포'
)

$processes = @(
    'CNC Recruit.exe',
    'electron.exe',
    '7za.exe',
    'app-builder.exe',
    'node.exe'
)

foreach ($p in $paths) {
    try { Add-MpPreference -ExclusionPath $p -ErrorAction Stop; Write-Host "OK path: $p" -ForegroundColor Green }
    catch { Write-Host "FAIL path: $p — $($_.Exception.Message)" -ForegroundColor Yellow }
}

foreach ($proc in $processes) {
    try { Add-MpPreference -ExclusionProcess $proc -ErrorAction Stop; Write-Host "OK process: $proc" -ForegroundColor Green }
    catch { Write-Host "FAIL process: $proc — $($_.Exception.Message)" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "=== 현재 등록된 경로 예외 ===" -ForegroundColor Cyan
(Get-MpPreference).ExclusionPath
Write-Host ""
Write-Host "=== 현재 등록된 프로세스 예외 ===" -ForegroundColor Cyan
(Get-MpPreference).ExclusionProcess
Write-Host ""
Write-Host "완료. 5초 후 닫힙니다." -ForegroundColor Green
Start-Sleep -Seconds 5
