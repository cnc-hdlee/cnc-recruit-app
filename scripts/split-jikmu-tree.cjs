/* 채용달성률 대시보드 트리: 직무 2개 이상 팀을 직무별 줄로 분리 (생산2팀 패턴).
 * 아래→위 순서, insertRange(A:E만, ROWS) + 포맷복사. 소계는 criteria-SUMIFS라 자동 보존.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',TAB='대시보드',GID=500969666;
const RAW="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const sum=(col,bu,bn,sb,tm,jik)=>`=SUMIFS(${RAW}!$${col}$3:$${col}$2001,${RAW}!$E$3:$E$2001,"${bu}",${RAW}!$F$3:$F$2001,"${bn}",${RAW}!$G$3:$G$2001,"${sb}",${RAW}!$H$3:$H$2001,"${tm}",${RAW}!$I$3:$I$2001,"${jik}")`;
// 아래→위 순서 (원본 트리 행번호)
const TEAMS=[
 {row:72,bu:'CFO',bn:'경영기획본부',sb:'People&Culture실',tm:'C&B',jiks:['총괄','팀원']},
 {row:71,bu:'CFO',bn:'경영기획본부',sb:'People&Culture실',tm:'HRBP',jiks:['총괄','팀원']},
 {row:70,bu:'CFO',bn:'경영기획본부',sb:'People&Culture실',tm:'Talent Acquisition팀',jiks:['팀원','총괄']},
 {row:67,bu:'CFO',bn:'경영기획본부',sb:'CEO Office실',tm:'거버넌스전략팀',jiks:['기업홍보','ESG','내부회게']},
 {row:61,bu:'CFO',bn:'경영기획본부',sb:'Workplace Experience실',tm:'디지털전략팀',jiks:['정보보호','총괄']},
 {row:50,bu:'CBO',bn:'영업본부',sb:'KPD실',tm:'KPD실',jiks:['국내영업','총괄']},
 {row:24,bu:'COO',bn:'생산본부',sb:'생산기획부',tm:'생산운영팀',jiks:['생산운영 총괄','제조계획','생산계획','SCM']},
 {row:18,bu:'COO',bn:'생산본부',sb:'품질경영부문',tm:'품질관리1팀',jiks:['자재QC','충전QC']},
 {row:16,bu:'COO',bn:'생산본부',sb:'자재물류부',tm:'자재물류1팀',jiks:['부자재 입출고','물류파트']},
 {row:14,bu:'COO',bn:'생산본부',sb:'제조부',tm:'제조2팀',jiks:['제조','칭량']},
];
async function main(){
  const s=await auth();
  const before=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${TAB}!B27`,valueRenderOption:'FORMATTED_VALUE'})).data.values;
  console.log('작업 전 COO소계(B27 채용필요):',before&&before[0][0]);
  // 추이 라벨 병합(B91:G91) 임시 해제 — 삽입 시 찢김 방지
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{unmergeCells:{range:{sheetId:GID,startRowIndex:90,endRowIndex:91,startColumnIndex:1,endColumnIndex:7}}}]}});
  let inserted=0;
  for(const t of TEAMS){
    const n=t.jiks.length,R=t.row;
    if(n>1){
      await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[
        {insertRange:{range:{sheetId:GID,startRowIndex:R,endRowIndex:R+n-1,startColumnIndex:0,endColumnIndex:5},shiftDimension:'ROWS'}},
        {copyPaste:{source:{sheetId:GID,startRowIndex:R-1,endRowIndex:R,startColumnIndex:0,endColumnIndex:5},destination:{sheetId:GID,startRowIndex:R,endRowIndex:R+n-1,startColumnIndex:0,endColumnIndex:5},pasteType:'PASTE_FORMAT'}},
      ]}});
    }
    const rows=t.jiks.map((jik,i)=>{const rr=R+i;return ['         '+t.tm+' - '+jik,sum('O',t.bu,t.bn,t.sb,t.tm,jik),sum('P',t.bu,t.bn,t.sb,t.tm,jik),`=B${rr}-C${rr}`,`=IFERROR(C${rr}/B${rr},0)`];});
    await s.spreadsheets.values.update({spreadsheetId:ID,range:`${TAB}!A${R}:E${R+n-1}`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
    inserted+=n-1;
    console.log(`  ${t.tm} → ${t.jiks.map(j=>t.tm+'-'+j).join(', ')} (R${R}~${R+n-1})`);
  }
  // 추이 라벨 다시 병합 (밀린 위치 = 91+inserted)
  const lr=91+inserted;
  await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{mergeCells:{range:{sheetId:GID,startRowIndex:lr-1,endRowIndex:lr,startColumnIndex:1,endColumnIndex:7},mergeType:'MERGE_ALL'}}]}});
  console.log(`삽입 ${inserted}행, 추이라벨 B${lr}:G${lr} 재병합. 검증:`);
  // 전사합계는 행이 밀렸으니 라벨로 찾기
  const v=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${TAB}!A5:E120`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  v.forEach((r,i)=>{const a=String(r[0]||'').trim();if(/전사 합계|COO 소계|CRIO 소계|CBO 소계|CFO 소계/.test(a))console.log(`  R${5+i} ${a}: 채용필요=${r[1]} 입사예정=${r[2]}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
