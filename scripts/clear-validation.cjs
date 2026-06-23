/* 라인블록 A3:V13 데이터유효성(날짜) 제거 → "잘못된 날짜 입력" 경고 삭제. 데이터 불변. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const meta=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(sheetId,title))'})).data.sheets;
 const GID=meta.find(x=>x.properties.title===P).properties.sheetId;
 // 유효성 제거 (rule 생략=clear), 라인블록 전체 + N/O 컬럼 넉넉히
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[
   {setDataValidation:{range:{sheetId:GID,startRowIndex:2,endRowIndex:13,startColumnIndex:0,endColumnIndex:22}}},
 ]}});
 // 실제 오류값 스캔
 const g=(await s.spreadsheets.get({spreadsheetId:PROG,ranges:[`'${P}'!A3:V13`],includeGridData:true})).data.sheets[0];
 const errs=[];(g.data[0].rowData||[]).forEach((rd,ri)=>{(rd.values||[]).forEach((c,ci)=>{if((c.effectiveValue||{}).errorValue)errs.push(`${String.fromCharCode(65+ci)}${ri+3}`);});});
 console.log('유효성 경고 제거 완료. 실제 수식오류 셀:',errs.length?errs.join(','):'0개 ✅');
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
