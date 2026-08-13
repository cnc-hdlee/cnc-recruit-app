// 면접 캘린더 → 면접 후보자 트래킹 시트(1AIfmxmN) 미러링
//
// 채용앱에서 면접 일정을 만들면(SHARED_CAL.interview, colorId=3) 그 정보를 팀 시트에 자동 기록한다.
//
// 원칙 (사용자 지시):
//   1) APPEND ONLY — 기존 행/셀은 절대 수정하지 않는다. 이미 있는 성명은 건너뛴다.
//   2) 넣을 수 있는 정보만 — 캘린더에서 확실히 알 수 있는 칸만 채우고 나머지는 빈칸으로 둔다.
//        B 성명 / F 직무 / H 면접일 / K 현업 공유 / N 비고(면접 시각)
//        C 성별, D 연락처, E 지원경로, G 지원일, I 면접결과, J 현황, L 후보자 공유, M 입사예정일 → 사용자 수기
//   3) A열(No)은 수식이므로 건드리지 않는다. 종합 탭은 전부 수식이라 자동 갱신된다.
//
// 인증: 캘린더 읽기는 채용앱 토큰(calendar.readonly), 시트 쓰기는 .dash-tokens.json(spreadsheets).
//       앱 토큰은 drive.file 스코프라 이 시트를 못 쓰고, dash 토큰엔 캘린더 스코프가 없어서 둘을 나눠 쓴다.
//
// 실행: node sync-interview-tracker.cjs [--dry]
//       검은 창 없이: wscript run-hidden.vbs sync-interview-tracker.cjs

const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const { appTokens } = require('./_decrypt-app-token.cjs');

const SHEET_ID = '1AIfmxmN2B6EDWz2f6UGPmdJSDHFFv2qbKW6IAILmmhQ';

// 앱이 면접을 등록하는 캘린더 + 보조 면접 캘린더
const INTERVIEW_CALS = [
  'c_d2a3298862ba8bba109c13c83c2cc7c1ac85560bdc12a305c40c79f6964c65a2@group.calendar.google.com', // interview (앱이 쓰는 메인)
  'c_711021d8db3140f0fa36874c11e98a449ee5528637e020d891cf903cd4b8c443@group.calendar.google.com', // interviewAlt
  'c_21d3c76327cd3e4ab66cb7f7cfdb6f1a7c63500dd0d8af17212640edee2c5459@group.calendar.google.com', // interviewMgr
];

// 시트에 존재하는 팀 탭 = 생산본부 17팀. 여기 매칭되는 면접만 미러링한다.
const TEAM_TABS = [
  '생산1팀', '생산2팀', '생산3팀', '생산4팀',
  '포장1팀', '포장2팀', '포장3팀',
  '제조1팀', '제조2팀',
  '자재물류1팀', '전략구매팀', '영업관리팀', '생산운영팀',
  '품질관리2팀', '품질보증팀', '품질연구팀', '시설안전팀',
];

const FIRST_ROW = 8;
const LAST_ROW = 57;

// 과거 데이터를 통째로 끌어오지 않도록 컷오프. 기본 = 오늘-14일 ~ 오늘+120일
const DAYS_BACK = 14;
const DAYS_FWD = 120;

const SITE_WORDS = /^(퍼플|그린|수원|3공장|서울|비대면|온라인|재택|화상)/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
// 취소/포기 면접은 미러링하지 않음 (메모리: feedback_cancelled_interview_filter)
const CANCELLED_RE = /(면접포기|면접취소|취소|노쇼|no-?show)/i;

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

// ---------------------------------------------------------------- auth
async function calendarClient() {
  const { client, tokens } = appTokens();
  const o = new google.auth.OAuth2(client.clientId, client.clientSecret);
  o.setCredentials({ refresh_token: tokens.refresh_token });
  await o.getAccessToken();
  return google.calendar({ version: 'v3', auth: o });
}

async function sheetsClient() {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const o = new google.auth.OAuth2(t.clientId, t.clientSecret);
  o.setCredentials({ refresh_token: t.refresh_token });
  await o.getAccessToken();
  return google.sheets({ version: 'v4', auth: o });
}

// ---------------------------------------------------------------- parsing
const norm = (s) => String(s || '').replace(/\s+/g, '').trim();

function descField(desc, label) {
  const m = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, 'm').exec(desc || '');
  return m ? m[1].trim() : '';
}

// "생산운영팀(팀원)" → { team: '생산운영팀', job: '팀원' }
function splitTeamJob(raw) {
  const s = String(raw || '').trim();
  const m = /^(.*?)\s*[(（]\s*(.+?)\s*[)）]\s*$/.exec(s);
  if (m) return { team: m[1].trim(), job: m[2].trim() };
  return { team: s, job: '' };
}

function matchTeamTab(candidate) {
  const n = norm(candidate);
  if (!n) return null;
  return TEAM_TABS.find((t) => norm(t) === n)
      || TEAM_TABS.find((t) => n.includes(norm(t)))
      || null;
}

/**
 * 면접 이벤트에서 시트에 넣을 정보를 뽑는다.
 * 앱이 만든 이벤트는 description에 "후보자:/팀:/직무:"(또는 "부서:")가 있으므로 그걸 우선 신뢰하고,
 * 없으면 summary("HH:MM / 사이트 / 이름 / 팀(직무)") 를 파싱한다.
 */
function parseEvent(ev) {
  const summary = String(ev.summary || '').trim();
  if (!summary) return null;
  if (CANCELLED_RE.test(summary)) return null;

  const desc = String(ev.description || '');
  let name = descField(desc, '후보자');
  let team = descField(desc, '팀');
  let job = descField(desc, '직무');

  // "부서: 생산운영팀(팀원)" 형태 (시트 자동등록 이벤트)
  if (!team) {
    const dept = descField(desc, '부서');
    if (dept) {
      const sp = splitTeamJob(dept);
      team = sp.team;
      if (!job) job = sp.job;
    }
  }

  if (!name || !team) {
    const parts = summary.split('/').map((s) => s.trim()).filter(Boolean);
    const rest = parts.filter((p) => !TIME_RE.test(p) && !SITE_WORDS.test(p));
    if (!name && rest[0]) name = rest[0];
    if (!team && rest[1]) {
      const sp = splitTeamJob(rest[1]);
      team = sp.team;
      if (!job) job = sp.job;
    }
  }

  // 후보자명에 직무 힌트를 괄호로 붙이는 습관 반영: "김성욱(창고 관리)" → 성명 김성욱 / 직무 창고 관리
  {
    const sp = splitTeamJob(name);
    name = sp.team;
    if (!job && sp.job) job = sp.job;
  }

  name = String(name || '').trim();
  if (!name || name.length > 20) return null;

  const tab = matchTeamTab(team);
  if (!tab) return null; // 생산본부 17팀 시트에 없는 팀 → 미러링 대상 아님

  // 면접일 / 시각 (Asia/Seoul 기준 문자열을 그대로 사용)
  const startRaw = ev.start?.dateTime || ev.start?.date || '';
  const date = startRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let timeLabel = '';
  const hm = /T(\d{2}):(\d{2})/.exec(startRaw);
  if (hm) timeLabel = hm[2] === '00' ? `${Number(hm[1])}시` : `${hm[1]}:${hm[2]}`;

  // 현업 공유 = 회의실(resource) 아닌 실제 참석자가 1명 이상 (메모리: 공유 여부 배지 규칙)
  const shared = (ev.attendees || []).some((a) => !a.resource && !a.self);

  return { tab, name, job: String(job || '').trim(), date, timeLabel, shared };
}

// ---------------------------------------------------------------- main
(async () => {
  const now = Date.now();
  const timeMin = new Date(now - DAYS_BACK * 864e5).toISOString();
  const timeMax = new Date(now + DAYS_FWD * 864e5).toISOString();

  const cal = await calendarClient();
  const seenEventKey = new Set();
  const parsed = [];
  let calFailures = 0;

  for (const calId of INTERVIEW_CALS) {
    let pageToken;
    let count = 0;
    do {
      let res;
      try {
        res = await cal.events.list({
          calendarId: calId, timeMin, timeMax, singleEvents: true,
          orderBy: 'startTime', maxResults: 2500, pageToken,
        });
      } catch (e) {
        calFailures++;
        const quota = /Quota exceeded|rateLimit|userRateLimit/i.test(e.message || '');
        log(`WARN 캘린더 읽기 실패 ${calId.slice(0, 12)}…: ${quota ? '구글 캘린더 API 분당 한도 초과 (앱과 같은 프로젝트를 공유합니다)' : e.message}`);
        break;
      }
      for (const ev of res.data.items || []) {
        if (ev.status === 'cancelled') continue;
        const p = parseEvent(ev);
        if (!p) continue;
        // 같은 후보자+같은 날짜는 1건으로 (캘린더 중복 등록분 흡수)
        const k = `${p.tab}|${norm(p.name)}|${p.date}`;
        if (seenEventKey.has(k)) continue;
        seenEventKey.add(k);
        parsed.push(p);
        count++;
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    // "CAL " prefix = 진행 로그. 수동 실행 팝업(mirror-interviews-now.vbs)에서 걸러낸다.
    log(`CAL ${calId.slice(0, 10)}… → 대상 ${count}건`);
  }

  // 캘린더를 하나도 못 읽었으면 "변경 없음"이 아니라 실패다 — 조용히 넘어가면 누락을 못 알아챈다.
  if (calFailures === INTERVIEW_CALS.length) {
    log('캘린더를 하나도 읽지 못했습니다. 1~2분 뒤 다시 실행해 주세요. (시트는 건드리지 않았습니다)');
    process.exitCode = 1;
    return;
  }

  // 같은 후보자가 여러 날짜에 잡혀 있으면 가장 이른 면접일 1건만 (시트는 후보자 1명 = 1행)
  const byPerson = new Map();
  for (const p of parsed) {
    const k = `${p.tab}|${norm(p.name)}`;
    const prev = byPerson.get(k);
    if (!prev || p.date < prev.date) byPerson.set(k, p);
  }

  const sheets = await sheetsClient();
  const ranges = TEAM_TABS.map((t) => `'${t}'!B${FIRST_ROW}:B${LAST_ROW}`);
  const cur = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID, ranges, valueRenderOption: 'FORMATTED_VALUE',
  });

  // 탭별 기존 성명 집합 + 다음 빈 행
  const state = {};
  TEAM_TABS.forEach((tab, i) => {
    const col = (cur.data.valueRanges[i].values || []).map((r) => (r && r[0]) || '');
    const names = new Set(col.map(norm).filter(Boolean));
    let nextRow = FIRST_ROW;
    for (let r = 0; r < LAST_ROW - FIRST_ROW + 1; r++) {
      if (norm(col[r])) nextRow = FIRST_ROW + r + 1;
    }
    state[tab] = { names, nextRow };
  });

  const data = [];
  const added = [];
  const skipped = [];
  const overflow = [];

  for (const p of [...byPerson.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const st = state[p.tab];
    if (st.names.has(norm(p.name))) { skipped.push(`${p.tab}/${p.name}`); continue; } // 이미 있음 → 절대 손대지 않음
    if (st.nextRow > LAST_ROW) { overflow.push(`${p.tab}/${p.name}`); continue; }

    const r = st.nextRow;
    // 채울 수 있는 칸만 개별 셀로 기록 — A(수식)·C·D·E·G·I·J·L·M 은 건드리지 않는다.
    data.push({ range: `'${p.tab}'!B${r}`, values: [[p.name]] });
    if (p.job) data.push({ range: `'${p.tab}'!F${r}`, values: [[p.job]] });
    data.push({ range: `'${p.tab}'!H${r}`, values: [[p.date]] });
    data.push({ range: `'${p.tab}'!K${r}`, values: [[p.shared]] });
    if (p.timeLabel) data.push({ range: `'${p.tab}'!N${r}`, values: [[p.timeLabel]] });

    st.names.add(norm(p.name));
    st.nextRow = r + 1;
    added.push(`${p.tab} R${r} ${p.name} ${p.date}${p.timeLabel ? ' ' + p.timeLabel : ''}${p.job ? ' (' + p.job + ')' : ''}${p.shared ? ' 공유O' : ''}`);
  }

  log(`신규 ${added.length}건 / 기존유지 ${skipped.length}건 / 자리없음 ${overflow.length}건`);
  added.forEach((a) => log('  + ' + a));
  if (overflow.length) log('  ! 행 부족(8~57 소진): ' + overflow.join(', '));

  if (!added.length) { log('변경 없음'); return; }
  if (DRY) { log('DRY RUN — 쓰지 않음'); return; }

  for (let i = 0; i < data.length; i += 200) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 200) },
    });
  }
  log(`기록 완료 (${data.length} cells)`);
})().catch((e) => { log('ERR', e.stack || e.message); process.exitCode = 1; });
