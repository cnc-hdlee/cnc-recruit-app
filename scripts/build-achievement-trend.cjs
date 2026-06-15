/* 대시보드 탭 빈 영역(G42~)에 월별 추이 차트 2개 추가 (세로 스택, 겹침 없음).
 *  ① 채용 달성률 추이 (%, 누적입사/TO) — 상승
 *  ② 채용 필요 대비 충원 추이 (명) — 채용목표(131) vs 누적입사
 * 데이터: 입사자 명단 입사확정일 월별 누적(COUNTIF) + TO=raw 채용필요 합. 전부 자동 연동.
 * 기존 트리(A~E)·우측 패널(G~L,~37행)·기존 차트 3개 미터치. 재실행 시 본 추이 차트 2개만 교체.
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const RAW="'RAW DATA_채용진행상황(현재)'";const ROSTER="'입사자 명단'";
const T1='채용 달성률 추이 (월별 누적)';const T2='채용 필요 대비 충원 추이 (월별)';
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${ROSTER}!B4:B300`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const months=new Set();v.forEach(r=>{const m=C(r[0]).match(/^(\d{4})-(\d{2})-\d{2}$/);if(m)months.add(m[1]+'-'+m[2]);});
  const ml=[...months].sort();if(!ml.length){console.log('입사확정일 없음');return;}

  // 기존 추이 차트 2종 제거(다른 차트 보존)
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title,sheetId),charts(chartId,spec.title))'});
  const dash=meta.data.sheets.find(x=>x.properties.title===TAB);
  const old=(dash.charts||[]).filter(c=>c.spec&&(c.spec.title===T1||c.spec.title===T2));
  if(old.length)await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:old.map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}))}});

  // 데이터 표: G(월) H(누적입사) I(달성률) J(채용목표)  | 라벨 G42, 헤더 G44, 데이터 G45~
  const LBL=42,hdr=44,first=45,last=first+ml.length-1;
  const TO=`SUM(${RAW}!$O$3:$O$2001)`;
  const rows=ml.map((m,i)=>{const rn=first+i;const[y,mm]=m.split('-');return [
    `=DATE(${y},${mm},1)`,
    `=COUNTIF(${ROSTER}!$B$4:$B$2000,"<="&EOMONTH($G${rn},0))`,
    `=IFERROR($H${rn}/$J${rn},0)`,
    `=${TO}`];});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G${LBL}`,valueInputOption:'USER_ENTERED',requestBody:{values:[['📈 채용 추이 (월별)']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!G${hdr}`,valueInputOption:'USER_ENTERED',requestBody:{values:[['월','누적 입사(명)','달성률','채용목표(명)'],...rows]}});

  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:LBL-1,endRowIndex:LBL,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:hdr,startColumnIndex:6,endColumnIndex:10},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy\"년 \"m\"월\"'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:8,endColumnIndex:9},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}},
  ]}});

  const range=(c0,c1)=>({sources:[{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:last,startColumnIndex:c0,endColumnIndex:c1}]});
  // 기존 차트 3개(rowIndex 2·14·26, 12행 간격, 440x230)의 리듬 그대로 이어서 38·50행에 동일 크기 스택 → 5개 완벽 정렬.
  const anchor=(rowIdx)=>({overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:rowIdx,columnIndex:11},offsetXPixels:0,offsetYPixels:0,widthPixels:440,heightPixels:230}});
  const chart1Row=38;          // 기존 26 + 12
  const chart2Row=50;          // 38 + 12
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {addChart:{chart:{spec:{title:T1,subtitle:'누적 입사 ÷ 채용목표(TO) · 자동 연동',
      basicChart:{chartType:'AREA',legendPosition:'NO_LEGEND',headerCount:1,
        axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'달성률'}],
        domains:[{domain:{sourceRange:range(6,7)}}],
        series:[{series:{sourceRange:range(8,9)},targetAxis:'LEFT_AXIS'}]}},position:anchor(chart1Row)}}},
    {addChart:{chart:{spec:{title:T2,subtitle:'채용목표(131) 대비 누적 입사(명)',
      basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND',headerCount:1,
        axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'명'}],
        domains:[{domain:{sourceRange:range(6,7)}}],
        series:[{series:{sourceRange:range(9,10)},targetAxis:'LEFT_AXIS'},{series:{sourceRange:range(7,8)},targetAxis:'LEFT_AXIS'}]}},position:anchor(chart2Row)}}},
  ]}});

  console.log(`추이 차트 2개 추가 (${ml.join(', ')}). 표 G${hdr}:J${last}, 차트① G${chart1Row+1}~, 차트② G${chart2Row+1}~.`);
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!G${hdr}:J${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach(r=>console.log('  ',r.map(C).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
