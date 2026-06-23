/* 생산2팀 달성률 병합을 생산1팀과 동일하게(팀행 포함 E17:E19). 달성률=팀 달성률(앵커 E17). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=500969666;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 // E17 앵커에 팀 달성률 보장(캡), E18:E19 언머지 후 E17:E19 머지
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'대시보드'!E17`,valueInputOption:'USER_ENTERED',requestBody:{values:[['=IF(B17<=0,"-",MIN(C17,B17)/B17)']]}});
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   {unmergeCells:{range:{sheetId:GID,startRowIndex:17,endRowIndex:19,startColumnIndex:4,endColumnIndex:5}}},
   {mergeCells:{range:{sheetId:GID,startRowIndex:16,endRowIndex:19,startColumnIndex:4,endColumnIndex:5},mergeType:'MERGE_ALL'}},
 ]}});
 await new Promise(r=>setTimeout(r,3000));
 const g=(await s.spreadsheets.get({spreadsheetId:PROG,ranges:[`'대시보드'!A12:E20`],fields:'sheets(merges)'})).data.sheets[0];
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A12:E20`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 정리 후 (병합 공통값) ===');
 v.forEach((r,i)=>console.log(`r${i+12}: ${(r[0]||'').padEnd(16)} | 필요 ${r[1]||'·'} | 입사 ${r[2]||'·'} | 달성 ${r[4]||'·'}`));
 console.log('\nE열 병합:',(g.merges||[]).filter(m=>m.startColumnIndex===4).map(m=>`E${m.startRowIndex+1}:E${m.endRowIndex}`).join(', '));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
