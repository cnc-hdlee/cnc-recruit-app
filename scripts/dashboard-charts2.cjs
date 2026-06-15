/* 대시보드 재구성: 상단 한 화면에 KPI + 그래프 4종. 집계표는 화면밖 하단(200행~).
 * 옆(AB열) 집계표/기존차트 제거. 기존 내용은 상단 행삽입으로 아래로 보존.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const DASH=500969666;
const TEST="RAW DATA_정리본(test)";
const HQ=['생산본부','경영기획본부','영업본부','Makeup Center','OD본부','생산기획부','품질경영본부','Skin Science Center','크리에이티브솔루션본부','CEO 직속','People&culture실'];
const STATUS=['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'];
const PRIO=['P0','P1','P2','P3'];
const T=(c)=>`'${TEST}'!$${c}$2:$${c}$2000`;
const HROW=200; // 헬퍼 시작행(화면밖)

async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const src=(r0,r1,c)=>({sourceRange:{sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
function colChart(title,r0,r1,domC,serCs,aRow,aCol){return {addChart:{chart:{spec:{title,basicChart:{chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,domains:[{domain:src(r0,r1,domC)}],series:serCs.map(c=>({series:src(r0,r1,c),targetAxis:'LEFT_AXIS'}))}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:aRow,columnIndex:aCol},widthPixels:560,heightPixels:300}}}}};}
function pieChart(title,r0,r1,domC,serC,aRow,aCol){return {addChart:{chart:{spec:{title,pieChart:{legendPosition:'RIGHT_LEGEND',domain:src(r0,r1,domC),series:src(r0,r1,serC)}},position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:aRow,columnIndex:aCol},widthPixels:560,heightPixels:300}}}}};}

async function main(){
  const sheets=await auth();
  // 1) 기존 차트 삭제
  const meta=await sheets.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId),charts(chartId))'});
  const dsh=meta.data.sheets.find(s=>s.properties.sheetId===DASH);
  const del=(dsh.charts||[]).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));
  if(del.length){await sheets.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:del}});console.log('기존차트',del.length,'삭제');}
  // 2) 옆 집계표/타이틀 제거 + 상단 36행 삽입
  await sheets.spreadsheets.values.clear({spreadsheetId:ID,range:"'대시보드'!N1:AN40"});
  await sheets.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {insertDimension:{range:{sheetId:DASH,dimension:'ROWS',startIndex:0,endIndex:36},inheritFromBefore:false}}
  ]}});
  console.log('옆 집계표 제거 + 상단 36행 삽입');
  // 3) 헬퍼 집계표(하단 200행~) + 상단 KPI/타이틀 작성
  const hq=[['본부','TO','입사예정','달성률']];
  HQ.forEach((h,i)=>{const r=HROW+1+i;hq.push([h,`=SUMIF(${T('B')},A${r},${T('AE')})`,`=SUMIF(${T('B')},A${r},${T('AQ')})`,`=IF(B${r}=0,0,C${r}/B${r})`]);});
  const st=[['현황','건수']];STATUS.forEach((x,i)=>{const r=HROW+1+i;st.push([x,`=COUNTIF(${T('AS')},F${r})`]);});
  const pr=[['우선순위','TO']];PRIO.forEach((x,i)=>{const r=HROW+1+i;pr.push([x,`=SUMIF(${T('AN')},I${r},${T('AE')})`]);});
  await sheets.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    {range:`'대시보드'!A${HROW}`,values:hq},
    {range:`'대시보드'!F${HROW}`,values:st},
    {range:`'대시보드'!I${HROW}`,values:pr},
    // 상단 타이틀/KPI
    {range:"'대시보드'!B1",values:[['📊 채용요청 달성률 대시보드   ·   출처: 채용요청(정규직)DB']]},
    {range:"'대시보드'!B2",values:[[
      `=SUM(${T('AE')})`,'', `=SUM(${T('AQ')})`,'', `=SUM(${T('AE')})-SUM(${T('AQ')})`,'', `=IF(SUM(${T('AE')})=0,0,SUM(${T('AQ')})/SUM(${T('AE')}))`
    ]]},
    {range:"'대시보드'!B3",values:[['총 TO (명)','','입사예정 (명)','','잔여 (명)','','채용달성률']]},
  ]}});
  // 4) 서식 + 차트
  const reqs=[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:HROW,endRowIndex:HROW+11,startColumnIndex:3,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:1,endRowIndex:2,startColumnIndex:7,endColumnIndex:8},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},textFormat:{bold:true,fontSize:14}}},fields:'userEnteredFormat(numberFormat,textFormat)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:0,endRowIndex:1,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:15}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:1,endRowIndex:2,startColumnIndex:1,endColumnIndex:7},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:14}}},fields:'userEnteredFormat.textFormat'}},
    // 차트: 본부별 헬퍼 rows HROW-1..HROW+10 (header+11)
    colChart('본부별 TO vs 입사예정', HROW-1, HROW+11, 0,[1,2], 4,1),   // B5
    colChart('본부별 채용달성률',     HROW-1, HROW+11, 0,[3],   4,11),  // L5
    pieChart('채용현황 단계별 분포',  HROW-1, HROW+6,  5,6,     20,1),  // B21
    colChart('우선순위별 TO',         HROW-1, HROW+4,  8,9,     20,11), // L21
  ];
  const resp=await sheets.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log('차트 생성:',resp.data.replies.filter(r=>r.addChart).length,'개 (상단 2x2)');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
