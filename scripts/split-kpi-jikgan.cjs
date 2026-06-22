/* 대시보드 상단 KPI를 직접/간접/전체 표로 분리. 진행상황 L열(직/간접) SUMIFS.
   node scripts/split-kpi-jikgan.cjs --write */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";const WRITE=process.argv.includes('--write');
const sif=(c,jg)=>`=SUMIFS(${P}!$${c}$3:$${c}$2026,${P}!$L$3:$L$2026,"${jg}")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 if(!WRITE){console.log('[DRY] 직접/간접/전체 표, 상단 3줄 삽입');return;}
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:Z130`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_dash_kpi_20260622.json'),JSON.stringify(bak,null,1));console.log('백업',bak.length,'행');
 // 상단 3줄 삽입 @ index2 (r3 앞) → r2(기존KPI) 유지, r3~5 신규
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:2,endIndex:5},inheritFromBefore:false}}]}});
 // r2~r6 = 헤더/직접/간접/전체/빈
 const body=[
  ['구분','채용필요','입사예정','잔여','채용 달성률'],
  ['직접 (생산·포장 라인)', sif('N','직접'), sif('O','직접'), '=B3-C3', '=IFERROR(C3/B3,0)'],
  ['간접 (사무·관리)',     sif('N','간접'), sif('O','간접'), '=B4-C4', '=IFERROR(C4/B4,0)'],
  ['■ 전체',               '=B3+B4',       '=C3+C4',       '=B5-C5', '=IFERROR(C5/B5,0)'],
  ['','','','',''],
 ];
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A2:E6`,valueInputOption:'USER_ENTERED',requestBody:{values:body}});
 // 서식: 헤더(r2)·전체(r5) 볼드/음영, 달성률 %, 숫자 정수
 const navy={red:0.12,green:0.22,blue:0.39},lav={red:0.93,green:0.95,blue:0.99};
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   {repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:lav,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:5,startColumnIndex:4,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:5,startColumnIndex:1,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
 ]}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A2:E7`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== KPI 표 ===');chk.forEach((r,i)=>console.log(`r${i+2}: ${JSON.stringify(r)}`));
 const cd=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!A2:A2`,valueRenderOption:'FORMULA'})).data.values||[];
 console.log('_chartdata A2 참조:',JSON.stringify(cd[0]),'(자동조정 확인)');
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
