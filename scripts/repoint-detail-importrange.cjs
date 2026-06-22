/* 진행상황(현재) 14행+ detail의 N(=DB!G)·O(=DB!O) IMPORTRANGE를 현재 채용요청(정규직)DB의
   올바른 행으로 재배치. 팀+직무 유일매칭(중복은 입사자/순서). 무매칭(삭제예정)은 N·O 비움(중복방지).
   4~13행 라인블록은 절대 안 건드림. 행 삽입/삭제 없음.
   사용: node scripts/repoint-detail-importrange.cjs        (DRY)
        node scripts/repoint-detail-importrange.cjs --write */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const PTAB='RAW DATA_채용진행상황(현재)';const WRITE=process.argv.includes('--write');
const norm=x=>String(x==null?'':x).replace(/\s+/g,'').toLowerCase();
const irG=n=>`=IMPORTRANGE("${HR}", "채용요청(정규직)DB!G${n}")`;
const irO=n=>`=IMPORTRANGE("${HR}", "채용요청(정규직)DB!O${n}")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const db=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용요청(정규직)DB'!A2:Q63`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const dbRows=[];db.forEach((r,i)=>{const rn=i+2,team=r[4]||'',job=r[5]||'',jik=(r[11]||'').trim();
   if(!team&&!job)return; if(jik==='직접')return;
   dbRows.push({rn,team,job,ipsaja:r[13]||'',key:norm(team)+'|'+norm(job),used:false});});
 const fv=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V75`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const fm=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V75`,valueRenderOption:'FORMULA'})).data.values||[];
 const det=[];fv.forEach((r,i)=>{const rn=i+14;if(String(r[0]||'').match(/^[■▸]/)||!(r[6]||r[7]))return;
   const f=fm[i]||[];const m=String(f[13]||'').match(/!G(\d+)/);
   det.push({rn,team:r[6]||'',job:r[7]||'',ipsaja:r[18]||'',curG:m?+m[1]:null,key:norm(r[6])+'|'+norm(r[7])});});
 det.forEach(d=>{const c=dbRows.filter(x=>x.key===d.key&&!x.used);if(!c.length){d.match=null;return;}
   const p=c.find(x=>norm(x.ipsaja)&&norm(d.ipsaja)&&norm(x.ipsaja).includes(norm(d.ipsaja).slice(0,4)))||c[0];p.used=true;d.match=p;});
 // 안전: 4~13행 절대 포함 안 됨 확인
 if(det.some(d=>d.rn<14)){console.error('STOP: 14행 미만 포함됨');process.exit(1);}
 const data=[];let repoint=0,clear=0;
 det.forEach(d=>{if(d.match){data.push({range:`'${PTAB}'!N${d.rn}`,values:[[irG(d.match.rn)]]});data.push({range:`'${PTAB}'!O${d.rn}`,values:[[irO(d.match.rn)]]});if(d.curG!==d.match.rn)repoint++;}
   else{data.push({range:`'${PTAB}'!N${d.rn}`,values:[['']]});data.push({range:`'${PTAB}'!O${d.rn}`,values:[['']]});clear++;}});
 console.log(`재배치 대상: ${repoint}행, 비움(삭제예정): ${clear}행, 셀 업데이트: ${data.length}개`);
 console.log('비움 행:',det.filter(d=>!d.match).map(d=>`r${d.rn}(${d.team}/${d.job})`).join(', '));
 if(!WRITE){console.log('\n[DRY] --write 시 적용');return;}
 // 백업
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A1:AC100`,valueRenderOption:'FORMULA'})).data.values||[];
 const bf=path.join(__dirname,'backup_progress_detail_20260622b.json');fs.writeFileSync(bf,JSON.stringify(bak,null,1));
 console.log('백업:',path.basename(bf),bak.length,'행');
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 console.log('적용 완료. 재계산 대기...');
 await new Promise(r=>setTimeout(r,5000));
 // 검증: 다시 읽어 매핑 일치 확인
 const fm2=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V75`,valueRenderOption:'FORMULA'})).data.values||[];
 let bad=0;det.forEach(d=>{const i=d.rn-14;const f=fm2[i]||[];const m=String(f[13]||'').match(/!G(\d+)/);const g=m?+m[1]:null;
   const want=d.match?d.match.rn:null;if((d.match&&g!==want)||(!d.match&&g!==null))bad++;});
 console.log(bad?`⚠ 검증 불일치 ${bad}행`:'✅ 검증 통과: 전 행 IMPORTRANGE 올바름');
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
