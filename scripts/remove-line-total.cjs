/* 뜬금없는 '직접 라인 합계'(r18) 제거 → 아래 1줄 당김. A:E만(블록 불변). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A12:E92`,valueRenderOption:'FORMULA'})).data.values||[];
  fs.writeFileSync(path.join(__dirname,'backup_remove_linetotal_20260622.json'),JSON.stringify(bak,null,1));
  // r19~92 → r18 (1줄 당김)
  await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{copyPaste:{
    source:{sheetId:GID,startRowIndex:18,endRowIndex:92,startColumnIndex:0,endColumnIndex:5},
    destination:{sheetId:GID,startRowIndex:17,endRowIndex:91,startColumnIndex:0,endColumnIndex:5},
    pasteType:'PASTE_NORMAL'}}]}});
  await s.spreadsheets.values.batchClear({spreadsheetId:PROG,ranges:[`'${TAB}'!A91:E92`]});
  await new Promise(r=>setTimeout(r,4000));
  const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A12:E28`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  console.log('=== 제거 후 ===');
  chk.forEach((r,i)=>{const t=r&&r.some(c=>String(c).trim()!=='')?JSON.stringify(r):'(빈칸)';console.log(`r${i+12}: ${t}`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
