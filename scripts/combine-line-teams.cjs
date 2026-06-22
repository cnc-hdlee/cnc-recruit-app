/* 대시보드 트리: 생산1·2팀 정규/도급 2행 → 1행 통합 (채용필요=충원, 입사=정규+도급).
   행 삭제 없이(블록 시프트 방지) 정규행에 통합, 도급행 클리어. 소계 업데이트. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
const N=`${P}!$N$3:$N$2026`,O=`${P}!$O$3:$O$2026`,D=`${P}!$D$3:$D$2026`,E=`${P}!$E$3:$E$2026`,G=`${P}!$G$3:$G$2026`,H=`${P}!$H$3:$H$2026`;
const U=`${P}!$U$3:$U$2026`,V=`${P}!$V$3:$V$2026`;
// 통합 팀 SUMIFS (정규+도급 라인 둘다, 와일드카드)
const need=(team)=>`=SUMIFS(${N},${D},"COO",${E},"생산본부",${G},"${team}*",${H},"생산")`;
const ipsa=(team)=>`=SUMIFS(${O},${D},"COO",${E},"생산본부",${G},"${team}*",${H},"생산")`;
const jae=(col,team)=>`SUMIFS(${col},${D},"COO",${E},"생산본부",${G},"${team}*",${H},"생산")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A12:E23`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_combine_line_20260622.json'),JSON.stringify(bak,null,1));
 // r12 생산1팀 통합 (재직 정규/도급 라벨 포함), r13 클리어
 const row=(rn,team)=>[`="         ${team} (재직 정규"&${jae(U,team)}&"·도급"&${jae(V,team)}&")"`,need(team),ipsa(team),`=B${rn}-C${rn}`,`=IFERROR(C${rn}/B${rn},0)`];
 const data=[
   {range:`'${TAB}'!A12:E12`,values:[row(12,'생산1팀')]},
   {range:`'${TAB}'!A13:E13`,values:[['','','','','']]},
   {range:`'${TAB}'!A15:E15`,values:[row(15,'생산2팀')]},
   {range:`'${TAB}'!A16:E16`,values:[['','','','','']]},
   // r21 정규직소계 → 생산 라인 합계, r22/r23 클리어
   {range:`'${TAB}'!A21:E21`,values:[['      ▸ 생산 라인 합계','=B12+B15+B17+B18+B19+B20','=C12+C15+C17+C18+C19+C20','=B21-C21','=IFERROR(C21/B21,0)']]},
   {range:`'${TAB}'!A22:E23`,values:[['','','','',''],['','','','','']]},
 ];
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A12:E23`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 통합 후 트리 ===');chk.forEach((r,i)=>{if(r&&r.some(c=>String(c).trim()!==''))console.log(`r${i+12}: ${JSON.stringify(r)}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
