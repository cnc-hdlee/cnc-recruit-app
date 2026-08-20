// Mobile LAN bridge — serves the viewer build (dist-viewer/) on the local network
// and exposes /snapshot.json built on-the-fly from the live maintainer state, so phones
// on the same Wi-Fi see the same data the desktop app does.
//
// Read-only. Sheets data comes from sync.cjs's in-memory cache; calendar is fetched
// directly via google.cjs each request (cached briefly). No write endpoints.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { exec } = require('node:child_process');

const sync = require('./integrations/sync.cjs');
const store = require('./integrations/store.cjs');
const google = require('./integrations/google.cjs');

const PORT = 5274;

// ---- Auth ----
// One-shot URL token: the maintainer shares a URL that includes ?t=<token>.
// First request with a valid token sets a long-lived cookie and redirects to /.
// All subsequent requests rely on the cookie. Anyone without the URL or cookie is blocked.

function getOrCreateAuthToken() {
  let t = store.get('mobileAccessToken');
  if (typeof t === 'string' && t.length >= 24) return t;
  t = crypto.randomBytes(18).toString('base64url');
  store.set('mobileAccessToken', t);
  return t;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function isAuthed(req) {
  const token = getOrCreateAuthToken();
  const cookies = parseCookies(req.headers.cookie);
  return cookies.cnc_auth === token;
}
const VIEWER_DIR_CANDIDATES = [
  path.join(__dirname, '..', 'dist-viewer'),
  path.join(process.resourcesPath || '', 'dist-viewer'),
];

// Calendars to merge into the snapshot.
// ※ src/lib/sharedCalendars.ts 의 READ_CALENDAR_IDS와 반드시 동일하게 유지할 것.
//   (여기가 뒤처져서 폰 화면에만 면접이 통째로 안 뜨던 이력 있음 — 2026-08-20)
const READ_CALENDAR_IDS = [
  'primary',
  'c_d2a3298862ba8bba109c13c83c2cc7c1ac85560bdc12a305c40c79f6964c65a2@group.calendar.google.com', // 면접 (메인)
  'c_711021d8db3140f0fa36874c11e98a449ee5528637e020d891cf903cd4b8c443@group.calendar.google.com', // 면접 (shim 보조)
  'c_21d3c76327cd3e4ab66cb7f7cfdb6f1a7c63500dd0d8af17212640edee2c5459@group.calendar.google.com', // 면접 (채용매니저)
  'c_bebeafad40540c7c46a8b75315ef413571d6f9fb13ef74c0f31cca541bd93587@group.calendar.google.com', // 면접 (서울 4E 등)
  'c_e006d0f491165344836f40c2589456a597676d6d551c00a477e5fe6c46a8804f@group.calendar.google.com', // 입사
  'c_6b893ca53cb3b057d4e04928dffae5408a3b4c81332b561668190094bf09c2a7@group.calendar.google.com', // 퇴사
];

const CONFIDENTIAL_PATTERNS = [
  /볼트엑스/i,
  /이나영/,
  /서치펌|서치 ?폼|서치 ?펌/i,
  /비공개\s*(채용|면접|이력|후보)/,
  /\bC&D\b/i,
  /헤드헌팅|헤드 ?헌터/i,
];
function isConfidential(...parts) {
  const s = parts.filter(Boolean).join(' ');
  return CONFIDENTIAL_PATTERNS.some((re) => re.test(s));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function resolveViewerDir() {
  for (const p of VIEWER_DIR_CANDIDATES) {
    if (p && fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) return p;
  }
  return null;
}

function getLanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push({ name, address: iface.address });
    }
  }
  // Prefer non-virtual adapters first (rough heuristic — drop names starting with VirtualBox/VMware/Loopback)
  out.sort((a, b) => {
    const va = /virtual|vmware|hyper-v|wsl|docker|bluetooth/i.test(a.name) ? 1 : 0;
    const vb = /virtual|vmware|hyper-v|wsl|docker|bluetooth/i.test(b.name) ? 1 : 0;
    return va - vb;
  });
  return out;
}

// ---- snapshot builder ----

let lastCalendar = null; // { events, fetchedAt }
let lastCalendarAt = 0;
const CALENDAR_TTL_MS = 30_000; // refresh every 30s at most

async function fetchCalendarEvents() {
  const now = Date.now();
  if (lastCalendar && now - lastCalendarAt < CALENDAR_TTL_MS) return lastCalendar;
  try {
    const timeMin = new Date(now - 30 * 86400e3).toISOString();
    const timeMax = new Date(now + 90 * 86400e3).toISOString();
    // 같은 이벤트가 primary 초대 사본 + 공유 캘린더 원본 두 벌로 들어온다.
    // 제목은 primary 사본에만, colorId/소속 캘린더는 공유 사본에만 있으므로 필드별로 병합한다.
    // (src/store/liveData.ts refreshCalendarFromGoogle과 동일 규칙)
    const byId = new Map();
    for (const calId of READ_CALENDAR_IDS) {
      try {
        const items = await google.listCalendar(timeMin, timeMax, calId);
        for (const e of items) {
          if (!e.id) continue;
          if (isConfidential(e.summary, e.description, e.location)) continue;
          const arr = byId.get(e.id);
          if (arr) arr.push({ calId, e });
          else byId.set(e.id, [{ calId, e }]);
        }
      } catch {
        // single-calendar failure is non-fatal
      }
    }
    const events = [];
    {
      for (const copies of byId.values()) {
        const base = copies.find((c) => (c.e.summary || '').trim()) || copies[0];
        const shared = copies.find((c) => c.calId !== 'primary');
        const pick = (get) =>
          (get(base.e) || '').trim() ||
          copies.map((c) => (get(c.e) || '').trim()).find(Boolean) ||
          '';
        {
          const e = base.e;
          const calId = shared ? shared.calId : base.calId;
          events.push({
            id: e.id,
            calendarId: calId,
            summary: pick((x) => x.summary),
            description: pick((x) => x.description),
            location: pick((x) => x.location),
            colorId: (shared && shared.e.colorId) || e.colorId || null,
            allDay: e.allDay,
            start: e.start || null,
            end: e.end || null,
            timeZone: e.timeZone,
            htmlLink: e.htmlLink || null,
            attendees: (e.attendees || []).map((a) => ({
              email: a.email,
              responseStatus: a.responseStatus,
              organizer: a.organizer,
              self: a.self,
            })),
            conferenceUrl: e.conferenceUrl,
            status: e.status || 'confirmed',
            updated: null,
          });
        }
      }
    }
    lastCalendar = {
      events,
      fetchedAt: new Date().toISOString(),
      calendarId: 'merged',
      range: { timeMin, timeMax },
    };
    lastCalendarAt = now;
  } catch {
    // keep previous lastCalendar
  }
  return lastCalendar;
}

async function buildSnapshot() {
  const ids = sync.collectSheetIds();
  const sheets = {};
  for (const id of ids) {
    const cached = sync.getCached(id);
    const status = (sync.getStatus() || []).find((s) => s.spreadsheetId === id);
    if (cached) {
      sheets[id] = {
        title: cached.title,
        modifiedTime: status?.lastModified || '',
        tabs: cached.tabs,
      };
    }
  }
  const mappings = store.get('sheetMappings') || {};
  const profile = store.get('googleProfile') || null;
  const calendar = await fetchCalendarEvents();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: profile?.email,
    appName: 'CNC 채용 커맨드센터',
    sheets,
    mappings,
    calendar,
  };
}

// ---- HTTP server ----

let server = null;
let viewerDir = null;

function safeJoin(base, p) {
  const target = path.normalize(path.join(base, p));
  if (!target.startsWith(base)) return null;
  return target;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(body);
}

async function handle(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(u.pathname);

  // CORS preflight (snapshot fetched cross-origin if user opens viewer elsewhere)
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', { 'Access-Control-Allow-Methods': 'GET,OPTIONS' });
  }
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed');

  // One-shot helper: expose refresh_token to local DEPLOY.ps1 so it can upload it as
  // a Cloudflare Worker secret. Localhost-only, requires URL token. Handled BEFORE the
  // generic ?t= → cookie redirect, so it actually returns JSON.
  if (pathname === '/__reveal_refresh_token') {
    const remote = req.socket.remoteAddress || '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLocal) return send(res, 403, 'forbidden');
    const expected = getOrCreateAuthToken();
    if (u.searchParams.get('t') !== expected) return send(res, 401, 'bad token');
    const tokens = store.get('googleTokens') || {};
    return send(
      res,
      200,
      JSON.stringify({ refresh_token: tokens.refresh_token || null }),
      { 'Content-Type': 'application/json; charset=utf-8' }
    );
  }

  // ---- Auth gate ----
  // 1) URL token — first visit via the one-shot URL: set cookie, redirect to /
  const urlToken = u.searchParams.get('t');
  if (urlToken) {
    const expected = getOrCreateAuthToken();
    if (urlToken === expected) {
      // 90-day cookie. trycloudflare URL is HTTPS so Secure is OK; we set both flavors so LAN HTTP works too.
      const isHttps = (req.headers['x-forwarded-proto'] || '').includes('https');
      const cookie = `cnc_auth=${expected}; Path=/; Max-Age=${60 * 60 * 24 * 90}; HttpOnly; SameSite=Lax${isHttps ? '; Secure' : ''}`;
      res.writeHead(302, {
        'Set-Cookie': cookie,
        Location: '/',
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    return send(res, 403, '<h1>잘못된 접속 토큰</h1><p>본체에서 새 URL을 발급받아 다시 접속하세요.</p>', {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }

  // 2) Public-allowed paths (without auth): healthz, manifest icons (so install prompt works without flash of 401)
  const PUBLIC_PATHS = new Set(['/healthz']);
  if (!PUBLIC_PATHS.has(pathname) && !isAuthed(req)) {
    return send(
      res,
      401,
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>접근 차단</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b001f;color:#dfd7f9;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
        .card{max-width:420px;padding:32px;background:#181838;border-radius:16px}
        h1{margin:0 0 8px;color:#cac3e4;font-size:20px}p{margin:8px 0;color:#a49dbe;font-size:14px;line-height:1.6}</style></head>
        <body><div class="card"><h1>🔒 접근 권한 필요</h1>
        <p>본체 PC에서 발급받은 1회성 URL로만 접속할 수 있어요.<br>본체 앱 설정 페이지에서 URL을 다시 받아주세요.</p></div></body></html>`,
      { 'Content-Type': 'text/html; charset=utf-8' }
    );
  }

  // Live snapshot
  if (pathname === '/snapshot.json' || pathname === '/api/snapshot') {
    try {
      const snap = await buildSnapshot();
      return send(res, 200, JSON.stringify(snap), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message || String(e) }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
  }

  // Health
  if (pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ ok: true, ts: Date.now() }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }

  // Static viewer
  if (!viewerDir) {
    return send(
      res,
      503,
      `<html><body style="font-family:sans-serif;padding:32px;background:#0b0d12;color:#eee">
        <h2>📱 모바일 뷰어가 아직 빌드되지 않았어요</h2>
        <p>본체 PC에서 다음 명령을 한 번 실행하세요:</p>
        <pre style="background:#222;padding:12px;border-radius:8px">cd Desktop\\CNC-Recruit-App
npm run build:viewer</pre>
        <p>그 다음 본체 앱을 재시작하면 같은 URL에서 모바일 뷰어가 열려요.</p>
      </body></html>`,
      { 'Content-Type': 'text/html; charset=utf-8' }
    );
  }

  let rel = pathname === '/' ? '/index.html' : pathname;
  let filePath = safeJoin(viewerDir, rel);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(viewerDir, 'index.html');
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    return send(res, 200, data, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    });
  } catch (e) {
    return send(res, 500, `Read error: ${e.message}`);
  }
}

function ensureFirewallRule(port) {
  // Best-effort: adds an inbound TCP allow rule if one doesn't exist.
  // Requires admin; failures are silently ignored — user can manually allow.
  const ruleName = `CNC Recruit Mobile Bridge (${port})`;
  const cmd = `netsh advfirewall firewall show rule name="${ruleName}" >NUL 2>&1 || netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port}`;
  exec(cmd, { windowsHide: true }, () => {
    /* ignored */
  });
}

function start() {
  if (server) return { url: null, ips: getLanIPs(), port: PORT };
  // Pre-create the auth token so the URL we hand to the user works on first click.
  getOrCreateAuthToken();
  viewerDir = resolveViewerDir();
  server = http.createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, e.message || String(e)));
  });
  server.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[mobile-server] error', err.message);
  });
  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLanIPs();
    // eslint-disable-next-line no-console
    console.info(
      `[mobile-server] listening on 0.0.0.0:${PORT}\n  Phone URLs:\n` +
        ips.map((i) => `   • http://${i.address}:${PORT}   (${i.name})`).join('\n')
    );
    ensureFirewallRule(PORT);
  });
  return { url: null, ips: getLanIPs(), port: PORT };
}

function stop() {
  if (server) {
    try {
      server.close();
    } catch {}
    server = null;
  }
}

function getInfo() {
  return {
    port: PORT,
    listening: !!server,
    viewerBuilt: !!resolveViewerDir(),
    ips: getLanIPs(),
  };
}

module.exports = { start, stop, getInfo };
