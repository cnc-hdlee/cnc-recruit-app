/* 입사예정(정규직/도급직)DB → 1QEvF 채용예정 미러링 + 근무지 자동(1팀퍼플/2팀그린) + 입사여부보존 + 표서식 + 에스텍 겨자음영. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY',TGT='1QEvFEWjnXC1CNw6qAZ4ooFQUIxh36ow_9EL3hnM6ZoI';
const TAB='채용예정',GID=929249270;
const C=x=>String(x==null?'':x).trim();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
// 근무지 규칙: 1팀→퍼플, 2팀→그린, 3팀→3공장, 그 외 소스값
function loc(team,src){team=C(team);if(/1\s*팀/.test(team))return '퍼플';if(/2\s*팀/.test(team))return '그린';if(/3\s*팀/.test(team))return '3공장';return C(src);}
// 직무가 생산·포장이면 직접 (에스텍 포함), 그 외 소스값
function jikgan(jik,src){jik=C(jik);return (jik==="생산"||jik==="포장")?"직접":C(src);}
// 소스 A0일 B1본부 C2팀 D3직무 E4직급 F5신입경력 G6성명 H7성별 I8출생 J9근무지 K10직간접 L11비고
function mapRow(r,소속,본부기본,kmap){const nm=C(r[6]);const sin=(소속==='에스텍플러스')?'신입':C(r[5]);return [C(r[0]),소속,C(r[1])||본부기본,C(r[2]),C(r[3]),C(r[4]),sin,nm,loc(r[2],r[9]),jikgan(r[3],r[10]),'입사',C(r[11])];}

async function main(){
  const s=await auth();
  // 기존 입사여부(K) 보존: 성명->K
  const cur=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!A2:L2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const kmap={};cur.forEach(r=>{const nm=C(r[7]);if(nm&&C(r[10]))kmap[nm]=C(r[10]);});
  // 소스
  const jv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`입사예정(정규직)DB!A2:M2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const dv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`입사예정(도급직)DB!A2:L2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const rows=[];
  jv.forEach(r=>{if(C(r[6]))rows.push(mapRow(r,'㈜씨앤씨인터내셔널','',kmap));});
  dv.forEach(r=>{if(C(r[6]))rows.push(mapRow(r,'에스텍플러스','생산본부',kmap));});
  rows.sort((a,b)=>(a[0]||'').localeCompare(b[0]||''));
  const last=rows.length+1; // 시트 마지막 행
  await s.spreadsheets.values.clear({spreadsheetId:TGT,range:`${TAB}!A2:L2000`});
  await s.spreadsheets.values.update({spreadsheetId:TGT,range:`${TAB}!A2`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});

  // ── 서식 ──
  const reqs=[];
  // 데이터영역 배경 흰색 리셋(옛 색 잔재 제거) — 에스텍은 아래 조건부서식이 겨자색 덮음
  reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:600,startColumnIndex:0,endColumnIndex:12},cell:{userEnteredFormat:{backgroundColor:{red:1,green:1,blue:1}}},fields:'userEnteredFormat.backgroundColor'}});
  // 헤더
  reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:12},cell:{userEnteredFormat:{backgroundColor:{red:0.12,green:0.22,blue:0.39},textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true,fontSize:10},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'}});
  // 헤더 고정
  reqs.push({updateSheetProperties:{properties:{sheetId:GID,gridProperties:{frozenRowCount:1}},fields:'gridProperties.frozenRowCount'}});
  // 데이터 가운데정렬(비고 제외) + 테두리
  reqs.push({repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:last,startColumnIndex:0,endColumnIndex:11},cell:{userEnteredFormat:{horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.horizontalAlignment'}});
  const bd={style:'SOLID',color:{red:0.8,green:0.8,blue:0.82}};
  reqs.push({updateBorders:{range:{sheetId:GID,startRowIndex:0,endRowIndex:last,startColumnIndex:0,endColumnIndex:12},top:bd,bottom:bd,left:bd,right:bd,innerHorizontal:bd,innerVertical:bd}});
  // 열너비
  const widths=[90,140,80,80,70,55,70,90,60,75,70,150];
  widths.forEach((w,i)=>reqs.push({updateDimensionProperties:{range:{sheetId:GID,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:w},fields:'pixelSize'}}));
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:reqs}});

  // ── 에스텍 겨자음영 조건부서식 (중복 방지: 기존 제거 후 추가) ──
  const meta=await s.spreadsheets.get({spreadsheetId:TGT,fields:'sheets(properties(sheetId,title),conditionalFormats)'});
  const sh=meta.data.sheets.find(x=>x.properties.sheetId===GID);
  const mine=[];(sh.conditionalFormats||[]).forEach((c,i)=>{const f=c.booleanRule&&c.booleanRule.condition&&c.booleanRule.condition.values&&c.booleanRule.condition.values[0];if(f&&String(f.userEnteredValue).includes('에스텍플러스'))mine.push(i);});
  const cfReq=mine.sort((a,b)=>b-a).map(i=>({deleteConditionalFormatRule:{sheetId:GID,index:i}}));
  cfReq.push({addConditionalFormatRule:{rule:{ranges:[{sheetId:GID,startRowIndex:1,endRowIndex:2000,startColumnIndex:0,endColumnIndex:12}],booleanRule:{condition:{type:'CUSTOM_FORMULA',values:[{userEnteredValue:'=$B2="에스텍플러스"'}]},format:{backgroundColor:{red:0.93,green:0.82,blue:0.38}}}},index:0}});
  await s.spreadsheets.batchUpdate({spreadsheetId:TGT,requestBody:{requests:cfReq}});

  console.log(`OK: 채용예정 미러 ${rows.length}명 (정규 ${jv.filter(r=>C(r[6])).length}+도급 ${dv.filter(r=>C(r[6])).length}) · 근무지자동 · 입사여부보존 ${Object.keys(kmap).length} · 표서식 · 에스텍 겨자음영`);
  const chk=(await s.spreadsheets.values.get({spreadsheetId:TGT,range:`${TAB}!A2:L5`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  chk.forEach(r=>console.log('  '+(r||[]).join(' | ')));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
