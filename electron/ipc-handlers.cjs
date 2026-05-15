const { ipcMain } = require('electron');
const google = require('./integrations/google.cjs');
const slack = require('./integrations/slack.cjs');
const store = require('./integrations/store.cjs');
const sync = require('./integrations/sync.cjs');

function safeHandle(channel, handler) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      const result = await handler(...args);
      return { ok: true, data: result };
    } catch (e) {
      return { ok: false, error: e.message || String(e), code: e.code };
    }
  });
}

function register() {
  // Google
  safeHandle('g:setCreds', async (creds) => google.setCreds(creds));
  safeHandle('g:clearCreds', async () => google.clearCreds());
  safeHandle('g:startAuth', async () => google.startAuth());
  safeHandle('g:status', async () => google.getStatus());
  safeHandle('g:signOut', async () => google.signOut());
  safeHandle('g:revealSecrets', async () => {
    // 일회성 — GitHub Secrets 셋업용
    const creds = store.get('googleClient') || {};
    const tokens = store.get('googleTokens') || {};
    const sheetIds = store.get('sheetIds') || {};
    const mappings = store.get('sheetMappings') || {};
    const list = Array.isArray(sheetIds.list)
      ? sheetIds.list.map((s) => s.spreadsheetId).filter(Boolean)
      : [];
    return {
      clientId: creds.clientId || null,
      clientSecret: creds.clientSecret || null,
      refreshToken: tokens.refresh_token || null,
      sheetsConfig: { sheetIds: list, mappings },
    };
  });
  safeHandle('g:listSheetTabs', async (id) => google.listSheetTabs(id));
  safeHandle('g:readSheet', async (id, range) => google.readSheetRange(id, range));
  // No write IPC for Google Sheets — strictly read-only.
  safeHandle('g:listGmail', async (q, max) => google.listGmail(q, max));
  safeHandle('g:openAttachment', async (messageId, filename, attachmentId) =>
    google.openGmailAttachment(messageId, filename, attachmentId));
  safeHandle('g:listCalendar', async (min, max, id) => google.listCalendar(min, max, id));
  safeHandle('g:listCalendars', async () => google.listCalendars());
  safeHandle('g:listCalendarsFull', async () => google.listCalendarsFull());
  safeHandle('g:patchCalendarListEntry', async (calendarId, body) => google.patchCalendarListEntry(calendarId, body));
  // Calendar write (only Calendar — Sheets/Gmail/Drive remain read-only)
  safeHandle('g:insertCalEvent', async (calendarId, body, sendUpdates) => google.insertCalendarEvent(calendarId, body, sendUpdates));
  safeHandle('g:updateCalEvent', async (calendarId, eventId, body, sendUpdates) => google.updateCalendarEvent(calendarId, eventId, body, sendUpdates));
  safeHandle('g:deleteCalEvent', async (calendarId, eventId, sendUpdates) => google.deleteCalendarEvent(calendarId, eventId, sendUpdates));
  // Calendar ACL — 캘린더 공유 권한 관리 (입사 캘린더를 인사팀/구성원경험팀에 reader로 공유 등)
  safeHandle('g:listCalAcl', async (calendarId) => google.listCalendarAcl(calendarId));
  safeHandle('g:insertCalAcl', async (calendarId, email, role, scopeType) => google.insertCalendarAcl(calendarId, email, role, scopeType));
  safeHandle('g:deleteCalAcl', async (calendarId, ruleId) => google.deleteCalendarAcl(calendarId, ruleId));

  // Slack
  safeHandle('s:saveToken', async (token) => {
    const r = await slack.testAuth(token);
    if (r.ok) slack.setToken(token);
    return r;
  });
  safeHandle('s:status', async () => slack.getStatus());
  safeHandle('s:signOut', async () => slack.clearToken());
  safeHandle('s:listChannels', async (types) => slack.listChannels(types));
  safeHandle('s:readChannel', async (id, lim) => slack.readChannel(id, lim));
  safeHandle('s:readMultiple', async (ids, lim) => slack.readMultiple(ids, lim));
  safeHandle('s:search', async (q, count) => slack.searchMessages(q, count));
  safeHandle('s:post', async (ch, text) => slack.postMessage(ch, text));

  // Config (sheet IDs, etc.)
  safeHandle('cfg:get', async (key) => store.get(key));
  safeHandle('cfg:set', async (key, value) => store.set(key, value));
  safeHandle('cfg:del', async (key) => store.del(key));

  // Sync engine
  safeHandle('sync:start', async (spreadsheetId) => sync.start(spreadsheetId));
  safeHandle('sync:stop', async (spreadsheetId) => sync.stop(spreadsheetId));
  safeHandle('sync:startAll', async () => sync.startFromConfig());
  safeHandle('sync:fetchOnce', async (spreadsheetId) => sync.fetchOnce(spreadsheetId));
  safeHandle('sync:cached', async (spreadsheetId) => sync.getCached(spreadsheetId));
  safeHandle('sync:foreground', async (v) => sync.setForeground(v));
  safeHandle('sync:status', async () => sync.getStatus());
}

module.exports = { register };
