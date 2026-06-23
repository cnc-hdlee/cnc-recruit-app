/* 헤더행(r3,4,7) 병합 해제 후 소계를 N/O/U/V 컬럼에 기입. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const meta=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(sheetId,title),merges)'})).data.sheets;
 const sh=meta.find(x=>x.properties.title===P);const GID=sh.properties.sheetId;
 const merges=(sh.merges||[]).filter(m=>m.startRowIndex<=6&&m.endRowIndex>=3&&m.startRowIndex>=2); // 행 3~7 영역
 console.log('병합 발견:',merges.map(m=>`r${m.startRowIndex+1}-${m.endRowIndex} c${m.startColumnIndex+1}-${m.endColumnIndex}`).join(', ')||'없음');
 const reqs=merges.map(m=>({unmergeCells:{range:{sheetId:GID,...m}}}));
 if(reqs.length)await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:reqs}});
 await new Promise(r=>setTimeout(r,1500));
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data:[
   {range:`'${P}'!N3`,values:[['=SUMIF($D$5:$D$105,"COO",$N$5:$N$105)']]},
   {range:`'${P}'!O3`,values:[['=SUMIF($D$5:$D$105,"COO",$O$5:$O$105)']]},
   {range:`'${P}'!N4`,values:[['=SUM(N5:N6)']]},{range:`'${P}'!O4`,values:[['=SUM(O5:O6)']]},{range:`'${P}'!U4`,values:[['=SUM(U5:U6)']]},
   {range:`'${P}'!N7`,values:[['=SUM(N8:N13)']]},{range:`'${P}'!O7`,values:[['=SUM(O8:O13)']]},{range:`'${P}'!V7`,values:[['=SUM(V8:V13)']]},
 ]}});
 await new Promise(r=>setTimeout(r,3500));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!A3:V7`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n=== 분리 후 [라벨 | N채용필요 | O입사 | U정규재직 | V도급재직] ===');
 [3,4,7].forEach(rn=>{const r=v[rn-3]||[];console.log(`r${rn}: ${(r[0]||'').padEnd(14)} | 채용필요=${r[13]||'-'} | 입사=${r[14]||'-'} | 정규재직=${r[20]||'-'} | 도급재직=${r[21]||'-'}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
