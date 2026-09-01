const { ipcMain } = require('electron');
const google = require('./integrations/google.cjs');
const slack = require('./integrations/slack.cjs');
const store = require('./integrations/store.cjs');
const sync = require('./integrations/sync.cjs');
const resumes = require('./integrations/resumes.cjs');

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
  // Sheets: 기존 시트 절대 수정 안 함 — 단, drive.file scope로 새 시트만 생성 가능.
  safeHandle('g:createSheet', async (title, headers, rows) => google.createSheetWithData(title, headers, rows));
  // 입사자 관리 워크북 동기화 — 앱이 만든 새 시트에 날짜별 탭 생성/갱신 (drive.file). 기존 시트 안 건드림.
  safeHandle('g:syncHiresSheet', async (spreadsheetId, tabs) => google.syncHiresWorkbook(spreadsheetId, tabs));
  safeHandle('g:listGmail', async (q, max) => google.listGmail(q, max));
  safeHandle('g:sendGmail', async (payload) => google.sendGmail(payload));
  safeHandle('g:openAttachment', async (messageId, filename, attachmentId) =>
    google.openGmailAttachment(messageId, filename, attachmentId));
  // 앱 내 inline 표시용 — base64 raw 반환, 렌더러에서 Blob URL로 변환 후 iframe.
  safeHandle('g:fetchAttachmentBase64', async (messageId, filename, attachmentId) =>
    google.fetchGmailAttachmentBase64(messageId, filename, attachmentId));
  safeHandle('g:driveFile', async (fileId) => google.downloadDriveFile(fileId));
  safeHandle('g:listCalendar', async (min, max, id) => google.listCalendar(min, max, id));
  safeHandle('g:listCalendars', async () => google.listCalendars());
  safeHandle('g:listCalendarsFull', async () => google.listCalendarsFull());
  safeHandle('g:patchCalendarListEntry', async (calendarId, body) => google.patchCalendarListEntry(calendarId, body));
  // Calendar write (only Calendar — Sheets/Gmail/Drive remain read-only)
  safeHandle('g:insertCalEvent', async (calendarId, body, sendUpdates) => google.insertCalendarEvent(calendarId, body, sendUpdates));
  safeHandle('g:updateCalEvent', async (calendarId, eventId, body, sendUpdates) => google.updateCalendarEvent(calendarId, eventId, body, sendUpdates));
  safeHandle('g:deleteCalEvent', async (calendarId, eventId, sendUpdates) => google.deleteCalendarEvent(calendarId, eventId, sendUpdates));
  // Calendar create — hdlee owner 새 캘린더 생성 (권한 우회용)
  safeHandle('g:createCalendar', async (summary, timeZone, description) => google.createCalendarForUser(summary, timeZone, description));
  // Calendar ACL — 캘린더 공유 권한 관리 (입사 캘린더를 인사팀/구성원경험팀에 reader로 공유 등)
  safeHandle('g:listCalAcl', async (calendarId) => google.listCalendarAcl(calendarId));
  safeHandle('g:insertCalAcl', async (calendarId, email, role, scopeType) => google.insertCalendarAcl(calendarId, email, role, scopeType));
  safeHandle('g:deleteCalAcl', async (calendarId, ruleId) => google.deleteCalendarAcl(calendarId, ruleId));

  // Slack
  // 이력서 보관함 — 로컬 저장(원본) + 드라이브 백업
  safeHandle('rv:save', async (payload) => resumes.saveResume(payload));
  safeHandle('rv:list', async () => resumes.listResumes());
  safeHandle('rv:update', async (id, patch) => resumes.updateResume(id, patch));
  safeHandle('rv:read', async (id) => resumes.readResumeBase64(id));
  safeHandle('rv:open', async (id) => resumes.openResume(id));
  safeHandle('rv:reveal', async () => resumes.revealResumeFolder());
  safeHandle('rv:delete', async (id) => resumes.deleteResume(id));
  safeHandle('rv:deleteMany', async (ids, opt) => resumes.deleteResumes(ids, opt));
  safeHandle('rv:backup', async (ids) => resumes.backupToDrive(ids));
  safeHandle('rv:classify', async (updates, opts) => resumes.applyClassification(updates, opts));
  safeHandle('rv:organize', async () => resumes.organizeVault());
  safeHandle('rv:contacts', async (id) => resumes.extractContacts(id));
  safeHandle('rv:contactsByName', async (name) => resumes.contactsByName(name));
  safeHandle('rv:scan', async (opt) => resumes.scanForResumes(opt));
  safeHandle('rv:importPath', async (p, meta, password) => resumes.importPath(p, meta, password));
  safeHandle('rv:contactsFromData', async (base64, mimeType) => resumes.extractContactsFromData(base64, mimeType));
  safeHandle('rv:stats', async () => resumes.stats());
  safeHandle('rv:driveFolder', async () => google.getResumeFolderLink());

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
