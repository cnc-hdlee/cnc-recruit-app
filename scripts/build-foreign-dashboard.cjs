/* 생산직 외국인 인력 현황 대시보드 — 클린 재설계 (채용 대시보드 스타일).
 * 소스='생산직 RAW DATA'만. 라이브 수식. 네이비헤더=표폭 정확히 일치, 박스=내용크기, 차트=표셀 직접참조.
 * 옛 차트 7개 전부 삭제 후 깔끔한 4개 재생성. 차트헬퍼/_chartdata 불필요(셀 직접참조).
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const TGT='1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo',TAB='대시보드',SID=1;
const R="'생산직 RAW DATA'";
const NAVY={red:0.12,green:0.22,blue:0.39},LIGHT={red:0.90,green:0.93,blue:0.97},HDR={red:0.83,green:0.87,blue:0.93};
const bd={style:'SOLID',color:{red:0.62,green:0.65,blue:0.72}};
const WHITE={red:1,green:1,blue:1};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const tot=`COUNTA(${R}!$E$2:$E$600)`;
const cif=(col,crit)=>`COUNTIF(${R}!$${col}$2:$${col}$600,"${crit}")`;
const alive=(col,crit)=>`COUNTIFS(${R}!$${col}$2:$${col}$600,"${crit}",${R}!$W$2:$W$600,"입사")`;
async function main(){
  const s=await auth();
  // 0) 백업
  const bak=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!A1:N90`,valueRenderOption:'FORMULA'})).data.values||[];
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`.backup-foreign-dash-${stamp}.json`),JSON.stringify(bak));
  // 1) 옛 차트/줄무늬밴딩/조건부서식/병합 전부 제거 + 서식 완전 초기화 (난장판 원인)
  const meta=await s.spreadsheets.get({spreadsheetId:TGT,fields:'sheets(properties(sheetId,title),charts(chartId),bandedRanges(bandedRangeId),conditionalFormats)'});
  const sh=meta.data.sheets.find(x=>x.properties.title===TAB);
  const delReqs=[];
  (sh.charts||[]).forEach(c=>delReqs.push({deleteEmbeddedObject:{objectId:c.chartId}}));
  (sh.bandedRanges||[]).forEach(b=>delReqs.push({deleteBanding:{bandedRangeId:b.bandedRangeId}}));
  for(let i=(sh.conditionalFormats||[]).length-1;i>=0;i--)delReqs.push({deleteConditionalFormatRule:{sheetId:SID,index:i}});
  delReqs.push({unmergeCells:{range:{sheetId:SID,startRowIndex:0,endRowIndex:90,startColumnIndex:0,endColumnIndex:14}}});
  delReqs.push({repeatCell:{range:{sheetId:SID,startRowIndex:0,endRowIndex:90,startColumnIndex:0,endColumnIndex:14},cell:{userEnteredFormat:{}},fields:'userEnteredFormat'}}); // 전 셀 서식 리셋
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:delReqs}});
  await s.spreadsheets.values.clear({spreadsheetId:TGT,range:`${TAB}!A1:N90`});
  console.log('옛 차트 '+(sh.charts||[]).length+'개·밴딩 '+(sh.bandedRanges||[]).length+'·조건부 '+(sh.conditionalFormats||[]).length+' 제거 · 서식 초기화');

  // 2) 값
  const data=[],put=(a1,v)=>data.push({range:`${TAB}!${a1}`,values:v});
  put('B1',[['🌏 생산직 외국인 인력 현황 대시보드']]);
  put('B2',[[`=CONCATENATE("총 ",${tot}," 명          재직 ",${cif('W','입사')},"   ·   퇴사 ",${cif('W','퇴사')},"   ·   탈락 ",${cif('W','탈락')},"          비자만료 90일이내 ",COUNTIFS(${R}!$O$2:$O$600,">="&TODAY(),${R}!$O$2:$O$600,"<="&TODAY()+90,${R}!$W$2:$W$600,"입사")," 명          국적 ",ROUND(SUMPRODUCT((${R}!$M$2:$M$600<>"")/COUNTIF(${R}!$M$2:$M$600,${R}!$M$2:$M$600&"")))," 개국")`]]);
  // 좌측: 팀별 (B:E)
  put('B4',[['👥 팀별 인력 현황']]);
  put('B5',[['팀','재직','퇴사','재직률']]);
  const teams=['생산1팀','생산2팀','생산3팀','포장1팀','포장2팀','포장3팀'];
  teams.forEach((t,i)=>put('B'+(6+i),[[t,'='+alive('E',t),`=COUNTIFS(${R}!$E$2:$E$600,"${t}",${R}!$W$2:$W$600,"퇴사")`,'=IFERROR(C'+(6+i)+'/'+cif('E',t)+',0)']]));
  put('B12',[['합계','=SUM(C6:C11)','=SUM(D6:D11)','=IFERROR(C12/(C12+D12),0)']]);
  // 좌측: 비자 만료 임박 (B:D)
  put('B14',[['⚠️ 비자 만료 임박 (재직자)']]);
  put('B15',[['구분','인원','비중']]);
  const exp=(a,b)=>`COUNTIFS(${R}!$O$2:$O$600,">="&TODAY()+${a},${R}!$O$2:$O$600,"<"&TODAY()+${b},${R}!$W$2:$W$600,"입사")`;
  put('B16',[['🔴 만료 경과',`=COUNTIFS(${R}!$O$2:$O$600,"<"&TODAY(),${R}!$O$2:$O$600,">"&DATE(2000,1,1),${R}!$W$2:$W$600,"입사")`,'=IFERROR(C16/$C$12,0)']]);
  put('B17',[['🟠 30일 이내','='+exp(0,30),'=IFERROR(C17/$C$12,0)']]);
  put('B18',[['🟡 31~60일','='+exp(30,60),'=IFERROR(C18/$C$12,0)']]);
  put('B19',[['🟢 61~90일',`=COUNTIFS(${R}!$O$2:$O$600,">="&TODAY()+60,${R}!$O$2:$O$600,"<="&TODAY()+90,${R}!$W$2:$W$600,"입사")`,'=IFERROR(C19/$C$12,0)']]);
  // 좌측: 만료 임박 명단 (B:E)
  put('B21',[['📋 만료 임박 명단 (90일내·재직)']]);
  put('B22',[['이름','국적','비자','만료일']]);
  put('B23',[[`=IFERROR(FILTER({${R}!I2:I600,${R}!M2:M600,${R}!N2:N600,${R}!O2:O600},(${R}!O2:O600<>"")*(${R}!O2:O600<=TODAY()+90)*(${R}!W2:W600="입사")),"✅ 없음")`]]);
  // 우측: 국적별 (G:I)
  put('G4',[['🌏 국적별 분포']]);
  put('G5',[['국적','인원','비중']]);
  const nats=['중국','베트남','미국','몽골','태국','필리핀','방글라데시','우즈베키스탄','네팔'];
  nats.forEach((n,i)=>put('G'+(6+i),[[n,'='+cif('M',n),'=IFERROR(H'+(6+i)+'/'+tot+',0)']]));
  put('G15',[['⚠️ 미입력("외국인")','='+cif('M','외국인'),'=IFERROR(H15/'+tot+',0)']]);
  // 우측: 비자별 (G:I)
  put('G17',[['🛂 체류자격(비자)별']]);
  put('G18',[['비자','인원','비중']]);
  const visas=[['F-4 재외동포','F-4*'],['F-6 결혼이민','F-6*'],['F-5 영주','F-5*'],['F-2 거주','F-2*'],['E-10 비전문','E-10*']];
  visas.forEach((v,i)=>put('G'+(19+i),[[v[0],'='+cif('N',v[1]),'=IFERROR(H'+(19+i)+'/'+tot+',0)']]));
  // 좌측: 근무지별 (B:D)
  put('B28',[['🏭 근무지별']]);
  put('B29',[['근무지','인원','비중']]);
  const sites=['그린카운티','퍼플카운티','3공장(제너럴)','3공장(솔테크)'];
  sites.forEach((w,i)=>put('B'+(30+i),[[w,'='+cif('H',w),'=IFERROR(C'+(30+i)+'/'+tot+',0)']]));
  // 우측: 연령대별 (G:I)
  put('G25',[['👤 연령대별']]);
  put('G26',[['연령대','인원','비중']]);
  const ages=[[20,29,'20대'],[30,39,'30대'],[40,49,'40대'],[50,59,'50대'],[60,99,'60대+']];
  ages.forEach((a,i)=>put('G'+(27+i),[[a[2],`=COUNTIFS(${R}!$L$2:$L$600,">="&${a[0]},${R}!$L$2:$L$600,"<="&${a[1]})`,'=IFERROR(H'+(27+i)+'/'+tot+',0)']]));
  // 우측: 성별 (G:I)
  put('G33',[['⚧ 성별']]);
  put('G34',[['성별','인원','비중']]);
  put('G35',[['여','='+cif('J','여'),'=IFERROR(H35/'+tot+',0)']]);
  put('G36',[['남','='+cif('J','남'),'=IFERROR(H36/'+tot+',0)']]);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:TGT,requestBody:{valueInputOption:'USER_ENTERED',data}});

  // 3) 서식
  const reqs=[];
  const rc=(r0,r1,c0,c1,fmt,fields)=>reqs.push({repeatCell:{range:{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1},cell:{userEnteredFormat:fmt},fields}});
  const merge=(r0,r1,c0,c1)=>reqs.push({mergeCells:{range:{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1},mergeType:'MERGE_ALL'}});
  const box=(r0,r1,c0,c1)=>reqs.push({updateBorders:{range:{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1},top:bd,bottom:bd,left:bd,right:bd,innerHorizontal:bd,innerVertical:bd}});
  const cw=(c,px)=>reqs.push({updateDimensionProperties:{range:{sheetId:SID,dimension:'COLUMNS',startIndex:c,endIndex:c+1},properties:{pixelSize:px},fields:'pixelSize'}});
  const rh=(r0,r1,px)=>reqs.push({updateDimensionProperties:{range:{sheetId:SID,dimension:'ROWS',startIndex:r0,endIndex:r1},properties:{pixelSize:px},fields:'pixelSize'}});
  // 1based navy 섹션타이틀 / 헤더
  const navy=(r,c0,c1)=>{merge(r-1,r,c0,c1);rc(r-1,r,c0,c1,{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true,fontSize:10},verticalAlignment:'MIDDLE',padding:{left:4}},'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)');};
  const hdr=(r,c0,c1)=>rc(r-1,r,c0,c1,{backgroundColor:HDR,textFormat:{bold:true,fontSize:9},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE'},'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)');
  // 열너비
  cw(0,22);cw(1,128);cw(2,52);cw(3,52);cw(4,66);cw(5,16);cw(6,128);cw(7,52);cw(8,62);cw(9,16);cw(10,16);
  // 행높이: 본문 균일 21px (좌우 표 높이가 달라 행공유 → 스페이서 줄이면 반대편 깨짐, 균일 유지)
  rh(2,44,21);rh(0,1,38);rh(1,2,26);
  // 타이틀/KPI
  merge(0,1,1,10);rc(0,1,1,10,{backgroundColor:NAVY,textFormat:{foregroundColor:WHITE,bold:true,fontSize:14},verticalAlignment:'MIDDLE',horizontalAlignment:'LEFT',padding:{left:10}},'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment,padding)');
  merge(1,2,1,10);rc(1,2,1,10,{backgroundColor:LIGHT,textFormat:{bold:true,fontSize:10,foregroundColor:NAVY},verticalAlignment:'MIDDLE',horizontalAlignment:'LEFT',padding:{left:10}},'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment,padding)');
  // 좌측 박스/헤더
  navy(4,1,5);hdr(5,1,5);box(3,12,1,5);                         // 팀별 B4:E12
  navy(14,1,4);hdr(15,1,4);box(13,19,1,4);                      // 비자임박 B14:D19
  navy(21,1,5);hdr(22,1,5);box(20,26,1,5);                      // 명단 B21:E26
  navy(28,1,4);hdr(29,1,4);box(27,33,1,4);                      // 근무지 B28:D33
  // 우측 박스/헤더
  navy(4,6,9);hdr(5,6,9);box(3,15,6,9);                         // 국적 G4:I15
  navy(17,6,9);hdr(18,6,9);box(16,23,6,9);                      // 비자 G17:I23
  navy(25,6,9);hdr(26,6,9);box(24,31,6,9);                      // 연령 G25:I31
  navy(33,6,9);hdr(34,6,9);box(32,36,6,9);                      // 성별 G33:I36
  // 정렬/숫자서식
  rc(5,12,2,5,{horizontalAlignment:'CENTER'},'userEnteredFormat.horizontalAlignment');     // 팀별 값 가운데
  rc(5,12,4,5,{numberFormat:{type:'PERCENT',pattern:'0%'},horizontalAlignment:'CENTER'},'userEnteredFormat(numberFormat,horizontalAlignment)'); // 재직률
  rc(15,19,2,4,{horizontalAlignment:'CENTER'},'userEnteredFormat.horizontalAlignment');
  rc(15,19,3,4,{numberFormat:{type:'PERCENT',pattern:'0.0%'}},'userEnteredFormat.numberFormat'); // 비자임박 비중
  rc(22,26,4,5,{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'},horizontalAlignment:'CENTER'},'userEnteredFormat(numberFormat,horizontalAlignment)'); // 만료일
  rc(22,26,2,4,{horizontalAlignment:'CENTER'},'userEnteredFormat.horizontalAlignment');
  rc(29,33,2,4,{horizontalAlignment:'CENTER'},'userEnteredFormat.horizontalAlignment');     // 근무지 값
  rc(29,33,3,4,{numberFormat:{type:'PERCENT',pattern:'0.0%'}},'userEnteredFormat.numberFormat'); // 근무지 비중
  rc(5,37,7,9,{horizontalAlignment:'CENTER'},'userEnteredFormat.horizontalAlignment');      // 우측 값 가운데
  rc(5,37,8,9,{numberFormat:{type:'PERCENT',pattern:'0.0%'}},'userEnteredFormat.numberFormat'); // 우측 비중
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:reqs}});

  // 4) 클린 차트 4개 (표 셀 직접참조). 컬럼 L(idx11)~ 세로 스트립, 균일 크기.
  const src=(r0,r1,c0,c1)=>({sourceRange:{sources:[{sheetId:SID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]}});
  const W=400,H=205,COLX=11; const anchor=r=>({overlayPosition:{anchorCell:{sheetId:SID,rowIndex:r,columnIndex:COLX},offsetXPixels:8,widthPixels:W,heightPixels:H}});
  const BL={red:0.20,green:0.46,blue:0.85},GR={red:0.22,green:0.66,blue:0.36},OR={red:0.95,green:0.55,blue:0.10},PU={red:0.55,green:0.30,blue:0.70};
  const f={fontFamily:'Roboto'};
  const charts=[
    {position:anchor(1),spec:{title:'국적별 분포',titleTextFormat:f,basicChart:{chartType:'BAR',legendPosition:'NO_LEGEND',headerCount:0,axis:[{position:'BOTTOM_AXIS',title:'명'},{position:'LEFT_AXIS'}],domains:[{domain:src(5,15,6,7)}],series:[{series:src(5,15,7,8),targetAxis:'BOTTOM_AXIS',colorStyle:{rgbColor:GR}}]}}},
    {position:anchor(11),spec:{title:'체류자격(비자)별',titleTextFormat:f,pieChart:{legendPosition:'RIGHT_LEGEND',pieHole:0.4,domain:src(18,23,6,7),series:src(18,23,7,8)}}},
    {position:anchor(21),spec:{title:'팀별 재직 인원',titleTextFormat:f,basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:0,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:src(5,11,1,2)}],series:[{series:src(5,11,2,3),targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:BL}}]}}},
    {position:anchor(31),spec:{title:'연령대별 분포',titleTextFormat:f,basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:0,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'명'}],domains:[{domain:src(26,31,6,7)}],series:[{series:src(26,31,7,8),targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:PU}}]}}},
  ];
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:charts.map(c=>({addChart:{chart:c}}))}});
  console.log('✅ 클린 재설계 완료: 표 7섹션 + 차트 4개(국적BAR/비자PIE/팀별COLUMN/연령COLUMN)');
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
