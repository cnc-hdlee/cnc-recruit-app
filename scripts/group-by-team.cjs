/* RAW 라인블록을 팀별로 묶기: 생산1팀(정규+도급), 생산2팀(정규+도급) 인접 + 팀 소계.
   소계행은 D/E/F/G/L 빈칸(집계 영향X), A는 텍스트(추이 제외). 팀행 A는 빈칸 유지(추이 포함). */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const P='RAW DATA_채용진행상황(현재)';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const meta=(await s.spreadsheets.get({spreadsheetId:PROG,fields:'sheets(properties(sheetId,title))'})).data.sheets;
 const GID=meta.find(x=>x.properties.title===P).properties.sheetId;
 const g=(await s.spreadsheets.get({spreadsheetId:PROG,ranges:[`'${P}'!A3:V13`],fields:'sheets.data.rowData.values(userEnteredValue,userEnteredFormat)'})).data.sheets[0];
 const R=g.data[0].rowData; // idx0=r3 ... idx10=r13
 fs.writeFileSync(path.join(__dirname,'backup_groupteam_20260623.json'),JSON.stringify(R,null,1));
 const clone=o=>JSON.parse(JSON.stringify(o));
 const setF=(rd,col,formula)=>{rd.values[col].userEnteredValue={formulaValue:formula};};
 const setS=(rd,col,str)=>{rd.values[col].userEnteredValue={stringValue:str};};
 // 팀 소계 만들기 (헤더 R[1] 서식 클론)
 const sub1=clone(R[1]); setS(sub1,0,'▸ 생산1팀'); setF(sub1,13,'=SUM(N5:N6)'); setF(sub1,14,'=SUM(O5:O6)'); setF(sub1,20,'=SUM(U5:U6)'); setF(sub1,21,'=SUM(V5:V6)');
 const sub2=clone(R[1]); setS(sub2,0,'▸ 생산2팀'); setF(sub2,13,'=SUM(N8:N9)'); setF(sub2,14,'=SUM(O8:O9)'); setF(sub2,20,'=SUM(U8:U9)'); setF(sub2,21,'=SUM(V8:V9)');
 // 새 순서: COO / 생산1팀소계 / 생1정규(R2) / 생1도급(R5) / 생산2팀소계 / 생2정규(R3) / 생2도급(R6) / 생3(R7) / 포1(R8) / 포2(R9) / 포3(R10)
 const out=[R[0], sub1, R[2], R[5], sub2, R[3], R[6], R[7], R[8], R[9], R[10]];
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{updateCells:{rows:out,fields:'userEnteredValue,userEnteredFormat',start:{sheetId:GID,rowIndex:2,columnIndex:0}}}]}});
 await new Promise(r=>setTimeout(r,4000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${P}'!A3:V13`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 팀별 묶음 후 [라벨/팀 | 채용필요 | 입사 | 정규재직 | 도급재직] ===');
 v.forEach((r,i)=>{const rn=i+3;const nm=r[0]||r[6]||'';console.log(`r${rn}: ${nm.padEnd(18)} | ${r[13]||'-'} | ${r[14]||'-'} | ${r[20]||'-'} | ${r[21]||'-'}`);});
 const k=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A9:B9`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n대시보드 전체(불변):',JSON.stringify(k[0]));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
