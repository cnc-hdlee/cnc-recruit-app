const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 // Q열 달성률 캡: 라인블록+전체 데이터(Q4:Q120)
 const rows=[];for(let r=4;r<=120;r++)rows.push([`=IF($N${r}="","",IF($N${r}<=0,"-",MIN($O${r},$N${r})/$N${r}))`]);
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${P}'!Q4:Q120`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
 await new Promise(r=>setTimeout(r,2500));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!Q4:Q13`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('Q열(달성률) 캡 후:',v.map(r=>r[0]).join(' '));
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
