/* L3를 '본부별 입사 vs 채용필요(목표)' 가로 묶은막대로 교체.
 *  데이터: 우측 패널 본부별 표 G4:J11 (G=본부, H=채용필요, I=입사예정, J=달성률).
 *  중복되는 L30(본부별 채용필요 vs 입사예정) 삭제 + 아래 차트 재정렬.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const L3=167562285;const DUP=776153523; // 본부별 채용필요 vs 입사예정 (중복)
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const src=(c0,c1)=>({sourceRange:{sources:[{sheetId:DASH,startColumnIndex:c0,endColumnIndex:c1,startRowIndex:3,endRowIndex:11}]}}); // R4헤더~R11

async function main(){
  const s=await auth();
  const spec={
    title:'본부별 입사 vs 채용필요(목표)',
    subtitle:'진한 막대=입사예정(채운 인원) · 연한 막대=채용필요(목표 인원)',
    titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'BAR',legendPosition:'BOTTOM_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'인원(명)'},{position:'LEFT_AXIS',title:'본부'}],
      domains:[{domain:src(6,7)}],
      series:[
        {series:src(8,9),targetAxis:'BOTTOM_AXIS',color:{red:0.16,green:0.55,blue:0.30}},  // 입사예정 진한 초록
        {series:src(7,8),targetAxis:'BOTTOM_AXIS',color:{red:0.80,green:0.83,blue:0.87}},  // 채용필요 연한 회색
      ]},
  };
  const anchor=(r,w,h)=>({overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:r,columnIndex:11},widthPixels:w,heightPixels:h}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {deleteEmbeddedObject:{objectId:DUP}},
    {updateChartSpec:{chartId:L3,spec}},
    {updateEmbeddedObjectPosition:{objectId:L3,newPosition:anchor(2,820,460),fields:'*'}},
    {updateEmbeddedObjectPosition:{objectId:570111091,newPosition:anchor(26,440,230),fields:'*'}},   // 현황 단계별
    {updateEmbeddedObjectPosition:{objectId:1035164469,newPosition:anchor(38,440,230),fields:'*'}},  // 충원 추이
  ]}});
  console.log('OK: L3=본부별 입사 vs 채용필요 가로막대(820x460), 중복 L30 삭제, 재정렬.');
  const m=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(spec.title,position.overlayPosition(anchorCell.rowIndex,widthPixels,heightPixels)))'});
  const d=m.data.sheets.find(x=>x.properties.title===TAB);
  (d.charts||[]).sort((a,b)=>a.position.overlayPosition.anchorCell.rowIndex-b.position.overlayPosition.anchorCell.rowIndex)
    .forEach(c=>{const p=c.position.overlayPosition;console.log(`  L${p.anchorCell.rowIndex+1} ${p.widthPixels}x${p.heightPixels} "${c.spec.title}"`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
