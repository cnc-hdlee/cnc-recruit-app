const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const subscribe = (channel, cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,

  app: {
    getVersion: () => invoke('app:getVersion'),
    checkForUpdates: () => invoke('app:checkForUpdates'),
    quitAndInstall: () => invoke('app:quitAndInstall'),
    onUpdateAvailable: (cb) => subscribe('app:update-available', cb),
    onUpdateNotAvailable: (cb) => subscribe('app:update-not-available', cb),
    onUpdateProgress: (cb) => subscribe('app:update-progress', cb),
    onUpdateDownloaded: (cb) => subscribe('app:update-downloaded', cb),
    onUpdateError: (cb) => subscribe('app:update-error', cb),
  },

  google: {
    setCreds: (c) => invoke('g:setCreds', c),
    clearCreds: () => invoke('g:clearCreds'),
    startAuth: () => invoke('g:startAuth'),
    status: () => invoke('g:status'),
    signOut: () => invoke('g:signOut'),
    // 일회성: GitHub Secrets에 등록할 refresh_token 노출 (한 번 복사 후 폐기 권장)
    revealSecrets: () => invoke('g:revealSecrets'),
    listSheetTabs: (id) => invoke('g:listSheetTabs', id),
    readSheet: (id, range) => invoke('g:readSheet', id, range),
    createSheet: (title, headers, rows) => invoke('g:createSheet', title, headers, rows),
    syncHiresSheet: (spreadsheetId, tabs) => invoke('g:syncHiresSheet', spreadsheetId, tabs),
    listGmail: (q, max) => invoke('g:listGmail', q, max),
    // Gmail WRITE — 사용자가 [발송] 버튼을 누른 경우에만 호출
    sendGmail: (payload) => invoke('g:sendGmail', payload),
    openAttachment: (messageId, filename, attachmentId) => invoke('g:openAttachment', messageId, filename, attachmentId),
    fetchAttachmentBase64: (messageId, filename, attachmentId) => invoke('g:fetchAttachmentBase64', messageId, filename, attachmentId),
    listCalendar: (min, max, id) => invoke('g:listCalendar', min, max, id),
    listCalendars: () => invoke('g:listCalendars'),
    listCalendarsFull: () => invoke('g:listCalendarsFull'),
    patchCalendarListEntry: (calendarId, body) => invoke('g:patchCalendarListEntry', calendarId, body),
    // Calendar WRITE (user authorized)
    insertCalEvent: (calendarId, body, sendUpdates) => invoke('g:insertCalEvent', calendarId, body, sendUpdates),
    updateCalEvent: (calendarId, eventId, body, sendUpdates) => invoke('g:updateCalEvent', calendarId, eventId, body, sendUpdates),
    deleteCalEvent: (calendarId, eventId, sendUpdates) => invoke('g:deleteCalEvent', calendarId, eventId, sendUpdates),
    createCalendar: (summary, timeZone, description) => invoke('g:createCalendar', summary, timeZone, description),
    listCalAcl: (calendarId) => invoke('g:listCalAcl', calendarId),
    insertCalAcl: (calendarId, email, role, scopeType) => invoke('g:insertCalAcl', calendarId, email, role, scopeType),
    deleteCalAcl: (calendarId, ruleId) => invoke('g:deleteCalAcl', calendarId, ruleId),
  },

  // 이력서 보관함 — 드래그앤드랍한 원본을 로컬에 쌓고 드라이브에 백업
  resumes: {
    save: (payload) => invoke('rv:save', payload),
    list: () => invoke('rv:list'),
    update: (id, patch) => invoke('rv:update', id, patch),
    read: (id) => invoke('rv:read', id),
    open: (id) => invoke('rv:open', id),
    reveal: () => invoke('rv:reveal'),
    remove: (id) => invoke('rv:delete', id),
    removeMany: (ids, opt) => invoke('rv:deleteMany', ids, opt),
    backup: (ids) => invoke('rv:backup', ids),
    classify: (updates, opts) => invoke('rv:classify', updates, opts),
    organize: () => invoke('rv:organize'),
    contacts: (id) => invoke('rv:contacts', id),
    contactsByName: (name) => invoke('rv:contactsByName', name),
    contactsFromData: (base64, mimeType) => invoke('rv:contactsFromData', base64, mimeType),
    scan: (opt) => invoke('rv:scan', opt),
    importPath: (filePath, meta, password) => invoke('rv:importPath', filePath, meta, password),
    stats: () => invoke('rv:stats'),
    driveFolder: () => invoke('rv:driveFolder'),
  },

  slack: {
    saveToken: (token) => invoke('s:saveToken', token),
    status: () => invoke('s:status'),
    signOut: () => invoke('s:signOut'),
    listChannels: (types) => invoke('s:listChannels', types),
    readChannel: (id, lim) => invoke('s:readChannel', id, lim),
    readMultiple: (ids, lim) => invoke('s:readMultiple', ids, lim),
    search: (q, count) => invoke('s:search', q, count),
    post: (ch, text) => invoke('s:post', ch, text),
  },

  cfg: {
    get: (key) => invoke('cfg:get', key),
    set: (key, value) => invoke('cfg:set', key, value),
    del: (key) => invoke('cfg:del', key),
  },

  mobile: {
    getInfo: () => invoke('mobile:getInfo'),
    rotateToken: () => invoke('mobile:rotateToken'),
    onTunnelUrl: (cb) => subscribe('mobile:tunnelUrl', cb),
  },

  sync: {
    start: (id) => invoke('sync:start', id),
    stop: (id) => invoke('sync:stop', id),
    startAll: () => invoke('sync:startAll'),
    fetchOnce: (id) => invoke('sync:fetchOnce', id),
    cached: (id) => invoke('sync:cached', id),
    foreground: (v) => invoke('sync:foreground', v),
    status: () => invoke('sync:status'),
    onUpdate: (cb) => subscribe('sync:update', cb),
    onTick: (cb) => subscribe('sync:tick', cb),
    onError: (cb) => subscribe('sync:error', cb),
    onRecovered: (cb) => subscribe('sync:recovered', cb),
  },
});
