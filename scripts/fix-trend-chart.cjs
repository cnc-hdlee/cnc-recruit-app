/* 대시보드 차트4(추이선) 통일 — 입사자명단 직접카운트 → RAW 기준으로 교체.
 * 달성률 = SUM(RAW P) * (입사확정일 ≤ 월말 누적비율, 포기제외) / SUM(RAW O)  → 끝점 = 대시보드 28.7%와 일치.
 * 남은 채용필요 = SUM(RAW O) − 위 분자.  RAW 시트는 안 건드림(대시보드 수식·차트만).
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',GID=500969666;
const RAW="'RAW DATA_채용진행상황(현재)'",MS="'입사자 명단'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const SP=`SUM(${RAW}!$P$3:$P$2001)`,SO=`SUM(${RAW}!$O$3:$O$2001)`;
const ratio=r=>`COUNTIFS(${MS}!$B$4:$B$2000,"<="&EOMONTH($A${r},0),${MS}!$P$4:$P$2000,"<>*포기*")/COUNTIFS(${MS}!$B$4:$B$2000,"<>",${MS}!$P$4:$P$2000,"<>*포기*")`;
async function main(){
  const s=await auth();
  // 데이터 6~12월 (105~111)
  const rows=[];const months=[6,7,8,9,10,11,12];
  rows.push(['📈 채용달성률 & 남은 채용필요 추이 (RAW 기준 · 입사확정일 분포)','','']);   //103
  rows.push(['월','채용달성률','남은 채용필요(건)']);                                      //104
  months.forEach((m,i)=>{const r=105+i;rows.push([`=DATE(2026,${m},1)`,`=${SP}*(${ratio(r)})/${SO}`,`=${SO}-${SP}*(${ratio(r)})`]);});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`대시보드!A103:C111`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});

  // 서식 + 차트 갱신
  const reqs=[
    {repeatCell:{range:{sheetId:GID,startRowIndex:104,endRowIndex:111,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy"년 "m"월"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:104,endRowIndex:111,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:104,endRowIndex:111,startColumnIndex:2,endColumnIndex:3},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0"건"'}}},fields:'userEnteredFormat.numberFormat'}},
  ];
  const src=(c)=>({sourceRange:{sources:[{sheetId:GID,startRowIndex:104,endRowIndex:111,startColumnIndex:c,endColumnIndex:c+1}]}});
  reqs.push({updateChartSpec:{chartId:330002883,spec:{title:'채용달성률 & 남은 채용필요 추이 (RAW 기준)',basicChart:{
    chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
    axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'남은 채용필요(건)'},{position:'RIGHT_AXIS',title:'채용달성률'}],
    domains:[{domain:src(0)}],
    series:[
      {series:src(1),targetAxis:'RIGHT_AXIS',color:{red:0.118,green:0.439,blue:0.827}},
      {series:src(2),targetAxis:'LEFT_AXIS',color:{red:0.937,green:0.420,blue:0.0}},
    ]}}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});

  // 검증 출력
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`대시보드!A104:C111`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('=== 새 차트4 데이터 (RAW 기준) ===');
  v.forEach(r=>console.log('  '+(r||[]).join(' | ')));
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`대시보드!E?`.replace('E?','B109'),valueRenderOption:'FORMATTED_VALUE'})).data.values;
  console.log('\n끝점(12월) 달성률이 대시보드 전사(28.7%)와 같아야 함 ↑');
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
