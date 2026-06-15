/* TEST 탭 깔끔 재구성: 채용요청 전용 17컬럼 + 명단 정리 + 열너비 조정 + 대시보드 헬퍼 갱신 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const SRC='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const SRC_TAB='채용요청(정규직)DB';
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TEST='RAW DATA_정리본(test)';const GID=55388169;const DASH=500969666;
const clean=x=>{x=String(x==null?'':x).trim();return x==='-'?'':x;};
const num=x=>{if(x===''||x==null)return '';const v=Number(x);return isNaN(v)?'':v;};
const HQ_KEEP=['생산본부','경영기획본부','영업본부','Makeup Center','OD본부','생산기획부','Skin Science Center','크리에이티브솔루션본부','CEO 직속','People&culture실'];
const HEADERS=['채용요청번호','우선순위','본부','실/부','팀','직무','채용유형','채용상세사유','근무지','직/간접','TO인원','입사예정','잔여','채용달성률','채용현황','후보자명','채용요청링크'];
// 컬럼레터: A채용요청번호 B우선순위 C본부 D실부 E팀 F직무 G채용유형 H상세사유 I근무지 J직간접 K TO L입사예정 M잔여 N달성률 O현황 P후보자명 Q링크

async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const src=(await s.spreadsheets.values.get({spreadsheetId:SRC,range:`'${SRC_TAB}'!A1:Q1026`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
  const body=src.slice(1).filter(r=>r&&(clean(r[2])||clean(r[5])));
  const orgSet=new Set();const out=[];
  body.forEach((r,i)=>{
    const rownum=i+2;
    let bonbu=clean(r[2]); if(bonbu==='품질경영본부')bonbu='생산본부';
    const org2=clean(r[3]); if(org2&&!/^\d+$/.test(org2)&&org2!=='품질경영본부')orgSet.add(org2);
    const q=clean(r[16]);const n=clean(r[13]);const qIsNames=/\d+\.\s*[가-힣]/.test(q);
    const name=qIsNames?q:n; const link=qIsNames?'':q;
    out.push([
      clean(r[0]),         // A 채용요청번호
      clean(r[1]),         // B 우선순위
      bonbu,               // C 본부
      org2,                // D 실/부
      clean(r[4]),         // E 팀
      clean(r[5]),         // F 직무
      clean(r[8]),         // G 채용유형(사유)
      clean(r[9]),         // H 채용상세사유
      clean(r[10]),        // I 근무지
      clean(r[11]),        // J 직/간접
      num(r[6]),           // K TO인원
      num(r[14]),          // L 입사예정
      num(r[15]),          // M 잔여
      `=IF(K${rownum}="","",L${rownum}/K${rownum})`, // N 달성률
      clean(r[12]),        // O 채용현황
      name,                // P 후보자명
      link,                // Q 링크
    ]);
  });
  console.log('재구성 행:',out.length);

  // 1) 기존 검증 전체 제거 + 값 클리어
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{setDataValidation:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2000,startColumnIndex:0,endColumnIndex:48}}}]}});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${TEST}'!A1:AV2000`});
  // 2) 헤더+데이터 쓰기
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TEST}'!A1`,valueInputOption:'USER_ENTERED',requestBody:{values:[HEADERS,...out]}});
  console.log('헤더+데이터 작성');

  // 3) 컬럼 trim + 드롭다운/형식/헤더서식/열너비
  const rng=(c)=>({sheetId:GID,startRowIndex:1,endRowIndex:2000,startColumnIndex:c,endColumnIndex:c+1});
  const dv=(c,opts)=>({setDataValidation:{range:rng(c),rule:{condition:{type:'ONE_OF_LIST',values:opts.map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}});
  const reqs=[
    {updateSheetProperties:{properties:{sheetId:GID,gridProperties:{columnCount:17}},fields:'gridProperties.columnCount'}},
    dv(1,['P0','P1','P2','P3']),
    dv(2,HQ_KEEP),
    dv(3,[...orgSet]),
    dv(6,['신규','결원','대체','충원','증원','전환']),
    dv(8,['퍼플','수원','그린','서울','방교']),
    dv(9,['직접','간접']),
    dv(14,['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정']),
    {repeatCell:{range:rng(13),cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    // 헤더 서식 (다크블루+흰굵게)
    {repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:17},cell:{userEnteredFormat:{backgroundColor:{red:0.12156863,green:0.21960784,blue:0.39215687},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    // 열너비 자동맞춤
    {autoResizeDimensions:{dimensions:{sheetId:GID,dimension:'COLUMNS',startIndex:0,endIndex:17}}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  // 4) 긴 텍스트 컬럼은 너비 고정(자동맞춤이 과도하게 넓어지므로) — H상세사유, P후보자명, Q링크
  const setW=(c,px)=>({updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[setW(7,200),setW(15,150),setW(16,210)]}});
  console.log('드롭다운/형식/열너비 적용. 실/부 옵션:',orgSet.size);

  // 5) 입사예정(정규직)DB 실제입사 집계 (6/1~)
  const hires=(await s.spreadsheets.values.get({spreadsheetId:SRC,range:`'입사예정(정규직)DB'!A2:G2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const BMAP={'제조부':'생산본부'};
  const actual={};let totalActual=0;
  hires.filter(r=>r&&r[6]&&String(r[6]).trim()).forEach(r=>{let b=String(r[1]||'').trim();b=BMAP[b]||b;actual[b]=(actual[b]||0)+1;totalActual++;});
  console.log('실제입사 총',totalActual,'명 / 본부별',JSON.stringify(actual));

  // 6) 대시보드 헬퍼(화면밖 200행~) : 본부 | TO(live) | 실제입사(static) | 달성률
  const HROW=200;const T=c=>`'${TEST}'!$${c}$2:$${c}$2000`;
  const STATUS=['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'];const PRIO=['P0','P1','P2','P3'];
  const hq=[['본부','TO','실제입사','달성률']];HQ_KEEP.forEach((h,i)=>{const r=HROW+1+i;hq.push([h,`=SUMIF(${T('C')},A${r},${T('K')})`, actual[h]||0, `=IF(B${r}=0,0,C${r}/B${r})`]);});
  const stt=[['현황','건수']];STATUS.forEach((x,i)=>{const r=HROW+1+i;stt.push([x,`=COUNTIF(${T('O')},F${r})`]);});
  const pr=[['우선순위','TO']];PRIO.forEach((x,i)=>{const r=HROW+1+i;pr.push([x,`=SUMIF(${T('B')},I${r},${T('K')})`]);});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!A200:J215"});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!A200',valueInputOption:'USER_ENTERED',requestBody:{values:hq.map((row,i)=>row.concat(stt[i]?['',...stt[i]]:['','','']).concat(pr[i]?['',...pr[i]]:['','','']))}});

  // 7) 우측 상단 KPI 요약 (M1:N4) — 원본 A~L 영역은 안 건드림
  await s.spreadsheets.values.update({spreadsheetId:ID,range:'대시보드!M1',valueInputOption:'USER_ENTERED',requestBody:{values:[
    ['■ 채용 달성률 요약',''],
    ['총 TO (명)',`=SUM(${T('K')})`],
    ['실제 입사 (명)',totalActual],
    ['채용 달성률',`=IF(N2=0,0,N3/N2)`],
  ]}});

  // 8) 기존 차트 삭제 후 재생성 (작게, 우측)
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(x=>x.properties.sheetId===DASH);
  const delc=(dsh.charts||[]).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));
  if(delc.length)await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:delc}});
  const NB=HQ_KEEP.length; // 본부수
  const srcR=(r0,r1,c)=>({sourceRange:{sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
  const W=360,H=210;
  const colC=(title,r0,r1,d,ser,ar,ac)=>({addChart:{chart:{spec:{title,basicChart:{chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,domains:[{domain:srcR(r0,r1,d)}],series:ser.map(c=>({series:srcR(r0,r1,c),targetAxis:'LEFT_AXIS'}))}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:W,heightPixels:H}}}}});
  const pieC=(title,r0,r1,d,se,ar,ac)=>({addChart:{chart:{spec:{title,pieChart:{legendPosition:'RIGHT_LEGEND',domain:srcR(r0,r1,d),series:srcR(r0,r1,se)}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:ar,columnIndex:ac},widthPixels:W,heightPixels:H}}}}});
  const chartReqs=[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:HROW,endRowIndex:HROW+NB,startColumnIndex:3,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:3,endRowIndex:4,startColumnIndex:13,endColumnIndex:14},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},textFormat:{bold:true}}},fields:'userEnteredFormat(numberFormat,textFormat)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:0,endRowIndex:1,startColumnIndex:12,endColumnIndex:13},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:12}}},fields:'userEnteredFormat.textFormat'}},
    colC('본부별 TO vs 실제입사',HROW-1,HROW+NB,0,[1,2],5,12),   // M6
    colC('본부별 채용달성률',HROW-1,HROW+NB,0,[3],5,18),         // S6
    pieC('채용현황 단계별 분포',HROW-1,HROW+6,5,6,17,12),        // M18
    colC('우선순위별 TO',HROW-1,HROW+4,8,[9],17,18),             // S18
  ];
  const resp=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:chartReqs}});
  console.log('대시보드 갱신: 실제입사 연동 + KPI + 차트',resp.data.replies.filter(r=>r.addChart).length,'개');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
