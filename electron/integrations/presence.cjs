// 접속 현황(presence) — 배포된 앱들이 "지금 누가 쓰고 있는지"를 관리자에게 알리기 위한 하트비트.
//
// 동작
//   · 1분마다 Cloudflare Worker(/presence)로 { 이메일, 이름, 버전, 보고 있는 화면 }을 보낸다.
//   · Worker는 KV에 5분 TTL로 저장하므로, 앱을 끄면 목록에서 자동으로 사라진다(별도 종료 신호 불필요).
//   · 서버 주소(cloudWorkerUrl)나 토큰이 없으면 아무것도 하지 않는다 — 조용히 비활성.
//   · 보내는 값은 사내 계정/버전/화면 이름뿐. 후보자 데이터는 절대 나가지 않는다.
const os = require('node:os');
const store = require('./store.cjs');

let timer = null;
let currentPage = '';
let appVersion = '';

function endpoint() {
  const base = store.get('cloudWorkerUrl');
  return base ? `${String(base).replace(/\/$/, '')}/presence` : null;
}

async function ping() {
  const url = endpoint();
  const token = store.get('presenceToken');
  if (!url || !token) return;
  const profile = store.get('googleProfile') || {};
  if (!profile.email) return; // 로그인 전에는 보고하지 않는다
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-presence-token': String(token) },
      body: JSON.stringify({
        email: profile.email,
        name: profile.name || '',
        page: currentPage,
        version: appVersion,
        platform: process.platform,
        host: os.hostname(),
      }),
    });
  } catch {
    // 오프라인이거나 서버가 없으면 그냥 넘어간다 (앱 동작에 영향 없음)
  }
}

function start(version) {
  appVersion = version || '';
  if (timer) return;
  void ping();
  timer = setInterval(ping, 60_000);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function setPage(page) {
  currentPage = String(page || '').slice(0, 40);
}

/** 관리자 화면용 — 현재 접속자 목록 조회 */
async function list() {
  const base = store.get('cloudWorkerUrl');
  const token = store.get('mobileAccessToken');
  if (!base || !token) return { configured: false, users: [] };
  const url = `${String(base).replace(/\/$/, '')}/presence?t=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`presence ${r.status}`);
  const j = await r.json();
  return { configured: true, now: j.now, users: j.users || [] };
}

module.exports = { start, stop, setPage, ping, list };
