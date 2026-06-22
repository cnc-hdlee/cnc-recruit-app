/* 복구: backup_compact_tree(원본 전체 트리)에서 라인 빈칸(r13,14,16,22,23)+직접라인합계(r21)만 빼고
   나머지 전부(부문 구분선 포함, CFO/크솔/CEO/전사합계까지) 연속 재배치. D/E 상대참조 새 행으로 재구성. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';const TAB='대시보드';
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const bak=JSON.parse(fs.readFileSync(path.join(__dirname,'backup_compact_tree_20260622.json'),'utf8'));
 const SKIP=new Set([2,3,5,10,11,12]); // r13,14,16,21,22,23 (idx=row-11)
 const kept=[];
 bak.forEach((row,idx)=>{if(idx===0){kept.push(row);return;} if(SKIP.has(idx))return; kept.push(row);});
 // 새 행번호로 D/E 재구성 (B가 수식이면 데이터행)
 const out=kept.map((row,i)=>{const rn=11+i;const a=row[0]||'',b=row[1]||'',c=row[2]||'';
   if(typeof b==='string'&&b.startsWith('=')){return [a,b,c,`=B${rn}-C${rn}`,`=IFERROR(C${rn}/B${rn},0)`];}
   return [a,b,c,row[3]||'',row[4]||''];});
 const endRow=11+out.length-1;
 await s.spreadsheets.values.update({spreadsheetId:PROG,range:`'${TAB}'!A11:E${endRow}`,valueInputOption:'USER_ENTERED',requestBody:{values:out}});
 if(endRow<118)await s.spreadsheets.values.batchClear({spreadsheetId:PROG,ranges:[`'${TAB}'!A${endRow+1}:E118`]});
 await new Promise(r=>setTimeout(r,4000));
 console.log('새 트리 마지막행:',endRow);
 // 검증: 부문 소계 + 전사합계 존재?
 const v=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${TAB}'!A11:E${endRow}`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const find=re=>{const i=v.findIndex(r=>r&&re.test(String(r[0]||'')));return i<0?'❌없음':`r${i+11}=${JSON.stringify(v[i])}`;};
 console.log('COO 소계:',find(/^COO 소계/));
 console.log('CRIO 소계:',find(/^CRIO 소계/));
 console.log('CBO 소계:',find(/^CBO 소계/));
 console.log('CFO 소계:',find(/^CFO 소계/));
 console.log('크솔 소계:',find(/^크리에이티브솔루션 소계/));
 console.log('CEO 소계:',find(/^CEO 소계/));
 console.log('전사합계:',find(/전사 합계/));
 console.log('라인 r12~18:');v.slice(1,8).forEach((r,i)=>console.log(`  r${i+12}: ${JSON.stringify(r)}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
