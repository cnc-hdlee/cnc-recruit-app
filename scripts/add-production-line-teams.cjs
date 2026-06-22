/* 진행상황(현재)에 단순 생산직(라인) 행 삽입 — 정규/도급 분리.
   순수 삽입만. 기존 행(생산1팀 r4·생산2팀 r5 포함) 일절 안 건드림. 대시보드 안 건드림.
   - 1) r4(생산1팀) 아래 1줄 삽입 → 생산1팀(도급)
   - 2) 생산2팀(이동된 r6) 아래 6줄 삽입 → 생산2팀(도급),생산3팀(정규),생산3팀(도급),포장1/2/3팀(도급)
   - 라벨/실부/직무/근무지/직접 + 수식(B,P,Q,R)만. N(필요)·O(예정)는 빈칸(수기).
   - ■COO 헤더 SUMIF($N$4:$N$77)는 중간삽입으로 자동확장 → 채우면 자동합산.
   실행: node scripts/add-production-line-teams.cjs        (백업+삽입)
        node scripts/add-production-line-teams.cjs --dry   (미리보기) */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const SS='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const TAB='RAW DATA_채용진행상황(현재)';const GID=660728561;
const DRY=process.argv.includes('--dry');
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

// 최종 행번호 → [실/부, 팀, 직무, 근무지]
const ROWS={
  5 :['생산1부','생산1팀(도급)','생산','퍼플'],
  7 :['생산2부','생산2팀(도급)','생산','그린'],
  8 :['생산3부','생산3팀(정규)','생산','3공장'],
  9 :['생산3부','생산3팀(도급)','생산','3공장'],
  10:['생산1부','포장1팀(도급)','포장','퍼플'],
  11:['생산2부','포장2팀(도급)','포장','그린'],
  12:['생산3부','포장3팀(도급)','포장','3공장'],
};
function rowVals(r){
  const [bu,team,jik,site]=ROWS[r];
  const a=Array(19).fill(''); // A..S
  a[1]=`=IF(ISNUMBER(A${r}),IF($T${r}="",TODAY()-A${r},$T${r}-A${r}),"")`; // B 리드타임
  a[3]='COO'; a[4]='생산본부'; a[5]=bu; a[6]=team; a[7]=jik; a[10]=site; a[11]='직접';
  a[15]=`=N${r}-O${r}`;                                    // P 잔여
  a[16]=`=IFERROR(O${r}/N${r},0)`;                         // Q 달성률
  a[17]=`=IF(AND(ISNUMBER(Q${r}),Q${r}>=1),"CLOSE","")`;   // R 마감
  return a;
}

async function main(){
  const s=await auth();
  const bak=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A1:S100`,valueRenderOption:'FORMULA'})).data.values||[];
  const bf=path.join(__dirname,'backup_chaeyong_progress_20260618.json');
  fs.writeFileSync(bf,JSON.stringify(bak,null,1));
  console.log(`백업: ${bf} (${bak.length}행)`);

  console.log('\n=== 삽입 예정 ===');
  Object.keys(ROWS).map(Number).sort((a,b)=>a-b).forEach(r=>{const v=rowVals(r);console.log(`r${r}: 실부=${v[5]} 팀=${v[6]} 직무=${v[7]} 근무지=${v[10]} 직간접=${v[11]}`);});
  if(DRY){console.log('\n[DRY] 삽입 안 함.');return;}

  // 1) 생산1팀(r4) 아래 1줄 삽입 (startIndex=4)
  await s.spreadsheets.batchUpdate({spreadsheetId:SS,requestBody:{requests:[{
    insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:4,endIndex:5},inheritFromBefore:true}}]}});
  // 2) 생산2팀(이동된 r6) 아래 6줄 삽입 (startIndex=6)
  await s.spreadsheets.batchUpdate({spreadsheetId:SS,requestBody:{requests:[{
    insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:6,endIndex:12},inheritFromBefore:true}}]}});
  console.log('\n행 삽입 완료 (총 7줄).');

  // 3) 값/수식 기입
  await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!A5:S5`,valueInputOption:'USER_ENTERED',requestBody:{values:[rowVals(5)]}});
  await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!A7:S12`,valueInputOption:'USER_ENTERED',requestBody:{values:[7,8,9,10,11,12].map(rowVals)}});
  console.log('값/수식 기입 완료.');

  const chk=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A3:Q13`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('\n=== 확인 (A3:Q13) ===');
  chk.forEach((r,i)=>{if(r.some(c=>String(c).trim()!==''))console.log(`r${i+3}: ${JSON.stringify(r)}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
