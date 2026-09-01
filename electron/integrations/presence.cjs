// 접속 현황 — "지금 이 앱을 누가 쓰고 있는지" (구글 스프레드시트 접속자 표시와 같은 개념).
//
// 방식: 각 사용자의 앱이 자기 구글 드라이브에 작은 JSON 파일 하나(cnc-app-presence.json)를
//       만들어 1분마다 갱신하고, 처음 만들 때 관리자에게 읽기 권한만 준다.
//       관리자 앱은 그 파일들을 모아 목록으로 보여준다.
//   · 설치·서버·공유폴더·캘린더 전부 필요 없음. 앱이 알아서 만든다.
//   · drive.file 스코프라 앱이 만든 이 파일 외에는 사용자의 어떤 파일도 건드리지 않는다.
//   · 기록 항목: 계정·이름·앱 버전·보고 있는 화면·PC 이름. 후보자/이력서 데이터는 없다.
const os = require('node:os');
const store = require('./store.cjs');

let google = null;
function gapi() {
  if (!google) google = require('./google.cjs');
  return google;
}

const ADMIN_EMAIL = 'hdlee@cnccosmetic.com'; // 접속 현황을 보는 관리자
const ONLINE_MS = 3 * 60 * 1000; // 3분 내 신호 = 사용 중
const KEEP_MS = 30 * 60 * 1000; // 30분 넘게 조용하면 목록에서 제외

let timer = null;
let currentPage = '';
let appVersion = '';
let lastPingAt = 0;

function me() {
  const p = store.get('googleProfile') || {};
  return p.email ? p : null;
}

async function ping(force = false) {
  const p = me();
  if (!p) return; // 로그인 전에는 기록하지 않는다
  if (!force && Date.now() - lastPingAt < 5000) return;
  lastPingAt = Date.now();
  try {
    await gapi().upsertPresenceFile(
      {
        email: p.email,
        name: p.name || '',
        page: currentPage,
        version: appVersion,
        platform: process.platform,
        host: os.hostname(),
        lastSeen: Date.now(),
      },
      p.email.toLowerCase() === ADMIN_EMAIL ? null : ADMIN_EMAIL
    );
  } catch (e) {
    if (process.env.PRESENCE_DEBUG) console.log('[presence] ping fail:', e && e.message);
  }
}

function start(version) {
  appVersion = version || '';
  if (timer) return;
  setTimeout(() => void ping(true), 5000); // 로그인 복구까지 잠깐 여유
  timer = setInterval(() => void ping(true), 60_000);
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
  const now = Date.now();
  let users = [];
  try {
    users = await gapi().readPresenceFiles();
  } catch (e) {
    return { configured: true, now, onlineMs: ONLINE_MS, users: [], error: e.message };
  }
  const seen = new Map();
  for (const u of users) {
    if (!u.email || now - (u.lastSeen || 0) > KEEP_MS) continue;
    const k = String(u.email).toLowerCase();
    const prev = seen.get(k);
    if (!prev || (u.lastSeen || 0) > prev.lastSeen) seen.set(k, u);
  }
  return {
    configured: true,
    now,
    onlineMs: ONLINE_MS,
    users: [...seen.values()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)),
  };
}

module.exports = { start, stop, setPage, ping, list };
