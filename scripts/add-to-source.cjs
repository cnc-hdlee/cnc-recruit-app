/* 전사인원현황 미충원 IMPORTRANGE 연결용 숨김탭 _src 생성 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const SRC = '1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  // _src 탭 있으면 재사용, 없으면 생성
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SS_ID, fields: 'sheets(properties(sheetId,title))' });
  const exists = meta.data.sheets.find(s => s.properties.title === '_src');
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [
      { addSheet: { properties: { title: '_src', hidden: true, gridProperties: { rowCount: 220, columnCount: 16 } } } },
    ] } });
  }
  // IMPORTRANGE (전사인원현황 B3:P210 = 팀/구분 ... 미충원)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SS_ID, range: '_src!A1', valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[`=IMPORTRANGE("${SRC}","★전사인원현황!B3:P210")`]] },
  });

  console.log('SRC_OK');
}
main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
