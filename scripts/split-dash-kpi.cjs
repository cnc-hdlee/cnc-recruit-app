/* 대시보드 2행 KPI를 한 칸(A2 합쳐진 텍스트) → 라벨+값 4쌍(A2:H2)으로 분리.
   값은 기존 SUM 수식 유지. 실행: node scripts/split-dash-kpi.cjs */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const SS='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const sumN=`SUM(${P}!$N$3:$N$2007)`, sumO=`SUM(${P}!$O$3:$O$2007)`;
 // A2:H2 라벨+값
 await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!A2:H2`,valueInputOption:'USER_ENTERED',requestBody:{values:[[
   '총 채용필요', `=${sumN}`,
   '입사예정',   `=${sumO}`,
   '잔여',       '=B2-D2',
   '채용달성률', '=IFERROR(D2/B2,0)',
 ]]}});
 // 서식: 숫자 칸 "명", 달성률 "%", 라벨/값 볼드+가운데
 const numFmt=(c)=>({repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:c,endColumnIndex:c+1},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'#,##0"명"'}}},fields:'userEnteredFormat.numberFormat'}});
 const pctFmt={repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:7,endColumnIndex:8},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}},fields:'userEnteredFormat.numberFormat'}};
 const lblFmt={repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:8},cell:{userEnteredFormat:{textFormat:{bold:true,foregroundColor:{red:0,green:0,blue:0}},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',backgroundColor:{red:0.93,green:0.95,blue:0.99}}},fields:'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,backgroundColor)'}};
 await s.spreadsheets.batchUpdate({spreadsheetId:SS,requestBody:{requests:[lblFmt,numFmt(1),numFmt(3),numFmt(5),pctFmt]}});
 await new Promise(r=>setTimeout(r,3000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A2:H2`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('확인 A2:H2 →', JSON.stringify(v[0]));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
