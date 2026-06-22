const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const rng=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A108:E130`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 let hdrRow=null,totRow=null;
 rng.forEach((r,i)=>{const rn=i+108;if(String(r[1]||'').includes('채용필요(누적)'))hdrRow=rn;if(String(r[0]||'').includes('전사 합계'))totRow=rn;});
 console.log('헤더행:',hdrRow,'전사합계행:',totRow);
 if(!hdrRow||!totRow){console.log('못찾음');return;}
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A108:E130`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_trend_goal_20260622.json'),JSON.stringify(bak,null,1));
 const first=hdrRow+1,last=hdrRow+8;
 const data=[{range:`'${TAB}'!B${hdrRow}`,values:[['채용목표(전체)']]}];
 for(let r=first;r<=last;r++)data.push({range:`'${TAB}'!B${r}`,values:[[`=$B$${totRow}`]]});
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 await new Promise(r=>setTimeout(r,3000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A${hdrRow}:D${last}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 추이 (목표 227 고정 후) ===');chk.forEach((r,i)=>console.log(`r${i+hdrRow}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
