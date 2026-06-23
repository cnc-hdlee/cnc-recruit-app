/* 생산본부 트리를 부(部)별로 재정렬: 라인팀을 소속 부로 묶고, 빠진 생산3부 소계 추가.
   값+서식 함께 이동(updateCells rowData). D/E는 새 행번호로 재구성. r45+(CRIO)는 안 건드림. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const GID=500969666;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const order=['생산1팀','포장1팀 · 도급','생산1부 소계',
 '생산2팀','포장2팀 · 도급','생산2팀 - PM','생산2팀 - ERP','포장2팀 - PM','포장2팀 - ERP','생산2부 소계',
 '생산3팀 · 도급','포장3팀 · 도급','__생산3부__',
 '제조1팀','제조2팀 - 제조','제조2팀 - 칭량','제조부 소계',
 '자재물류1팀 - 부자재 입출고','자재물류1팀 - 물류파트','자재물류부 소계',
 '품질관리1팀 - 자재QC','품질관리2팀','품질보증팀','품질경영부문 소계',
 '전략구매팀','영업관리팀','생산운영팀 - 생산운영 총괄','생산운영팀 - 제조계획','생산운영팀 - 생산계획','생산기획부 - SCM','생산기획부 소계',
 '생산본부 소계','COO 소계'];
(async()=>{const s=await auth();
 const g=(await s.spreadsheets.get({spreadsheetId:PROG,ranges:[`'대시보드'!A12:E43`],fields:'sheets.data.rowData.values(userEnteredValue,userEnteredFormat)'})).data.sheets[0];
 const rows=g.data[0].rowData||[];
 const map={};
 rows.forEach(rd=>{const c=(rd.values||[])[0];const lbl=c&&c.userEnteredValue&&c.userEnteredValue.stringValue?c.userEnteredValue.stringValue.trim():'';if(lbl)map[lbl]=rd;});
 fs.writeFileSync(path.join(__dirname,'backup_reorg_bu_20260622.json'),JSON.stringify(rows,null,1));
 const out=[];
 order.forEach((lbl,idx)=>{const rn=12+idx;let rd;
   if(lbl==='__생산3부__'){rd=JSON.parse(JSON.stringify(map['생산1부 소계']));
     rd.values[0].userEnteredValue={stringValue:'      생산3부 소계'};
     rd.values[1].userEnteredValue={formulaValue:map['생산1부 소계'].values[1].userEnteredValue.formulaValue.replace(/생산1부/g,'생산3부')};
     rd.values[2].userEnteredValue={formulaValue:map['생산1부 소계'].values[2].userEnteredValue.formulaValue.replace(/생산1부/g,'생산3부')};
   } else { rd=JSON.parse(JSON.stringify(map[lbl])); if(!rd){console.error('라벨없음:',lbl);process.exit(1);} }
   // D,E 새 행번호로
   rd.values[3].userEnteredValue={formulaValue:`=B${rn}-C${rn}`};
   rd.values[4].userEnteredValue={formulaValue:`=IFERROR(C${rn}/B${rn},0)`};
   out.push(rd);
 });
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:[{updateCells:{rows:out,fields:'userEnteredValue,userEnteredFormat',start:{sheetId:GID,rowIndex:11,columnIndex:0}}}]}});
 await new Promise(r=>setTimeout(r,4000));
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'대시보드'!A12:E45`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('=== 재정렬 후 ===');v.forEach((r,i)=>{const rn=i+12;if(r&&r.some(c=>String(c).trim()))console.log(`r${rn}: ${JSON.stringify(r)}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
