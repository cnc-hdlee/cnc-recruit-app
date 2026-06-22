/* 추이 그래프 X축이 "1원..."으로 나오는 문제: _chartdata 월 라벨을 텍스트로 고정 → 카테고리 축. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='_chartdata';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const gid=(await s.spreadsheets.get({spreadsheetId:PROG})).data.sheets.find(x=>x.properties.title===TAB).properties.sheetId;
 // 현재 A2:A9 (날짜) 확인
 const before=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:A10`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('현재 A열:',JSON.stringify(before.map(r=>r[0])));
 // 백업
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:G12`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_chartdata_xaxis_20260622.json'),JSON.stringify(bak,null,1));
 // A2:A9 텍스트 월 라벨 + 텍스트서식
 const labels=['1월','2월','3월','4월','5월','6월','7월','8월'].map(x=>[x]);
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A2:A9`,valueInputOption:'RAW',requestBody:{values:labels}});
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{repeatCell:{range:{sheetId:gid,startRowIndex:1,endRowIndex:9,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'TEXT'}}},fields:'userEnteredFormat.numberFormat'}}]}});
 await new Promise(r=>setTimeout(r,2000));
 const after=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:G9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n수정 후 _chartdata:');after.forEach((r,i)=>console.log(`r${i+1}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
