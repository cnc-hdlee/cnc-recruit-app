// CNC 채용 클라우드 호스팅 Worker
// - 정적 viewer (dist-viewer/) ASSETS binding으로 서빙
// - /snapshot.json → KV에 cache된 라이브 데이터 즉시 응답
// - 5분마다 Cron 트리거가 Google Sheets/Calendar 직접 fetch → KV 업데이트
// - 인증: URL ?t=<TOKEN> 첫 클릭 → 90일 cookie. 토큰 없으면 401.
// - 비공개 채용 (이나영/볼트엑스/서치펌 등) 키워드는 응답 직전 한 번 더 필터.

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  SNAPSHOT_KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  ACCESS_TOKEN: string; // URL token shown to the maintainer
  PRESENCE_TOKEN: string; // 배포된 앱이 접속 현황을 보고할 때 쓰는 토큰
  SHEET_IDS: string; // JSON array
  CALENDAR_IDS: string; // JSON array
  MAPPINGS: string; // JSON object
}

const SNAPSHOT_KEY = 'snapshot:current';
const COOKIE_NAME = 'cnc_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

const CONFIDENTIAL = [
  /볼트엑스/i,
  /이나영/,
  /서치펌|서치 ?폼|서치 ?펌/i,
  /비공개\s*(채용|면접|이력|후보)/,
  /\bC&D\b/i,
  /헤드헌팅|헤드 ?헌터/i,
];
const isConfidential = (...parts: (string | undefined | null)[]) =>
  CONFIDENTIAL.some((re) => re.test(parts.filter(Boolean).join(' ')));

// ---- auth ----
function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}
const isAuthed = (req: Request, expected: string) =>
  parseCookies(req.headers.get('cookie'))[COOKIE_NAME] === expected;

function unauthorizedHTML(): Response {
  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>접근 차단</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,sans-serif;background:#0b001f;color:#dfd7f9;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.card{max-width:420px;padding:32px;background:#181838;border-radius:16px}h1{margin:0 0 8px;color:#cac3e4;font-size:20px}p{margin:8px 0;color:#a49dbe;font-size:14px;line-height:1.6}</style></head>
<body><div class="card"><h1>🔒 접근 권한 필요</h1>
<p>본체 앱 ⚙️ 설정 페이지에서 발급된 URL로만 접속할 수 있어요.</p></div></body></html>`,
    { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ---- Google OAuth (refresh token → access token) ----
let cachedAccessToken: { token: string; exp: number } | null = null;
async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.exp - 60_000 > now) return cachedAccessToken.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`oauth refresh failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: j.access_token, exp: now + j.expires_in * 1000 };
  return j.access_token;
}

// ---- Sheets / Drive ----
async function fetchSheetMeta(spreadsheetId: string, token: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`sheet meta ${spreadsheetId}: ${r.status}`);
  const j = (await r.json()) as any;
  return {
    title: j.properties?.title || spreadsheetId,
    tabs: (j.sheets || []).map((s: any) => s.properties.title as string),
  };
}

async function fetchSheetValues(spreadsheetId: string, tabs: string[], token: string) {
  if (tabs.length === 0) return {} as Record<string, string[][]>;
  const ranges = tabs.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`sheet values ${spreadsheetId}: ${r.status}`);
  const j = (await r.json()) as any;
  const out: Record<string, string[][]> = {};
  (j.valueRanges || []).forEach((vr: any, i: number) => {
    out[tabs[i]] = vr.values || [];
  });
  return out;
}

async function fetchDriveModifiedTime(spreadsheetId: string, token: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return '';
  const j = (await r.json()) as any;
  return j.modifiedTime || '';
}

async function fetchCalendarEvents(calendarId: string, timeMin: string, timeMax: string, token: string) {
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=250`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [] as any[];
  const j = (await r.json()) as any;
  return (j.items || []).map((e: any) => ({
    id: e.id,
    calendarId,
    summary: e.summary || '',
    description: e.description || '',
    location: e.location || '',
    colorId: e.colorId || null,
    allDay: !e.start?.dateTime,
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    timeZone: e.start?.timeZone || null,
    htmlLink: e.htmlLink || null,
    attendees: (e.attendees || []).map((a: any) => ({
      email: a.email,
      responseStatus: a.responseStatus,
      organizer: !!a.organizer,
      self: !!a.self,
    })),
    conferenceUrl: e.conferenceData?.entryPoints?.[0]?.uri || e.hangoutLink || null,
    status: e.status || 'confirmed',
    updated: null,
  }));
}

// ---- snapshot builder ----
async function buildSnapshot(env: Env): Promise<any> {
  const token = await getAccessToken(env);
  const sheetIds: string[] = JSON.parse(env.SHEET_IDS);
  const calendarIds: string[] = JSON.parse(env.CALENDAR_IDS);
  const mappings = JSON.parse(env.MAPPINGS);

  // Sheets in parallel
  const sheetResults = await Promise.all(
    sheetIds.map(async (id) => {
      try {
        const [meta, modifiedTime] = await Promise.all([
          fetchSheetMeta(id, token),
          fetchDriveModifiedTime(id, token),
        ]);
        const tabsData = await fetchSheetValues(id, meta.tabs, token);
        return { id, ok: true as const, title: meta.title, modifiedTime, tabs: tabsData };
      } catch (e: any) {
        return { id, ok: false as const, error: e.message || String(e) };
      }
    })
  );
  const sheets: Record<string, { title: string; modifiedTime: string; tabs: Record<string, string[][]> }> = {};
  for (const r of sheetResults) {
    if (r.ok) sheets[r.id] = { title: r.title, modifiedTime: r.modifiedTime, tabs: r.tabs };
  }

  // Calendar in parallel
  const now = Date.now();
  const timeMin = new Date(now - 30 * 86400e3).toISOString();
  const timeMax = new Date(now + 90 * 86400e3).toISOString();
  const calResults = await Promise.all(calendarIds.map((id) => fetchCalendarEvents(id, timeMin, timeMax, token)));
  const seen = new Set<string>();
  const events: any[] = [];
  for (const items of calResults) {
    for (const e of items) {
      if (!e.id || seen.has(e.id)) continue;
      if (isConfidential(e.summary, e.description, e.location)) continue;
      seen.add(e.id);
      events.push(e);
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: 'cloud-worker',
    appName: 'CNC 채용',
    sheets,
    mappings,
    calendar: {
      events,
      fetchedAt: new Date().toISOString(),
      calendarId: 'merged',
      range: { timeMin, timeMax },
    },
  };
}

async function refreshSnapshotKV(env: Env): Promise<void> {
  const snap = await buildSnapshot(env);
  await env.SNAPSHOT_KV.put(SNAPSHOT_KEY, JSON.stringify(snap), {
    // Cache for 30 minutes — Cron refreshes every 5 min, but in case Cron is delayed.
    expirationTtl: 60 * 30,
  });
}

// ---- HTTP entry ----
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Healthcheck — public
    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, ts: Date.now() });
    }

    // ── 접속 현황(presence) ────────────────────────────────────────────────
    // 배포된 앱들이 1분마다 자기 상태를 여기로 보내고, 관리자만 목록을 본다.
    // KV TTL(5분)로 저장하므로 앱을 끄면 목록에서 자동으로 사라진다.
    if (url.pathname === '/presence' && req.method === 'POST') {
      // 앱에 심어둔 토큰으로만 기록 가능 (아무나 못 밀어넣게)
      const token = req.headers.get('x-presence-token') || '';
      if (!env.PRESENCE_TOKEN || token !== env.PRESENCE_TOKEN) {
        return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false, error: 'bad json' }, { status: 400 });
      }
      const email = String(body.email || '').toLowerCase().trim();
      if (!email) return Response.json({ ok: false, error: 'no email' }, { status: 400 });
      const rec = {
        email,
        name: String(body.name || '').slice(0, 40),
        page: String(body.page || '').slice(0, 40),
        version: String(body.version || '').slice(0, 20),
        platform: String(body.platform || '').slice(0, 20),
        host: String(body.host || '').slice(0, 40),
        lastSeen: Date.now(),
      };
      await env.SNAPSHOT_KV.put(`presence:${email}`, JSON.stringify(rec), { expirationTtl: 300 });
      return Response.json({ ok: true });
    }

    if (url.pathname === '/presence' && req.method === 'GET') {
      // 조회는 관리자 토큰(=뷰어 접속 토큰)을 가진 사람만
      const q = url.searchParams.get('t');
      if (!isAuthed(req, env.ACCESS_TOKEN) && q !== env.ACCESS_TOKEN) {
        return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
      const list = await env.SNAPSHOT_KV.list({ prefix: 'presence:' });
      const users: any[] = [];
      for (const k of list.keys) {
        const v = await env.SNAPSHOT_KV.get(k.name);
        if (v) {
          try {
            users.push(JSON.parse(v));
          } catch {
            /* skip */
          }
        }
      }
      users.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      return Response.json(
        { ok: true, now: Date.now(), users },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Auth: URL token → set cookie & redirect to /
    const t = url.searchParams.get('t');
    if (t) {
      if (t !== env.ACCESS_TOKEN) return unauthorizedHTML();
      const cookie = `${COOKIE_NAME}=${env.ACCESS_TOKEN}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax; Secure`;
      return new Response(null, {
        status: 302,
        headers: { 'Set-Cookie': cookie, Location: '/', 'Cache-Control': 'no-store' },
      });
    }
    if (!isAuthed(req, env.ACCESS_TOKEN)) return unauthorizedHTML();

    // Snapshot — read from KV; if cold, build on demand.
    if (url.pathname === '/snapshot.json' || url.pathname === '/api/snapshot') {
      let raw = await env.SNAPSHOT_KV.get(SNAPSHOT_KEY);
      if (!raw) {
        try {
          await refreshSnapshotKV(env);
          raw = await env.SNAPSHOT_KV.get(SNAPSHOT_KEY);
        } catch (e: any) {
          return Response.json({ error: e.message || String(e) }, { status: 500 });
        }
      }
      return new Response(raw || '{}', {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Manual refresh (debugging)
    if (url.pathname === '/__refresh') {
      ctx.waitUntil(refreshSnapshotKV(env));
      return Response.json({ ok: true, scheduled: true });
    }

    // Static viewer
    return env.ASSETS.fetch(req);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refreshSnapshotKV(env).catch((e) => {
        console.error('[scheduled] refresh failed:', e?.message || e);
      })
    );
  },
};
