const http = require('node:http');
const url = require('node:url');
const crypto = require('node:crypto');
const { shell, BrowserWindow } = require('electron');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const store = require('./store.cjs');

// Sheets/Drive/Gmail are STRICTLY read-only (per user instruction).
// Calendar is the ONLY service with write access — user wants the app to create/update/delete events
// to prevent the "Gmail에 일정 있는데 Calendar에 등록 안 한" 누락 케이스.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events', // read+write events only (not calendar settings/ACL)
  'https://www.googleapis.com/auth/calendar.readonly', // for listing other calendars
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function getCreds() {
  return store.get('googleClient') || null;
}

function setCreds({ clientId, clientSecret }) {
  store.set('googleClient', { clientId, clientSecret });
}

function clearCreds() {
  store.del('googleClient');
  store.del('googleTokens');
  store.del('googleProfile');
}

function getTokens() {
  return store.get('googleTokens');
}

function setTokens(tokens) {
  store.set('googleTokens', tokens, true);
}

function buildClient() {
  const creds = getCreds();
  if (!creds) throw new Error('NO_GOOGLE_CLIENT');
  const client = new OAuth2Client(creds.clientId, creds.clientSecret, 'http://127.0.0.1:0');
  const tokens = getTokens();
  if (tokens) client.setCredentials(tokens);
  client.on('tokens', (t) => {
    const cur = getTokens() || {};
    if (t.refresh_token) cur.refresh_token = t.refresh_token;
    cur.access_token = t.access_token;
    cur.expiry_date = t.expiry_date;
    setTokens(cur);
  });
  return client;
}

async function startAuth() {
  const creds = getCreds();
  if (!creds) throw new Error('NO_GOOGLE_CLIENT');

  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const parsed = url.parse(req.url, true);
        if (!parsed.pathname.startsWith('/oauth2callback')) {
          res.writeHead(404).end('Not found');
          return;
        }
        const { code, state: returnedState, error } = parsed.query;
        if (error) {
          res.writeHead(400).end(`OAuth error: ${error}`);
          server.close();
          reject(new Error(error));
          return;
        }
        if (returnedState !== state) {
          res.writeHead(400).end('State mismatch');
          server.close();
          reject(new Error('STATE_MISMATCH'));
          return;
        }
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
        const client = new OAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
        const { tokens } = await client.getToken(code);
        setTokens(tokens);
        client.setCredentials(tokens);

        try {
          const oauth2 = google.oauth2({ version: 'v2', auth: client });
          const me = await oauth2.userinfo.get();
          store.set('googleProfile', { email: me.data.email, name: me.data.name, picture: me.data.picture });
        } catch {}

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><head><meta charset="utf-8"><title>인증 완료</title>
        <style>body{font-family:sans-serif;background:#0a0a23;color:#fff;display:grid;place-items:center;height:100vh;margin:0}
        .card{padding:32px;background:#181838;border-radius:16px;text-align:center}h1{color:#3ad29f}p{color:#94a3b8}</style></head>
        <body><div class="card"><h1>✓ 인증 완료</h1><p>이 창을 닫고 앱으로 돌아가세요.</p></div></body></html>`);

        setTimeout(() => server.close(), 100);
        resolve(store.get('googleProfile'));
      } catch (e) {
        res.writeHead(500).end('Server error: ' + e.message);
        server.close();
        reject(e);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const client = new OAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
        state,
      });
      shell.openExternal(authUrl);
    });

    setTimeout(() => {
      try {
        server.close();
      } catch {}
      reject(new Error('OAUTH_TIMEOUT'));
    }, 5 * 60 * 1000);
  });
}

async function getStatus() {
  const creds = getCreds();
  const tokens = getTokens();
  const profile = store.get('googleProfile');
  return {
    hasClient: !!creds,
    authed: !!(tokens && tokens.refresh_token),
    profile: profile || null,
  };
}

async function signOut() {
  store.del('googleTokens');
  store.del('googleProfile');
}

async function listSheetTabs(spreadsheetId) {
  const auth = buildClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const r = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties' });
  return {
    title: r.data.properties.title,
    tabs: r.data.sheets.map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId })),
  };
}

async function readSheetRange(spreadsheetId, range) {
  const auth = buildClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return r.data.values || [];
}

async function listGmail(query, max = 30) {
  const auth = buildClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({ userId: 'me', q: query || '', maxResults: max });
  const msgs = list.data.messages || [];
  const detailed = await Promise.all(
    msgs.map(async (m) => {
      const det = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      const h = (name) => (det.data.payload.headers || []).find((x) => x.name === name)?.value || '';
      return {
        id: m.id,
        threadId: m.threadId,
        snippet: det.data.snippet,
        from: h('From'),
        to: h('To'),
        subject: h('Subject'),
        date: h('Date'),
        labelIds: det.data.labelIds || [],
      };
    })
  );
  return detailed;
}

async function listCalendar(timeMin, timeMax, calendarId = 'primary') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return (r.data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || '',
    description: e.description || '',
    location: e.location || '',
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    htmlLink: e.htmlLink,
    status: e.status,
    attendees: (e.attendees || []).map((a) => ({ email: a.email, name: a.displayName, responseStatus: a.responseStatus })),
  }));
}

async function listCalendars() {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.calendarList.list();
  return (r.data.items || []).map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

// Calendar event WRITE — user explicitly authorized read+write on Calendar only.
// `body` shape mirrors Google Calendar event resource:
//   { summary, description, location, start: {dateTime|date}, end: {dateTime|date}, attendees: [{email}], reminders, ... }
async function insertCalendarEvent(calendarId, body) {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.events.insert({
    calendarId: calendarId || 'primary',
    requestBody: body,
    sendUpdates: 'none', // do NOT auto-email attendees by default; user can opt in later
  });
  return r.data;
}

async function updateCalendarEvent(calendarId, eventId, body, sendUpdates = 'none') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.events.patch({
    calendarId: calendarId || 'primary',
    eventId,
    requestBody: body,
    sendUpdates,
  });
  return r.data;
}

async function deleteCalendarEvent(calendarId, eventId, sendUpdates = 'none') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  await cal.events.delete({
    calendarId: calendarId || 'primary',
    eventId,
    sendUpdates,
  });
  return { ok: true };
}

module.exports = {
  setCreds,
  getCreds,
  clearCreds,
  startAuth,
  getStatus,
  signOut,
  // Sheets/Drive/Gmail: read-only
  listSheetTabs,
  readSheetRange,
  listGmail,
  // Calendar: read + WRITE (user explicitly authorized)
  listCalendar,
  listCalendars,
  insertCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
};
