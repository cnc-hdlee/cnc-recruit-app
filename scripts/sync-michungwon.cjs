/* 전사인원현황 미충원(직접) → 생산직 대시보드 K9:K12 자동 동기화 (작업스케줄러용) */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const DASH = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const SRC = '1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const TEAMS = ['생산1팀', '생산2팀', '생산3팀', '생산4팀'];

(async () => {
  const ts = new Date().toISOString();
  try {
    const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
    const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
    oauth.setCredentials({ refresh_token: tok.refresh_token });
    await oauth.getAccessToken();
    const sheets = google.sheets({ version: 'v4', auth: oauth });

    // 전사인원현황 미충원(직접) 집계
    const src = await sheets.spreadsheets.values.get({ spreadsheetId: SRC, range: '★전사인원현황!B3:P210' });
    const TO = {};
    (src.data.values || []).forEach(r => {
      const team = (r[0] || '').trim(), g = (r[1] || '').trim();
      const mi = Number(String(r[14] || '0').replace(/[^0-9.-]/g, '')) || 0;
      if (TEAMS.includes(team) && g === '직접') TO[team] = (TO[team] || 0) + mi;
    });

    // 대시보드 K9:K12 갱신 (변경 있을 때만)
    const cur = await sheets.spreadsheets.values.get({ spreadsheetId: DASH, range: '대시보드!K9:K12' });
    const now = TEAMS.map(t => TO[t] || 0);
    const before = (cur.data.values || []).map(r => Number(r[0]) || 0);
    const changed = TEAMS.some((_, i) => before[i] !== now[i]);
    if (changed) {
      await sheets.spreadsheets.values.update({ spreadsheetId: DASH, range: '대시보드!K9:K12', valueInputOption: 'USER_ENTERED', requestBody: { values: now.map(v => [v]) } });
    }
    console.log(`${ts} OK ${JSON.stringify(TO)} changed=${changed}`);
  } catch (e) {
    console.error(`${ts} FAIL`, e.response && e.response.data ? JSON.stringify(e.response.data) : e.message);
    process.exit(1);
  }
})();
