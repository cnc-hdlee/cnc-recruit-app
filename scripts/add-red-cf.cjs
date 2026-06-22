/* 블록 달성률(K열) 40%미만 빨강 조건부서식 추가 (기존 규칙과 동일 서식). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=500969666;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const RED={red:0.95686275,green:0.8,blue:0.8}; // 연빨강 배경 (기존 규칙과 동일)
 const fmt={backgroundColor:RED,textFormat:{foregroundColor:{red:0.79,green:0.0,blue:0.0},bold:true}};
 const rule={booleanRule:{condition:{type:'NUMBER_LESS',values:[{userEnteredValue:'0.4'}]},format:fmt}};
 // 블록 달성률 K열 범위 (4개 5열블록)
 const ranges=[{sheetId:GID,startRowIndex:11,endRowIndex:18,startColumnIndex:10,endColumnIndex:11},  // 본부별 K12:K18
   {sheetId:GID,startRowIndex:20,endRowIndex:24,startColumnIndex:10,endColumnIndex:11},  // 우선순위 K21:K24
   {sheetId:GID,startRowIndex:26,endRowIndex:29,startColumnIndex:10,endColumnIndex:11},  // 채용사유 K27:K29
   {sheetId:GID,startRowIndex:31,endRowIndex:36,startColumnIndex:10,endColumnIndex:11}]; // 근무지 K32:K36
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   {addConditionalFormatRule:{rule:{ranges,...rule},index:0}}
 ]}});
 console.log('K열 달성률 40%미만 빨강 규칙 추가 완료');
 // 확인: 현재 빨강 대상 달성률 셀
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!G11:K36`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('40% 미만(빨강 대상):');
 v.forEach((r,i)=>{const rn=i+11;const k=r&&r[4];if(k&&/%/.test(k)){const n=parseFloat(k);if(n<40)console.log(`  r${rn} ${r[0]}: ${k}`);}});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
