/* 새로 추가한 도급행 회색 규칙(=$Q$5/=$Q$8)의 색을 rule#2와 동일한 #e5e5e5로. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
const GRAY={red:0.8980392,green:0.8980392,blue:0.8980392};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const sh=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(sheetId,title),conditionalFormats)'})).data.sheets.find(x=>x.properties.title===P);
 const GID=sh.properties.sheetId;
 const reqs=[];
 (sh.conditionalFormats||[]).forEach((cf,i)=>{const v=cf.booleanRule&&cf.booleanRule.condition&&cf.booleanRule.condition.values;const f=v&&v[0]&&v[0].userEnteredValue||'';
   if(f.includes('$Q$5>=1')||f.includes('$Q$8>=1')){const nr=JSON.parse(JSON.stringify(cf));nr.booleanRule.format.backgroundColor=GRAY;reqs.push({updateConditionalFormatRule:{sheetId:GID,index:i,rule:nr}});}});
 if(reqs.length)await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:reqs}});
 await new Promise(r=>setTimeout(r,2000));
 const hex=c=>{if(!c)return'-';const f=x=>Math.round((x||0)*255).toString(16).padStart(2,'0');return '#'+f(c.red)+f(c.green)+f(c.blue);};
 const g=(await s.spreadsheets.get({spreadsheetId:PROG,ranges:[`'${P}'!A4:A9`],fields:'sheets(data(rowData(values(effectiveFormat(backgroundColor)))))'})).data.sheets[0];
 (g.data[0].rowData||[]).forEach((rd,i)=>{const c=(rd.values||[])[0];console.log(`r${i+4}: ${hex(c&&c.effectiveFormat&&c.effectiveFormat.backgroundColor)}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
