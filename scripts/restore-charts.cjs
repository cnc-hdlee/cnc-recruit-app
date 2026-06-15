/* 차트/표 원복: 원래 5개 차트 구성 + 추이표 G44:J46(6·7월) 복원, 내가 추가한 표/차트 제거. */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const RAW="'RAW DATA_채용진행상황(현재)'";const ROSTER="'입사자 명단'";
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const range=(r0,r1,c0,c1)=>({sources:[{sheetId:DASH,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});

async function main(){
  const s=await auth();
  // ---- 추이표 원복 G42/G44:J46 + 확장분 제거 ----
  const bv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${ROSTER}!B4:B2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const ms=new Set();bv.forEach(r=>{const m=C(r[0]).match(/^(\d{4})-(\d{2})-\d{2}$/);if(m)ms.add(m[1]+'-'+m[2]);});
  const ml=[...ms].sort();const hdr=44,first=45,last=first+ml.length-1;
  const TO=`SUM(${RAW}!$O$3:$O$2001)`;
  const rows=ml.map((m,i)=>{const rn=first+i;const[y,mm]=m.split('-');return [`=DATE(${y},${mm},1)`,`=COUNTIF(${ROSTER}!$B$4:$B$2000,"<="&EOMONTH($G${rn},0))`,`=IFERROR($H${rn}/$J${rn},0)`,`=${TO}`];});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${TAB}'!G42:J60`});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${TAB}'!A91:G94`}); // 내 본부별 헬퍼표 제거
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G42`,valueInputOption:'USER_ENTERED',requestBody:{values:[['📈 채용 추이 (월별)']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G44`,valueInputOption:'USER_ENTERED',requestBody:{values:[['월','누적 입사(명)','달성률','채용목표(명)'],...rows]}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:hdr,startColumnIndex:6,endColumnIndex:10},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy"년 "m"월"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:8,endColumnIndex:9},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
  ]}});

  // ---- 차트 정리 ----
  // 167562285 → 원래 COLUMN(본부별 채용달성률%), R3 440x230
  const spec167={title:'본부별 채용달성률(%)',titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
    basicChart:{chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',viewWindowOptions:{}},{position:'LEFT_AXIS',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1}}],
      domains:[{domain:{sourceRange:range(3,11,6,7)}}],
      series:[{series:{sourceRange:range(3,11,9,10)},targetAxis:'LEFT_AXIS'}]}};
  const pos=(r,w,h)=>({overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:r,columnIndex:11},widthPixels:w,heightPixels:h}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {updateChartSpec:{chartId:167562285,spec:spec167}},
    {updateEmbeddedObjectPosition:{objectId:167562285,newPosition:pos(2,440,230),fields:'*'}},
    {deleteEmbeddedObject:{objectId:1035164469}}, // 내 추이선 제거
    {updateEmbeddedObjectPosition:{objectId:570111091,newPosition:pos(26,440,230),fields:'*'}}, // 현황 파이 R27
    // 본부별 채용필요 vs 입사예정 (R15)
    {addChart:{chart:{spec:{title:'본부별 채용필요 vs 입사예정',titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',hiddenDimensionStrategy:'SKIP_HIDDEN_ROWS_AND_COLUMNS',
      basicChart:{chartType:'COLUMN',legendPosition:'BOTTOM_LEGEND',headerCount:1,
        axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS'}],
        domains:[{domain:{sourceRange:range(3,11,6,7)}}],
        series:[{series:{sourceRange:range(3,11,7,8)},targetAxis:'LEFT_AXIS'},{series:{sourceRange:range(3,11,8,9)},targetAxis:'LEFT_AXIS'}]}},
      position:pos(14,440,230)}}},
    // 채용 달성률 추이 (월별 누적) AREA @ R39
    {addChart:{chart:{spec:{title:'채용 달성률 추이 (월별 누적)',subtitle:'누적 입사 ÷ 채용목표(TO) · 자동 연동',titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',
      basicChart:{chartType:'AREA',legendPosition:'NO_LEGEND',headerCount:1,
        axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'달성률'}],
        domains:[{domain:{sourceRange:range(hdr-1,last,6,7)}}],
        series:[{series:{sourceRange:range(hdr-1,last,8,9)},targetAxis:'LEFT_AXIS'}]}},
      position:pos(38,440,230)}}},
    // 채용 필요 대비 충원 추이 (월별) LINE @ R51
    {addChart:{chart:{spec:{title:'채용 필요 대비 충원 추이 (월별)',subtitle:'채용목표 대비 누적 입사(명)',titleTextFormat:{fontFamily:'Roboto'},fontName:'Roboto',
      basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
        axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'명'}],
        domains:[{domain:{sourceRange:range(hdr-1,last,6,7)}}],
        series:[{series:{sourceRange:range(hdr-1,last,9,10)},targetAxis:'LEFT_AXIS'},{series:{sourceRange:range(hdr-1,last,7,8)},targetAxis:'LEFT_AXIS'}]}},
      position:pos(50,440,230)}}},
  ]}});

  console.log('차트/표 원복 완료. 현재 차트:');
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title),charts(spec.title,position.overlayPosition.anchorCell.rowIndex))'});
  const d=meta.data.sheets.find(x=>x.properties.title===TAB);
  (d.charts||[]).sort((a,b)=>a.position.overlayPosition.anchorCell.rowIndex-b.position.overlayPosition.anchorCell.rowIndex).forEach(c=>console.log(`  L${c.position.overlayPosition.anchorCell.rowIndex+1} "${c.spec.title}"`));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
