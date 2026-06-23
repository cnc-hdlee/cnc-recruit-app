const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!G46:N54`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== G46 생산 라인 채용현황 ===');v.forEach(r=>console.log('  '+JSON.stringify(r)));
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
