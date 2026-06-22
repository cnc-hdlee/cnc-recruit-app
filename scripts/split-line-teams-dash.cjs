/* 대시보드 생산본부 트리: 생산1·2·3팀·포장1·2·3팀을 정규/도급 8줄로 분리 (step1).
   진행상황 팀명(정규="생산1팀", 도급="생산1팀 (도급직)")+직무로 SUMIFS. 잠긴 4~13행 안 건드림.
   백업 + 그래프/_chartdata 검증. node scripts/split-line-teams-dash.cjs --write */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";const WRITE=process.argv.includes('--write');
const sif=(col,g,h)=>`=SUMIFS(${P}!$${col}$3:$${col}$2026,${P}!$D$3:$D$2026,"COO",${P}!$E$3:$E$2026,"생산본부",${P}!$G$3:$G$2026,"${g}",${P}!$H$3:$H$2026,"${h}")`;
// [라벨, G(팀명), H(직무), 구분]
const ROWS=[
 ['         생산1팀 · 정규','생산1팀','생산','J'],
 ['         생산1팀 · 도급','생산1팀 (도급직)','생산','D'],
 ['         생산2팀 · 정규','생산2팀','생산','J'],
 ['         생산2팀 · 도급','생산2팀 (도급직)','생산','D'],
 ['         생산3팀 · 도급','생산3팀 (도급직)','생산','D'],
 ['         포장1팀 · 도급','포장1팀 (도급직)','포장','D'],
 ['         포장2팀 · 도급','포장2팀 (도급직)','포장','D'],
 ['         포장3팀 · 도급','포장3팀 (도급직)','포장','D'],
];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const NB=ROWS.length, FIRST=5; // 5~12 = 8줄, 13~15 소계
 console.log('삽입: 11줄(@r5) = 8팀 + 정규/도급/합 소계');
 if(!WRITE){console.log('[DRY]');return;}
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:Z130`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_dash_split_20260622.json'),JSON.stringify(bak,null,1));console.log('백업 완료',bak.length,'행');
 const cdBefore=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!A2:A3`,valueRenderOption:'FORMULA'})).data.values||[];
 // 1) 11줄 삽입 @ index4 (r5)
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:4,endIndex:4+11},inheritFromBefore:false}}]}});
 // 2) 내용
 const body=[];
 ROWS.forEach((r,i)=>{const rn=FIRST+i;body.push([r[0],sif('N',r[1],r[2]),sif('O',r[1],r[2]),`=B${rn}-C${rn}`,`=IFERROR(C${rn}/B${rn},0)`]);});
 body.push(['      ▸ 라인 정규 소계','=B5+B7','=C5+C7','=B13-C13','=IFERROR(C13/B13,0)']);
 body.push(['      ▸ 라인 도급 소계','=B6+B8+B9+B10+B11+B12','=C6+C8+C9+C10+C11+C12','=B14-C14','=IFERROR(C14/B14,0)']);
 body.push(['   ▸ 직접라인 합계','=B13+B14','=C13+C14','=B15-C15','=IFERROR(C15/B15,0)']);
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A5:E15`,valueInputOption:'USER_ENTERED',requestBody:{values:body}});
 // 3) 옛 통합 생산1팀/생산2팀 행 삭제(시프트된 위치 탐색)
 const after=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A5:A40`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const delRows=[];after.forEach((r,i)=>{const t=String(r[0]||'').trim();if(t==='생산1팀'||t==='생산2팀')delRows.push(i+5);});
 console.log('옛 통합행 삭제 대상:',delRows);
 // 아래→위 삭제
 for(const dr of delRows.sort((a,b)=>b-a)){await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{deleteDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:dr-1,endIndex:dr}}}]}});}
 await new Promise(r=>setTimeout(r,4000));
 // 검증
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A5:E16`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n=== 분리 결과 ===');chk.forEach((r,i)=>{if(r&&r.some(c=>String(c).trim()!==''))console.log(`r${i+5}: ${JSON.stringify(r)}`);});
 const cdAfter=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!A2:A3`,valueRenderOption:'FORMULA'})).data.values||[];
 console.log('\n_chartdata 참조: before',JSON.stringify(cdBefore),'→ after',JSON.stringify(cdAfter),'(자동조정 확인)');
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
