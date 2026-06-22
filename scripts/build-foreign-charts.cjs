/* 생산직 외국인 RAW DATA: 자동 집계표(데이터 아래) + N7부터 세로 차트 5개.
 * 지표: 월별입사 추이 / 체류자격별 / 국적별 / 근무지별 / 연령대별. 전부 COUNTIF 자동연동.
 * 기존 데이터(행1~34, A~AC) 미터치. 집계표는 빈 영역(행38~)에만.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='생산직 RAW DATA',SID=0;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const rng=(r0,r1,c0,c1)=>({sources:[{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});
const COUNTRIES=['베트남','중국','우즈베키스탄','캄보디아','네팔','필리핀','태국','미얀마','인도네시아','스리랑카','몽골','한국(귀화)','기타','외국인'];

async function main(){
  const s=await auth();
  // ── 집계표 (행38~) ──
  const data=[];
  const put=(a1,vals)=>data.push({range:`'${TAB}'!${a1}`,values:vals});
  put('A37',[['── 차트용 자동 집계 (수식, 데이터 변경 시 자동 갱신) ──']]);
  // 월별 입사
  put('A39',[['월','입사(명)'],
    ['5월','=COUNTIFS($Z$2:$Z$600,">="&DATE(2026,5,1),$Z$2:$Z$600,"<"&DATE(2026,6,1))'],
    ['6월','=COUNTIFS($Z$2:$Z$600,">="&DATE(2026,6,1),$Z$2:$Z$600,"<"&DATE(2026,7,1))'],
    ['7월','=COUNTIFS($Z$2:$Z$600,">="&DATE(2026,7,1),$Z$2:$Z$600,"<"&DATE(2026,8,1))']]);
  // 체류자격
  put('A44',[['체류자격','인원'],
    ['F-4','=COUNTIF($N$2:$N$600,"F-4*")'],['F-5','=COUNTIF($N$2:$N$600,"F-5*")'],
    ['F-6','=COUNTIF($N$2:$N$600,"F-6*")'],['F-2','=COUNTIF($N$2:$N$600,"F-2*")']]);
  // 근무지
  put('A49',[['근무지','인원'],
    ['그린카운티','=COUNTIF($H$2:$H$600,"그린카운티")'],['퍼플카운티','=COUNTIF($H$2:$H$600,"퍼플카운티")'],
    ['3공장(제너럴)','=COUNTIF($H$2:$H$600,"3공장(제너럴)")'],['3공장(솔테크)','=COUNTIF($H$2:$H$600,"3공장(솔테크)")']]);
  // 연령대
  const ages=[[10,19,'10대'],[20,29,'20대'],[30,39,'30대'],[40,49,'40대'],[50,59,'50대'],[60,69,'60대']];
  put('A55',[['연령대','인원'],...ages.map(([a,b,l])=>[l,`=COUNTIFS($L$2:$L$600,">="&${a},$L$2:$L$600,"<="&${b})`])]);
  // 국적 raw(A63~) + 정렬·비0 필터(D63 spill)
  put('A63',[['국적','인원'],...COUNTRIES.map(c=>[c,`=COUNTIF($M$2:$M$600,"${c}")`])]);
  put('D63',[['=SORT(FILTER(A64:B77,B64:B77>0),2,FALSE)']]);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:TGT,requestBody:{valueInputOption:'USER_ENTERED',data}});
  // 라벨 굵게
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:[
    {repeatCell:{range:{sheetId:SID,startRowIndex:36,endRowIndex:37,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,italic:true}}},fields:'userEnteredFormat.textFormat'}},
  ]}});

  // ── 차트 5개 (N7부터 세로) ──
  const W=380,H=230,SP=12,startRow=6,col=13; // N=13(0-index), 행7=rowIndex6
  const pos=i=>({overlayPosition:{anchorCell:{sheetId:SID,rowIndex:startRow+i*SP,columnIndex:col},widthPixels:W,heightPixels:H}});
  const f={fontFamily:'Roboto'};
  const charts=[
    // 1 월별 입사 추이 (COLUMN)
    {position:pos(0),spec:{title:'월별 입사 추이',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:rng(38,42,0,1)}}],series:[{series:{sourceRange:rng(38,42,1,2)},targetAxis:'LEFT_AXIS',color:{red:0.12,green:0.44,blue:0.83}}]}}},
    // 2 체류자격(비자)별 (PIE)
    {position:pos(1),spec:{title:'체류자격(비자)별 분포',titleTextFormat:f,fontName:'Roboto',pieChart:{legendPosition:'RIGHT_LEGEND',domain:{sourceRange:rng(44,48,0,1)},series:{sourceRange:rng(44,48,1,2)},threeDimensional:false}}},
    // 3 국적별 (BAR, 정렬·비0)
    {position:pos(2),spec:{title:'국적별 분포',subtitle:'미상=형도님 채우면 자동 반영',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'BAR',legendPosition:'NO_LEGEND',headerCount:0,axis:[{position:'BOTTOM_AXIS',title:'명'},{position:'LEFT_AXIS'}],domains:[{domain:{sourceRange:rng(62,77,3,4)}}],series:[{series:{sourceRange:rng(62,77,4,5)},targetAxis:'BOTTOM_AXIS',color:{red:0.30,green:0.69,blue:0.31}}]}}},
    // 4 근무지별 (BAR)
    {position:pos(3),spec:{title:'근무지별 분포',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'BAR',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS',title:'명'},{position:'LEFT_AXIS'}],domains:[{domain:{sourceRange:rng(48,53,0,1)}}],series:[{series:{sourceRange:rng(48,53,1,2)},targetAxis:'BOTTOM_AXIS',color:{red:0.96,green:0.55,blue:0.0}}]}}},
    // 5 연령대별 (COLUMN)
    {position:pos(4),spec:{title:'연령대별 분포',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:rng(54,61,0,1)}}],series:[{series:{sourceRange:rng(54,61,1,2)},targetAxis:'LEFT_AXIS',color:{red:0.55,green:0.27,blue:0.68}}]}}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:charts.map(c=>({addChart:{chart:c}}))}});
  console.log('OK: 집계표 + 차트 5개(N7~ 세로) 추가');
  const chk=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`'${TAB}'!A39:B61`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach(r=>{if(r&&r[0])console.log('  ',r.join(' | '));});
  const sortChk=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`'${TAB}'!D63:E77`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('국적(정렬):',sortChk.filter(r=>r&&r[0]).map(r=>r.join(':')).join(', '));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
