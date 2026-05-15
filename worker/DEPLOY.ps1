# CNC 채용 클라우드 배포 — 한 번 실행하면 끝
#
# 동작:
#  1) wrangler login (브라우저에서 Cloudflare OAuth — 처음 한 번만)
#  2) KV namespace 자동 생성 → wrangler.toml의 ID 자리표시 자동 치환
#  3) 본체 store에서 Google client_id / client_secret / refresh_token 추출
#  4) wrangler secret put 으로 Cloudflare에 4개 시크릿 등록
#  5) viewer 빌드 (../dist-viewer)
#  6) wrangler deploy → URL 출력
#
# 필요한 사전 조건: 본체에서 Google 로그인 완료 (refresh_token 있어야 함)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$root = Resolve-Path "$PSScriptRoot\.."
$cfgPath = Join-Path $env:APPDATA 'cnc-recruit-app\cnc-recruit-config.json'
$tomlPath = Join-Path $PSScriptRoot 'wrangler.toml'

Write-Host '=== 1. wrangler login ===' -ForegroundColor Cyan
$whoami = & npx --yes wrangler whoami 2>&1 | Out-String
if ($whoami -match 'You are not authenticated' -or $whoami -match 'not logged in') {
  Write-Host '브라우저에서 Cloudflare 계정으로 로그인하세요 (자동 가입 가능).' -ForegroundColor Yellow
  & npx --yes wrangler login
} else {
  Write-Host '이미 로그인됨' -ForegroundColor Green
}

Write-Host ''
Write-Host '=== 2. KV namespace 생성 ===' -ForegroundColor Cyan
$tomlContent = Get-Content $tomlPath -Raw
if ($tomlContent -match 'id = "REPLACE_WITH_KV_ID"') {
  $kvOutput = & npx --yes wrangler kv namespace create SNAPSHOT_KV 2>&1 | Out-String
  Write-Host $kvOutput
  $kvIdMatch = [regex]::Match($kvOutput, 'id = "([0-9a-f]{32,})"')
  if (-not $kvIdMatch.Success) {
    # try alternative formats
    $kvIdMatch = [regex]::Match($kvOutput, '"id":\s*"([0-9a-f]{32,})"')
  }
  if (-not $kvIdMatch.Success) {
    throw "KV namespace ID 추출 실패. 위 출력에서 'id'를 찾아 수동으로 wrangler.toml에 입력하세요."
  }
  $kvId = $kvIdMatch.Groups[1].Value
  Write-Host "KV ID: $kvId" -ForegroundColor Green
  $tomlContent = $tomlContent -replace 'REPLACE_WITH_KV_ID', $kvId
  Set-Content -Path $tomlPath -Value $tomlContent -Encoding UTF8 -NoNewline
} else {
  Write-Host 'KV namespace 이미 셋업됨' -ForegroundColor Green
}

Write-Host ''
Write-Host '=== 3. 본체 store에서 Google credentials 추출 ===' -ForegroundColor Cyan
if (-not (Test-Path $cfgPath)) {
  throw "본체 config 파일이 없어요: $cfgPath`n본체 앱을 한 번 실행해서 Google 로그인하세요."
}
$cfgRaw = Get-Content $cfgPath -Raw
# googleClient is plain JSON; googleTokens.refresh_token is encrypted by safeStorage.
# The maintainer's `g:revealSecrets` IPC decrypts it — we use that path via the running app.

# Try: ask the live app via mobile:getInfo? no — that doesn't reveal tokens.
# Use a small helper: spawn a one-shot Node script with electron's safeStorage? complex.
# Simplest path: rely on `g:revealSecrets` — show the user how to copy 3 values from devtools console.
# But we can do it programmatically via the running mobile-server (port 5274) IF we add a one-shot endpoint.
# For now: read googleClient (plain) + ask user to paste refresh_token from app's Settings → 시크릿 노출 button.

$clientIdMatch = [regex]::Match($cfgRaw, '"clientId"\s*:\s*"([^"]+)"')
$clientSecretMatch = [regex]::Match($cfgRaw, '"clientSecret"\s*:\s*"([^"]+)"')
$accessTokenMatch = [regex]::Match($cfgRaw, '"mobileAccessToken"\s*:\s*"([^"]+)"')

if (-not $clientIdMatch.Success -or -not $clientSecretMatch.Success) {
  throw '본체 store에서 Google clientId/Secret 못 찾음. 본체 앱을 켜고 Google 로그인 먼저.'
}
$CLIENT_ID = $clientIdMatch.Groups[1].Value
$CLIENT_SECRET = $clientSecretMatch.Groups[1].Value
if ($accessTokenMatch.Success) {
  $ACCESS_TOKEN = $accessTokenMatch.Groups[1].Value
} else {
  $bytes = New-Object byte[] 18
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $ACCESS_TOKEN = [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
}

Write-Host "  CLIENT_ID: $($CLIENT_ID.Substring(0, [Math]::Min(20,$CLIENT_ID.Length)))..." -ForegroundColor DarkGray
Write-Host "  ACCESS_TOKEN: $ACCESS_TOKEN" -ForegroundColor DarkGray

# refresh_token은 본체에서 안전하게 추출 — 본체가 떠있는 동안 mobile-server에 한 번만 추가한 endpoint 호출
# (다른 보안된 경로는 IPC뿐인데 외부 PowerShell에서 못 부름)
Write-Host '  refresh_token: 본체 mobile-server에서 가져오는 중...' -ForegroundColor DarkGray
$REFRESH_TOKEN = $null
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5274/__reveal_refresh_token?t=$ACCESS_TOKEN" -TimeoutSec 5 -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  $REFRESH_TOKEN = $j.refresh_token
} catch {
  Write-Host "  자동 추출 실패 — 본체 앱 ⚙️ 설정 → '🔓 시크릿 노출' 버튼으로 refresh_token 복사 후 입력:" -ForegroundColor Yellow
  $REFRESH_TOKEN = Read-Host '  refresh_token'
}

if (-not $REFRESH_TOKEN) {
  throw 'refresh_token 없음. 본체 앱 ⚙️ 설정 → 🔓 시크릿 노출에서 복사하세요.'
}

Write-Host ''
Write-Host '=== 4. Secrets 등록 (Cloudflare Worker로 업로드) ===' -ForegroundColor Cyan
function Put-Secret($name, $value) {
  Write-Host "  → $name" -ForegroundColor DarkGray
  $value | & npx --yes wrangler secret put $name 2>&1 | Out-Null
}
Put-Secret 'GOOGLE_CLIENT_ID' $CLIENT_ID
Put-Secret 'GOOGLE_CLIENT_SECRET' $CLIENT_SECRET
Put-Secret 'GOOGLE_REFRESH_TOKEN' $REFRESH_TOKEN
Put-Secret 'ACCESS_TOKEN' $ACCESS_TOKEN

Write-Host ''
Write-Host '=== 5. Viewer 빌드 ===' -ForegroundColor Cyan
Push-Location $root
& npm run build:viewer
Pop-Location

Write-Host ''
Write-Host '=== 6. Deploy ===' -ForegroundColor Cyan
$deployOutput = & npx --yes wrangler deploy 2>&1 | Out-String
Write-Host $deployOutput
$urlMatch = [regex]::Match($deployOutput, 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev')
if ($urlMatch.Success) {
  $finalUrl = "$($urlMatch.Value)/?t=$ACCESS_TOKEN"
  Write-Host ''
  Write-Host '════════════════════════════════════════════════' -ForegroundColor Green
  Write-Host '  ✓ 배포 완료!' -ForegroundColor Green
  Write-Host '════════════════════════════════════════════════' -ForegroundColor Green
  Write-Host ''
  Write-Host '폰에서 이 URL 한 번 클릭하면 자동 로그인 + 앱 설치 안내:' -ForegroundColor Yellow
  Write-Host $finalUrl -ForegroundColor White -BackgroundColor DarkBlue
  Write-Host ''
  Write-Host '✓ PC 꺼져있어도 동작' -ForegroundColor Green
  Write-Host '✓ URL 영구 고정' -ForegroundColor Green
  Write-Host '✓ 5분마다 자동 새로고침' -ForegroundColor Green
} else {
  Write-Host '배포 메시지에서 URL 추출 실패. 위 출력에서 workers.dev 도메인을 찾아 끝에 ?t=' + $ACCESS_TOKEN + ' 붙여서 사용하세요.' -ForegroundColor Yellow
}
