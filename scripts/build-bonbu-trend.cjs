/* 본부별 월 추이(누적 입사) 표 + 멀티라인 차트 추가.
 *  표: A62 라벨 / A63 헤더(월 + 본부6) / A64~ 월별 행. 값=COUNTIFS(입사확정일<=월말, 본부=헤더).
 *  차트: 본부마다 선 1개(점 마커), x=월. L열 스택 맨 아래(R63)에 대형 배치. 자동 연동.
 *  기존 차트/표/트리 미터치. 재실행 시 이 표·차트만 갱신(차트는 제목으로 식별해 교체).
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const DASH=500969666;const TAB='대시보드';
const ROSTER="'입사자 명단'";
const CHART_TITLE='본부별 채용 추이 (월별 누적 입사)';
// 대시보드 본부별 패널 순서(CEO직속 제외 — 입사자 명단에 없음)
const BONBU=['생산본부','경영기획본부','영업본부','Makeup Center','Skin Science Center','크리에이티브솔루션본부'];
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function main(){
  const s=await auth();
  // 1) 월 목록(입사확정일 distinct yyyy-mm)
  const bv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${ROSTER}!B4:B2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const months=new Set();bv.forEach(r=>{const m=C(r[0]).match(/^(\d{4})-(\d{2})-\d{2}$/);if(m)months.add(m[1]+'-'+m[2]);});
  const ml=[...months].sort();if(!ml.length){console.log('입사확정일 없음');return;}

  // 2) 표 작성: A62 라벨, A63 헤더, A64~ 데이터
  const LBL=62,hdr=63,first=64,last=first+ml.length-1;
  const header=['월',...BONBU];
  const rows=ml.map((m,i)=>{const rn=first+i;const[y,mm]=m.split('-');
    const cells=[`=DATE(${y},${mm},1)`];
    BONBU.forEach((b,bi)=>{const col=String.fromCharCode(66+bi); // B,C,...
      cells.push(`=COUNTIFS(${ROSTER}!$B$4:$B$2000,"<="&EOMONTH($A${rn},0),${ROSTER}!$D$4:$D$2000,${col}$${hdr})`);});
    return cells;});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A${LBL}`,valueInputOption:'USER_ENTERED',requestBody:{values:[['🏢 본부별 채용 추이 (월별 누적 입사)']]}});
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!A${hdr}`,valueInputOption:'USER_ENTERED',requestBody:{values:[header,...rows]}});

  // 3) 서식
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {repeatCell:{range:{sheetId:DASH,startRowIndex:LBL-1,endRowIndex:LBL,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{bold:true,fontSize:13}}},fields:'userEnteredFormat.textFormat'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:hdr,startColumnIndex:0,endColumnIndex:header.length},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy\"년 \"m\"월\"'}}},fields:'userEnteredFormat.numberFormat'}},
    // 본부 카운트 열은 숫자(정수) 강제 — 옛 퍼센트 서식 잔존 제거
    {repeatCell:{range:{sheetId:DASH,startRowIndex:first-1,endRowIndex:last,startColumnIndex:1,endColumnIndex:1+BONBU.length},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
  ]}});

  // 4) 기존 본부별 추이 차트 제거 후 재생성
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(title,sheetId),charts(chartId,spec.title))'});
  const dash=meta.data.sheets.find(x=>x.properties.title===TAB);
  const old=(dash.charts||[]).filter(c=>c.spec&&c.spec.title===CHART_TITLE);
  if(old.length)await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:old.map(c=>({deleteEmbeddedObject:{objectId:c.chartId}}))}});

  // domain A(col0), series B..(본부 수) — 헤더행 포함
  const range=(c0,c1)=>({sources:[{sheetId:DASH,startRowIndex:hdr-1,endRowIndex:last,startColumnIndex:c0,endColumnIndex:c1}]});
  const series=BONBU.map((b,i)=>({series:{sourceRange:range(1+i,2+i)},targetAxis:'LEFT_AXIS',
    lineStyle:{type:'SOLID',width:2},pointStyle:{size:7,shape:'CIRCLE'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
    {addChart:{chart:{spec:{
      title:CHART_TITLE,subtitle:'각 선=본부 · 월말까지 누적 입사(명) · 자동 연동',
      basicChart:{chartType:'LINE',legendPosition:'RIGHT_LEGEND',headerCount:1,
        axis:[{position:'BOTTOM_AXIS',title:'월'},{position:'LEFT_AXIS',title:'누적 입사(명)'}],
        domains:[{domain:{sourceRange:range(0,1)}}],
        series},
    },position:{overlayPosition:{anchorCell:{sheetId:DASH,rowIndex:62,columnIndex:11},widthPixels:900,heightPixels:460}}}}},
  ]}});

  console.log(`OK: 본부별 월 추이 표 A${hdr}:${String.fromCharCode(65+BONBU.length)}${last} (월 ${ml.length}, 본부 ${BONBU.length}) + 차트 R63 900x460.`);
  const chk=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A${hdr}:${String.fromCharCode(65+BONBU.length)}${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach(r=>console.log('  ',r.map(C).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
