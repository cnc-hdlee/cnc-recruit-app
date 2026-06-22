/* 활성/완료 혼동 2행 교정: r22→채용완료13, r17→채용완료14.
   완료시트 컬럼: F=채용요청인원(TO), M=입사예정. 데이터 일치 검증된 행만.
   백업 후 N/O만 교체. 4~13행 불변. node scripts/fix-completed-rows.cjs --write */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const PTAB='RAW DATA_채용진행상황(현재)';const WRITE=process.argv.includes('--write');
const F=n=>`=IMPORTRANGE("${HR}", "채용완료!F${n}")`;const M=n=>`=IMPORTRANGE("${HR}", "채용완료!M${n}")`;
// 진행행 : 완료시트행
const FIX=[{r:22,done:13},{r:17,done:14}];
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 // 검증: 완료시트의 팀/직무/근무지/입사자가 진행행과 일치하는지 재확인
 const dc=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용완료'!A1:O20`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const pv=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V75`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 for(const f of FIX){const d=dc[f.done-1];const p=pv[f.r-14];
   console.log(`r${f.r} [${p[6]}/${p[7]}/${p[10]}/${(p[18]||'').replace(/\n/g,' ')}]  ↔ 완료${f.done} [${d[3]}/${d[4]}/${d[8]}/${d[11]}] TO${d[5]} 예정${d[12]}`);
 }
 if(!WRITE){console.log('\n[DRY]');return;}
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A1:AC100`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_progress_completed_20260622.json'),JSON.stringify(bak,null,1));console.log('백업 완료');
 const data=[];FIX.forEach(f=>{data.push({range:`'${PTAB}'!N${f.r}`,values:[[F(f.done)]]});data.push({range:`'${PTAB}'!O${f.r}`,values:[[M(f.done)]]});});
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 await new Promise(r=>setTimeout(r,4000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!N17:O22`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('적용 후 r17 N/O:',JSON.stringify(chk[0]),' r22 N/O:',JSON.stringify(chk[5]));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
