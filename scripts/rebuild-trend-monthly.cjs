/* L4 추이 월별 재구성: 채용필요(승인일 누적)·누적입사·달성률 3선.
 * 겹침 원천제거: 달성률은 라벨 없음(선만). 채용필요=회색(범례 맨 왼쪽), 누적입사=주황(숫자 위), 달성률=파랑(우측축).
 * 채용필요=N열, 승인일=A열, 부문=D열. 누적입사=입사자명단 입사확정일.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',GID=500969666;
const R="'RAW DATA_채용진행상황(현재)'",MS="'입사자 명단'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 기존 추이 영역 정리(A101:H111)
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`대시보드!A101:H115`});
  // 월별표 A101~ (1~7월)
  const need=`SUMIFS(${R}!$N$4:$N$2001,${R}!$A$4:$A$2001,"<="&EOMONTH($A{R},0))`;
  const hire=`COUNTIFS(${MS}!$B$4:$B$2000,"<="&EOMONTH($A{R},0),${MS}!$P$4:$P$2000,"<>*포기*")`;
  const tot=`SUMIFS(${R}!$N$4:$N$2001,${R}!$D$4:$D$2001,"<>")`;
  const rows=[['📈 채용 진행 추이 (월별)','','',''],['월','채용필요(누적)','누적입사','달성률']];
  for(let m=1;m<=7;m++){const r=m+102;rows.push([`=DATE(2026,${m},1)`,`=${need.replace(/{R}/g,r)}`,`=${hire.replace(/{R}/g,r)}`,`=${hire.replace(/{R}/g,r)}/${tot}`]);}
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`대시보드!A101`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  // 서식: 월=날짜, 채용필요/누적입사=정수, 달성률=%
  const reqs=[
    {repeatCell:{range:{sheetId:GID,startRowIndex:102,endRowIndex:109,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy"년 "m"월"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:102,endRowIndex:109,startColumnIndex:1,endColumnIndex:3},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:102,endRowIndex:109,startColumnIndex:3,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
  ];
  // 차트 재정의 — domain A102:A109(헤더포함), 3계열
  const GR={red:0.55,green:0.55,blue:0.58},Of={red:0.937,green:0.420,blue:0.0},Bf={red:0.118,green:0.439,blue:0.827};
  const src=(c)=>({sourceRange:{sources:[{sheetId:GID,startRowIndex:101,endRowIndex:109,startColumnIndex:c,endColumnIndex:c+1}]}});
  reqs.push({updateChartSpec:{chartId:330002883,spec:{
    title:'채용 진행 추이 (월별)',
    subtitle:'⬛ 채용필요(누적·회색) · 🟠 누적입사(주황·숫자 아래) · 🔵 달성률(파랑·숫자 위·우측축)',
    basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'인원(명)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:135}},{position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:src(0)}],
      series:[
        {series:src(1),targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:GR},lineStyle:{type:'SOLID',width:3},pointStyle:{size:6,shape:'CIRCLE'}},   // 채용필요 — 라벨없음(천장)
        {series:src(2),targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:Of},lineStyle:{type:'SOLID',width:3},pointStyle:{size:7,shape:'CIRCLE'},dataLabel:{type:'DATA',placement:'BELOW',textFormat:{fontSize:10,bold:true,foregroundColor:Of}}},   // 누적입사 — 숫자 아래
        {series:src(3),targetAxis:'RIGHT_AXIS',colorStyle:{rgbColor:Bf},lineStyle:{type:'SOLID',width:3},pointStyle:{size:6,shape:'CIRCLE'},dataLabel:{type:'DATA',placement:'ABOVE',textFormat:{fontSize:10,bold:true,foregroundColor:Bf}}}   // 달성률 — 숫자 위
      ]}}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`대시보드!A102:D109`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('월별 추이:');v.forEach(r=>console.log('  '+(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
