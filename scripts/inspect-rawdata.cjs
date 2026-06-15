/* RAW DATA_정리본 현황 점검: 탭 gid, 행 수, 채널 분포, 헤더 확인 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const SHEET = 'RAW DATA_정리본';

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SS_ID });
  console.log('=== 탭 목록 ===');
  for (const s of meta.data.sheets) {
    console.log(`  "${s.properties.title}" gid=${s.properties.sheetId} rows=${s.properties.gridProperties.rowCount} cols=${s.properties.gridProperties.columnCount}`);
  }

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SS_ID, range: `'${SHEET}'!A1:AL1300` });
  const vals = res.data.values || [];
  console.log(`\n=== '${SHEET}' 데이터 행(헤더 포함): ${vals.length} ===`);
  console.log('헤더:', JSON.stringify(vals[0]));

  // 채널 = K열 = index 10
  const ch = {};
  for (let i = 1; i < vals.length; i++) {
    const v = (vals[i][10] || '').trim();
    if (v) ch[v] = (ch[v] || 0) + 1;
  }
  console.log('\n=== 현재 채널 분포(K열) ===');
  Object.entries(ch).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}`));

  // 본부 분포(B), 채용유형(G), 신입경력(J)
  const dist = (idx,label)=>{const m={};for(let i=1;i<vals.length;i++){const v=(vals[i][idx]||'').trim();if(v)m[v]=(m[v]||0)+1;}console.log(`\n=== ${label} (idx ${idx}) ===`);Object.entries(m).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}`));};
  dist(1,'본부'); dist(6,'채용유형'); dist(9,'신입/경력'); dist(7,'근무지');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
