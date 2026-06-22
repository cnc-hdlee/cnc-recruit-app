/* 대시보드 2행 KPI: 지표별 라벨+값을 '한 셀'에 묶어 4개 셀로 분리 (A2/C2/E2/G2).
   "총 채용필요 183명" / "입사예정 46명" / "잔여 137명" / "채용달성률 25.1%"
   실행: node scripts/split-dash-kpi.cjs */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const SS='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const sumN=`SUM(${P}!$N$3:$N$2007)`, sumO=`SUM(${P}!$O$3:$O$2007)`;
 await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!A2:H2`,valueInputOption:'USER_ENTERED',requestBody:{values:[[
   `="총 채용필요 "&${sumN}&"명"`, '',
   `="입사예정 "&${sumO}&"명"`,   '',
   `="잔여 "&(${sumN}-${sumO})&"명"`, '',
   `="채용달성률 "&TEXT(IFERROR(${sumO}/${sumN},0),"0.0%")`, '',
 ]]}});
 // 서식: 숫자서식 제거(텍스트라 무관) + 볼드/가운데/연한배경, 라벨칸 좌측 정렬
 const fmtAll={repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:8},cell:{userEnteredFormat:{numberFormat:{type:'TEXT'},textFormat:{bold:true,foregroundColor:{red:0,green:0,blue:0}},horizontalAlignment:'LEFT',verticalAlignment:'MIDDLE',backgroundColor:{red:0.93,green:0.95,blue:0.99}}},fields:'userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment,backgroundColor)'}};
 await s.spreadsheets.batchUpdate({spreadsheetId:SS,requestBody:{requests:[fmtAll]}});
 await new Promise(r=>setTimeout(r,3000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!A2:H2`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('확인 A2:H2 →', JSON.stringify(v[0]));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
