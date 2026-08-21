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
  'https://www.googleapis.com/auth/drive.file', // 앱이 직접 만든 파일만 read/write — 기존 시트는 절대 건드릴 수 없음.
                                                 // "이번 달 면접" 익스포트 같이 새 시트 생성+데이터 쓰기 용도.
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

// 새 Google 시트를 만들고 데이터를 채워서 spreadsheetId+url 반환.
// drive.file scope로 동작 — 앱이 만든 파일만 접근 가능, 기존 시트는 절대 못 건드림.
// 사용처: 대시보드 "이번 달 면접" 카드 클릭 시 데이터 익스포트.
async function createSheetWithData(title, headers, rows) {
  const auth = buildClient();
  const sheets = google.sheets({ version: 'v4', auth });
  // 1) 빈 시트 생성
  const created = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
  });
  const spreadsheetId = created.data.spreadsheetId;
  // 2) values.update로 헤더+데이터 한 번에 쓰기
  const allRows = [headers, ...rows];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'USER_ENTERED', // 날짜·숫자 자동 포맷
    requestBody: { values: allRows },
  });
  // 3) 첫 행 굵게 + freeze + auto resize
  const sheetId = created.data.sheets[0].properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // 첫 행 굵게 + 배경
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.92, green: 0.92, blue: 0.97 },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        // 첫 행 freeze
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        // 컬럼 폭 자동 조정
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length },
          },
        },
      ],
    },
  });
  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

// 수기 입력(체크) 컬럼 — 앱이 절대 자동으로 채우지 않고 기존 시트 값을 그대로 되살리는 칸.
// src/pages/IncomingHires.tsx 의 HIRES_MANUAL_COLUMNS 와 동일하게 유지할 것.
// 여기에 이름만 추가하면 새 제출서류 항목도 자동으로 보존된다.
const HIRES_MANUAL_COLUMNS = [
  '입사안내',
  '건강검진 영수증',
  '등본',
  '채용검진표',
  '계좌사본',
  '학력/성적증명서',
  '외국인등록증',
  '퇴사',
];

// 기존 탭 값에서 (성명|연락처) -> { 컬럼명: 수기값 } 보존맵 생성.
// 헤더 이름으로 찾으므로 컬럼 순서가 바뀌어도(신규 컬럼이 중간에 끼어도) 값이 밀리지 않는다.
function markMapFromValues(values) {
  const out = {};
  if (!values || values.length === 0) return out;
  const head = values[0].map((c) => String(c == null ? '' : c).trim());
  const ni = head.indexOf('성명');
  const pi = head.indexOf('연락처');
  if (ni === -1) return out;
  const manualIdx = HIRES_MANUAL_COLUMNS
    .map((name) => ({ name, i: head.indexOf(name) }))
    .filter((x) => x.i >= 0);
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const nm = String(row[ni] == null ? '' : row[ni]).trim();
    if (!nm) continue;
    const key = nm + '|' + String(pi >= 0 ? (row[pi] || '') : '').replace(/[^0-9]/g, '');
    const marks = {};
    for (const { name, i: ci } of manualIdx) marks[name] = row[ci] || '';
    out[key] = marks;
  }
  return out;
}

// 앱이 만든 "입사자 관리" 워크북을 날짜별 탭으로 동기화 (drive.file scope — 앱이 만든 파일만).
// 기존 사용자 시트는 절대 건드리지 않음. spreadsheetId가 null이면 새로 생성.
// tabs: [{ name, headers, rows }] (rows: string[][]). '입사안내'/'건강검진 영수증' 수기 O는
// (성명|연락처) 기준으로 기존 시트에서 읽어 보존한다.
async function syncHiresWorkbook(spreadsheetId, tabs) {
  const auth = buildClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const q = (n) => `'${String(n).replace(/'/g, "''")}'`; // 탭 이름 안전 인용

  // 1) 없으면 새 워크북 생성
  if (!spreadsheetId) {
    const created = await sheets.spreadsheets.create({
      requestBody: { properties: { title: '입사자 관리 (자동 · 입사예정정규직DB)' } },
    });
    spreadsheetId = created.data.spreadsheetId;
  }

  // 2) 현재 탭 메타
  let meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  let byTitle = {};
  meta.data.sheets.forEach((s) => { byTitle[s.properties.title] = s.properties.sheetId; });

  const wantTitles = tabs.map((t) => t.name);

  // 3) 기존 탭에서 수기 표시 보존 (이미 존재하는 탭만 읽기)
  const present = wantTitles.filter((n) => byTitle[n] != null);
  const marksByTab = {};
  if (present.length) {
    const resp = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: present.map(q) });
    (resp.data.valueRanges || []).forEach((vr) => {
      const m = (vr.range || '').match(/^'?(.*?)'?!/);
      let name = m ? m[1].replace(/''/g, "'") : null;
      if (name) marksByTab[name] = markMapFromValues(vr.values || []);
    });
  }

  // 3b) 모든 탭의 수기 표시를 (성명|연락처) 기준으로 하나로 합친다.
  //     날짜별 탭에 친 O가 '전체(날짜순)'·'입사포기' 탭에도 그대로 보이도록(양방향 미러링).
  //     같은 사람이 여러 탭에 있으면 값이 있는 쪽이 이긴다.
  const globalMarks = {};
  for (const tabName of Object.keys(marksByTab)) {
    for (const [key, marks] of Object.entries(marksByTab[tabName])) {
      const cur = globalMarks[key] || (globalMarks[key] = {});
      for (const [col, val] of Object.entries(marks)) {
        if (val && !cur[col]) cur[col] = val;
      }
    }
  }

  // 4) 탭 추가/삭제 (우리가 만든 자동탭 + 기본 Sheet1/시트1 만 정리)
  const requests = [];
  for (const name of wantTitles) {
    if (byTitle[name] == null) requests.push({ addSheet: { properties: { title: name } } });
  }
  const isOurs = (t) => t === '전체(날짜순)' || t.indexOf('입사 ') === 0 || /^Sheet1$|^시트1$/.test(t);
  for (const title of Object.keys(byTitle)) {
    if (isOurs(title) && !wantTitles.includes(title)) {
      requests.push({ deleteSheet: { sheetId: byTitle[title] } });
    }
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
    byTitle = {};
    meta.data.sheets.forEach((s) => { byTitle[s.properties.title] = s.properties.sheetId; });
  }

  // 4b) 탭을 wantTitles(= '전체(날짜순)' + 입사일 오름차순) 순서대로 재배치.
  //     addSheet는 새 탭을 항상 맨 뒤에 붙이므로, 나중에 추가된 입사자(예: 6/22 정원호)의
  //     탭이 날짜순을 깨고 끝으로 밀린다. index를 desired 순서로 지정해 매 동기화마다 정렬 보정.
  //     wantTitles 순서대로(앞→뒤) index=i를 주면 뒤로 밀린 탭이 제자리(낮은 index)로 당겨진다.
  const orderReq = [];
  wantTitles.forEach((name, i) => {
    const sid = byTitle[name];
    if (sid != null) {
      orderReq.push({ updateSheetProperties: { properties: { sheetId: sid, index: i }, fields: 'index' } });
    }
  });
  if (orderReq.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: orderReq } });
  }

  // 5) 각 탭 clear 후 값 쓰기 (수기 입력 보존 — 입사안내/건강검진/퇴사)
  const data = tabs.map((t) => {
    const h = t.headers;
    const ni = h.indexOf('성명'), pi = h.indexOf('연락처');
    // 수기 컬럼은 헤더 이름으로 매칭 — 컬럼을 새로 끼워넣어도 값이 옆칸으로 밀리지 않는다.
    const manualIdx = HIRES_MANUAL_COLUMNS
      .map((name) => ({ name, i: h.indexOf(name) }))
      .filter((x) => x.i >= 0);
    const marks = marksByTab[t.name] || {};
    const rows = t.rows.map((r) => {
      const row = r.slice();
      const key = String(row[ni] || '') + '|' + String(pi >= 0 ? (row[pi] || '') : '').replace(/[^0-9]/g, '');
      // 같은 탭 값 우선, 없으면 다른 탭(날짜별 탭 ↔ 전체 탭)에서 친 표시를 끌어온다.
      const mk = marks[key] || {};
      const gk = globalMarks[key] || {};
      for (const { name, i } of manualIdx) {
        if (!row[i]) row[i] = mk[name] || gk[name] || '';
      }
      return row;
    });
    return { range: `${q(t.name)}!A1`, values: [h, ...rows] };
  });
  await sheets.spreadsheets.values.batchClear({ spreadsheetId, ranges: tabs.map((t) => q(t.name)) });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  // 6) 헤더 서식 + freeze
  const fmt = [];
  for (const t of tabs) {
    const sid = byTitle[t.name];
    if (sid == null) continue;
    fmt.push({
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.92, blue: 0.83 } } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    });
    fmt.push({
      updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' },
    });
  }
  if (fmt.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: fmt } });

  return { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
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
      // format='full' — payload.parts 트리가 와야 collectAttachmentNames가 첨부 파일명/attachmentId를 walk할 수 있음.
      // 'metadata'는 headers만 돌려주고 parts를 통째로 잘라내서 attachments가 항상 []로 비어 보였음 (이력서 매칭 전멸 원인).
      // 첨부 본문 base64는 walk에서 무시되므로 메모리 부담은 일시적.
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

// Gmail 첨부의 base64 raw + mimeType만 반환 — 렌더러에서 Blob URL로 만들어 iframe inline 표시.
// CandidateLookup의 "앱 내에서 펼쳐 보기" UX에 사용. 새 창 안 띄움.
async function fetchGmailAttachmentBase64(messageId, filename, attachmentId) {
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
    mimeType = hit.mimeType || '';
  }
  if (!mimeType) {
    // attachmentId만 알고 mimeType 모르면 full fetch 한 번 더
    const det = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const infos = [];
    collectAttachmentNames(det.data.payload, infos);
    const hit = infos.find((x) => x.attachmentId === attId);
    if (hit) mimeType = hit.mimeType || '';
  }
  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attId,
  });
  // Gmail API는 base64url 인코딩 — Blob 호환 base64로 변환 (URL-safe → standard)
  const b64 = (att.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
  return { base64: b64, mimeType, filename };
}

// Gmail 첨부 다운로드 → 임시 폴더에 저장 → 시스템 기본 앱으로 open.
// 사용처: 이력서 메일 박스 옆 PDF 버튼 클릭 → 바로 PDF Reader로 열림.
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
  // 전체 페이지네이션 — 한 페이지(250)만 읽으면 이벤트가 많은 캘린더에서 뒤쪽 이벤트를 놓쳐
  // "기존 이벤트 없음"으로 오판 → 중복 재생성 악순환이 생긴다. (입사 캘린더 중복 버그 원인)
  const items = [];
  let pageToken;
  do {
    const r = await cal.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    });
    items.push(...(r.data.items || []));
    pageToken = r.data.nextPageToken;
  } while (pageToken && items.length < 5000);
  return items.map((e) => ({
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
  // Sheets/Drive/Gmail: read-only (기존 시트), 단 createSheetWithData는 새 시트만 생성 (drive.file scope)
  listSheetTabs,
  readSheetRange,
  createSheetWithData,
  syncHiresWorkbook,
  listGmail,
  openGmailAttachment,
  fetchGmailAttachmentBase64,
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
