/* 진행상황(현재) 라인팀을 정규/도급 섹터로 묶기.
   moveDimension로 행 이동(수식참조 자동보정) + 섹터 헤더 2줄 삽입.
   기존 데이터/IMPORTRANGE 보존. 대시보드 안 건드림(팀명·실부 그대로라 SUMIFS 무관).
   최종:
     r4  ▸ 정규직 라인 (헤더)
     r5  생산1팀 / r6 생산2팀 / r7 생산3팀(정규)
     r8  ▸ 도급직 라인 (헤더)
     r9~r14  생산1·2·3팀(도급)·포장1·2·3팀(도급)
     r15 제조1팀…
   실행: node scripts/reorganize-line-sectors.cjs */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const SS='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const TAB='RAW DATA_채용진행상황(현재)';const GID=660728561;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const bu=(s,reqs)=>s.spreadsheets.batchUpdate({spreadsheetId:SS,requestBody:{requests:reqs}});

async function main(){
  const s=await auth();
  const bak=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A1:AC100`,valueRenderOption:'FORMULA'})).data.values||[];
  const bf=path.join(__dirname,'backup_chaeyong_progress_20260618_b.json');
  fs.writeFileSync(bf,JSON.stringify(bak,null,1));
  console.log(`백업: ${bf} (${bak.length}행)`);

  // 현재(삽입후): r4생산1팀,r5생산1팀도급,r6생산2팀,r7생산2팀도급,r8생산3팀정규,r9생산3팀도급,r10~r12 포장도급
  // 1) 생산2팀(idx5) → 생산1팀 바로 뒤(dest 4)
  await bu(s,[{moveDimension:{source:{sheetId:GID,dimension:'ROWS',startIndex:5,endIndex:6},destinationIndex:4}}]);
  // 2) 생산3팀정규(현재 idx7) → 생산2팀 바로 뒤(dest 5)
  await bu(s,[{moveDimension:{source:{sheetId:GID,dimension:'ROWS',startIndex:7,endIndex:8},destinationIndex:5}}]);
  console.log('행 이동 완료 (정규 3줄 상단 묶음).');

  // 3) 섹터 헤더 2줄 삽입: 정규 헤더 idx3, (이후) 도급 헤더 idx7
  await bu(s,[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:3,endIndex:4},inheritFromBefore:false}}]);
  await bu(s,[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:7,endIndex:8},inheritFromBefore:false}}]);
  console.log('섹터 헤더 2줄 삽입 완료.');

  // 4) 헤더 텍스트(소계 수식)
  await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!A4`,valueInputOption:'USER_ENTERED',
    requestBody:{values:[[`="▸ 정규직 라인    (채용필요 "&SUM($N$5:$N$7)&"명 · 입사예정 "&SUM($O$5:$O$7)&"명)"`]]}});
  await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!A8`,valueInputOption:'USER_ENTERED',
    requestBody:{values:[[`="▸ 도급직 라인    (채용필요 "&SUM($N$9:$N$14)&"명 · 입사예정 "&SUM($O$9:$O$14)&"명)"`]]}});

  // 5) 헤더 행 음영+볼드 (정규=연파랑, 도급=연주황). A:R
  const fmt=(row,c)=>({repeatCell:{range:{sheetId:GID,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:18},
    cell:{userEnteredFormat:{backgroundColor:c,textFormat:{bold:true,foregroundColor:{red:0,green:0,blue:0}},verticalAlignment:'MIDDLE'}},
    fields:'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)'}});
  await bu(s,[fmt(3,{red:0.84,green:0.92,blue:0.98}), fmt(7,{red:0.99,green:0.90,blue:0.79})]);
  console.log('헤더 서식 적용.');

  const chk=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A3:Q16`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('\n=== 확인 (A3:Q16) ===');
  chk.forEach((r,i)=>{if(r.some(c=>String(c).trim()!==''))console.log(`r${i+3}: ${JSON.stringify(r)}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
