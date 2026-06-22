/* 대시보드 탭: 재직·퇴사 분석 섹션 추가.
 * 퇴사일(비고에서 REGEXEXTRACT)→재직일수 미러(G89:H137, 자동) → 퇴사율/고용형태별/재직기간분포/평균재직 집계 + 차트3.
 * 기존 내용·차트 미터치. 전부 자동 연동.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='대시보드',SID=1;
const R="'생산직 RAW DATA'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const rng=(r0,r1,c0,c1)=>({sources:[{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});

async function main(){
  const s=await auth();
  // 그리드 행 확장(140)
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:[
    {updateSheetProperties:{properties:{sheetId:SID,gridProperties:{rowCount:140}},fields:'gridProperties.rowCount'}}]}});

  const data=[],put=(a1,v)=>data.push({range:`'${TAB}'!${a1}`,values:v});
  put('A88',[['── 재직·퇴사 분석 (입사자 명단 자동 연동) ──']]);
  // 재직 vs 퇴사 (A91 헤더)
  put('A91',[['상태','인원'],
    ['재직',`=COUNTA(${R}!I2:I600)-COUNTIF(${R}!W2:W600,"퇴사")`],
    ['퇴사',`=COUNTIF(${R}!W2:W600,"퇴사")`]]);
  // 고용형태별 재직/퇴사 (A95)
  put('A95',[['고용형태','재직','퇴사'],
    ['정규직',`=COUNTIF(${R}!AA2:AA600,"정규직*")-COUNTIFS(${R}!AA2:AA600,"정규직*",${R}!W2:W600,"퇴사")`,`=COUNTIFS(${R}!AA2:AA600,"정규직*",${R}!W2:W600,"퇴사")`],
    ['도급직',`=COUNTIF(${R}!AA2:AA600,"도급*")-COUNTIFS(${R}!AA2:AA600,"도급*",${R}!W2:W600,"퇴사")`,`=COUNTIFS(${R}!AA2:AA600,"도급*",${R}!W2:W600,"퇴사")`]]);
  // 재직기간 분포(퇴사자) (A99) — G/H 미러 기반
  put('A99',[['퇴사자 재직기간','인원'],
    ['당일(0일)','=COUNTIFS($G$89:$G$137,"퇴사",$H$89:$H$137,0)'],
    ['1~7일','=COUNTIFS($G$89:$G$137,"퇴사",$H$89:$H$137,">=1",$H$89:$H$137,"<=7")'],
    ['8~30일','=COUNTIFS($G$89:$G$137,"퇴사",$H$89:$H$137,">=8",$H$89:$H$137,"<=30")'],
    ['31일+','=COUNTIFS($G$89:$G$137,"퇴사",$H$89:$H$137,">=31")']]);
  // KPI (A105)
  put('A105',[['퇴사율',`=IFERROR(COUNTIF(${R}!W2:W600,"퇴사")/COUNTA(${R}!I2:I600),0)`]]);
  put('A106',[['퇴사자 평균 재직일','=IFERROR(AVERAGEIFS($H$89:$H$137,$G$89:$G$137,"퇴사"),0)']]);
  put('A107',[['재직자 평균 재직일','=IFERROR(AVERAGEIFS($H$89:$H$137,$G$89:$G$137,"<>퇴사"),0)']]);
  // 미러 G89:H137 (RAW 2~50행, 상태+재직일수 자동)
  const mir=[['상태','재직일수']];
  for(let i=0;i<48;i++){const rr=2+i;
    mir.push([
      `=IF(${R}!I${rr}="","",${R}!W${rr})`,
      `=IF(${R}!I${rr}="","",IF(${R}!W${rr}="퇴사",IFERROR(DATEVALUE(REGEXEXTRACT(${R}!AA${rr},"퇴사 (\\d{4}-\\d{2}-\\d{2})"))-${R}!Z${rr},""),TODAY()-${R}!Z${rr}))`]);
  }
  put('G88',mir);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:TGT,requestBody:{valueInputOption:'USER_ENTERED',data}});
  // 라벨 굵게 + 퇴사율 % / 미러 숨김느낌(연한)
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:[
    {repeatCell:{range:{sheetId:SID,startRowIndex:87,endRowIndex:88,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,italic:true}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:SID,startRowIndex:104,endRowIndex:105,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:SID,startRowIndex:87,endRowIndex:137,startColumnIndex:6,endColumnIndex:8},cell:{userEnteredFormat:{textFormat:{foregroundColor:{red:0.7,green:0.7,blue:0.7},fontSize:8}}},fields:'userEnteredFormat.textFormat'}},
  ]}});

  // 차트 3개 (N67/N79/N91)
  const W=380,H=230,f={fontFamily:'Roboto'};
  const pos=r=>({overlayPosition:{anchorCell:{sheetId:SID,rowIndex:r,columnIndex:13},widthPixels:W,heightPixels:H}});
  const charts=[
    {position:pos(66),spec:{title:'재직 vs 퇴사',titleTextFormat:f,fontName:'Roboto',pieChart:{legendPosition:'RIGHT_LEGEND',pieHole:0.4,domain:{sourceRange:rng(91,93,0,1)},series:{sourceRange:rng(91,93,1,2)}}}},
    {position:pos(78),spec:{title:'고용형태별 재직/퇴사',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'COLUMN',stackedType:'STACKED',legendPosition:'BOTTOM_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:rng(94,97,0,1)}}],series:[{series:{sourceRange:rng(94,97,1,2)},color:{red:0.26,green:0.62,blue:0.28}},{series:{sourceRange:rng(94,97,2,3)},color:{red:0.9,green:0.3,blue:0.24}}]}}},
    {position:pos(90),spec:{title:'퇴사자 재직기간 분포',subtitle:'당일 퇴사 다수 = 조기이탈',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:rng(98,103,0,1)}}],series:[{series:{sourceRange:rng(98,103,1,2)},color:{red:0.9,green:0.3,blue:0.24}}]}}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:charts.map(c=>({addChart:{chart:c}}))}});
  console.log('OK: 재직·퇴사 분석 섹션 + 차트3 추가');
  const v=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`'${TAB}'!A91:C107`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  v.forEach(r=>{if(r&&r[0])console.log('  ',r.join(' | '));});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
