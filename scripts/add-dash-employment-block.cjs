/* 대시보드 우측에 '고용형태(정규직/도급직)' 요약 미니블록 추가 (G40:J42).
   도급직 = 도급 라인행만(V열 도급재직>0) SUMIFS, 정규직 = 전사합계 - 도급직.
   기존 근무지 블록(G33:J35) 서식 복사로 시각 통일. 실행: node scripts/add-dash-employment-block.cjs */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const SS='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const N=`${P}!$N$3:$N$2007`, O=`${P}!$O$3:$O$2007`, V=`${P}!$V$3:$V$2007`;
 await s.spreadsheets.batchUpdate({spreadsheetId:SS,requestBody:{requests:[{copyPaste:{
   source:{sheetId:GID,startRowIndex:32,endRowIndex:35,startColumnIndex:6,endColumnIndex:10},
   destination:{sheetId:GID,startRowIndex:39,endRowIndex:42,startColumnIndex:6,endColumnIndex:10},
   pasteType:'PASTE_FORMAT'}}]}});
 await s.spreadsheets.values.update({spreadsheetId:SS,range:`'${TAB}'!G40:J42`,valueInputOption:'USER_ENTERED',requestBody:{values:[
   ['고용형태','채용필요','입사예정','채용 달성률'],
   ['정규직', `=SUM(${N})-H42`,          `=SUM(${O})-I42`,          '=IFERROR(I41/H41,0)'],
   ['도급직', `=SUMIFS(${N},${V},">0")`, `=SUMIFS(${O},${V},">0")`, '=IFERROR(I42/H42,0)'],
 ]}});
 await new Promise(r=>setTimeout(r,3500));
 const v=(await s.spreadsheets.values.get({spreadsheetId:SS,range:`'${TAB}'!G40:J42`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 고용형태 블록 (G40:J42) ===');
 v.forEach((r,i)=>console.log('r'+(i+40), JSON.stringify(r)));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
