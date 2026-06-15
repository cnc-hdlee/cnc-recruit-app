/* 회사 월추이표 G44~ 를 2026-06~12로 확장(달 미리 깔기) + L39 차트(1035164469)를 통합 추이선으로 교체.
 *  표: G=월 H=누적입사(명) I=달성률 J=채용필요(명). 미래 달은 누적이 carry-forward, 데이터 추가 시 자동 상승.
 *  추이선 3개: 누적입사(파랑·좌)·채용필요(회색·좌)·달성률(주황점선·우).
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const TREND=1035164469; // 기존 '채용 필요 대비 충원 추이 (월별)' -> 통합 추이선
const RAW="'RAW DATA_채용진행상황(현재)'";const ROSTER="'입사자 명단'";
const MONTHS=[6,7,8,9,10,11,12]; // 2026
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const hdr=44,first=45,last=first+MONTHS.length-1; // 45..51
  const TO=`SUM(${RAW}!$O$3:$O$2001)`;
  const rows=MONTHS.map((m,i)=>{const rn=first+i;return [
    `=DATE(2026,${m},1)`,
    `=COUNTIF(${ROSTER}!$B$4:$B$2000,"<="&EOMONTH($G${rn},0))`,
    `=IFERROR($H${rn}/$J${rn},0)`,
    `=${TO}`];});
  // 헤더 + 데이터 재기록 (G44:J51)
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G${hdr}`,valueInputOption:'USER_ENTERED',
    requestBody:{values:[['월','누적 입사(명)','달성률','채용 필요(명)'],...rows]}});
  // 라벨(G42)
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G42`,valueInputOption:'USER_ENTERED',requestBody:{values:[['📈 채용 추이 (월별) — 6월~12월']]}});
  // 서식
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:41,endRowIndex:42,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:12}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:hdr,startColumnIndex:6,endColumnIndex:10},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy\"년 \"m\"월\"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:7,endColumnIndex:8},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:8,endColumnIndex:9},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:9,endColumnIndex:10},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
  ]}});

  // 추이선 차트
  const src=(c0,c1)=>({sourceRange:{sources:[{sheetId:DASH,startColumnIndex:c0,endColumnIndex:c1,startRowIndex:hdr-1,endRowIndex:last}]}});
  const spec={
    title:'채용 추이 (월별) — 누적 입사 · 채용 필요 · 달성률',
    subtitle:'파랑=누적 입사(명) · 회색=채용 필요(명) · 주황점선=달성률(%) · 6~12월, 데이터 추가 시 자동 연장',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'인원(명)'},
            {position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:src(6,7)}],
      series:[
        {series:src(7,8),targetAxis:'LEFT_AXIS',color:{red:0.12,green:0.44,blue:0.83},lineStyle:{type:'SOLID',width:3},pointStyle:{size:8,shape:'CIRCLE'}},     // 누적입사
        {series:src(9,10),targetAxis:'LEFT_AXIS',color:{red:0.5,green:0.5,blue:0.5},lineStyle:{type:'MEDIUM_DASHED',width:2},pointStyle:{size:6,shape:'DIAMOND'}}, // 채용필요
        {series:src(8,9),targetAxis:'RIGHT_AXIS',color:{red:0.94,green:0.42,blue:0.0},lineStyle:{type:'DOTTED',width:4},pointStyle:{size:10,shape:'CIRCLE'}},      // 달성률
      ]},
  };
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {updateChartSpec:{chartId:TREND,spec}},
    {updateEmbeddedObjectPosition:{objectId:TREND,newPosition:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:38,columnIndex:11},widthPixels:760,heightPixels:360}},fields:'*'}},
  ]}});

  console.log(`OK: 추이표 G${hdr}:J${last} (월 ${MONTHS.length}) + L39 통합 추이선 760x360.`);
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!G${hdr}:J${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach(r=>console.log('  ',(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
