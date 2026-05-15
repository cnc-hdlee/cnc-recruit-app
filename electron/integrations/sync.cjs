const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const store = require('./store.cjs');

// Debug dump path — dev 모드에서만 프로젝트 루트에 시트 fetch 결과를 dump.
// 빌드된 .exe(asar)에선 __dirname이 read-only라 매 polling 시 EPERM throw → polling 망가짐.
// IS_DEV 가드: pkg path가 .asar를 포함하면 prod로 간주.
const IS_DEV = !__dirname.includes('.asar');
const DEBUG_DUMP_PATH = IS_DEV ? path.join(__dirname, '..', '..', '__debug_lastFetch.json') : null;

function writeDebugDump(spreadsheetId, title, modifiedTime, tabsData) {
  if (!IS_DEV || !DEBUG_DUMP_PATH) return; // prod 빌드에선 no-op
  try {
    const headers = {};
    const samples = {};
    for (const [tab, rows] of Object.entries(tabsData)) {
      const r = rows || [];
      headers[tab] = r[0] || [];
      samples[tab] = r.slice(0, 6);
    }
    let existing = {};
    if (fs.existsSync(DEBUG_DUMP_PATH)) {
      try { existing = JSON.parse(fs.readFileSync(DEBUG_DUMP_PATH, 'utf8')); } catch {}
    }
    existing[spreadsheetId] = {
      title,
      modifiedTime,
      tabNames: Object.keys(tabsData),
      headers,
      sampleRows: samples,
      writtenAt: new Date().toISOString(),
    };
    fs.writeFileSync(DEBUG_DUMP_PATH, JSON.stringify(existing, null, 2), 'utf8');
  } catch (e) {
    // ignore — dev 디버그용
  }
}

let webContents = null;
let pollers = new Map(); // spreadsheetId -> { timer, lastModified, mappings }
let foreground = true;

const POLL_FOREGROUND_MS = 8000;
const POLL_BACKGROUND_MS = 60000;

function setWindow(wc) {
  webContents = wc;
}

function setForeground(v) {
  foreground = !!v;
  // adjust intervals on next tick
  for (const [id, st] of pollers) {
    schedule(id, st);
  }
}

function emit(channel, payload) {
  if (webContents && !webContents.isDestroyed()) {
    try {
      webContents.send(channel, payload);
    } catch (e) {}
  }
}

function buildClient() {
  const creds = store.get('googleClient');
  if (!creds) throw new Error('NO_GOOGLE_CLIENT');
  const client = new OAuth2Client(creds.clientId, creds.clientSecret, 'http://127.0.0.1:0');
  const tokens = store.get('googleTokens');
  if (!tokens) throw new Error('NO_TOKENS');
  client.setCredentials(tokens);
  client.on('tokens', (t) => {
    const cur = store.get('googleTokens') || {};
    if (t.refresh_token) cur.refresh_token = t.refresh_token;
    cur.access_token = t.access_token;
    cur.expiry_date = t.expiry_date;
    store.set('googleTokens', cur, true);
  });
  return client;
}

async function getModifiedTime(auth, spreadsheetId) {
  const drive = google.drive({ version: 'v3', auth });
  const r = await drive.files.get({ fileId: spreadsheetId, fields: 'modifiedTime,name' });
  return { modifiedTime: r.data.modifiedTime, name: r.data.name };
}

async function fetchAllTabs(auth, spreadsheetId) {
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties',
  });
  const tabs = (meta.data.sheets || []).map((s) => s.properties.title);

  const ranges = tabs.map((t) => `'${t.replace(/'/g, "''")}'`);
  const data = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const result = {};
  (data.data.valueRanges || []).forEach((vr, i) => {
    result[tabs[i]] = vr.values || [];
  });
  return { title: meta.data.properties.title, tabs: result };
}

async function pollOnce(spreadsheetId) {
  const st = pollers.get(spreadsheetId);
  if (!st) return;
  try {
    const auth = buildClient();
    const m = await getModifiedTime(auth, spreadsheetId);
    if (m.modifiedTime !== st.lastModified) {
      const data = await fetchAllTabs(auth, spreadsheetId);
      st.lastModified = m.modifiedTime;
      st.cache = data;
      writeDebugDump(spreadsheetId, data.title, m.modifiedTime, data.tabs);
      emit('sync:update', {
        spreadsheetId,
        title: data.title,
        modifiedTime: m.modifiedTime,
        tabs: data.tabs,
      });
    } else {
      emit('sync:tick', { spreadsheetId, modifiedTime: m.modifiedTime, changed: false });
    }
  } catch (e) {
    emit('sync:error', { spreadsheetId, error: e.message || String(e) });
  }
}

function schedule(spreadsheetId, st) {
  if (st.timer) clearInterval(st.timer);
  const interval = foreground ? POLL_FOREGROUND_MS : POLL_BACKGROUND_MS;
  st.timer = setInterval(() => pollOnce(spreadsheetId), interval);
}

async function start(spreadsheetId) {
  if (!spreadsheetId) return;
  if (pollers.has(spreadsheetId)) return;
  const st = { timer: null, lastModified: null, cache: null };
  pollers.set(spreadsheetId, st);
  await pollOnce(spreadsheetId);
  schedule(spreadsheetId, st);
}

function stop(spreadsheetId) {
  const st = pollers.get(spreadsheetId);
  if (!st) return;
  if (st.timer) clearInterval(st.timer);
  pollers.delete(spreadsheetId);
}

function stopAll() {
  for (const id of [...pollers.keys()]) stop(id);
}

function collectSheetIds() {
  const sheetIds = store.get('sheetIds') || {};
  const mappings = store.get('sheetMappings') || {};
  const ids = new Set();

  // New shape: { list: [{ spreadsheetId, url, ... }] }
  if (Array.isArray(sheetIds.list)) {
    sheetIds.list.forEach((s) => {
      if (s && typeof s.spreadsheetId === 'string' && s.spreadsheetId) ids.add(s.spreadsheetId);
    });
  }
  // Legacy shape: { recruit, headcount, mail } — direct strings
  ['recruit', 'headcount', 'mail'].forEach((k) => {
    const v = sheetIds[k];
    if (typeof v === 'string' && v) ids.add(v);
  });
  // From mappings (any kind that has at least one mapping)
  Object.values(mappings).forEach((arr) => {
    if (Array.isArray(arr)) {
      arr.forEach((e) => {
        if (e && typeof e.spreadsheetId === 'string' && e.spreadsheetId) ids.add(e.spreadsheetId);
      });
    }
  });

  return [...ids];
}

async function startFromConfig() {
  stopAll();
  const ids = collectSheetIds();
  for (const id of ids) {
    try {
      await start(id);
    } catch (e) {
      emit('sync:error', { spreadsheetId: id, error: e.message || String(e) });
    }
  }
  return ids;
}

function getStatus() {
  const ids = collectSheetIds();
  return ids.map((id) => {
    const st = pollers.get(id);
    return {
      spreadsheetId: id,
      polling: !!st,
      lastModified: st?.lastModified || null,
      hasCache: !!st?.cache,
    };
  });
}

async function fetchOnce(spreadsheetId) {
  const auth = buildClient();
  const data = await fetchAllTabs(auth, spreadsheetId);
  const m = await getModifiedTime(auth, spreadsheetId);
  writeDebugDump(spreadsheetId, data.title, m.modifiedTime, data.tabs);
  return { ...data, modifiedTime: m.modifiedTime };
}

function getCached(spreadsheetId) {
  const st = pollers.get(spreadsheetId);
  return st?.cache || null;
}

module.exports = { setWindow, setForeground, start, stop, stopAll, startFromConfig, fetchOnce, getCached, getStatus, collectSheetIds };
