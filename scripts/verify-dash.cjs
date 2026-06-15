const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const SS_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });
  // computed values (not formulas)
  const g = await sheets.spreadsheets.values.get({ spreadsheetId: SS_ID, range: "'대시보드'!A1:L76", valueRenderOption: 'UNFORMATTED_VALUE' });
  const v = g.data.values || [];
  const row = (i) => (v[i-1]||[]);
  console.log('=== KPI ===');
  console.log('채용필요(건) B4 =', row(4)[1], '| 전체지원자 D4 =', row(4)[3], '| 실제입사 F4 =', row(4)[5], '| 달성율 H4 =', row(4)[7]);
  console.log('진행중 B7 =', row(7)[1], '| 탈락 D7 =', row(7)[3], '| 평균리드타임 F7 =', row(7)[5], '| 20일초과 H7 =', row(7)[7]);
  console.log('\n=== 퍼널 (단계/인원) ===');
  for (let i=60;i<=66;i++){ const r=row(i); if(r[1]) console.log(' ', r[1], '=', r[2]); }
  console.log('\n=== 채널별 (C70:C76) & 유형별 (G70:G72) ===');
  for (let i=70;i<=76;i++){ const r=row(i); if(r[1]!==undefined) console.log('  채널', r[1], '=', r[2], r[5]?`| 유형 ${r[5]} = ${r[6]}`:''); }
  console.log('\n=== 본부별 합계행 (r56) ===');
  console.log('  ', JSON.stringify(row(56)));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
