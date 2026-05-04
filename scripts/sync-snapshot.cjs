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
const { WebClient: SlackWebClient } = require('@slack/web-api');

const SNAPSHOT_VERSION = 2; // bumped: adds gmail + slack sections

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
        name: a.displayName || null,
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

// Gmail — read-only. Defaults to last 30 days, recruit-relevant queries only.
// Confidential threads (이나영/볼트엑스 etc.) are filtered post-fetch using subject/snippet.
async function fetchGmail(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const query = process.env.GMAIL_QUERY || 'newer_than:30d -category:promotions -in:spam';
  const max = Number(process.env.GMAIL_MAX || 120);

  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
  const msgs = list.data.messages || [];

  const detailed = [];
  for (const m of msgs) {
    try {
      const det = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
      });
      const h = (name) => (det.data.payload.headers || []).find((x) => x.name === name)?.value || '';
      const subject = h('Subject');
      const snippet = det.data.snippet || '';
      // Confidential filter — same patterns as calendar
      const blob = `${subject} ${snippet}`;
      if (CONFIDENTIAL_PATTERNS.some((re) => re.test(blob))) continue;
      detailed.push({
        id: m.id,
        threadId: m.threadId,
        snippet,
        from: h('From'),
        to: h('To'),
        cc: h('Cc'),
        subject,
        date: h('Date'),
        labelIds: det.data.labelIds || [],
      });
    } catch (e) {
      // skip individual message errors, keep going
    }
  }
  console.log(`[sync] gmail: ${detailed.length}/${msgs.length} messages kept (rest confidential or errored)`);
  return { messages: detailed, fetchedAt: new Date().toISOString(), query };
}

// Slack — read-only. Pulls priority channels (per project memory) + DMs of key contacts.
// Skips entirely if SLACK_TOKEN is not set (so existing setups keep working without breakage).
const SLACK_PRIORITY_KEYWORDS = ['team_people-culture', 'team_talent-acquisition', '캔디드', '코공고', 'people', 'talent', '채용', '인사'];
const SLACK_PRIORITY_DM_NAMES = ['허필중', '임세현'];

async function fetchSlack() {
  const token = process.env.SLACK_TOKEN;
  if (!token) {
    console.log('[sync] slack: SLACK_TOKEN not set — skipping');
    return null;
  }
  const client = new SlackWebClient(token);

  // 1) list channels (paginated)
  const allChannels = [];
  let cursor;
  do {
    const r = await client.conversations.list({
      types: 'public_channel,private_channel,im',
      limit: 1000,
      exclude_archived: true,
      cursor,
    });
    allChannels.push(...(r.channels || []));
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor && allChannels.length < 5000);

  // 2) bulk-fetch user names for IM resolution
  const userMap = {};
  try {
    let uCursor;
    do {
      const ur = await client.users.list({ limit: 1000, cursor: uCursor });
      (ur.members || []).forEach((u) => {
        userMap[u.id] = u.real_name || u.profile?.real_name_normalized || u.profile?.display_name || u.name || u.id;
      });
      uCursor = ur.response_metadata?.next_cursor || undefined;
    } while (uCursor);
  } catch (e) {
    // names will fall back to user IDs
  }

  // 3) pick priority channels + DMs
  const priorityChannels = allChannels.filter((c) =>
    !c.is_im && SLACK_PRIORITY_KEYWORDS.some((kw) => (c.name || '').toLowerCase().includes(kw.toLowerCase()))
  );
  const priorityDMs = allChannels.filter(
    (c) => c.is_im && SLACK_PRIORITY_DM_NAMES.some((n) => (userMap[c.user] || '').includes(n))
  );
  const targets = [...priorityChannels.slice(0, 12), ...priorityDMs.slice(0, 6)];

  // 4) fetch recent messages from each
  const messages = [];
  const limitEach = Number(process.env.SLACK_LIMIT_EACH || 50);
  for (const ch of targets) {
    try {
      const r = await client.conversations.history({ channel: ch.id, limit: limitEach });
      const channelLabel = ch.is_im ? `DM · ${userMap[ch.user] || ch.user}` : ch.name;
      for (const m of r.messages || []) {
        const text = m.text || '';
        // confidential filter
        if (CONFIDENTIAL_PATTERNS.some((re) => re.test(text))) continue;
        messages.push({
          ts: m.ts,
          channelId: ch.id,
          channelName: channelLabel,
          isIM: !!ch.is_im,
          user: m.user || m.bot_id || 'system',
          userName: userMap[m.user] || null,
          text,
          threadTs: m.thread_ts || null,
          replyCount: m.reply_count || 0,
        });
      }
    } catch (e) {
      console.error(`[sync]   slack channel ${ch.name || ch.id} skipped: ${e.message}`);
    }
  }

  console.log(`[sync] slack: ${messages.length} messages from ${targets.length} channels/DMs`);
  return {
    messages,
    fetchedAt: new Date().toISOString(),
    channels: targets.map((c) => ({
      id: c.id,
      name: c.is_im ? `DM · ${userMap[c.user] || c.user}` : c.name,
      isIM: !!c.is_im,
    })),
  };
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

  let gmailOut = null;
  try {
    console.log('[sync] fetching gmail messages...');
    gmailOut = await fetchGmail(auth);
  } catch (e) {
    console.error(`[sync] gmail fetch failed (non-fatal): ${e.message}`);
  }

  let slackOut = null;
  try {
    console.log('[sync] fetching slack messages...');
    slackOut = await fetchSlack();
  } catch (e) {
    console.error(`[sync] slack fetch failed (non-fatal): ${e.message}`);
  }

  const snapshot = {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: process.env.EXPORTED_BY || 'github-actions',
    appName: 'CNC 채용 커맨드센터',
    sheets: sheetsOut,
    mappings: config.mappings || {},
    calendar: calendarOut, // null if fetch failed (snapshot still usable)
    gmail: gmailOut,       // null if fetch failed
    slack: slackOut,       // null if SLACK_TOKEN missing or fetch failed
  };

  const outPath = process.env.OUT_PATH || path.join(process.cwd(), 'snapshot.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  const eventCount = calendarOut?.events?.length || 0;
  const gmailCount = gmailOut?.messages?.length || 0;
  const slackCount = slackOut?.messages?.length || 0;
  console.log(`[sync] wrote ${outPath} (${Object.keys(sheetsOut).length} sheets, ${eventCount} cal events, ${gmailCount} gmail, ${slackCount} slack)`);
}

main().catch((e) => {
  console.error('[sync] FATAL:', e?.stack || e?.message || e);
  process.exit(1);
});
