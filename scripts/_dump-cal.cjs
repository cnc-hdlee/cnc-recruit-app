// 진단용: 앱과 동일한 인증/범위로 READ_CALENDAR_IDS 전체를 덤프한다.
// 실행: npx electron scripts/_dump-cal.cjs
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const CALS = {
  primary: 'primary',
  interview: 'c_d2a3298862ba8bba109c13c83c2cc7c1ac85560bdc12a305c40c79f6964c65a2@group.calendar.google.com',
  interviewAlt: 'c_711021d8db3140f0fa36874c11e98a449ee5528637e020d891cf903cd4b8c443@group.calendar.google.com',
  interviewMgr: 'c_21d3c76327cd3e4ab66cb7f7cfdb6f1a7c63500dd0d8af17212640edee2c5459@group.calendar.google.com',
  onboardingMain: 'c_e006d0f491165344836f40c2589456a597676d6d551c00a477e5fe6c46a8804f@group.calendar.google.com',
  offboarding: 'c_6b893ca53cb3b057d4e04928dffae5408a3b4c81332b561668190094bf09c2a7@group.calendar.google.com',
  interviewX: 'c_bebeafad40540c7c46a8b75315ef413571d6f9fb13ef74c0f31cca541bd93587@group.calendar.google.com',
  shim: 'shim@cnccosmetic.com',
};

app.setPath('userData', 'C:/Users/user/AppData/Roaming/cnc-recruit-app');
app.whenReady().then(async () => {
  const google = require('../electron/integrations/google.cjs');
  const now = Date.now();
  const timeMin = new Date(now - 30 * 86400e3).toISOString();
  const timeMax = new Date(now + 90 * 86400e3).toISOString();
  const out = { timeMin, timeMax, cals: {}, calendarList: [] };
  try {
    out.calendarList = await google.listCalendarsFull();
  } catch (e) {
    out.calendarListError = String(e.message || e);
  }
  for (const [name, id] of Object.entries(CALS)) {
    try {
      const items = await google.listCalendar(timeMin, timeMax, id);
      out.cals[name] = { id, count: items.length, items };
    } catch (e) {
      out.cals[name] = { id, error: String(e.message || e) };
    }
  }
  const dest = process.argv[process.argv.length - 1].endsWith('.json')
    ? process.argv[process.argv.length - 1]
    : path.join(__dirname, '_calendar_dump.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE', dest);
  for (const [n, v] of Object.entries(out.cals)) console.log(n, v.count ?? v.error);
  app.quit();
});
