/* 대시보드 탭: 차트용 자동집계(크로스시트, 45행~ 빈영역) + N7부터 세로 차트 5개.
 * 소스 = 생산직 RAW DATA. 기존 대시보드 표(2~41행) 미터치.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='대시보드',SID=1;
const R="'생산직 RAW DATA'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const rng=(r0,r1,c0,c1)=>({sources:[{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});
const CO=['베트남','중국','우즈베키스탄','캄보디아','네팔','필리핀','태국','미얀마','인도네시아','스리랑카','몽골','한국(귀화)','기타','외국인'];

async function main(){
  const s=await auth();
  const data=[],put=(a1,v)=>data.push({range:`'${TAB}'!${a1}`,values:v});
  put('A45',[['── 차트용 자동 집계 (생산직 RAW DATA 연동) ──']]);
  put('A46',[['월','입사(명)'],
    ['5월',`=COUNTIFS(${R}!$Z$2:$Z$600,">="&DATE(2026,5,1),${R}!$Z$2:$Z$600,"<"&DATE(2026,6,1))`],
    ['6월',`=COUNTIFS(${R}!$Z$2:$Z$600,">="&DATE(2026,6,1),${R}!$Z$2:$Z$600,"<"&DATE(2026,7,1))`],
    ['7월',`=COUNTIFS(${R}!$Z$2:$Z$600,">="&DATE(2026,7,1),${R}!$Z$2:$Z$600,"<"&DATE(2026,8,1))`]]);
  put('A51',[['체류자격','인원'],
    ['F-4',`=COUNTIF(${R}!$N$2:$N$600,"F-4*")`],['F-5',`=COUNTIF(${R}!$N$2:$N$600,"F-5*")`],
    ['F-6',`=COUNTIF(${R}!$N$2:$N$600,"F-6*")`],['F-2',`=COUNTIF(${R}!$N$2:$N$600,"F-2*")`]]);
  put('A57',[['근무지','인원'],
    ['그린카운티',`=COUNTIF(${R}!$H$2:$H$600,"그린카운티")`],['퍼플카운티',`=COUNTIF(${R}!$H$2:$H$600,"퍼플카운티")`],
    ['3공장(제너럴)',`=COUNTIF(${R}!$H$2:$H$600,"3공장(제너럴)")`],['3공장(솔테크)',`=COUNTIF(${R}!$H$2:$H$600,"3공장(솔테크)")`]]);
  const ages=[[10,19,'10대'],[20,29,'20대'],[30,39,'30대'],[40,49,'40대'],[50,59,'50대'],[60,69,'60대']];
  put('A63',[['연령대','인원'],...ages.map(([a,b,l])=>[l,`=COUNTIFS(${R}!$L$2:$L$600,">="&${a},${R}!$L$2:$L$600,"<="&${b})`])]);
  put('A71',[['국적','인원'],...CO.map(c=>[c,`=COUNTIF(${R}!$M$2:$M$600,"${c}")`])]);
  put('D71',[['=QUERY(A72:B85,"select Col1,Col2 where Col2>0 order by Col2 desc")']]);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:TGT,requestBody:{valueInputOption:'USER_ENTERED',data}});
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:[{repeatCell:{range:{sheetId:SID,startRowIndex:44,endRowIndex:45,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,italic:true}}},fields:'userEnteredFormat.textFormat'}}]}});

  const W=380,H=230,SP=12,col=13,sr=6; // N7=row6
  const pos=i=>({overlayPosition:{anchorCell:{sheetId:SID,rowIndex:sr+i*SP,columnIndex:col},widthPixels:W,heightPixels:H}});
  const f={fontFamily:'Roboto'};
  const charts=[
    {position:pos(0),spec:{title:'월별 입사 추이',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:rng(45,49,0,1)}}],series:[{series:{sourceRange:rng(45,49,1,2)},targetAxis:'LEFT_AXIS',color:{red:0.12,green:0.44,blue:0.83}}]}}},
    {position:pos(1),spec:{title:'체류자격(비자)별 분포',titleTextFormat:f,fontName:'Roboto',pieChart:{legendPosition:'RIGHT_LEGEND',domain:{sourceRange:rng(51,55,0,1)},series:{sourceRange:rng(51,55,1,2)}}}},
    {position:pos(2),spec:{title:'국적별 분포',subtitle:'미상 채우면 자동 반영·재정렬',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'BAR',legendPosition:'NO_LEGEND',headerCount:0,axis:[{position:'BOTTOM_AXIS',title:'명'},{position:'LEFT_AXIS'}],domains:[{domain:{sourceRange:rng(70,84,3,4)}}],series:[{series:{sourceRange:rng(70,84,4,5)},targetAxis:'BOTTOM_AXIS',color:{red:0.30,green:0.69,blue:0.31}}]}}},
    {position:pos(3),spec:{title:'근무지별 분포',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'BAR',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS',title:'명'},{position:'LEFT_AXIS'}],domains:[{domain:{sourceRange:rng(56,61,0,1)}}],series:[{series:{sourceRange:rng(56,61,1,2)},targetAxis:'BOTTOM_AXIS',color:{red:0.96,green:0.55,blue:0.0}}]}}},
    {position:pos(4),spec:{title:'연령대별 분포',titleTextFormat:f,fontName:'Roboto',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:{sourceRange:rng(62,69,0,1)}}],series:[{series:{sourceRange:rng(62,69,1,2)},targetAxis:'LEFT_AXIS',color:{red:0.55,green:0.27,blue:0.68}}]}}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:charts.map(c=>({addChart:{chart:c}}))}});
  console.log('OK: 대시보드 탭에 집계+차트5개(N7~) 추가');
  const q=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`'${TAB}'!D71:E85`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('국적 정렬:',q.filter(r=>r&&r[0]).map(r=>r.join(':')).join(', '));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
