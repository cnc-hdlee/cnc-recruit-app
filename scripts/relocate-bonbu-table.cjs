/* 본부별 표를 G49:M51 → A91~(차트 무간섭 영역)로 이전 + 통합 차트 재연결. */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const L3=167562285;const ROSTER="'입사자 명단'";
const BONBU=['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부'];
const BCOL=[{red:0.0,green:0.6,blue:0.6},{red:0.5,green:0.2,blue:0.75},{red:0.85,green:0.2,blue:0.2},{red:0.95,green:0.45,blue:0.75},{red:0.55,green:0.38,blue:0.20},{red:0.6,green:0.6,blue:0.1}];
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  // 옛 표 제거(G48:M51 값+서식)
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${TAB}'!G48:M51`});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:47,endRowIndex:51,startColumnIndex:6,endColumnIndex:13},cell:{userEnteredFormat:{}},fields:'userEnteredFormat'}},
  ]}});

  // 월 목록
  const bv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${ROSTER}!B4:B2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const ms=new Set();bv.forEach(r=>{const m=C(r[0]).match(/^(\d{4})-(\d{2})-\d{2}$/);if(m)ms.add(m[1]+'-'+m[2]);});
  const ml=[...ms].sort();const n=ml.length;

  // 새 표 A91~ : A=월, B..G=본부6
  const LBL=91,hdr=92,first=93,last=first+n-1;
  const header=['월',...BONBU];
  const drows=ml.map((m,i)=>{const rn=first+i;const[y,mm]=m.split('-');const cells=[`=DATE(${y},${mm},1)`];
    BONBU.forEach((b,bi)=>{const col=String.fromCharCode(66+bi);/*B..G*/cells.push(`=COUNTIFS(${ROSTER}!$B$4:$B$2000,"<="&EOMONTH($A${rn},0),${ROSTER}!$D$4:$D$2000,${col}$${hdr})`);});return cells;});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A${LBL}`,valueInputOption:'USER_ENTERED',requestBody:{values:[['🏢 본부별 채용 추이 (월별 누적 입사) — 통합차트 데이터']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A${hdr}`,valueInputOption:'USER_ENTERED',requestBody:{values:[header,...drows]}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:LBL-1,endRowIndex:LBL,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:12}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:hdr,startColumnIndex:0,endColumnIndex:header.length},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy\"년 \"m\"월\"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:1,endColumnIndex:1+BONBU.length},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
  ]}});

  // 차트 재연결
  const COMP={r0:43,r1:44+n};const BON={r0:hdr-1,r1:last};
  const src=(c0,c1,r0,r1)=>({sourceRange:{sources:[{sheetId:DASH,startColumnIndex:c0,endColumnIndex:c1,startRowIndex:r0,endRowIndex:r1}]}});
  const series=[
    {series:src(7,8,COMP.r0,COMP.r1),type:'COLUMN',targetAxis:'LEFT_AXIS',color:{red:0.26,green:0.52,blue:0.96}},
    {series:src(9,10,COMP.r0,COMP.r1),type:'LINE',targetAxis:'LEFT_AXIS',color:{red:0.45,green:0.45,blue:0.45},lineStyle:{type:'MEDIUM_DASHED',width:3},pointStyle:{size:6,shape:'DIAMOND'}},
    ...BONBU.map((b,i)=>({series:src(1+i,2+i,BON.r0,BON.r1),type:'LINE',targetAxis:'LEFT_AXIS',color:BCOL[i],lineStyle:{type:'SOLID',width:2},pointStyle:{size:6,shape:'CIRCLE'}})),
    {series:src(8,9,COMP.r0,COMP.r1),type:'LINE',targetAxis:'RIGHT_AXIS',color:{red:0.92,green:0.34,blue:0.09},lineStyle:{type:'DOTTED',width:3},pointStyle:{size:9,shape:'CIRCLE'}},
  ];
  const spec={title:'채용 추이 통합 (월별) — 누적 입사·채용 필요·달성률 + 본부별',
    subtitle:'막대=누적 입사(명) · 회색점선=채용 필요(명) · 색선=본부별 누적(명) · 주황점선=달성률(%)',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'COMBO',legendPosition:'RIGHT_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'인원(명)'},{position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:src(0,1,BON.r0,BON.r1)}],series}};
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateChartSpec:{chartId:L3,spec}}]}});

  console.log(`OK: 본부표 A${hdr}:G${last} 이전, 차트 재연결(회사 ${COMP.r0+1}-${COMP.r1}, 본부 ${BON.r0+1}-${BON.r1}).`);
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A${hdr}:G${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach(r=>console.log('  ',(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
