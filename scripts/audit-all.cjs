/* 전수 엄격 audit: 진행상황 detail ↔ 채용요청(정규직)DB + 채용완료.
   4중 검증: (1)현재IMPORTRANGE소스 (2)올바른소스(팀+직무+근무지+입사자) (3)live값==소스TO/입사 (4)미배정소스/중복/orphan */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const PTAB='RAW DATA_채용진행상황(현재)';
const nm=x=>String(x==null?'':x).replace(/\s+/g,'').toLowerCase();
const nameOnly=x=>String(x==null?'':x).replace(/\d+\/\d+/g,'').replace(/[()]/g,'').replace(/[,\s]+/g,' ').trim();
const hasName=(a,b)=>{a=nameOnly(a);b=nameOnly(b);if(!a||!b)return false;const A=a.split(' ').filter(w=>w.length>=2),B=b.split(' ').filter(w=>w.length>=2);return A.some(w=>B.some(v=>v.includes(w)||w.includes(v)));};
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const db=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용요청(정규직)DB'!A2:Q63`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const pool=[];db.forEach((r,i)=>{const rn=i+2,team=r[4]||'',job=r[5]||'',jik=(r[11]||'').trim();if((!team&&!job)||jik==='직접')return;
   pool.push({src:'DB',rn,team,job,site:r[10]||'',ipsaja:r[13]||'',TO:String(r[6]??'').trim(),plan:String(r[14]??'').trim(),used:false});});
 const dc=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용완료'!A2:O20`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 dc.forEach((r,i)=>{const rn=i+2;if(!(r[3]||r[4]))return;
   pool.push({src:'완료',rn,team:r[3]||'',job:r[4]||'',site:r[8]||'',ipsaja:r[11]||'',TO:String(r[5]??'').trim(),plan:String(r[12]??'').trim(),used:false});});
 const fv=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V75`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const fm=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V75`,valueRenderOption:'FORMULA'})).data.values||[];
 const det=[];fv.forEach((r,i)=>{const rn=i+14;if(String(r[0]||'').match(/^[■▸]/)||!(r[6]||r[7]))return;
   const f=fm[i]||[];const nf=String(f[13]||'');
   let cs=null,cr=null;let m;
   if(m=nf.match(/채용요청\(정규직\)DB!G(\d+)/)){cs='DB';cr=+m[1];}
   else if(m=nf.match(/채용완료!F(\d+)/)){cs='완료';cr=+m[1];}
   det.push({rn,team:r[6]||'',job:r[7]||'',site:r[10]||'',ipsaja:r[18]||'',liveN:String(r[13]??'').trim(),liveO:String(r[14]??'').trim(),curSrc:cs,curRow:cr});});
 // 올바른 소스 결정 (greedy, 입사자 우선)
 det.forEach(d=>{let c=pool.filter(x=>!x.used&&nm(x.team)===nm(d.team)&&nm(x.job)===nm(d.job)&&nm(x.site)===nm(d.site));
   let pick=null,amb=false;
   if(c.length===1)pick=c[0];
   else if(c.length>1){const byn=c.filter(x=>hasName(x.ipsaja,d.ipsaja));pick=byn.length===1?byn[0]:(byn[0]||c[0]);amb=true;}
   else{const c2=pool.filter(x=>!x.used&&nm(x.team)===nm(d.team)&&nm(x.job)===nm(d.job));pick=c2[0]||null;if(pick)d.siteMis=true;}
   if(pick){pick.used=true;d.correct=pick;}});
 // 출력: 문제 행만 강조
 let ok=0,prob=[];
 det.forEach(d=>{const cor=d.correct;
   if(!cor){prob.push(`r${d.rn} [${d.team}/${d.job}/${d.site}] ❌소스 무매칭 (현재 ${d.curSrc||'-'}${d.curRow||''})`);return;}
   const srcOK = d.curSrc===cor.src && d.curRow===cor.rn;
   const valOK = d.liveN===cor.TO && d.liveO===cor.plan;
   if(srcOK&&valOK){ok++;return;}
   let msg=`r${d.rn} [${d.team}/${d.job}/${d.site}]`;
   if(!srcOK)msg+=` 🔴소스 현재${d.curSrc}${d.curRow}→올바름 ${cor.src}${cor.rn}`;
   if(!valOK)msg+=` 🔴값 live(${d.liveN}/${d.liveO})≠소스(${cor.TO}/${cor.plan})`;
   if(d.siteMis)msg+=' ⚠근무지불일치';
   prob.push(msg);});
 console.log(`=== 검증 결과: 정상 ${ok} / 총 ${det.length} ===`);
 console.log('\n--- 문제 행 ---');prob.length?prob.forEach(p=>console.log(p)):console.log('  없음 ✅');
 // 중복 소스
 const u={};det.forEach(d=>{if(d.correct){const k=d.correct.src+d.correct.rn;u[k]=(u[k]||0)+1;}});
 console.log('\n--- 소스 중복배정 ---');const dup=Object.entries(u).filter(([,n])=>n>1);console.log(dup.length?JSON.stringify(dup):'  없음 ✅');
 // 미배정 (= detail에 없는 채용)
 console.log('\n--- 활성DB 미배정 (신규로 추가해야) ---');pool.filter(x=>x.src==='DB'&&!x.used).forEach(x=>console.log(`  DB${x.rn} [${x.team}/${x.job}/${x.site}] TO${x.TO} 예정${x.plan}`));
 console.log('\n--- 채용완료 미배정 (완료로 추가해야) ---');pool.filter(x=>x.src==='완료'&&!x.used).forEach(x=>console.log(`  완료${x.rn} [${x.team}/${x.job}/${x.site}] 입사:${nameOnly(x.ipsaja)} TO${x.TO}`));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
