const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data:[
   {range:`'대시보드'!E13`,values:[['=IF($B$12<=0,"-",MIN(C13,$B$12)/$B$12)']]},
   {range:`'대시보드'!E14`,values:[['=IF($B$12<=0,"-",MIN(C14,$B$12)/$B$12)']]},
   {range:`'대시보드'!E19`,values:[['=IF($B$17<=0,"-",MIN(C19,$B$17)/$B$17)']]},
 ]}});
 await new Promise(r=>setTimeout(r,3000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A12:E20`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 최종 (정규/도급 달성률 채움) ===');
 v.forEach((r,i)=>console.log(`r${i+12}: ${(r[0]||'').padEnd(16)} | 필요 ${r[1]||'·'} | 입사 ${r[2]||'·'} | 달성 ${r[4]||'·'}`));
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
