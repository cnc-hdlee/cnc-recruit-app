/* L3에 '채용 달성률 추이 & 예측' 라인차트 추가 (기존 L3 막대는 아래로 이동, 미삭제).
 *  데이터 표 A90~ : 월(6~12) / 실제 채용달성률(누적입사÷목표, 미래월 공백) / 예측(FORECAST.LINEAR 추세).
 *  + "달성률" 헤더 라벨 → "채용 달성률" 일괄 변경.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const RAW="'RAW DATA_채용진행상황(현재)'";const ROSTER="'입사자 명단'";
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const rng=(r0,r1,c0,c1)=>({sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});

async function main(){
  const s=await auth();
  // 실제 데이터 월 수
  const bv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${ROSTER}!B4:B2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const ms=new Set();bv.forEach(r=>{const m=C(r[0]).match(/^(\d{4})-(\d{2})-\d{2}$/);if(m)ms.add(m[1]+'-'+m[2]);});
  const nA=Math.max(2,[...ms].size); // 예측 기준 실제월 수(최소2)
  const MONTHS=[6,7,8,9,10,11,12];
  const LBL=90,hdr=91,first=92,last=first+MONTHS.length-1;        // 표: A90 라벨, A91 헤더, A92~A98
  const aLast=first+nA-1;                                          // 실제 데이터 마지막 행
  const TO=`SUM(${RAW}!$O$3:$O$2001)`;
  const rows=MONTHS.map((m,i)=>{const r=first+i;return [
    `=DATE(2026,${m},1)`,
    `=IF($A${r}>EOMONTH(MAX(${ROSTER}!$B$4:$B$2000),0),"",COUNTIF(${ROSTER}!$B$4:$B$2000,"<="&EOMONTH($A${r},0))/${TO})`,
    `=IFERROR(FORECAST.LINEAR($A${r},$B$${first}:$B$${aLast},$A$${first}:$A$${aLast}),"")`,
  ];});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A${LBL}`,valueInputOption:'USER_ENTERED',requestBody:{values:[['📈 채용 달성률 추이 & 예측 (월별, 실제 입사 누적 기준)']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A${hdr}`,valueInputOption:'USER_ENTERED',requestBody:{values:[['월','실제 채용 달성률','예측(추세)'],...rows]}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:LBL-1,endRowIndex:LBL,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:12}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:hdr,startColumnIndex:0,endColumnIndex:3},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy"년 "m"월"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:1,endColumnIndex:3},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
  ]}});

  // L3 새 라인차트 + 기존 167562285(본부별 달성률 막대) L63으로 이동
  const pos=(r,w,h)=>({overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:r,columnIndex:11},widthPixels:w,heightPixels:h}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {updateEmbeddedObjectPosition:{objectId:167562285,newPosition:pos(62,440,230),fields:'*'}},
    {addChart:{chart:{spec:{
      title:'채용 달성률 추이 & 예측 (월별)',
      subtitle:'실선=실제(입사 누적÷채용목표) · 점선=예측 추세선 · 데이터 추가 시 자동 갱신',
      titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
      basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
        axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'채용 달성률'}],
        domains:[{domain:{sourceRange:rng(hdr-1,last,0,1)}}],
        series:[
          {series:{sourceRange:rng(hdr-1,last,1,2)},targetAxis:'LEFT_AXIS',color:{red:0.12,green:0.44,blue:0.83},lineStyle:{type:'SOLID',width:3},pointStyle:{size:8,shape:'CIRCLE'},dataLabel:{type:'DATA',textFormat:{fontSize:9}}},
          {series:{sourceRange:rng(hdr-1,last,2,3)},targetAxis:'LEFT_AXIS',color:{red:0.94,green:0.42,blue:0.0},lineStyle:{type:'MEDIUM_DASHED',width:2},pointStyle:{size:5,shape:'DIAMOND'}},
        ]}},
      position:pos(2,440,230)}}},
  ]}});

  // "달성률" 라벨 → "채용 달성률"
  for(const cell of ['E4','J4','J14','J20','J32']){
    await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!${cell}`,valueInputOption:'RAW',requestBody:{values:[['채용 달성률']]}});
  }
  console.log('OK: L3 예측 라인차트 추가, 본부별 막대 L63 이동, 달성률→채용 달성률 라벨 변경');
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A${hdr}:C${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach(r=>console.log('  ',(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
