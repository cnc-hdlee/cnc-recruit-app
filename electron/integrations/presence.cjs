// 접속 현황(presence) — "지금 이 앱을 누가 쓰고 있는지"를 관리자 화면에 보여주기 위한 하트비트.
//
// 설치·서버·설정이 전혀 필요 없게, 팀이 이미 함께 쓰는 면접 캘린더에 "보이지 않는 기록장"
// 이벤트 하나를 두고 거기 description(JSON)에 각자 마지막 접속 시각을 적는다.
//   · 날짜를 2000-01-01로 두어 앱의 어떤 화면(-30일~+90일 창)에도, 일정 목록에도 뜨지 않는다.
//   · 이벤트 id를 고정해 모든 PC가 같은 기록장을 본다. 없으면 처음 실행한 앱이 만든다.
//   · 1분마다 자기 줄만 갱신하고, 30분 넘게 조용한 사람은 자동으로 지운다.
// 기록되는 값: 사내 계정·이름·앱 버전·보고 있는 화면·PC 이름. 후보자/이력서 데이터는 없다.
const os = require('node:os');
const store = require('./store.cjs');

let google = null;
function gapi() {
  if (!google) google = require('./google.cjs');
  return google;
}

// 면접 캘린더 (팀 전원이 쓰기 권한을 가진 유일한 공용 캘린더)
const CAL_ID =
  'c_d2a3298862ba8bba109c13c83c2cc7c1ac85560bdc12a305c40c79f6964c65a2@group.calendar.google.com';
// 캘린더 이벤트 id 규칙: a-v, 0-9 만 사용 가능
const EVENT_ID = 'cncapppresence00000000000000';
const MARK_DATE = '2000-01-01'; // 화면에 안 보이도록 아주 과거로
const MARK_END = '2000-01-02'; // 종일 일정은 end가 start보다 커야 한다
const ONLINE_MS = 3 * 60 * 1000; // 3분 내 신호 = 사용 중
const KEEP_MS = 30 * 60 * 1000; // 30분 넘으면 목록에서 제거

let timer = null;
let currentPage = '';
let appVersion = '';
let lastRead = { at: 0, users: [] };
let lastPingAt = 0; // 화면 이동이 잦아도 API를 몰아치지 않게 (Rate Limit 방지)

function me() {
  const p = store.get('googleProfile') || {};
  return p.email ? p : null;
}

/** 기록장 이벤트를 읽어 { email: rec } 맵으로 돌려준다 (없으면 빈 맵) */
async function readBoard() {
  const g = gapi();
  const items = await g.listCalendar(
    `${MARK_DATE}T00:00:00Z`,
    `${MARK_DATE}T23:59:59Z`,
    CAL_ID
  );
  const ev = (items || []).find((e) => e.id === EVENT_ID || (e.summary || '').includes('접속현황'));
  if (!ev) return { exists: false, map: {} };
  try {
    return { exists: true, map: JSON.parse(ev.description || '{}') || {} };
  } catch {
    return { exists: true, map: {} };
  }
}

async function writeBoard(map, exists) {
  const g = gapi();
  const body = {
    summary: '[시스템] 앱 접속현황 (지우지 마세요)',
    description: JSON.stringify(map),
    start: { date: MARK_DATE },
    end: { date: MARK_END },
    transparency: 'transparent',
    visibility: 'private',
  };
  if (exists) {
    await g.updateCalendarEvent(CAL_ID, EVENT_ID, body, 'none');
    return;
  }
  try {
    await g.insertCalendarEvent(CAL_ID, { ...body, id: EVENT_ID }, 'none');
  } catch (e) {
    // 다른 PC가 방금 만들었으면 409 — 그 위에 덮어쓴다
    const code = e?.code || e?.response?.status;
    if (code === 409) await g.updateCalendarEvent(CAL_ID, EVENT_ID, body, 'none');
    else throw e;
  }
}

function prune(map) {
  const now = Date.now();
  for (const [k, v] of Object.entries(map)) {
    if (!v || now - (v.lastSeen || 0) > KEEP_MS) delete map[k];
  }
  return map;
}

async function ping(force = false) {
  const p = me();
  if (!p) return; // 로그인 전에는 기록하지 않는다
  if (!force && Date.now() - lastPingAt < 5000) return;
  lastPingAt = Date.now();
  try {
    const { exists, map } = await readBoard();
    map[p.email.toLowerCase()] = {
      email: p.email,
      name: p.name || '',
      page: currentPage,
      version: appVersion,
      platform: process.platform,
      host: os.hostname(),
      lastSeen: Date.now(),
    };
    await writeBoard(prune(map), exists);
    lastRead = { at: Date.now(), users: Object.values(map) };
  } catch (e) {
    // 캘린더가 잠시 안 되더라도 앱 동작에는 영향 없음
    if (process.env.PRESENCE_DEBUG) console.log("[presence] ping fail:", e && e.message);
  }
}

function start(version) {
  appVersion = version || '';
  if (timer) return;
  setTimeout(() => void ping(), 5000); // 로그인 복구까지 잠깐 여유
  timer = setInterval(() => void ping(), 60_000);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function setPage(page) {
  const next = String(page || '').slice(0, 40);
  if (next === currentPage) return;
  currentPage = next;
  void ping(); // 화면을 옮기면 곧바로 반영
}

/** 관리자 화면용 — 현재 접속자 목록 */
async function list() {
  const { map } = await readBoard();
  const users = Object.values(prune(map)).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return { configured: true, now: Date.now(), onlineMs: ONLINE_MS, users };
}

module.exports = { start, stop, setPage, ping, list, lastRead };
