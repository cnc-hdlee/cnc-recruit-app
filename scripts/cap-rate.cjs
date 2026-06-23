/* 달성률 100% 캡(표시용): 트리 E열 전체. MIN(입사,필요)/필요. 음수/0필요는 "-". 총합·입사는 불변. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const rows=[];for(let r=12;r<=110;r++)rows.push([`=IF($B${r}="","",IF($B${r}<=0,"-",MIN($C${r},$B${r})/$B${r}))`]);
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'대시보드'!E12:E110`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
 await new Promise(r=>setTimeout(r,3000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A12:E24`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 캡 적용 후 (달성률 100% 이하) ===');v.forEach((r,i)=>{if(r&&r.some(c=>String(c).trim()))console.log(`r${i+12}: ${JSON.stringify(r)}`);});
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
