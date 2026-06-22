/* 대시보드 정리: 차트 보조데이터(추이 과거/미래 분리 + 현황 전치)를 숨김시트 _chartdata로 이전.
 * 대시보드엔 깔끔한 추이표(A~D)만 남기고 #N/A·전치 junk 제거. 차트4·차트2 재연결. L4 겹침 보정.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',DASH=500969666;
const TREND=330002883,HYUN=570111091;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 1) _chartdata 시트 확보(없으면 생성, 숨김)
  let meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title))'});
  let cd=meta.data.sheets.find(x=>x.properties.title==='_chartdata');let CDGID;
  if(!cd){const a=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{addSheet:{properties:{title:'_chartdata',hidden:true,gridProperties:{rowCount:30,columnCount:10}}}}]}});CDGID=a.data.replies[0].addSheet.properties.sheetId;}
  else CDGID=cd.properties.sheetId;
  // 2) _chartdata 채우기 — 추이(대시보드 A103~D111 참조) 과거/미래 분리 + 채용필요
  const rows=[['주차','입사_과거','입사_미래','달성_과거','달성_미래','채용필요']];
  for(let i=0;i<9;i++){const dr=103+i;rows.push([
    `='대시보드'!A${dr}`,
    `=IF('대시보드'!$A${dr}<=TODAY(),'대시보드'!$B${dr},NA())`,
    `=IF('대시보드'!$A${dr}>TODAY()-7,'대시보드'!$B${dr},NA())`,
    `=IF('대시보드'!$A${dr}<=TODAY(),'대시보드'!$D${dr},NA())`,
    `=IF('대시보드'!$A${dr}>TODAY()-7,'대시보드'!$D${dr},NA())`,
    `='대시보드'!$C${dr}`]);}
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`_chartdata!A1:F10`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
  // 현황 전치(대시보드 G24:H30 참조) — 13~14행
  const names=['단계'],vals=['건수'];for(let i=0;i<7;i++){names.push(`='대시보드'!G${24+i}`);vals.push(`='대시보드'!H${24+i}`);}
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`_chartdata!A13:H14`,valueInputOption:'USER_ENTERED',requestBody:{values:[names,vals]}});

  // 3) 차트4(추이) 재연결 + 겹침보정(좌0~130/우0~1.3 → 입사>달성률, 라벨 분리)
  const Of={red:0.937,green:0.420,blue:0.0},Ol={red:0.98,green:0.78,blue:0.60};
  const Bf={red:0.118,green:0.439,blue:0.827},Bl={red:0.62,green:0.76,blue:0.93},GR={red:0.55,green:0.55,blue:0.55};
  const cs=(c,r1,r2)=>({sourceRange:{sources:[{sheetId:CDGID,startRowIndex:r1,endRowIndex:r2,startColumnIndex:c,endColumnIndex:c+1}]}});
  const ser=(c,ax,col,line,place,lab)=>{const o={series:cs(c,0,10),targetAxis:ax,colorStyle:{rgbColor:col},lineStyle:{type:line,width:line==='SOLID'?3:2},pointStyle:{size:line==='SOLID'?7:5,shape:'CIRCLE'}};if(lab)o.dataLabel={type:'DATA',placement:place,textFormat:{fontSize:9,bold:true,foregroundColor:lab}};return o;};
  const reqs=[{updateChartSpec:{chartId:TREND,spec:{
    title:'주별 채용 달성률 추이 (실제 입사확정일 기준)',
    subtitle:'⬜ 채용필요(목표) · 🟠 누적 입사(위) · 🔵 달성률(아래) · 진한실선=실제도달/연한점선=미래',
    basicChart:{chartType:'LINE',legendPosition:'NO_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'주차'},{position:'LEFT_AXIS',title:'인원(명)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:130}},{position:'RIGHT_AXIS',title:'달성률(%)',viewWindowOptions:{viewWindowMin:0,viewWindowMax:1.3}}],
      domains:[{domain:cs(0,0,10)}],
      series:[ser(5,'LEFT_AXIS',GR,'SOLID','RIGHT',null),ser(1,'LEFT_AXIS',Of,'SOLID','ABOVE',Of),ser(2,'LEFT_AXIS',Ol,'MEDIUM_DASHED','ABOVE',Of),ser(3,'RIGHT_AXIS',Bf,'SOLID','BELOW',Bf),ser(4,'RIGHT_AXIS',Bl,'MEDIUM_DASHED','BELOW',Bf)]}}}}];
  // 4) 차트2(현황) 재연결
  const PAL=[[0.26,0.52,0.96],[0.96,0.49,0.0],[0.20,0.66,0.33],[0.92,0.26,0.21],[0.61,0.35,0.71],[0.0,0.67,0.66],[0.98,0.74,0.02]];
  const hd=(c)=>({sourceRange:{sources:[{sheetId:CDGID,startRowIndex:12,endRowIndex:14,startColumnIndex:c,endColumnIndex:c+1}]}});
  reqs.push({updateChartSpec:{chartId:HYUN,spec:{title:'📊 현황 단계별 분포',basicChart:{chartType:'COLUMN',legendPosition:'RIGHT_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS',title:'건수'}],domains:[{domain:hd(0)}],series:PAL.map((c,i)=>({series:hd(i+1),colorStyle:{rgbColor:{red:c[0],green:c[1],blue:c[2]}},dataLabel:{type:'DATA',placement:'OUTSIDE_END',textFormat:{fontSize:9,bold:true}}}))}}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});

  // 5) 대시보드 junk 제거: E102:H111(분리열) + A128:H129(현황 전치)
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`대시보드!E102:H111`});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`대시보드!A128:H129`});
  // _chartdata 숨김 보장
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{updateSheetProperties:{properties:{sheetId:CDGID,hidden:true},fields:'hidden'}}]}});
  console.log('✅ 보조데이터 _chartdata로 이전 · 차트4·2 재연결 · 대시보드 #N/A/전치 junk 제거 · L4 겹침보정');
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`_chartdata!A1:F10`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.slice(0,4).forEach(r=>console.log('  '+(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
