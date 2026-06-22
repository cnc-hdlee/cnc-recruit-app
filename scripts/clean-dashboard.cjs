/* 대시보드 정리: 헬퍼시트 미러 수정([0-9]) + 차트 재구성(헬퍼/기존표 참조, 막대 다색) + 비중최고 빨강 조건부서식 + 대시보드 헬퍼잔재 제거. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',SID=1;
const R="'생산직 RAW DATA'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const PAL=[{red:0.26,green:0.52,blue:0.96},{red:0.0,green:0.62,blue:0.53},{red:0.55,green:0.27,blue:0.68},{red:0.96,green:0.55,blue:0.0},{red:0.30,green:0.69,blue:0.31},{red:0.91,green:0.30,blue:0.58},{red:0.47,green:0.33,blue:0.28},{red:0.40,green:0.65,blue:0.92},{red:0.85,green:0.65,blue:0.13},{red:0.45,green:0.45,blue:0.45},{red:0.55,green:0.76,blue:0.29},{red:0.0,green:0.47,blue:0.75},{red:0.85,green:0.40,blue:0.40},{red:0.30,green:0.55,blue:0.55}];
const ov=n=>Array.from({length:n},(_,i)=>({index:i,color:PAL[i%PAL.length]}));

async function main(){
  const s=await auth();
  const meta=await s.spreadsheets.get({spreadsheetId:TGT,fields:'sheets(properties(sheetId,title),charts(chartId))'});
  const HID=meta.data.sheets.find(x=>x.properties.title==='_chartdata').properties.sheetId;
  const dash=meta.data.sheets.find(x=>x.properties.title==='대시보드');

  // 1) 미러 수식 [0-9] 패턴으로 재작성 (G1:H50)
  const mir=[];for(let i=0;i<50;i++){const rr=2+i;mir.push([
    `=IF(${R}!I${rr}="","",${R}!W${rr})`,
    `=IF(${R}!I${rr}="","",IF(${R}!W${rr}="퇴사",IFERROR(DATEVALUE(REGEXEXTRACT(${R}!AA${rr},"퇴사 ([0-9]{4}-[0-9]{2}-[0-9]{2})"))-${R}!Z${rr},""),TODAY()-${R}!Z${rr}))`]);}
  await s.spreadsheets.values.update({spreadsheetId:TGT,range:`_chartdata!G1:H50`,valueInputOption:'USER_ENTERED',requestBody:{values:mir}});
  await s.spreadsheets.values.clear({spreadsheetId:TGT,range:`_chartdata!J1:J5`});

  // 2) 기존 대시보드 차트 전부 삭제 + 헬퍼 잔재(A44:H140) 제거
  const reqs=(dash.charts||[]).map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}));
  if(reqs.length)await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:reqs}});
  await s.spreadsheets.values.clear({spreadsheetId:TGT,range:`대시보드!A44:H140`});

  // 3) 차트 8개 재생성 (col13=N, 12행 간격)
  const W=380,H=230,f={fontFamily:'Roboto'};
  const src=(sid,r0,r1,c0,c1)=>({sources:[{sheetId:sid,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});
  const pos=i=>({overlayPosition:{anchorCell:{sheetId:SID,rowIndex:6+i*12,columnIndex:13},widthPixels:W,heightPixels:H}});
  const col=(c)=>({chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1});
  const charts=[];
  // 월별입사 (helper rows0-3)
  charts.push({position:pos(0),spec:{title:'월별 입사 추이',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:src(HID,0,4,0,1)}}],series:[{series:{sourceRange:src(HID,0,4,1,2)},styleOverrides:ov(3)}]}}});
  // 체류자격 PIE (기존표 H26:K29)
  charts.push({position:pos(1),spec:{title:'체류자격(비자)별',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',pieChart:{legendPosition:'RIGHT_LEGEND',domain:{sourceRange:src(SID,25,29,7,8)},series:{sourceRange:src(SID,25,29,10,11)}}}});
  // 국적 BAR (기존표 B26:E33)
  charts.push({position:pos(2),spec:{title:'국적별 분포',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',basicChart:{chartType:'BAR',legendPosition:'NO_LEGEND',headerCount:0,axis:[{position:'BOTTOM_AXIS',title:'명'},{position:'LEFT_AXIS'}],domains:[{domain:{sourceRange:src(SID,25,33,1,2)}}],series:[{series:{sourceRange:src(SID,25,33,4,5)},targetAxis:'BOTTOM_AXIS',styleOverrides:ov(8)}]}}});
  // 근무지 BAR (helper rows5-9)
  charts.push({position:pos(3),spec:{title:'근무지별 분포',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',basicChart:{chartType:'BAR',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS',title:'명'},{position:'LEFT_AXIS'}],domains:[{domain:{sourceRange:src(HID,5,10,0,1)}}],series:[{series:{sourceRange:src(HID,5,10,1,2)},targetAxis:'BOTTOM_AXIS',styleOverrides:ov(4)}]}}});
  // 연령대 COLUMN (helper rows11-17)
  charts.push({position:pos(4),spec:{title:'연령대별 분포',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:src(HID,11,18,0,1)}}],series:[{series:{sourceRange:src(HID,11,18,1,2)},styleOverrides:ov(6)}]}}});
  // 재직 vs 퇴사 도넛 (helper rows19-21)
  charts.push({position:pos(5),spec:{title:'재직 vs 퇴사',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',pieChart:{legendPosition:'RIGHT_LEGEND',pieHole:0.4,domain:{sourceRange:src(HID,19,22,0,1)},series:{sourceRange:src(HID,19,22,1,2)}}}});
  // 고용형태별 재직/퇴사 누적 (helper rows23-25)
  charts.push({position:pos(6),spec:{title:'고용형태별 재직/퇴사',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',basicChart:{chartType:'COLUMN',stackedType:'STACKED',legendPosition:'BOTTOM_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:src(HID,23,26,0,1)}}],series:[{series:{sourceRange:src(HID,23,26,1,2)},color:{red:0.26,green:0.62,blue:0.28}},{series:{sourceRange:src(HID,23,26,2,3)},color:{red:0.9,green:0.3,blue:0.24}}]}}});
  // 퇴사자 재직기간 분포 (helper rows27-31)
  charts.push({position:pos(7),spec:{title:'퇴사자 재직기간 분포',subtitle:'당일 퇴사 = 조기이탈',titleTextFormat:f,fontName:'Roboto',hiddenDimensionStrategy:'SHOW_ALL',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:src(HID,27,32,0,1)}}],series:[{series:{sourceRange:src(HID,27,32,1,2)},styleOverrides:ov(4)}]}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:charts.map(c=>({addChart:{chart:c}}))}});

  // 4) 비중 최고 항목 빨강 조건부서식 (각 표 인원열)
  const redRule=(r0,r1,c0,c1,colLetter,rowStart,rowEnd)=>({addConditionalFormatRule:{rule:{ranges:[{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}],booleanRule:{condition:{type:'CUSTOM_FORMULA',values:[{userEnteredValue:`=AND(${colLetter}${rowStart}<>"",${colLetter}${rowStart}=MAX($${colLetter}$${rowStart}:$${colLetter}$${rowEnd}))`}]},format:{backgroundColor:{red:0.96,green:0.26,blue:0.21},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true}}}},index:0}});
  const cfReqs=[
    redRule(16,22,4,5,'E',17,22),   // 센터 E17:E22
    redRule(16,22,10,11,'K',17,22), // 유입경로 K17:K22
    redRule(25,33,4,5,'E',26,33),   // 국적 E26:E33
    redRule(25,29,10,11,'K',26,29), // 체류자격 K26:K29
    redRule(36,41,4,5,'E',37,41),   // 퍼널 E37:E41
    redRule(36,40,10,11,'K',37,40), // 채용유형 K37:K40
    redRule(8,12,7,8,'H',9,12),     // 팀별 입사 H9:H12
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:cfReqs}});
  console.log('OK: 미러수정 + 차트8(다색) + 비중최고 빨강 + 헬퍼정리');
  const chk=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`_chartdata!A28:B32`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('재직기간 분포:',chk.filter(r=>r&&r[0]).map(r=>r.join(':')).join(', '));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
