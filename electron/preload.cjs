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
    listGmail: (q, max) => invoke('g:listGmail', q, max),
    listCalendar: (min, max, id) => invoke('g:listCalendar', min, max, id),
    listCalendars: () => invoke('g:listCalendars'),
    // Calendar WRITE (user authorized)
    insertCalEvent: (calendarId, body) => invoke('g:insertCalEvent', calendarId, body),
    updateCalEvent: (calendarId, eventId, body, sendUpdates) => invoke('g:updateCalEvent', calendarId, eventId, body, sendUpdates),
    deleteCalEvent: (calendarId, eventId, sendUpdates) => invoke('g:deleteCalEvent', calendarId, eventId, sendUpdates),
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
  },
});
