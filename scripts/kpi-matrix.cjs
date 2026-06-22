/* 대시보드 상단 KPI: 정규직/도급직(고용형태) + 직접/간접(섹터) + 전체 = 5줄로 분리.
   진행상황 L(직간접)·U(정규재직>0)·V(도급재직>0) 마커. node scripts/kpi-matrix.cjs --write */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";const WRITE=process.argv.includes('--write');
const R='3:$_$2026'.replace('_','');
const sL=(c,jg)=>`SUMIFS(${P}!$${c}$3:$${c}$2026,${P}!$L$3:$L$2026,"${jg}")`;
const sLM=(c,jg,m)=>`SUMIFS(${P}!$${c}$3:$${c}$2026,${P}!$L$3:$L$2026,"${jg}",${P}!$${m}$3:$${m}$2026,">0")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 if(!WRITE){console.log('[DRY]');return;}
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:Z135`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_kpi_matrix_20260622.json'),JSON.stringify(bak,null,1));console.log('백업',bak.length);
 // 현재 KPI 표는 r2헤더,r3직접,r4간접,r5전체. 2줄 추가 필요 → index4에 2줄 삽입
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:4,endIndex:6},inheritFromBefore:false}}]}});
 // r2~r7 재작성: 헤더, 정규직, 도급직, 직접, 간접, 전체
 const rowF=(label,bExpr,cExpr,rn)=>[label,'='+bExpr,'='+cExpr,`=B${rn}-C${rn}`,`=IFERROR(C${rn}/B${rn},0)`];
 const body=[
  ['구분','채용필요','입사예정','잔여','채용 달성률'],
  rowF('정규직', `${sL('N','간접')}+${sLM('N','직접','U')}`, `${sL('O','간접')}+${sLM('O','직접','U')}`, 3),
  rowF('도급직', sLM('N','직접','V'), sLM('O','직접','V'), 4),
  rowF('직접 (생산·포장 라인)', sL('N','직접'), sL('O','직접'), 5),
  rowF('간접 (사무·관리)', sL('N','간접'), sL('O','간접'), 6),
  ['■ 전체','=B4+B5','=C4+C5','=B7-C7','=IFERROR(C7/B7,0)'], // 전체=직접+간접
 ];
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A2:E7`,valueInputOption:'USER_ENTERED',requestBody:{values:body}});
 // 서식
 const navy={red:0.12,green:0.22,blue:0.39},lav={red:0.93,green:0.95,blue:0.99},gray={red:0.95,green:0.95,blue:0.95};
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   {repeatCell:{range:{sheetId:GID,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:4,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:lav,textFormat:{bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:6,endRowIndex:7,startColumnIndex:0,endColumnIndex:5},cell:{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:7,startColumnIndex:4,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:7,startColumnIndex:1,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
 ]}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A2:E8`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== KPI 매트릭스 ===');chk.forEach((r,i)=>console.log(`r${i+2}: ${JSON.stringify(r)}`));
 const cd=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!A2:A2`,valueRenderOption:'FORMULA'})).data.values||[];
 console.log('_chartdata A2:',JSON.stringify(cd[0]));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
