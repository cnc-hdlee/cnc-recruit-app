/* 성별 옆에 생년월일 + 나이(자동) 컬럼 추가 */
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

  // 1) 성별(J=index9) 뒤에 컬럼 2개 삽입 → K=생년월일, L=나이
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [
    { insertDimension: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 10, endIndex: 12 }, inheritFromBefore: false } },
    // 생년월일(K=10) 날짜서식
    { repeatCell: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: N, startColumnIndex: 10, endColumnIndex: 11 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } },
    // 나이(L=11) 가운데정렬
    { repeatCell: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: N, startColumnIndex: 11, endColumnIndex: 12 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    // 헤더 서식(K:L) 본문 헤더와 통일
    { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 10, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.122, green: 0.220, blue: 0.392 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 } } }, fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)' } },
    { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 96 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 54 }, fields: 'pixelSize' } },
  ] } });

  // 2) 헤더 + 나이 자동수식 + 예시 생년월일
  const ageF = [];
  for (let r = 2; r <= N; r++) ageF.push([`=IF($K${r}="","",DATEDIF($K${r},TODAY(),"Y"))`]);
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SS_ID, requestBody: {
    valueInputOption: 'USER_ENTERED', data: [
      { range: `${Q}K1`, values: [['생년월일', '나이(자동)']] },
      { range: `${Q}L2`, values: ageF },
      { range: `${Q}K2:K5`, values: [['1992-04-10'], ['1988-11-22'], ['1995-06-03'], ['1990-09-15']] },
    ],
  } });

  console.log('AGE_OK');
}
main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
