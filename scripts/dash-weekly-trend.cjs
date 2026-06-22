/* 대시보드 차트4 → "주별 채용추이" 탭 디자인으로 교체 (누적 주별 라인).
 * 누적 입사(입사자명단, 팀별 캡, 포기제외) 주차별 + 달성률=누적/채용필요. 끝점=46.7%(RAW 누적과 일치).
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',GID=500969666,REQ='RAW DATA_채용진행상황(현재)';
const C=x=>String(x==null?'':x).trim();const norm=x=>C(x).replace(/\s+/g,'').toLowerCase();const NUM=x=>parseFloat(C(x).replace(/[^0-9.-]/g,''))||0;
const D=s=>{const m=/(\d{4})-(\d{1,2})-(\d{1,2})/.exec(C(s));return m?new Date(+m[1],+m[2]-1,+m[3]):null;};
const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  const ros=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`입사자 명단!B4:P400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const hires=[];ros.forEach(r=>{const d=D(r[0]),t=C(r[4]),j=C(r[5]);if(/포기|취소|불참|거절/.test(C(r[14])))return;if(d&&t)hires.push({d,key:norm(t)+'|'+norm(j)});});
  const vals=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!A1:P80`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const rows=[];let totO=0;const keyCnt={};hires.forEach(h=>keyCnt[h.key]=(keyCnt[h.key]||0)+1);
  for(let i=0;i<vals.length;i++){const r=vals[i]||[];const E=C(r[4]),H=C(r[7]),I=C(r[8]);if(!E||E.includes('부문')||C(r[0]).startsWith('■'))continue;
    const O=NUM(r[14]),P=NUM(r[15]);const key=norm(H)+'|'+norm(I);totO+=O;rows.push({key,O,base:(!keyCnt[key]&&P>0)?Math.min(P,O):0});}
  const allD=hires.map(h=>h.d).sort((a,b)=>a-b);const first=allD[0],last=allD[allD.length-1];
  const mon=new Date(first);mon.setDate(mon.getDate()-((mon.getDay()+6)%7));
  const weeks=[];for(let w=new Date(mon);w<=last;w.setDate(w.getDate()+7)){const su=new Date(w);su.setDate(su.getDate()+6);weeks.push(new Date(su));}
  const baseSum=rows.reduce((a,r)=>a+r.base,0);
  const table=weeks.map(su=>{let num=baseSum;rows.forEach(r=>{if(!keyCnt[r.key])return;num+=Math.min(hires.filter(h=>h.key===r.key&&h.d<=su).length,r.O);});return [fmt(su),num,totO];});
  console.log('주별 누적 (끝점=대시보드 46.7% 일치해야):');table.forEach(t=>console.log(`  ${t[0]}  ${t[1]}/${t[2]} = ${(100*t[1]/t[2]).toFixed(1)}%`));

  // ── 대시보드에 주별추이 디자인으로 작성 (A103~) ──
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`대시보드!A103:F125`});
  const out=[['📈 주별 채용 달성률 추이 (누적)','','',''],['주차(종료일)','누적 입사(명)','채용필요(명)','달성률']];
  table.forEach((t,i)=>out.push([t[0],t[1],t[2],`=B${i+3+102}/C${i+3+102}`])); // data starts row105
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`대시보드!A103`,valueInputOption:'USER_ENTERED',requestBody:{values:out}});
  const lastRow=104+table.length; // 105..lastRow
  const reqs=[
    {mergeCells:{range:{sheetId:GID,startRowIndex:102,endRowIndex:103,startColumnIndex:0,endColumnIndex:4},mergeType:'MERGE_ALL'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:102,endRowIndex:103,startColumnIndex:0,endColumnIndex:4},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true,fontSize:11},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:103,endRowIndex:104,startColumnIndex:0,endColumnIndex:4},cell:{userEnteredFormat:{backgroundColor:{red:0.85,green:0.89,blue:0.95},textFormat:{bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:104,endRowIndex:lastRow,startColumnIndex:3,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:GID,startRowIndex:104,endRowIndex:lastRow,startColumnIndex:0,endColumnIndex:3},cell:{userEnteredFormat:{horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.horizontalAlignment'}},
  ];
  // 차트4 재정의: 누적입사(좌·라인) + 달성률(우·라인) 마커+값라벨, 주별추이 느낌
  const R=(c)=>({sourceRange:{sources:[{sheetId:GID,startRowIndex:103,endRowIndex:lastRow,startColumnIndex:c,endColumnIndex:c+1}]}});
  const LBL={dataLabel:{type:'DATA',textFormat:{fontSize:8,bold:true}}};
  reqs.push({updateChartSpec:{chartId:330002883,spec:{
    title:'주별 채용 달성률 추이 (누적)',
    subtitle:'🟠 누적 입사(좌측축·명) · 🔵 달성률(우측축) — 실제 입사확정일 누적, 끝점=전사 46.7%',
    basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
      axis:[{position:'BOTTOM_AXIS',title:'주차'},{position:'LEFT_AXIS',title:'누적 입사(명)'},{position:'RIGHT_AXIS',title:'달성률'}],
      domains:[{domain:R(0)}],
      series:[{series:R(1),targetAxis:'LEFT_AXIS',color:{red:0.937,green:0.420,blue:0.0},lineStyle:{type:'SOLID',width:3},pointStyle:{size:7,shape:'CIRCLE'},...LBL},
              {series:R(3),targetAxis:'RIGHT_AXIS',color:{red:0.118,green:0.439,blue:0.827},lineStyle:{type:'SOLID',width:3},pointStyle:{size:7,shape:'CIRCLE'},...LBL}]}}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log(`\n✅ 대시보드 차트4 = 주별 누적 추이(${table.length}주) · 끝점 46.7% · 주별추이 탭 디자인`);
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
