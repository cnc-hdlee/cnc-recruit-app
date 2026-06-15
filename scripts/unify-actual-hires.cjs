/* 달성률 기준 통일 → 실제 입사(입사자 명단) 기준.
 *  (요약만 변경; 팀 트리는 명단에 실/팀 없어 불가 → 라벨로 구분)
 *  - 헤드라인 R2: 입사예정(P합) → 실제입사 COUNTA(명단)
 *  - 본부별 패널 I5:I11: 입사예정(SUMIF P) → 실제입사 COUNTIF(명단 본부)
 *  - 패널 헤더 I4: '입사예정' → '실제 입사'  / 달성률 J 유지(=I/H)
 *  - 좌측 트리 헤더 C4/E4: '입사예정'/'달성률' → '(요청)' 표기로 구분
 *  - L3 차트 제목/부제 실제입사로
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const L3=167562285;
const RAW="'RAW DATA_채용진행상황(현재)'";const ROSTER="'입사자 명단'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const O=`SUM(${RAW}!$O$3:$O$2001)`;
  const HIRE=`COUNTA(${ROSTER}!$B$4:$B$2000)`;
  // 1) 헤드라인
  const r2=`="총 채용필요 "&${O}&"명   ·   실제 입사 "&${HIRE}&"명   ·   잔여 "&(${O}-${HIRE})&"명   ·   채용달성률 "&TEXT(IFERROR(${HIRE}/${O},0),"0.0%")`;
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A2`,valueInputOption:'USER_ENTERED',requestBody:{values:[[r2]]}});
  // 2) 패널 I5:I11 = 본부별 실제입사
  const I=[5,6,7,8,9,10,11].map(r=>[`=COUNTIF(${ROSTER}!$D$4:$D$2000,$G${r})`]);
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!I5:I11`,valueInputOption:'USER_ENTERED',requestBody:{values:I}});
  // 3) 헤더 라벨
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!I4`,valueInputOption:'RAW',requestBody:{values:[['실제 입사']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!C4`,valueInputOption:'RAW',requestBody:{values:[['입사예정(요청)']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!E4`,valueInputOption:'RAW',requestBody:{values:[['달성률(요청)']]}});
  // 4) L3 차트 제목/부제
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(chartId,spec))'});
  const d=meta.data.sheets.find(x=>x.properties.title===TAB);const c=(d.charts||[]).find(x=>x.chartId===L3);
  c.spec.title='본부별 실제 입사 vs 채용필요 (달성률)';
  c.spec.subtitle='진한 막대=실제 입사(명단) · 연한 막대=채용필요(목표) · 차이=잔여';
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateChartSpec:{chartId:L3,spec:c.spec}}]}});

  console.log('OK: 실제입사 기준 통일 완료');
  // 검증
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A2`,valueRenderOption:'FORMATTED_VALUE'})).data.values;
  console.log('헤드라인:',v&&v[0][0]);
  const p=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!G4:J11`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('패널:');p.forEach(r=>console.log('  ',(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
