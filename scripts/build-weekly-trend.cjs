/* 주별 채용 달성률 추이 (날짜 역산) — 별도 탭 "주별 채용추이".
 * 분자: 그 주(일요일)까지 입사확정일 누적 입사, 팀+직무별로 채용필요(O)에서 캡 → 대시보드(46.7%)와 일관.
 * 분모: 채용필요 합계(122) 고정(요청일 데이터 없음). 미래 입사확정일 포함 = 계획 궤적.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',REQ='RAW DATA_채용진행상황(현재)';
const TAB='주별 채용추이';
const C=x=>String(x==null?'':x).trim();
const norm=x=>C(x).replace(/\s+/g,'').toLowerCase();
const NUM=x=>parseFloat(C(x).replace(/[^0-9.-]/g,''))||0;
const D=s=>{const m=/(\d{4})-(\d{1,2})-(\d{1,2})/.exec(C(s));return m?new Date(+m[1],+m[2]-1,+m[3]):null;};
const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 입사자 명단: B입사확정일 F팀 G직무 P비고 — 포기/취소 제외
  const ros=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`입사자 명단!B4:P400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const hires=[];ros.forEach(r=>{const d=D(r[0]),t=C(r[4]),j=C(r[5]);if(/포기|취소|불참|거절/.test(C(r[14])))return;if(d&&t)hires.push({d,key:norm(t)+'|'+norm(j)});});
  // 채용진행상황 행: key->O, 그리고 보존완료(매칭0인데 P>0) 베이스라인
  const vals=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!A1:R80`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const rows=[];let totO=0;
  const keyCnt={};hires.forEach(h=>keyCnt[h.key]=(keyCnt[h.key]||0)+1);
  for(let i=0;i<vals.length;i++){const r=vals[i]||[];const E=C(r[4]),H=C(r[7]),I=C(r[8]);
    if(!E||E.includes('부문')||C(r[0]).startsWith('■'))continue;
    const O=NUM(r[14]),P=NUM(r[15]);const key=norm(H)+'|'+norm(I);
    totO+=O;
    const base=(!keyCnt[key]&&P>0)?Math.min(P,O):0; // 라벨불일치 보존 완료분
    rows.push({key,O,base});}
  // 주 생성: 최소 입사확정일의 월요일 ~ 최대
  const allD=hires.map(h=>h.d).sort((a,b)=>a-b);
  const first=allD[0],last=allD[allD.length-1];
  const mon=new Date(first);mon.setDate(mon.getDate()-((mon.getDay()+6)%7)); // 그 주 월요일
  const weeks=[];for(let w=new Date(mon);w<=last;w.setDate(w.getDate()+7)){const sun=new Date(w);sun.setDate(sun.getDate()+6);weeks.push(new Date(sun));}
  // 주별 분자(팀+직무 캡 누적)
  const baseSum=rows.reduce((a,r)=>a+r.base,0);
  const table=weeks.map(sun=>{
    let num=baseSum;
    rows.forEach(r=>{if(!keyCnt[r.key])return;const c=hires.filter(h=>h.key===r.key&&h.d<=sun).length;num+=Math.min(c,r.O);});
    return [fmt(sun),num,totO];
  });
  console.log('채용필요 합계(분모):',totO);
  console.log('주별 (종료일 · 누적입사 · 달성률):');
  table.forEach(t=>console.log(`  ${t[0]}  ${t[1]}/${t[2]} = ${(100*t[1]/t[2]).toFixed(1)}%`));

  // ── 탭 생성/초기화 ──
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title))'});
  let sh=meta.data.sheets.find(x=>x.properties.title===TAB);let gid;
  if(!sh){const add=await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{addSheet:{properties:{title:TAB,gridProperties:{rowCount:60,columnCount:6}}}}]}});gid=add.data.replies[0].addSheet.properties.sheetId;}
  else{gid=sh.properties.sheetId;await s.spreadsheets.values.clear({spreadsheetId:ID,range:`${TAB}!A1:F60`});}
  // 값
  const out=[['📈 주별 채용 달성률 추이 (실제 입사확정일 누적 / 채용필요)','','',''],
             ['주차(종료일)','누적 입사','채용필요','달성률']];
  table.forEach((t,i)=>out.push([t[0],t[1],t[2],`=B${i+3}/C${i+3}`]));
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`${TAB}!A1`,valueInputOption:'USER_ENTERED',requestBody:{values:out}});
  const lastRow=table.length+2;
  // 서식
  const reqs=[
    {repeatCell:{range:{sheetId:gid,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:4},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true,fontSize:11}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}},
    {mergeCells:{range:{sheetId:gid,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:4},mergeType:'MERGE_ALL'}},
    {repeatCell:{range:{sheetId:gid,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:4},cell:{userEnteredFormat:{backgroundColor:{red:0.85,green:0.89,blue:0.95},textFormat:{bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:gid,startRowIndex:2,endRowIndex:lastRow,startColumnIndex:3,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:gid,startRowIndex:2,endRowIndex:lastRow,startColumnIndex:0,endColumnIndex:3},cell:{userEnteredFormat:{horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.horizontalAlignment'}},
    {updateDimensionProperties:{range:{sheetId:gid,dimension:'COLUMNS',startIndex:0,endIndex:1},properties:{pixelSize:130},fields:'pixelSize'}},
    {updateDimensionProperties:{range:{sheetId:gid,dimension:'COLUMNS',startIndex:1,endIndex:4},properties:{pixelSize:90},fields:'pixelSize'}},
    {updateSheetProperties:{properties:{sheetId:gid,gridProperties:{frozenRowCount:2}},fields:'gridProperties.frozenRowCount'}},
  ];
  // 라인 차트
  reqs.push({addChart:{chart:{spec:{title:'주별 채용 달성률 추이',basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',axis:[{position:'BOTTOM_AXIS',title:'주차'},{position:'LEFT_AXIS',title:'달성률'}],
    domains:[{domain:{sourceRange:{sources:[{sheetId:gid,startRowIndex:2,endRowIndex:lastRow,startColumnIndex:0,endColumnIndex:1}]}}}],
    series:[{series:{sourceRange:{sources:[{sheetId:gid,startRowIndex:2,endRowIndex:lastRow,startColumnIndex:3,endColumnIndex:4}]}},targetAxis:'LEFT_AXIS'}],headerCount:0}},
    position:{overlayPosition:{anchorCell:{sheetId:gid,rowIndex:1,columnIndex:5},widthPixels:520,heightPixels:300}}}}});
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:reqs}});
  console.log(`\n✅ "${TAB}" 탭 생성 (gid ${gid}) · ${table.length}주 · 라인차트`);
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
