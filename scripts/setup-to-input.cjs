/* 대시보드 TO를 입력폼으로: 리프(팀) TO 비움 + 소계/합계 SUM 수식 + 상단 KPI 달성율 연결
 * 사용: node setup-to-input.cjs --write
 */
const fs = require('node:fs'); const path = require('node:path'); const { google } = require('googleapis');
const SS_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const WRITE = process.argv.includes('--write');

// 본부별 현황(행 13~56) — J열이 TO. 리프(팀) 행 = 사용자가 입력. 소계/합계 = SUM 수식.
const LEAF = [13,14,16,18,20,21,22, 24,25,27,28,30,32,33,35, 37,39,40,42, 45,47,48,50, 53,54];
const SUBTOTAL = {
  15:'=J13+J14', 17:'=J16', 19:'=J18',
  23:'=J13+J14+J16+J18+J20+J21+J22',
  26:'=J24+J25', 29:'=J27+J28', 31:'=J30', 34:'=J32+J33',
  36:'=J24+J25+J27+J28+J30+J32+J33+J35',
  38:'=J37', 41:'=J39+J40', 43:'=J42',
  44:'=J37+J39+J40+J42',
  46:'=J45', 49:'=J47+J48', 51:'=J50',
  52:'=J45+J47+J48+J50',
  55:'=J53+J54',
  56:'=J23+J36+J44+J52+J55',
};

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token }); await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  const data = [];
  LEAF.forEach(r => data.push({ range: `'대시보드'!J${r}`, values: [['']] }));         // 리프 TO 비움(입력란)
  Object.entries(SUBTOTAL).forEach(([r,f]) => data.push({ range: `'대시보드'!J${r}`, values: [[f]] })); // 소계/합계 SUM
  data.push({ range: `'대시보드'!B4`, values: [['=J56']] });                              // 채용필요(건) = 총 TO
  data.push({ range: `'대시보드'!H4`, values: [['=IFERROR(F4/J56,0)']] });                // 채용달성율 = 실제입사 / 총TO

  console.log(`업데이트 셀: 리프TO 비움 ${LEAF.length} + 소계/합계 ${Object.keys(SUBTOTAL).length} + KPI 2 = ${data.length}`);
  if (!WRITE) { console.log('[DRY] --write 시 반영'); return; }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SS_ID, requestBody: { valueInputOption: 'USER_ENTERED', data } });
  console.log('[WRITE] 완료. 팀 TO만 입력하면 소계·합계·채용달성율 자동 계산.');
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
