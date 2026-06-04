/* 체류자격 F비자만 + 이력서_링크 컬럼 삭제 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const RAW = '생산직 RAW DATA';
const Q = "'" + RAW + "'!";
const N = 400;

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  const FVISA = ['F-2(거주)', 'F-4(재외동포)', 'F-5(영주)', 'F-6(결혼이민)'];

  // 1) 예시 비자값을 F비자로 (L2:L5) — E-9/H-2 → F계열
  await sheets.spreadsheets.values.update({
    spreadsheetId: SS_ID, range: `${Q}L2:L5`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['F-4(재외동포)'], ['F-5(영주)'], ['F-4(재외동포)'], ['F-6(결혼이민)']] },
  });

  // 2) 비자 드롭다운 = F비자만 (col L = index11) + 이력서_링크 컬럼(P=index15) 삭제
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [
    { setDataValidation: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: N, startColumnIndex: 11, endColumnIndex: 12 },
      rule: { condition: { type: 'ONE_OF_LIST', values: FVISA.map(v => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } },
    { deleteDimension: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 15, endIndex: 16 } } },
  ] } });

  console.log('RAW_OK (F비자 + 이력서링크 삭제)');
}
main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
