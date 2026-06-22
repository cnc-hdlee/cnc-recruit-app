/* KPI를 정규직(직접/간접)/도급직(직접/간접)/전체 중첩 구조로 재구성. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';const GID=500969666;
const P="'RAW DATA_채용진행상황(현재)'";
const sL=(c,jg)=>`SUMIFS(${P}!$${c}$3:$${c}$2026,${P}!$L$3:$L$2026,"${jg}")`;
const sLM=(c,jg,m)=>`SUMIFS(${P}!$${c}$3:$${c}$2026,${P}!$L$3:$L$2026,"${jg}",${P}!$${m}$3:$${m}$2026,">0")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A1:Z135`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_kpi_nested_20260622.json'),JSON.stringify(bak,null,1));
 // 현재 KPI: r2헤더,r3정규직,r4도급직,r5직접,r6간접,r7전체 → 2줄 추가
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:4,endIndex:6},inheritFromBefore:false}}]}});
 const row=(label,b,c,rn)=>[label,'='+b,'='+c,`=B${rn}-C${rn}`,`=IFERROR(C${rn}/B${rn},0)`];
 const body=[
  ['구분','채용필요','입사예정','잔여','채용 달성률'],
  row('정규직','B4+B5','C4+C5',3),
  row('   · 직접', sLM('N','직접','U'), sLM('O','직접','U'),4),
  row('   · 간접', `${sL('N','간접')}-${sLM('N','간접','V')}`, `${sL('O','간접')}-${sLM('O','간접','V')}`,5),
  row('도급직','B7+B8','C7+C8',6),
  row('   · 직접', sLM('N','직접','V'), sLM('O','직접','V'),7),
  row('   · 간접', sLM('N','간접','V'), sLM('O','간접','V'),8),
  row('■ 전체','B3+B6','C3+C6',9),
 ];
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A2:E9`,valueInputOption:'USER_ENTERED',requestBody:{values:body}});
 const navy={red:0.12,green:0.22,blue:0.39},lav={red:0.93,green:0.95,blue:0.99};
 const fmt=(r0,r1,cell,flds)=>({repeatCell:{range:{sheetId:GID,startRowIndex:r0,endRowIndex:r1,startColumnIndex:0,endColumnIndex:5},cell,fields:flds}});
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   fmt(1,2,{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true},horizontalAlignment:'CENTER'}},'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'),
   fmt(2,3,{userEnteredFormat:{backgroundColor:lav,textFormat:{bold:true}}},'userEnteredFormat(backgroundColor,textFormat)'),  // 정규직
   fmt(5,6,{userEnteredFormat:{backgroundColor:lav,textFormat:{bold:true}}},'userEnteredFormat(backgroundColor,textFormat)'),  // 도급직
   fmt(8,9,{userEnteredFormat:{backgroundColor:navy,textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true}}},'userEnteredFormat(backgroundColor,textFormat)'), // 전체
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:9,startColumnIndex:4,endColumnIndex:5},cell:{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
   {repeatCell:{range:{sheetId:GID,startRowIndex:2,endRowIndex:9,startColumnIndex:1,endColumnIndex:4},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(numberFormat,horizontalAlignment)'}},
 ]}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A2:E10`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== KPI 중첩 ===');chk.forEach((r,i)=>console.log(`r${i+2}: ${JSON.stringify(r)}`));
 const cd=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'_chartdata'!A2:A2`,valueRenderOption:'FORMULA'})).data.values||[];
 console.log('_chartdata A2:',JSON.stringify(cd[0]));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
