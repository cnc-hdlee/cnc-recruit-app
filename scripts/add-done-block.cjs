/* 정규직 채용요청 = 활성 130 + 채용완료 16 = 146 블록을 KPI 아래에 추가.
   완료는 채용완료 탭에서 직접 IMPORTRANGE (현황 라벨 누락분까지 정확히). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const ir=rng=>`SUM(IMPORTRANGE("${HR}","채용완료!${rng}"))`;
(async()=>{const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:Z140`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_done_block_20260622.json'),JSON.stringify(bak,null,1));
 // r9(전체) 아래 5줄 삽입
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:9,endIndex:14},inheritFromBefore:false}}]}});
 // r11~r14 블록 (r10 빈줄)
 const body=[
  ['정규직 채용요청 현황','채용요청','입사',''],
  ['   활성 요청','=B13-B12','=C13-C12',''],         // 활성 = 합계 - 완료
  ['   채용완료(별도)',`=${ir('F2:F20')}`,`=${ir('M2:M20')}`,''],  // 완료 직접 IMPORTRANGE
  ['   합계 (= 정규직)','=B3','=C3',''],              // 정규직 KPI
 ];
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A11:D14`,valueInputOption:'USER_ENTERED',requestBody:{values:body}});
 const navy={red:0.12,green:0.22,blue:0.39},mint={red:0.85,green:0.95,blue:0.90};
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   {repeatCell:{range:{sheetId:GID,startRowIndex:10,endRowIndex:11,startColumnIndex:0,endColumnIndex:4},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:12,endRowIndex:13,startColumnIndex:0,endColumnIndex:4},cell:{userEnteredFormat:{backgroundColor:mint,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:13,endRowIndex:14,startColumnIndex:0,endColumnIndex:4},cell:{userEnteredFormat:{textFormat:{bold:true}}},fields:'userEnteredFormat.textFormat'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:11,endRowIndex:14,startColumnIndex:1,endColumnIndex:3},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
 ]}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A11:C14`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 채용완료 블록 ===');chk.forEach((r,i)=>console.log(`r${i+11}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
