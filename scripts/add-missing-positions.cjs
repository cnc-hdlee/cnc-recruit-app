/* 진행상황 detail에 미반영 20건(활성9+완료11) 추가. 소스 그대로 매핑.
   각 부문 섹션 끝에 행 삽입(부문 SUMIF 자동집계). 4~13행 불변. 백업 포함.
   node scripts/add-missing-positions.cjs --write */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const PTAB='RAW DATA_채용진행상황(현재)';const GID=660728561;const WRITE=process.argv.includes('--write');
const nm=x=>String(x==null?'':x).replace(/\s+/g,'').toLowerCase();
const nameOnly=x=>String(x==null?'':x).replace(/\d+\/\d+/g,'').replace(/[()]/g,'').replace(/[,\s]+/g,' ').trim();
const hasName=(a,b)=>{a=nameOnly(a);b=nameOnly(b);if(!a||!b)return false;const A=a.split(' ').filter(w=>w.length>=2),B=b.split(' ').filter(w=>w.length>=2);return A.some(w=>B.some(v=>v.includes(w)||w.includes(v)));};
const CENTER={'생산본부':'생산본부','생산기획부':'생산본부','품질경영본부':'생산본부','제조부':'생산본부','경영기획본부':'경영기획본부','people&culture실':'경영기획본부','People&culture실':'경영기획본부','영업본부':'영업본부','Makeup Center':'Makeup Center','Skin Science Center':'Skin Science Center','크리에이티브솔루션본부':'크리에이티브솔루션본부','CEO 직속':'CEO직속'};
const BUMUN={'생산본부':'COO','경영기획본부':'CFO','영업본부':'CBO','Makeup Center':'CRIO','Skin Science Center':'CRIO','크리에이티브솔루션본부':'크리에이티브솔루션','CEO직속':'CEO'};
const cen=o=>CENTER[o]||o; const bmn=c=>BUMUN[c]||c;
const irDB=(c,n)=>`=IMPORTRANGE("${HR}", "채용요청(정규직)DB!${c}${n}")`;
const irDONE=(c,n)=>`=IMPORTRANGE("${HR}", "채용완료!${c}${n}")`;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
(async()=>{const s=await auth();
 const db=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용요청(정규직)DB'!A2:Q63`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const pool=[];db.forEach((r,i)=>{const rn=i+2,team=r[4]||'',job=r[5]||'',jik=(r[11]||'').trim();if((!team&&!job)||jik==='직접')return;
   pool.push({type:'DB',rn,org1:r[2]||'',org2:r[3]||'',team,job,sayu:r[8]||'',sangse:r[9]||'',site:r[10]||'',hyun:r[12]||'',ipsaja:r[13]||'',pri:r[1]||'',used:false});});
 const dc=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`'채용완료'!A2:O20`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 dc.forEach((r,i)=>{const rn=i+2;if(!(r[3]||r[4]))return;
   pool.push({type:'완료',rn,org1:r[1]||'',org2:r[2]||'',team:r[3]||'',job:r[4]||'',sayu:r[6]||'',sangse:r[7]||'',site:r[8]||'',hyun:r[10]||'입사완료',ipsaja:r[11]||'',pri:'',used:false});});
 // 현재 detail에서 사용중 소스 제거(audit과 동일 매칭)
 const fv=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A14:V75`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const det=[];fv.forEach((r,i)=>{if(String(r[0]||'').match(/^[■▸]/)||!(r[6]||r[7]))return;det.push({team:r[6]||'',job:r[7]||'',site:r[10]||'',ipsaja:r[18]||''});});
 det.forEach(d=>{let c=pool.filter(x=>!x.used&&nm(x.team)===nm(d.team)&&nm(x.job)===nm(d.job)&&nm(x.site)===nm(d.site));
   let pick=c.length===1?c[0]:(c.length>1?(c.filter(x=>hasName(x.ipsaja,d.ipsaja))[0]||c[0]):pool.filter(x=>!x.used&&nm(x.team)===nm(d.team)&&nm(x.job)===nm(d.job))[0]);
   if(pick)pick.used=true;});
 const missing=pool.filter(x=>!x.used);
 // 부문 버킷
 const buckets={};missing.forEach(m=>{m.bumun=bmn(cen(m.org1));(buckets[m.bumun]=buckets[m.bumun]||[]).push(m);});
 console.log('미반영 합계:',missing.length);Object.entries(buckets).forEach(([b,a])=>console.log(`  ${b}: ${a.length}건 -`,a.map(x=>`${x.type}${x.rn}[${x.team}/${x.job}]`).join(', ')));

 // 섹션별 삽입(다음 ■헤더 원본행). 부문 detail 끝 = 그 다음 ■헤더 직전
 const SEC=[{b:'COO',next:33},{b:'CRIO',next:43},{b:'CBO',next:52},{b:'CFO',next:68}];
 let cum=0;const inserts=[];const writes=[];
 for(const sec of SEC){const items=buckets[sec.b]||[];if(!items.length)continue;
   const insIdx=(sec.next-1)+cum; // 0-based
   inserts.push({insertDimension:{range:{sheetId:GID,dimension:'ROWS',startIndex:insIdx,endIndex:insIdx+items.length},inheritFromBefore:true}});
   items.forEach((it,k)=>{const row=insIdx+1+k;writes.push({row,it});});
   cum+=items.length;
 }
 console.log('\n삽입 계획:',inserts.map(x=>`@${x.insertDimension.range.startIndex+1}+${x.insertDimension.range.endIndex-x.insertDimension.range.startIndex}`).join(', '));
 console.log('쓰기 행:',writes.map(w=>`r${w.row}=${w.it.type}${w.it.rn}`).join(', '));
 if(!WRITE){console.log('\n[DRY]');return;}
 const bak=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A1:AC120`,valueRenderOption:'FORMULA'})).data.values||[];
 fs.writeFileSync(path.join(__dirname,'backup_progress_add20_20260622.json'),JSON.stringify(bak,null,1));console.log('백업 완료',bak.length,'행');
 // 1) 행 삽입(한 batch, 위→아래 순서로 offset 반영됨)
 await s.spreadsheets.batchUpdate({spreadsheetId:PROG,requestBody:{requests:inserts}});
 // 2) 내용 기입
 const data=[];
 for(const w of writes){const it=w.it,r=w.row;const center=cen(it.org1);const silbu=(center===it.org1)?it.org2:it.org1;
   const a=Array(22).fill('');
   a[1]=`=IF(ISNUMBER(A${r}),IF($T${r}="",TODAY()-A${r},$T${r}-A${r}),"")`;
   a[2]=it.pri; a[3]=bmn(center); a[4]=center; a[5]=silbu; a[6]=it.team; a[7]=it.job; a[8]=it.sayu; a[9]=it.sangse; a[10]=it.site; a[11]='간접'; a[12]=it.hyun;
   a[13]= it.type==='DB'?irDB('G',it.rn):irDONE('F',it.rn);
   a[14]= it.type==='DB'?irDB('O',it.rn):irDONE('M',it.rn);
   a[15]=`=N${r}-O${r}`; a[16]=`=IFERROR(O${r}/N${r},0)`;
   a[17]=`=IF(AND(ISNUMBER(Q${r}),Q${r}>=1),"CLOSE","")`; a[18]=it.ipsaja;
   data.push({range:`'${PTAB}'!A${r}:V${r}`,values:[a]});
 }
 await s.spreadsheets.values.batchUpdate({spreadsheetId:PROG,requestBody:{valueInputOption:'USER_ENTERED',data}});
 console.log('20건 기입 완료. 재계산 대기...');
 await new Promise(r=>setTimeout(r,5000));
 const chk=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`'${PTAB}'!A3:Q95`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 console.log('\n=== ■부문 헤더(추가후) ===');
 chk.forEach((r,i)=>{if(String(r[0]||'').match(/^■/))console.log(`  r${i+3}: ${r[0]}`);});
})().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
