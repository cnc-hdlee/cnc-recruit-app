/* ◆전사합계 r108: SUM(N) → SUMIFS(N, D<>"") 로 변경 (RAW 소계행 D빈칸이라 제외). 이중계상 해소. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const R="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 // 현재 r108 수식 백업
 const f=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!B108:C108`,valueRenderOption:'FORMULA'})).data.values||[];
 console.log('현재 B108:',f[0]&&f[0][0]);
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data:[
   {range:`'대시보드'!B108`,values:[[`=SUMIFS(${R}!$N$3:$N$2026,${R}!$D$3:$D$2026,"<>")`]]},
   {range:`'대시보드'!C108`,values:[[`=SUMIFS(${R}!$O$3:$O$2026,${R}!$D$3:$D$2026,"<>")`]]},
 ]}});
 await new Promise(r=>setTimeout(r,3000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A108:E108`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('전사합계(수정후):',JSON.stringify(v[0]));
 const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A9:F9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('KPI 전체:',JSON.stringify(k[0]));
 const m=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A12:E44`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n부 소계 검증:');
 m.forEach(r=>{if(r&&/소계/.test(String(r[0]||'')))console.log(`  ${r[0].trim()}: 채용필요 ${r[1]} / 입사 ${r[2]}`);});
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
