const http = require('node:http');
const url = require('node:url');
const crypto = require('node:crypto');
const { shell, BrowserWindow } = require('electron');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const store = require('./store.cjs');

// Sheets/Drive are STRICTLY read-only (per user instruction).
// Calendar is the ONLY service with full write access — user wants the app to create/update/delete events
// to prevent the "Gmail에 일정 있는데 Calendar에 등록 안 한" 누락 케이스.
// Gmail is read-only EXCEPT for `gmail.send`, which is used solely to deliver
// anomaly alerts to the user's own inbox (hdlee@cnccosmetic.com → hdlee@cnccosmetic.com).
// No outbound mail to candidates / external parties.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send', // self-mail anomaly alerts only
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

// Walk Gmail message payload and collect attachment filenames (recursively).
// 또한 attachmentId/mimeType을 별도 _detailed로 수집해 다운로드/오픈 기능에 활용.
function collectAttachmentNames(payload, detailed) {
  const out = [];
  const walk = (part) => {
    if (!part) return;
    if (part.filename && part.filename.length > 0) {
      out.push(part.filename);
      if (detailed && part.body?.attachmentId) {
        detailed.push({
          filename: part.filename,
          attachmentId: part.body.attachmentId,
          mimeType: part.mimeType || '',
          size: part.body.size || 0,
        });
      }
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  };
  walk(payload);
  return out;
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
        format: 'full',
      });
      const h = (name) => (det.data.payload?.headers || []).find((x) => x.name === name)?.value || '';
      const attachmentInfos = [];
      const attachments = collectAttachmentNames(det.data.payload, attachmentInfos);
      return {
        id: m.id,
        threadId: m.threadId,
        snippet: det.data.snippet,
        from: h('From'),
        to: h('To'),
        subject: h('Subject'),
        date: h('Date'),
        labelIds: det.data.labelIds || [],
        attachments,
        attachmentInfos, // [{filename, attachmentId, mimeType, size}]
      };
    })
  );
  return detailed;
}

// Gmail 첨부 다운로드 → 임시 폴더에 저장 → 시스템 기본 앱으로 open.
// 사용처: 이력서 메일 박스 옆 PDF 버튼 클릭 → 바로 PDF Reader로 열림.
// 첨부 buffer만 받아옴 — 파일로 저장/오픈 없이 메모리에서 처리.
async function fetchAttachmentBuffer(messageId, filename, attachmentId) {
  const auth = buildClient();
  const gmail = google.gmail({ version: 'v1', auth });
  let attId = attachmentId;
  let mimeType = '';
  if (!attId) {
    const det = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const infos = [];
    collectAttachmentNames(det.data.payload, infos);
    const hit = infos.find((x) => x.filename === filename);
    if (!hit) throw new Error(`첨부 "${filename}"을 찾을 수 없습니다.`);
    attId = hit.attachmentId;
    mimeType = hit.mimeType;
  }
  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attId,
  });
  const b64 = (att.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(b64, 'base64');
  return { buf, mimeType };
}

// 이력서 첨부에서 텍스트 추출 — PDF + DOCX 지원.
// 사용처: 후보자 이름으로 검색한 메일의 이력서를 열어 본문에서 이메일을 자동 추출.
// 텍스트 길이 제한: 첫 50KB만 반환 (이메일 추출엔 충분, 토큰 절약).
// 텍스트가 너무 짧으면 이미지 PDF로 판정 → OCR fallback.
// 임계값: 50자 (이력서는 보통 수백~수천 자, 50자 이하면 메타데이터만 뽑힌 것)
const OCR_FALLBACK_THRESHOLD = 50;

async function extractGmailAttachmentText(messageId, filename, attachmentId) {
  const log = (msg) => console.log(`[extractAttachment] ${filename} :: ${msg}`);
  try {
    const { buf, mimeType } = await fetchAttachmentBuffer(messageId, filename, attachmentId);
    log(`fetched ${buf.length} bytes, mime=${mimeType}`);
    const lower = (filename || '').toLowerCase();
    const mt = (mimeType || '').toLowerCase();
    const MAX = 50 * 1024;

    if (lower.endsWith('.pdf') || mt.includes('pdf')) {
      let pdfText = '';
      let pdfParseErr = null;
      try {
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const data = await pdfParse(buf, { max: 5 });
        pdfText = (data.text || '').trim();
        log(`pdf-parse ok: ${pdfText.length} chars`);
      } catch (e) {
        pdfParseErr = e.message;
        log(`pdf-parse fail: ${e.message}`);
      }

      // 텍스트가 충분히 추출됐으면 그대로 반환
      if (pdfText.length >= OCR_FALLBACK_THRESHOLD) {
        return { ok: true, text: pdfText.slice(0, MAX), kind: 'pdf' };
      }

      // 짧거나 빈 텍스트 → 이미지 PDF로 판정, OCR fallback
      log(`OCR fallback triggered (pdf-parse text=${pdfText.length} chars, threshold=${OCR_FALLBACK_THRESHOLD})`);
      try {
        const ocr = require('./ocr.cjs');
        const ocrText = await ocr.ocrPdfBuffer(buf, { maxPages: 2, scale: 2.0 });
        log(`OCR done: ${ocrText.length} chars`);
        if (ocrText.trim().length === 0) {
          return {
            ok: false,
            text: '',
            kind: 'ocr_empty',
            reason: `OCR도 빈 텍스트 (pdf-parse=${pdfText.length}자${pdfParseErr ? `, err=${pdfParseErr}` : ''})`,
          };
        }
        return { ok: true, text: ocrText.slice(0, MAX), kind: 'pdf_ocr' };
      } catch (e) {
        log(`OCR fail: ${e.message}`);
        return {
          ok: false,
          text: '',
          kind: 'ocr_error',
          reason: `OCR 실패: ${e.message}${pdfParseErr ? ` (pdf-parse: ${pdfParseErr})` : ''}`,
        };
      }
    }

    if (lower.endsWith('.docx') || mt.includes('officedocument.wordprocessingml')) {
      try {
        const mammoth = require('mammoth');
        const r = await mammoth.extractRawText({ buffer: buf });
        log(`docx ok: ${(r.value || '').length} chars`);
        return { ok: true, text: (r.value || '').slice(0, MAX), kind: 'docx' };
      } catch (e) {
        log(`mammoth fail: ${e.message}`);
        return { ok: false, text: '', kind: 'docx_error', reason: `mammoth: ${e.message}` };
      }
    }
    log(`unsupported format`);
    return { ok: false, text: '', kind: 'unsupported', reason: `미지원 포맷: ${filename}` };
  } catch (e) {
    log(`outer fail: ${e.message}`);
    return { ok: false, text: '', kind: 'error', reason: String(e?.message || e) };
  }
}

async function openGmailAttachment(messageId, filename, attachmentId) {
  const auth = buildClient();
  const gmail = google.gmail({ version: 'v1', auth });
  // attachmentId가 안 들어왔으면 메시지 다시 fetch해서 파일명으로 찾는다.
  let attId = attachmentId;
  if (!attId) {
    const det = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const infos = [];
    collectAttachmentNames(det.data.payload, infos);
    const hit = infos.find((x) => x.filename === filename);
    if (!hit) throw new Error(`첨부 "${filename}"을 찾을 수 없습니다.`);
    attId = hit.attachmentId;
  }
  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attId,
  });
  const b64 = (att.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(b64, 'base64');
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { app } = require('electron');
  const tempRoot = app?.getPath ? app.getPath('temp') : os.tmpdir();
  const dir = path.join(tempRoot, 'cnc-recruit-attachments');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const safe = (filename || `attachment-${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_');
  // messageId prefix로 중복 방지 (다른 메일에 같은 파일명이 있어도 충돌 X)
  const filePath = path.join(dir, `${messageId.slice(0, 8)}__${safe}`);
  fs.writeFileSync(filePath, buf);
  const err = await shell.openPath(filePath);
  if (err) throw new Error(`파일 열기 실패: ${err}`);
  return { path: filePath };
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
    colorId: e.colorId || null,
    allDay: !e.start?.dateTime,
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    timeZone: e.start?.timeZone || null,
    htmlLink: e.htmlLink,
    status: e.status,
    conferenceUrl: e.conferenceData?.entryPoints?.[0]?.uri || e.hangoutLink || null,
    creator: e.creator ? { email: e.creator.email || null, self: !!e.creator.self } : null,
    organizer: e.organizer ? { email: e.organizer.email || null, self: !!e.organizer.self } : null,
    attendees: (e.attendees || []).map((a) => ({
      email: a.email,
      name: a.displayName,
      responseStatus: a.responseStatus,
      organizer: !!a.organizer,
      self: !!a.self,
    })),
  }));
}

async function listCalendars() {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.calendarList.list();
  return (r.data.items || []).map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

// calendarList의 모든 메타 (selected, hidden, accessRole, color 등) — Google Calendar
// 좌측 사이드바 표시 여부를 코드로 분석/수정하기 위한 read.
async function listCalendarsFull() {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.calendarList.list();
  return (r.data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary || '',
    summaryOverride: c.summaryOverride || null,
    primary: !!c.primary,
    selected: !!c.selected,
    hidden: !!c.hidden,
    accessRole: c.accessRole || null,
    backgroundColor: c.backgroundColor || null,
    foregroundColor: c.foregroundColor || null,
    colorId: c.colorId || null,
    timeZone: c.timeZone || null,
    deleted: !!c.deleted,
  }));
}

// 사용자 본인 view의 calendarList 항목 patch — selected/hidden 토글로 사이드바 표시 제어.
// 캘린더 자체는 안 건드림 (다른 사용자에게 영향 없음). 본인 UI에서만 안 보임.
async function patchCalendarListEntry(calendarId, body) {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.calendarList.patch({ calendarId, requestBody: body });
  return r.data;
}

// Calendar event WRITE — user explicitly authorized read+write on Calendar only.
// `body` shape mirrors Google Calendar event resource:
//   { summary, description, location, start: {dateTime|date}, end: {dateTime|date}, attendees: [{email}], reminders, ... }
async function insertCalendarEvent(calendarId, body, sendUpdates = 'none') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.events.insert({
    calendarId: calendarId || 'primary',
    requestBody: body,
    sendUpdates,
  });
  return r.data;
}

async function updateCalendarEvent(calendarId, eventId, body, sendUpdates = 'none') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  try {
    const r = await cal.events.patch({
      calendarId: calendarId || 'primary',
      eventId,
      requestBody: body,
      sendUpdates,
    });
    return r.data;
  } catch (e) {
    // 410 Gone / 404 Not Found — race condition으로 이미 삭제됐을 때 false-fail 방지.
    // (deleteCalendarEvent와 동일한 패턴)
    const code = e?.code || e?.response?.status || e?.status;
    if (code === 404 || code === 410) return { ok: true, alreadyGone: true };
    throw e;
  }
}

async function deleteCalendarEvent(calendarId, eventId, sendUpdates = 'none') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  try {
    await cal.events.delete({
      calendarId: calendarId || 'primary',
      eventId,
      sendUpdates,
    });
  } catch (e) {
    // 이미 삭제됨(410 Gone)이나 존재하지 않음(404)은 결과적으로 "사라진 상태"라 성공으로 간주.
    // googleapis는 사실 events.delete 성공 시 204 No Content를 반환하면서 가끔 응답 처리에서
    // throw하는 케이스가 있어, 동일 신호로 잡아 alert가 잘못 뜨는 것 방지.
    const code = e?.code || e?.response?.status || e?.status;
    if (code === 404 || code === 410) return { ok: true, alreadyGone: true };
    throw e;
  }
  return { ok: true };
}

// Calendar create — 새 캘린더 생성 (사용자 owner). 권한 문제 회피용.
async function createCalendarForUser(summary, timeZone = 'Asia/Seoul', description = '') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.calendars.insert({
    requestBody: { summary, timeZone, description },
  });
  return r.data; // { id, summary, ... }
}

// Calendar ACL — 캘린더 공유 대상(사용자/그룹) 권한 관리. 입사 캘린더를 인사팀/구성원경험팀에 공유.
async function listCalendarAcl(calendarId) {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.acl.list({ calendarId });
  return r.data.items || [];
}

async function insertCalendarAcl(calendarId, email, role = 'reader', scopeType = 'user') {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  const r = await cal.acl.insert({
    calendarId,
    requestBody: {
      role, // 'reader' | 'writer' | 'owner' | 'freeBusyReader'
      scope: { type: scopeType, value: email }, // 'user' | 'group' | 'domain'
    },
    sendNotifications: false, // 사용자에게 공유 알림 메일 안 보냄 (자동 적용이라)
  });
  return r.data;
}

async function deleteCalendarAcl(calendarId, ruleId) {
  const auth = buildClient();
  const cal = google.calendar({ version: 'v3', auth });
  try {
    await cal.acl.delete({ calendarId, ruleId });
  } catch (e) {
    const code = e?.code || e?.response?.status || e?.status;
    if (code === 404 || code === 410) return { ok: true, alreadyGone: true };
    throw e;
  }
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
  openGmailAttachment,
  extractGmailAttachmentText,
  // Calendar: read + WRITE (user explicitly authorized)
  listCalendar,
  listCalendars,
  listCalendarsFull,
  patchCalendarListEntry,
  insertCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  createCalendarForUser,
  listCalendarAcl,
  insertCalendarAcl,
  deleteCalendarAcl,
};
