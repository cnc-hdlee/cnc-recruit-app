/* 긴급: 추이 달성률 분모 $B$116(트리정리때 삭제됨) → $B$9(KPI 전체 채용필요=197, 고정셀)로 복구 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const rows=[];for(let r=120;r<=127;r++)rows.push([`=IFERROR(C${r}/$B$9,0)`]);
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'대시보드'!D120:D127`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
 await new Promise(r=>setTimeout(r,3000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A120:D127`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 추이 달성률 복구 후 [월|필요|입사|달성률] ===');v.forEach(r=>console.log(`  ${JSON.stringify(r)}`));
 const cd=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!A6:G7`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n_chartdata 달성(F/G) 6·7월:',cd.map(r=>`${r[0]}:F=${r[5]} G=${r[6]}`).join(' / '));
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
