#!/usr/bin/env node
/**
 * sync-snapshot.cjs
 *
 * 24/7 server-side sync runner — designed for GitHub Actions cron.
 * Fetches all configured Google Sheets + Google Calendar events using a stored
 * OAuth refresh token, writes a snapshot.json that the viewer build reads.
 *
 * Required env vars (provide via GitHub Secrets):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   SHEETS_CONFIG              JSON string — see scripts/sheets-config.example.json
 *
 * Optional:
 *   OUT_PATH                   default ./snapshot.json
 *   EXPORTED_BY                free-form label written into the snapshot
 *   CALENDAR_ID                default 'primary'
 *   CALENDAR_RANGE_PAST_DAYS   default 30
 *   CALENDAR_RANGE_FUTURE_DAYS default 90
 */

const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const SNAPSHOT_VERSION = 1;

// ★ 비공개 채용 키워드 — 일치하는 캘린더 이벤트는 snapshot에서 제외 (팀원 뷰어에 노출 X)
//    사용자(이형도)의 본체에는 maintainer-only private tracker로 별도 등록됨.
const CONFIDENTIAL_PATTERNS = [
  /볼트엑스/i,
  /이나영/,
  /서치펌|서치 ?폼|서치 ?펌/i,
  /비공개\s*(채용|면접|이력|후보)/,
  /\bC&D\b/i,
  /헤드헌팅|헤드 ?헌터/i,
];

function isConfidentialEvent(ev) {
  const haystack = [ev.summary || '', ev.description || '', ev.location || ''].join(' ');
  return CONFIDENTIAL_PATTERNS.some((re) => re.test(haystack));
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[sync] FATAL: missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

function loadConfig() {
  if (process.env.SHEETS_CONFIG) {
    try {
      return JSON.parse(process.env.SHEETS_CONFIG);
    } catch (e) {
      console.error('[sync] FATAL: SHEETS_CONFIG is not valid JSON:', e.message);
      process.exit(1);
    }
  }
  const filePath = path.join(__dirname, 'sheets-config.json');
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  console.error('[sync] FATAL: no SHEETS_CONFIG env and no scripts/sheets-config.json');
  process.exit(1);
}

async function buildOAuth() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function fetchSheet(auth, spreadsheetId) {
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties',
  });
  const tabs = (meta.data.sheets || []).map((s) => s.properties.title);

  const drv = await drive.files.get({ fileId: spreadsheetId, fields: 'modifiedTime' });

  const ranges = tabs.map((t) => `'${t.replace(/'/g, "''")}'`);
  const data = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const tabsOut = {};
  (data.data.valueRanges || []).forEach((vr, i) => {
    tabsOut[tabs[i]] = vr.values || [];
  });

  return {
    title: meta.data.properties.title,
    modifiedTime: drv.data.modifiedTime || new Date().toISOString(),
    tabs: tabsOut,
  };
}

async function fetchCalendar(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = process.env.CALENDAR_ID || 'primary';
  const pastDays = Number(process.env.CALENDAR_RANGE_PAST_DAYS || 30);
  const futureDays = Number(process.env.CALENDAR_RANGE_FUTURE_DAYS || 90);

  const now = Date.now();
  const timeMin = new Date(now - pastDays * 86400e3).toISOString();
  const timeMax = new Date(now + futureDays * 86400e3).toISOString();

  const items = [];
  let pageToken;
  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    });
    items.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  let total = items.length;
  let dropped = 0;
  const events = [];
  for (const e of items) {
    if (e.status === 'cancelled') continue;
    if (isConfidentialEvent(e)) {
      dropped += 1;
      continue;
    }
    const start = e.start || {};
    const end = e.end || {};
    events.push({
      id: e.id,
      summary: e.summary || '',
      description: e.description || '',
      location: e.location || '',
      colorId: e.colorId || null,
      allDay: !start.dateTime,
      start: start.dateTime || start.date || null,
      end: end.dateTime || end.date || null,
      timeZone: start.timeZone || null,
      htmlLink: e.htmlLink || null,
      attendees: (e.attendees || []).map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
        organizer: !!a.organizer,
        self: !!a.self,
      })),
      conferenceUrl: e.conferenceData?.entryPoints?.[0]?.uri || e.hangoutLink || null,
      status: e.status || 'confirmed',
      updated: e.updated || null,
    });
  }

  console.log(`[sync] calendar: ${total - dropped}/${total} events kept (${dropped} confidential filtered)`);
  return { events, fetchedAt: new Date().toISOString(), calendarId, range: { timeMin, timeMax } };
}

async function main() {
  const config = loadConfig();
  const auth = await buildOAuth();

  const sheetsOut = {};
  const spreadsheetIds = config.sheetIds || [];
  if (!spreadsheetIds.length) {
    console.error('[sync] FATAL: config.sheetIds is empty');
    process.exit(1);
  }

  console.log(`[sync] fetching ${spreadsheetIds.length} sheet(s)...`);
  for (const id of spreadsheetIds) {
    try {
      const data = await fetchSheet(auth, id);
      sheetsOut[id] = data;
      console.log(`[sync]   ✓ ${data.title} (${Object.keys(data.tabs).length} tabs, modified ${data.modifiedTime})`);
    } catch (e) {
      console.error(`[sync]   ✗ ${id}: ${e.message}`);
    }
  }

  let calendarOut = null;
  try {
    console.log('[sync] fetching calendar events...');
    calendarOut = await fetchCalendar(auth);
  } catch (e) {
    console.error(`[sync] calendar fetch failed (non-fatal): ${e.message}`);
  }

  const snapshot = {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: process.env.EXPORTED_BY || 'github-actions',
    appName: 'CNC 채용 커맨드센터',
    sheets: sheetsOut,
    mappings: config.mappings || {},
    calendar: calendarOut, // null if fetch failed (snapshot still usable)
  };

  const outPath = process.env.OUT_PATH || path.join(process.cwd(), 'snapshot.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  const eventCount = calendarOut?.events?.length || 0;
  console.log(`[sync] wrote ${outPath} (${Object.keys(sheetsOut).length} sheets, ${eventCount} cal events)`);
}

main().catch((e) => {
  console.error('[sync] FATAL:', e?.stack || e?.message || e);
  process.exit(1);
});
