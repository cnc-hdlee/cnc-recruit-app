# CNC 채용 커맨드센터 — 연동 셋업 가이드

이 문서는 **Google (Sheets · Gmail · Calendar)** 와 **Slack** 을 앱에 연결하는 단계별 절차입니다.
2-3명이 함께 쓰려면 각자 자기 PC에서 **Google 로그인 / Slack 토큰 입력**만 한 번씩 하면 됩니다 — Client ID 등록은 회사에서 한 번만.

---

## 0. 사전 준비

- 회사 Google 계정 (관리자 권한 필요할 수 있음)
- 회사 Slack 워크스페이스 admin 권한 또는 admin 협조
- Node.js 20+ 설치

```
npm install
npm run dev
```

앱 첫 실행 후 사이드바 **⚙️ 설정 / 연동** 으로 이동합니다.

---

## 1. Google 연동 (Sheets · Gmail · Calendar)

### 1-1. Google Cloud 프로젝트 생성

1. https://console.cloud.google.com/ 접속, 회사 Google 계정으로 로그인
2. 상단 프로젝트 선택 드롭다운 → **새 프로젝트** → 이름: `CNC Recruit Command` (원하는 이름) → 만들기
3. 생성된 프로젝트가 선택되어 있는지 확인

### 1-2. 필요한 API 활성화

좌측 메뉴 → **API 및 서비스** → **라이브러리** 에서 아래 3개를 검색해 각각 **사용 설정** 클릭:

- **Google Sheets API**
- **Gmail API**
- **Google Calendar API**

### 1-3. OAuth 동의 화면 구성

좌측 메뉴 → **API 및 서비스** → **OAuth 동의 화면**

1. User Type: **외부 (External)** 선택 → 만들기
2. 앱 정보:
   - 앱 이름: `CNC Recruit Command Center`
   - 사용자 지원 이메일: 본인 이메일
   - 개발자 연락처: 본인 이메일
3. 범위 (Scopes): 추가 안 해도 됨 — 앱이 요청 시 동적으로 표시
4. **테스트 사용자 (Test users)**: 사용할 팀원 이메일 모두 추가 (hdlee@cnccosmetic.com, 동료 2-3명)
   - 게시 상태가 "테스트"인 동안은 등록된 사용자만 접속 가능 (Test 100명 제한)
   - 사내용이라면 게시(Production)까지 안 가도 됨
5. 저장

### 1-4. OAuth Client ID 발급

좌측 메뉴 → **API 및 서비스** → **사용자 인증 정보 (Credentials)**

1. 상단 **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
2. 애플리케이션 유형: **데스크톱 앱 (Desktop app)**
3. 이름: `CNC Recruit Desktop`
4. 만들기 → 팝업에 **클라이언트 ID** + **클라이언트 보안 비밀번호** 표시
5. 두 값을 모두 복사

### 1-5. 앱에서 입력

1. 앱 사이드바 → **⚙️ 설정 / 연동**
2. **Google 연동** 섹션에 Client ID / Secret 붙여넣기 → **저장**
3. **🔐 Google 로그인** 버튼 클릭 → 기본 브라우저가 열리면 회사 계정으로 로그인
4. 권한 동의 화면에서 모든 권한 허용 → 브라우저에 "✓ 인증 완료" 표시되면 닫기
5. 앱에 본인 이메일이 표시되면 성공

### 1-6. 시트 ID 매핑 (중요)

위 단계까지 끝나면 **Google Sheets 매핑** 섹션이 나타납니다.

1. 팀에서 사용 중인 Google Sheets 열기
2. 주소창 URL 통째로 복사 (예: `https://docs.google.com/spreadsheets/d/1AbC.../edit#gid=0`)
3. **채용 데이터 시트** 입력란에 붙여넣기 → **확인** 버튼 → 시트 제목과 탭 목록이 표시되면 성공
4. 필요시 TO 시트, 메일 시트도 추가
5. **시트 ID 저장** 클릭

> **권한 주의:** 인증한 Google 계정이 해당 시트에 *최소 보기 권한*을 가져야 함. 쓰기까지 하려면 *편집자* 권한 필요.

---

## 2. Slack 연동

### 2-1. Slack 앱 생성

1. https://api.slack.com/apps 접속 → 워크스페이스 admin 계정으로 로그인
2. **Create New App** → **From scratch**
3. 이름: `CNC Recruit Bot`, 워크스페이스 선택 → 만들기

### 2-2. OAuth 권한 설정

좌측 메뉴 → **OAuth & Permissions**

**Bot Token Scopes** 섹션에서 아래 스코프를 모두 추가 (Add an OAuth Scope):

| Scope | 용도 |
|---|---|
| `channels:history` | 공개 채널 메시지 읽기 |
| `channels:read` | 공개 채널 목록 |
| `groups:history` | 비공개 채널 메시지 읽기 (필요 시) |
| `groups:read` | 비공개 채널 목록 (필요 시) |
| `chat:write` | 메시지 발송 |
| `search:read` | 메시지 검색 (User Token 필요 — 아래 참고) |
| `users:read` | 유저 정보 |
| `users:read.email` | 유저 이메일 |

> **검색 기능(`search:read`)이 필요하면** Bot 대신 **User Token** 으로 가야 합니다. Bot Token은 search 미지원이 Slack 정책. 같은 페이지의 **User Token Scopes** 에 `search:read` 추가하고, 설치 후 발급되는 `xoxp-...` 토큰을 앱에 입력하세요. (가장 간단한 방법: 우선 Bot Token으로 채널 읽기/쓰기만 시작, 검색은 추후 활성화)

### 2-3. 워크스페이스에 설치

같은 페이지 상단 **Install to Workspace** 버튼 → 권한 검토 → 허용

설치 완료 후 페이지 상단에 두 토큰 표시:

- **Bot User OAuth Token**: `xoxb-...` ← 이걸 복사
- **User OAuth Token** (User scope를 추가한 경우): `xoxp-...`

### 2-4. 봇을 채널에 초대

Slack에서 모니터링할 채널마다:

```
/invite @CNC Recruit Bot
```

(채널 멤버십 없이는 메시지 못 읽음)

### 2-5. 앱에서 입력

1. 앱 → **설정 / 연동** → **Slack 연동** 섹션
2. 토큰 붙여넣기 → **저장 + 검증**
3. 워크스페이스 이름이 표시되면 성공

---

## 3. 팀원 배포

각 팀원 PC에 동일 절차:

1. 이 폴더 `CNC-Recruit-App` 통째로 복사 (또는 빌드된 .exe)
2. 첫 실행 시 **설정 / 연동** 페이지에서:
   - Google: Client ID/Secret은 같은 값 사용 (회사 GCP 프로젝트 1개를 공유) → 본인 계정으로 로그인
   - Slack: 같은 Bot Token 사용 가능 (워크스페이스가 같으면)
   - 시트 ID는 동일

> **보안:** 토큰은 각자 PC의 Electron `safeStorage` (Windows DPAPI 기반)로 암호화되어 `%APPDATA%\CNC Recruit\cnc-recruit-config.json` 에 저장됩니다. PC에 로그인한 OS 계정만 복호화 가능.

---

## 4. 문제 해결

### 팀원이 Google 로그인에서 "액세스 차단됨 (Access blocked)"

게시 상태가 **테스트(Testing)** 인 동안은 등록된 테스트 사용자만 로그인 가능.
클라이언트 유형은 데스크톱 앱이라 loopback(`http://127.0.0.1:포트/oauth2callback`)은
어떤 포트든 허용되므로 redirect_uri 문제는 아님 → **사용자 허용 문제**다.

**권장: 대상(Audience)을 "내부(Internal)"로 전환** — cnccosmetic.com Workspace 조직
소속 프로젝트면 가능. `console.cloud.google.com/auth/audience?project=634320343074`
→ 사용자 인증 정보 유형 **내부** → 저장.
- @cnccosmetic.com 계정 전원 자동 허용 (테스트 사용자 등록 불필요)
- Google 앱 확인(verification) 불필요
- **refresh token 7일 만료가 사라짐** ← 테스트 모드의 가장 큰 함정

**차선: 테스트 사용자 추가** — 같은 페이지 하단 **테스트 사용자 → Add users**
에 팀원 이메일 추가 (최대 100명). 단 테스트 모드에서는 refresh token이 7일 후
만료되어 팀원이 매주 재로그인해야 한다.

어느 쪽이든 팀원 화면에 "이 앱은 Google에서 확인하지 않았습니다"가 뜨면
**고급 → (앱 이름)(안전하지 않음)으로 이동** 을 눌러야 동의 화면으로 넘어간다.

### "Quota exceeded for quota metric 'Read requests'"
→ Google API 무료 할당량 초과. 일반적으로 사내 2-3명이 쓰면 충분하지만, 폴링 주기를 늘리거나 GCP에서 quota 증가 신청.

### Slack "missing_scope" 에러
→ 2-2 단계의 scope 추가 후 **반드시 재설치 (Reinstall to Workspace)** 해야 권한이 적용됨.

### Google 로그인 후 5분 내 응답 없음 → OAUTH_TIMEOUT
→ 다시 [Google 로그인] 클릭. 회사 방화벽이 127.0.0.1 콜백을 막는 경우는 IT에 문의.

---

## 5. 다음 단계 (Phase 2 후속)

- 시트 ↔ Gmail ↔ Calendar 간 reconciliation 룰 (예: "Gmail 면접 안내 ↔ Calendar 일정" 누락 자동 검출)
- 후보자 유형(신입/경력/임원)별 파이프라인 분기
- Slack 봇 자동 알림 (입사 D-1 자동 멘션 등)
- electron-builder로 portable .exe 패키징 → 사내 공유드라이브 배포
