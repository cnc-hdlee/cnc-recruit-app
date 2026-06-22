/* 진행상황 detail(14행~)을 현재 채용요청(정규직)DB + 채용완료에 재싱크.
   팀+직무+근무지+입사자 매칭으로 각 행의 N/O IMPORTRANGE를 올바른 소스행으로 재기입.
   DB가 수정돼 위치가 밀릴 때마다 재실행. 4~13행 불변. node scripts/resync-detail.cjs --write */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const PTAB='RAW DATA_채용진행상황(현재)';const WRITE=process.argv.includes('--write');
const nm=x=>String(x==null?'':x).replace(/\s+/g,'').toLowerCase();
const nameOnly=x=>String(x==null?'':x).replace(/\d+\/\d+/g,'').replace(/[()]/g,'').replace(/[,\s]+/g,' ').trim();
const hasName=(a,b)=>{a=nameOnly(a);b=nameOnly(b);if(!a||!b)return false;const A=a.split(' ').filter(w=>w.length>=2),B=b.split(' ').filter(w=>w.length>=2);return A.some(w=>B.some(v=>v.includes(w)||w.includes(v)));};
const dbN=n=>`=IMPORTRANGE("${HR}", "채용요청(정규직)DB!G${n}")`, dbO=n=>`=IMPORTRANGE("${HR}", "채용요청(정규직)DB!O${n}")`;
const dcN=n=>`=IMPORTRANGE("${HR}", "채용완료!F${n}")`, dcO=n=>`=IMPORTRANGE("${HR}", "채용완료!M${n}")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const db=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용요청(정규직)DB'!A2:Q70`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const pool=[];db.forEach((r,i)=>{const rn=i+2,team=r[4]||'',job=r[5]||'',jik=(r[11]||'').trim();const lab=String(r[0]||'');
   if((!team&&!job)||jik==='직접'||/합계|소계|면접|cpi|처우|품의|확정|보류|^ㅁ/i.test(lab))return;
   pool.push({type:'DB',rn,team,job,site:r[10]||'',ipsaja:r[13]||'',used:false});});
 const dc=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용완료'!A2:O25`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 dc.forEach((r,i)=>{const rn=i+2;if(!(r[3]||r[4]))return;pool.push({type:'완료',rn,team:r[3]||'',job:r[4]||'',site:r[8]||'',ipsaja:r[11]||'',used:false});});
 const fv=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V95`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const fm=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V95`,valueRenderOption:'FORMULA'})).data.values||[];
 const det=[];fv.forEach((r,i)=>{const rn=i+14;if(String(r[0]||'').match(/^[■▸]/)||!(r[6]||r[7]))return;
   const f=fm[i]||[];const cur=String(f[13]||'');det.push({rn,team:r[6]||'',job:r[7]||'',site:r[10]||'',ipsaja:r[18]||'',cur});});
 det.forEach(d=>{let c=pool.filter(x=>!x.used&&nm(x.team)===nm(d.team)&&nm(x.job)===nm(d.job)&&nm(x.site)===nm(d.site));
   let pick=c.length===1?c[0]:(c.length>1?(c.filter(x=>hasName(x.ipsaja,d.ipsaja))[0]||c[0]):pool.filter(x=>!x.used&&nm(x.team)===nm(d.team)&&nm(x.job)===nm(d.job))[0]);
   if(pick){pick.used=true;d.m=pick;}});
 // 변경 필요한 행만
 const data=[];const changes=[];
 det.forEach(d=>{if(!d.m){changes.push(`r${d.rn} [${d.team}/${d.job}] ❌무매칭→비움`);data.push({range:`'${PTAB}'!N${d.rn}`,values:[['']]},{range:`'${PTAB}'!O${d.rn}`,values:[['']]});return;}
   const wantN=d.m.type==='DB'?dbN(d.m.rn):dcN(d.m.rn);const wantO=d.m.type==='DB'?dbO(d.m.rn):dcO(d.m.rn);
   if(d.cur!==wantN){changes.push(`r${d.rn} [${d.team}/${d.job}] → ${d.m.type}${d.m.rn}`);
     data.push({range:`'${PTAB}'!N${d.rn}`,values:[[wantN]]},{range:`'${PTAB}'!O${d.rn}`,values:[[wantO]]});}});
 console.log(`재싱크 필요: ${changes.length}행`);changes.forEach(c=>console.log('  '+c));
 if(!WRITE){console.log('[DRY]');return;}
 if(!changes.length){console.log('변경 없음 — 이미 일치');return;}
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A1:AC100`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_resync_20260622.json'),JSON.stringify(bak,null,1));
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 console.log('재싱크 완료. 검증...');await new Promise(r=>setTimeout(r,4000));
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
