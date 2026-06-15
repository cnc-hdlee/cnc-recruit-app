/* 대시보드: 채용요청(TO/달성) 집계표(우측) + 상단 그래프 4종 추가 (비파괴)
 * 사용: node dashboard-charts.cjs --write
 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const DASH_GID = 500969666;
const TEST = "RAW DATA_정리본(test)";
const WRITE = process.argv.includes('--write');

const HQ = ['생산본부','경영기획본부','영업본부','Makeup Center','OD본부','생산기획부','품질경영본부','Skin Science Center','크리에이티브솔루션본부','CEO 직속','People&culture실'];
const STATUS = ['서류접수','면접예정','인성검사','처우협의','채용품의','입사확정'];
const PRIO = ['P0','P1','P2','P3'];

// TEST 탭 컬럼 A1표기: 본부=B, 채용유형=G, TO인원=AE, 우선순위=AN, 입사예정=AQ, 채용현황=AS
const T = (c)=>`'${TEST}'!$${c}$2:$${c}$2000`;
const sumif = (critCell, critCol, sumCol)=>`=SUMIF(${T(critCol)},${critCell},${T(sumCol)})`;
const countif = (critCell, critCol)=>`=COUNTIF(${T(critCol)},${critCell})`;

async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

function buildHelper(){
  // 본부별: AB(본부) AC(TO) AD(입사예정) AE(달성률)   header row1
  const hq=[['본부','TO','입사예정','달성률']];
  HQ.forEach((h,i)=>{const r=i+2;hq.push([h, sumif(`AB${r}`,'B','AE'), sumif(`AB${r}`,'B','AQ'), `=IF(AC${r}=0,0,AD${r}/AC${r})`]);});
  // 현황별: AG(현황) AH(건수)
  const st=[['현황','건수']]; STATUS.forEach((s,i)=>{const r=i+2;st.push([s, countif(`AG${r}`,'AS')]);});
  // 우선순위: AJ(우선순위) AK(TO)
  const pr=[['우선순위','TO']]; PRIO.forEach((p,i)=>{const r=i+2;pr.push([p, sumif(`AJ${r}`,'AN','AE')]);});
  // 채용사유: AM(사유) AN(TO)
  const rs=[['채용사유','TO'],['신규', sumif('AM2','G','AE')],['결원', sumif('AM3','G','AE')]];
  return {hq,st,pr,rs};
}

const range=(c0,r0,vals)=>({range:`'대시보드'!${c0}${r0}`,values:vals});

function chart(title,type,domainCol,seriesCols,r0,r1,anchorRow,anchorCol,extra){
  const src=(c)=>({sourceRange:{sources:[{sheetId:DASH_GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
  return {addChart:{chart:{spec:{title,basicChart:{
    chartType:type,legendPosition:type==='PIE'?'RIGHT_LEGEND':'BOTTOM_LEGEND',
    headerCount:1,
    domains:[{domain:src(domainCol)}],
    series:seriesCols.map(c=>({series:src(c),targetAxis:'LEFT_AXIS'})),
    ...(extra||{}),
  }},position:{overlayPosition:{anchorCell:{sheetId:DASH_GID,rowIndex:anchorRow,columnIndex:anchorCol},widthPixels:470,heightPixels:290}}}}};
}
function pie(title,domainCol,seriesCol,r0,r1,anchorRow,anchorCol){
  const src=(c)=>({sourceRange:{sources:[{sheetId:DASH_GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c,endColumnIndex:c+1}]}});
  return {addChart:{chart:{spec:{title,pieChart:{legendPosition:'RIGHT_LEGEND',domain:src(domainCol),series:src(seriesCol)}},position:{overlayPosition:{anchorCell:{sheetId:DASH_GID,rowIndex:anchorRow,columnIndex:anchorCol},widthPixels:470,heightPixels:290}}}}};
}

async function main(){
  const sheets=await auth();
  const {hq,st,pr,rs}=buildHelper();
  console.log('집계표 미리보기 본부:',hq.length-1,'현황:',st.length-1,'우선순위:',pr.length-1);
  if(!WRITE){console.log('[DRY] --write 시 적용');return;}

  // 기존 차트 정리(이전에 생성한 게 있으면 삭제)
  const meta=await sheets.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title),charts(chartId))'});
  const dsh=meta.data.sheets.find(s=>s.properties.sheetId===DASH_GID);
  const delReqs=(dsh.charts||[]).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));
  if(delReqs.length){await sheets.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:delReqs}});console.log('기존 차트',delReqs.length,'개 삭제');}

  // 집계표 쓰기 (AB=28열~). 컬럼 충분히 확장
  await sheets.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateSheetProperties:{properties:{sheetId:DASH_GID,gridProperties:{columnCount:42}},fields:'gridProperties.columnCount'}}]}});
  await sheets.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:[
    range('AB',1,hq), range('AG',1,st), range('AJ',1,pr), range('AM',1,rs),
    {range:`'대시보드'!N1`,values:[['📊 채용요청 달성률 시각화 (출처: '+TEST+')']]},
  ]}});
  // 달성률 % 형식
  await sheets.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH_GID,startRowIndex:1,endRowIndex:12,startColumnIndex:30,endColumnIndex:31},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
  ]}});

  // 차트 4종 (집계표: AB=27,AC=28,AD=29,AE=30 / AG=32,AH=33 / AJ=35,AK=36)
  const charts=[
    chart('본부별 TO vs 입사예정','COLUMN',27,[28,29],0,12, 1,13),   // N2
    chart('본부별 채용달성률','COLUMN',27,[30],0,12,           1,21),   // V2 (오른쪽)
    pie('채용현황 단계별 분포',32,33,0,7,                       17,13),  // N18
    chart('우선순위별 TO','COLUMN',35,[36],0,5,                17,21),   // V18
  ];
  const resp=await sheets.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:charts}});
  console.log('차트 생성:',resp.data.replies.filter(r=>r.addChart).length,'개');
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
