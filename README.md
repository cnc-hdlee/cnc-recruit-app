# CNC 채용 커맨드센터

CNC TA팀 전용 채용 관리 데스크탑 앱. Google Sheets · Gmail · Calendar · Slack을 한 화면에 모아 후보자 단위로 자동 통합 분석합니다.

**구성**
- **본체** (Electron 앱) — TA 담당자가 시트 매핑·OAuth·Calendar 작성 등 모든 기능 사용
- **뷰어** (정적 웹) — 다른 팀원이 설치 없이 브라우저에서만 보는 읽기 전용 모드
- **GitHub Actions cron** — 5분마다 서버에서 자동 시트 폴링 (본인 PC 무관, 24/7)

---

## 빠른 시작 (본체 — 본인용)

```bash
npm install
npm run dev          # Vite + Electron 개발 모드
npm run build        # portable .exe (Windows) 생성 — release/ 디렉토리
```

본체에서 처음 한 번 [⚙️ 설정 / 연동]에서:
1. Google Cloud Console에서 OAuth Client ID/Secret 발급 후 입력
2. Google 로그인
3. 시트 URL 추가 → ✨ 모든 탭 자동 매핑 → 매핑 저장
4. (선택) Slack User Token 등록

---

## 팀 배포 — GitHub Pages + Actions (24/7 자동 동기화)

본인 PC가 꺼져있어도 팀원이 항상 최신 데이터를 보게 하려면:

### 1) GitHub repo 생성
https://github.com/new → repo 만들기 → 이 폴더 코드 push.

```bash
git init
git remote add origin https://github.com/<id>/<repo>.git
git add .
git commit -m "init"
git branch -M main
git push -u origin main
```

### 2) GitHub Secrets 4개 등록
본체 앱의 [⚙️ 설정 / 연동] → [🔑 GitHub Secrets 4개 한 번에 추출] 클릭.

repo > Settings > Secrets and variables > Actions > **New repository secret**에 다음 4개를 각각 등록:

| 이름 | 설명 |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret |
| `GOOGLE_REFRESH_TOKEN` | 본인 계정 refresh token |
| `SHEETS_CONFIG` | 시트 ID + 매핑 JSON |

### 3) GitHub Pages 활성화
repo > Settings > Pages > Source: **Deploy from a branch** → Branch: `gh-pages` / `(root)` → Save.

1-2분 후 URL 표시됨: `https://<id>.github.io/<repo>/`

### 4) Workflows 자동 실행
- **Deploy** (`.github/workflows/deploy.yml`) — main에 push될 때마다 viewer 빌드 + gh-pages 배포
- **Sync** (`.github/workflows/sync.yml`) — 5분마다 시트 읽어서 snapshot.json 갱신

처음엔 Actions 탭에서 두 워크플로우를 [Run workflow]로 수동 트리거하면 즉시 반영.

### 5) 팀원에게 URL 공유
끝. 팀원은 설치/로그인/세팅 없이 북마크 한 번이면 24/7 최신 데이터.

---

## 데이터 안전성

- **Google Sheets · Gmail · Drive — 읽기 전용** (앱이 셀을 절대 수정하지 않음)
- **Calendar — 읽기 + 쓰기** (면접 일정 등록·수정·삭제용)
- **Slack — 읽기 권장**
- 본인 OAuth 토큰은 본인 PC의 Windows DPAPI로 암호화 저장 (`%APPDATA%/cnc-recruit-app/`)
- GitHub Secrets는 GitHub 측에서 암호화 저장 — 워크플로우에서만 접근 가능

---

## 페이지 가이드

| 페이지 | 역할 |
|---|---|
| 🏠 대시보드 | 다가오는 면접 · 최근 메일 · 알림 |
| 👥 인원현황 | ★전사인원현황 시트 그대로 + 본부 필터 |
| 🎯 채용 파이프라인 | 사무직 신입/경력/임원 + 현장직 칸반 |
| 📅 면접 캘린더 | 중복 제거 리스트 + 면접/입사/퇴사 필터 |
| ✉️ 메일 | TA팀 메일 로그 (클릭 시 Gmail로 이동) |
| 💬 Slack 피드 | 채널·DM 통합 피드 |
| 🔗 자동 분석 | 시트 후보자 ↔ Gmail/Calendar/Slack 자동 매칭 |
| ⚙️ 설정 / 연동 | OAuth · 시트 매핑 · GitHub 배포 |
| 📖 사용법 (필독) | 팀원 안내용 풀 가이드 |

---

## 스택

- React 18 + TypeScript + Vite + Tailwind CSS
- Electron 33 (본체) / 정적 SPA (뷰어)
- Google APIs (Sheets · Gmail · Calendar · Drive)
- @slack/web-api
- electron-builder (portable .exe)
- GitHub Actions (cron sync + deploy)

---

문의 — Talent Acquisition Team · 이형도 사원 (hdlee@cnccosmetic.com)
