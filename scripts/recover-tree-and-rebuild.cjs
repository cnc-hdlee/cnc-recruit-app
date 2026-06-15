/* 복구 + 재구성:
 *  (1) 덮어쓴 트리 행 정밀 복구: A62(라벨만), A63:E65(라벨+SUMIFS 수식), F62:G65 정리.
 *      서식은 인접 정상행 복사 — 팀행 R61 / 실소계 R69.
 *  (2) 본부별 월 추이 표를 트리 밖 우측패널 G48~로 이전.
 *  (3) 통합 차트(167562285) 시리즈 범위를 새 위치로 재연결.
 *  트리 좌측(A~E)은 RAW DATA SUMIFS 결정적 → 원형 복원. 다른 행 미터치.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const L3=167562285;
const RAW="'RAW DATA_채용진행상황(현재)'";const ROSTER="'입사자 명단'";
const BONBU=['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부'];
const BCOL=[{red:0.0,green:0.6,blue:0.6},{red:0.5,green:0.2,blue:0.75},{red:0.85,green:0.2,blue:0.2},{red:0.95,green:0.45,blue:0.75},{red:0.55,green:0.38,blue:0.20},{red:0.6,green:0.6,blue:0.1}];
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

// CFO/경영기획본부 트리 수식
const sumO=(extra)=>`=SUMIFS(${RAW}!$O$3:$O$2001,${RAW}!$E$3:$E$2001,"CFO",${RAW}!$F$3:$F$2001,"경영기획본부"${extra})`;
const sumP=(extra)=>`=SUMIFS(${RAW}!$P$3:$P$2001,${RAW}!$E$3:$E$2001,"CFO",${RAW}!$F$3:$F$2001,"경영기획본부"${extra})`;
const team=(r,sil,tm)=>{const e=`,${RAW}!$G$3:$G$2001,"${sil}",${RAW}!$H$3:$H$2001,"${tm}"`;return [sumO(e),sumP(e),`=B${r}-C${r}`,`=IFERROR(C${r}/B${r},0)`];};
const soce=(r,sil)=>{const e=`,${RAW}!$G$3:$G$2001,"${sil}"`;return [sumO(e),sumP(e),`=B${r}-C${r}`,`=IFERROR(C${r}/B${r},0)`];};

async function main(){
  const s=await auth();

  // ---- (1) 트리 복구 ----
  // A62 라벨만(공백9). B62:E62 수식 생존 → 미터치
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A62`,valueInputOption:'RAW',requestBody:{values:[['         구성원경험팀']]}});
  // A63:E65
  const rows=[
    ['      Workplace Experience실 소계',...soce(63,'Workplace Experience실')],
    ['         재무관리실',...team(64,'재무관리실','재무관리실')],
    ['      재무관리실 소계',...soce(65,'재무관리실')],
  ];
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A63:E65`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  // F62:G65 값 제거
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${TAB}'!F62:G65`});

  // 서식 복사 + F:G 서식 초기화
  const cp=(srcRow,dstRow)=>({copyPaste:{source:{sheetId:DASH,startRowIndex:srcRow,endRowIndex:srcRow+1,startColumnIndex:0,endColumnIndex:5},destination:{sheetId:DASH,startRowIndex:dstRow,endRowIndex:dstRow+1,startColumnIndex:0,endColumnIndex:5},pasteType:'PASTE_FORMAT'}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    cp(60,61), // R61 팀행 -> R62
    cp(68,62), // R69 실소계 -> R63
    cp(60,63), // R61 팀행 -> R64
    cp(68,64), // R69 실소계 -> R65
    {repeatCell:{range:{sheetId:DASH,startRowIndex:61,endRowIndex:65,startColumnIndex:5,endColumnIndex:7},cell:{userEnteredFormat:{}},fields:'userEnteredFormat'}},
  ]}});
  console.log('(1) 트리 R62:R65 복구 완료');

  // ---- (2) 본부별 표를 G48~ 로 작성 ----
  const bv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${ROSTER}!B4:B2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const ms=new Set();bv.forEach(r=>{const m=C(r[0]).match(/^(\d{4})-(\d{2})-\d{2}$/);if(m)ms.add(m[1]+'-'+m[2]);});
  const ml=[...ms].sort();const n=ml.length;
  const LBL=48,hdr=49,first=50,last=first+n-1; // G열 기준
  const header=['월',...BONBU];
  const drows=ml.map((m,i)=>{const rn=first+i;const[y,mm]=m.split('-');const cells=[`=DATE(${y},${mm},1)`];
    BONBU.forEach((b,bi)=>{const col=String.fromCharCode(72+bi);/*H..M*/cells.push(`=COUNTIFS(${ROSTER}!$B$4:$B$2000,"<="&EOMONTH($G${rn},0),${ROSTER}!$D$4:$D$2000,${col}$${hdr})`);});return cells;});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G${LBL}`,valueInputOption:'USER_ENTERED',requestBody:{values:[['🏢 본부별 채용 추이 (월별 누적 입사)']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G${hdr}`,valueInputOption:'USER_ENTERED',requestBody:{values:[header,...drows]}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:LBL-1,endRowIndex:LBL,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:12}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:hdr,startColumnIndex:6,endColumnIndex:6+header.length},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy\"년 \"m\"월\"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:7,endColumnIndex:7+BONBU.length},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
  ]}});
  console.log(`(2) 본부별 표 G${hdr}:M${last} (월 ${n}) 작성`);

  // ---- (3) 통합 차트 재연결 ----
  const COMP={r0:43,r1:44+n};       // 회사표 헤더 R44(idx43)+데이터
  const BON={r0:hdr-1,r1:last};     // 본부표 헤더 R49(idx48)+데이터
  const src=(c0,c1,r0,r1)=>({sourceRange:{sources:[{sheetId:DASH,startColumnIndex:c0,endColumnIndex:c1,startRowIndex:r0,endRowIndex:r1}]}});
  const series=[
    {series:src(7,8,COMP.r0,COMP.r1),type:'COLUMN',targetAxis:'LEFT_AXIS',color:{red:0.26,green:0.52,blue:0.96}},
    {series:src(9,10,COMP.r0,COMP.r1),type:'LINE',targetAxis:'LEFT_AXIS',color:{red:0.45,green:0.45,blue:0.45},lineStyle:{type:'MEDIUM_DASHED',width:3},pointStyle:{size:6,shape:'DIAMOND'}},
    ...BONBU.map((b,i)=>({series:src(7+i,8+i,BON.r0,BON.r1),type:'LINE',targetAxis:'LEFT_AXIS',color:BCOL[i],lineStyle:{type:'SOLID',width:2},pointStyle:{size:6,shape:'CIRCLE'}})),
    {series:src(8,9,COMP.r0,COMP.r1),type:'LINE',targetAxis:'RIGHT_AXIS',color:{red:0.92,green:0.34,blue:0.09},lineStyle:{type:'DOTTED',width:3},pointStyle:{size:9,shape:'CIRCLE'}},
  ];
  const spec={title:'채용 추이 통합 (월별) — 누적 입사·채용 필요·달성률 + 본부별',
    subtitle:'막대=누적 입사(명) · 회색점선=채용 필요(명) · 색선=본부별 누적(명) · 주황점선=달성률(%)',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'COMBO',legendPosition:'RIGHT_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'인원(명)'},{position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:src(6,7,BON.r0,BON.r1)}],series}};
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateChartSpec:{chartId:L3,spec}}]}});
  console.log(`(3) 통합 차트 재연결: 회사 rows ${COMP.r0+1}-${COMP.r1}, 본부 rows ${BON.r0+1}-${BON.r1}`);

  // 검증
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A61:E66`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('\n검증 A61:E66:');chk.forEach((r,i)=>console.log(`R${61+i}: ${(r||[]).join(' | ')}`));
  const cfo=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A74:E75`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('경영기획본부/CFO 소계:');cfo.forEach((r,i)=>console.log(`R${74+i}: ${(r||[]).join(' | ')}`));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
