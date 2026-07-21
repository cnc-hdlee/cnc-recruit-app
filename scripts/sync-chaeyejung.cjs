// 입사예정(형도)/채용예정 동기화 — 헤더명 기반 컬럼 탐지(컬럼 삽입/이동/이름변경에 안전). 비파괴.
// 소스: 1CS2 입사예정(정규직/도급직)DB, 생산1/2/3팀 & 직무=생산.
// 지원일 규칙(형도만): 채용결과=지원자면 소스 날짜(입사예정일 or 서류접수일)를 형도 '지원일'(B)에, '입사예정일'(A)은 공란. 비지원자는 입사예정일→A.
// DRYRUN=1 이면 쓰기 안 하고 변경예정만 출력.
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const DRY=process.env.DRYRUN==='1';
async function auth(){const t=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(t.clientId,t.clientSecret);o.setCredentials({refresh_token:t.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const SRC='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const TARGETS=[
 {ID:'1QEvFEWjnXC1CNw6qAZ4ooFQUIxh36ow_9EL3hnM6ZoI', TAB:'입사예정(형도)'}, // 형도 (지원일 컬럼 있음)
 {ID:'1LGwwI6917vhONjXNqhgfibgrK6gUwzYWzDuRuVZyUqc', TAB:'채용예정'},        // 상현 (지원일 없음, 옛 구조 — 안 건드림)
];
const HD_ID='1QEvFEWjnXC1CNw6qAZ4ooFQUIxh36ow_9EL3hnM6ZoI';
const LINE=['생산1팀','생산2팀','생산3팀'];
const DOG_LOC={'생산1팀':'퍼플','생산2팀':'그린','생산3팀':'3공장'};
const norm=d=>{const t=String(d||'').trim();if(!t)return '';const m=t.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;return t.slice(0,10);};
const today=()=>new Date().toISOString().slice(0,10);
const mapStat=v=>{const t=String(v||'').trim();if(t==='입사포기')return '입사취소';if(['지원자','입사예정','입사완료','입사취소'].includes(t))return t;return '';};
const idx=(H,names)=>{for(const n of names){const i=(H||[]).findIndex(x=>String(x||'').replace(/\s/g,'')===n);if(i>=0)return i;}return -1;};
const colL=i=>{let s='',x=i+1;while(x>0){const m=(x-1)%26;s=String.fromCharCode(65+m)+s;x=Math.floor((x-1)/26);}return s;};

async function buildSrc(s){
 const grab=async r=>(await s.spreadsheets.values.get({spreadsheetId:SRC,range:r,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 const reg=await grab("'입사예정(정규직)DB'!A1:R"), dog=await grab("'입사예정(도급직)DB'!A1:R");
 const src=[]; const seen=new Set();
 const take=(all,소속)=>{ if(!all||!all.length)return; const H=all[0]||[];
   const cP=idx(H,['입사예정일']),cT=idx(H,['팀명']),cJ=idx(H,['직무']),cN=idx(H,['성명']),cLoc=idx(H,['근무지']),cG=idx(H,['직급']),cS=idx(H,['신입/경력']),cR=idx(H,['채용결과']),cJW=idx(H,['지원일','서류접수일']),cNat=idx(H,['국적']);
   for(let i=1;i<all.length;i++){const r=all[i]||[];const 팀=(r[cT]||'').trim(),직무=(r[cJ]||'').trim(),성명=(r[cN]||'').trim();
     if(성명&&LINE.includes(팀)&&직무==='생산'&&!seen.has(성명)){seen.add(성명);
       const 근무지=(소속==='에스텍플러스'&&DOG_LOC[팀])?DOG_LOC[팀]:(r[cLoc]||'');
       const status=cR>=0?mapStat(r[cR]):'';
       const ipsaRaw=norm(r[cP]); const jwRaw=cJW>=0?norm(r[cJW]):'';
       src.push({소속,본부:'생산본부',팀,직무,직급:(r[cG]||'사원'),신입:(r[cS]||'신입'),성명,근무지,간접:'직접',status,ipsaRaw,jwRaw,국적:(cNat>=0?(r[cNat]||'').trim():'')});}}};
 take(reg,'㈜씨앤씨인터내셔널'); take(dog,'에스텍플러스');
 return src;
}
// 지원일 규칙(형도만): 채용결과=지원자면 소스 날짜(서류접수일 or 입사예정일칸)=지원일, 입사예정일(A) 공란.
// 비지원자·상현시트: 입사예정일→A, 지원일은 안 채움(지원자 전용). 남의 시트(상현)는 지원자 규칙 미적용.
const deriveDates=(x,isHD)=>{ if(isHD && x.status==='지원자') return {ipsa:'', jiwon:(x.jwRaw||x.ipsaRaw||'')}; return {ipsa:x.ipsaRaw, jiwon:''}; };

async function syncOne(s, ID, TAB, srcList, TD){
 const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title))'});
 const prop=meta.data.sheets.find(x=>x.properties.title===TAB); if(!prop){console.log('  ('+ID.slice(0,8)+') "'+TAB+'" 탭 없음 — 건너뜀');return;}
 const sid=prop.properties.sheetId;
 const isHD=ID===HD_ID;
 const eff=st=>(st==='지원자'&&!isHD)?'':st;   // 상현 시트엔 지원자 안 씀
 let tv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A1:R2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 let hr=tv.findIndex(r=>r&&r.join('|').includes('입사예정일')&&r.join('|').includes('성명'));
 if(hr<0){console.log('  ('+ID.slice(0,8)+') 헤더 못찾음 — 건너뜀');return;}
 const H=tv[hr]||[];
 const c={ipsa:idx(H,['입사예정일']),jiwon:idx(H,['지원일']),소속:idx(H,['소속']),본부:idx(H,['본부명']),팀:idx(H,['팀명']),직무:idx(H,['직무']),직급:idx(H,['직급']),신입:idx(H,['신입/경력']),성명:idx(H,['성명']),국적:idx(H,['국적']),근무지:idx(H,['근무지']),간접:idx(H,['직/간접구분','직/간접분류']),입사여부:idx(H,['입사여부']),비고:idx(H,['비고','비고(외국인)'])};
 if(c.성명<0||c.입사여부<0||c.ipsa<0){console.log('  ('+ID.slice(0,8)+') 필수컬럼 못찾음',JSON.stringify(c));return;}
 const first=hr+1;
 const srcNames=new Set(srcList.map(x=>x.성명));
 const smap=new Map(srcList.filter(x=>eff(x.status)).map(x=>[x.성명,eff(x.status)]));
 const dmap=new Map(srcList.map(x=>[x.성명,deriveDates(x,isHD)]));
 const KOR=v=>(v==='대한민국'||v==='한국')?'내국인':v; // 국적 통일: 대한민국→내국인
 const natmap=new Map(srcList.filter(x=>x.국적).map(x=>[x.성명,KOR(x.국적)])); // 국적(도급직DB H열), 대한민국은 내국인 표기
 const yb=일자=>{const d=norm(일자); if(!d) return isHD?'지원자':'입사예정'; return d<=TD?'입사완료':'입사예정';};
 const tmap=new Map(); let lastRow=first;
 for(let i=first;i<tv.length;i++){const r=tv[i];const nm=r&&(r[c.성명]||'').trim();if(nm){tmap.set(nm,{row:i+1});lastRow=i+1;}}
 const upd=[]; // {range,values,why}
 const PUT=(col,row,val,why)=>upd.push({range:`'${TAB}'!${colL(col)}${row}`,values:[[val]],why});
 // 기존 행 갱신
 for(let i=first;i<tv.length;i++){const r=tv[i];const nm=r&&(r[c.성명]||'').trim();if(!nm)continue;if(!srcNames.has(nm))continue; // 수기 인원 절대 무변경
   const rowN=i+1, d=dmap.get(nm), st=smap.get(nm);
   const curIpsa=norm(r[c.ipsa]);
   const curJw=c.jiwon>=0?(r[c.jiwon]||'').trim():'';
   const curLoc=(r[c.근무지]||'').trim();
   const curSt=(r[c.입사여부]!=null&&String(r[c.입사여부]).trim())||'';
   // 입사예정일(A): 지원자면 공란유지(값 있으면 비움), 비지원자면 소스날짜로
   if(eff(st)==='지원자'){ if(curIpsa) PUT(c.ipsa,rowN,'',`${nm} 지원자→입사예정일 비움`); }
   else if(d.ipsa && curIpsa!==d.ipsa){ PUT(c.ipsa,rowN,d.ipsa,`${nm} 입사예정일 ${curIpsa||'공란'}→${d.ipsa}`); }
   // 지원일(B): 형도만, 지원자 날짜 채움(소스에 있을 때만, 빈값으로 안 덮음)
   if(c.jiwon>=0 && d.jiwon && curJw!==d.jiwon){ PUT(c.jiwon,rowN,d.jiwon,`${nm} 지원일 ${curJw||'공란'}→${d.jiwon}`); }
   // 근무지 표준화(에스텍 팀별)
   const 소속t=(r[c.소속]||'').trim(),팀t=(r[c.팀]||'').trim();
   if(소속t.includes('에스텍')&&DOG_LOC[팀t]&&curLoc!==DOG_LOC[팀t]) PUT(c.근무지,rowN,DOG_LOC[팀t],`${nm} 근무지→${DOG_LOC[팀t]}`);
   // 국적: 형도 탭에만, 소스(도급직DB)에 있고 대상 국적칸이 비었을 때만 채움 — 수동입력 보존(비파괴)
   if(isHD && c.국적>=0){ const curNat=(r[c.국적]||'').trim(); const srcNat=natmap.get(nm); if(srcNat&&(!curNat||curNat==='대한민국')) PUT(c.국적,rowN,srcNat,`${nm} 국적 ${curNat||'공란'}→${srcNat}`); }
   // 입사여부(M): 소스 상태 있으면 반영, 없으면 빈칸만 초기값
   if(smap.has(nm)){ if(curSt!==st) PUT(c.입사여부,rowN,st,`${nm} 입사여부 ${curSt||'공란'}→${st}`); }
   else if(!curSt){ PUT(c.입사여부,rowN,yb(r[c.ipsa]),`${nm} 입사여부 공란→${yb(r[c.ipsa])}`); }
 }
 // 형도: 입사예정일·지원일 둘 다 공란 & 입사여부 공란 → 지원자
 if(isHD){ for(let i=first;i<tv.length;i++){const r=tv[i];const nm=r&&(r[c.성명]||'').trim();if(!nm)continue;
   const a=norm(r[c.ipsa]), jw=c.jiwon>=0?(r[c.jiwon]||'').trim():'', cur=(r[c.입사여부]!=null&&String(r[c.입사여부]).trim())||'';
   if(!a&&!jw&&!cur) PUT(c.입사여부,i+1,'지원자',`${nm} 무날짜→지원자`); } }
 // 신규 인원 append (헤더 순서대로 배치)
 const add=srcList.filter(x=>!tmap.has(x.성명));
 let addRows=[];
 if(add.length && tmap.size>50 && add.length>15){ console.log(`  ⚠️ 추가대상 ${add.length}명 비정상(tmap ${tmap.size}) — 부분읽기 의심, append 건너뜀`); }
 else if(add.length){ const width=H.length;
   addRows=add.map(x=>{const d=deriveDates(x,isHD);const row=new Array(width).fill('');
     const set=(col,v)=>{if(col>=0&&col<width)row[col]=v;};
     set(c.ipsa,d.ipsa); set(c.jiwon,d.jiwon); set(c.소속,x.소속); set(c.본부,x.본부); set(c.팀,x.팀); set(c.직무,x.직무); set(c.직급,x.직급); set(c.신입,x.신입); set(c.성명,x.성명); set(c.근무지,x.근무지); set(c.간접,x.간접); set(c.국적, isHD?(natmap.get(x.성명)||''):''); set(c.입사여부, eff(x.status)||yb(d.ipsa)); // 국적=형도만, 비고=공란(수동)
     return row;}); }
 // ── 출력/적용 ──
 console.log(`  (${ID.slice(0,8)}) ${TAB}: 갱신예정 ${upd.length} · 추가예정 ${addRows.length} · 보존 ${tmap.size}`);
 if(DRY){ upd.slice(0,40).forEach(u=>console.log('    ~ '+u.why)); if(upd.length>40)console.log('    ...('+(upd.length-40)+' more)'); addRows.forEach(r=>console.log('    + '+r[c.성명])); return; }
 // 실제 적용
 if(upd.length){ for(let k=0;k<upd.length;k+=200){ await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data:upd.slice(k,k+200).map(u=>({range:u.range,values:u.values}))}}); } }
 if(addRows.length){ await s.spreadsheets.values.append({spreadsheetId:ID,range:`'${TAB}'!${colL(c.ipsa)}${lastRow}`,valueInputOption:'USER_ENTERED',insertDataOption:'INSERT_ROWS',requestBody:{values:addRows}}); }
 // 정렬(입사예정일 A 기준 오름차순)
 const av=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!${colL(c.ipsa)}1:${colL(c.ipsa)}2000`})).data.values||[];
 let last=first; for(let i=first;i<av.length;i++){ if(av[i]&&av[i][0]) last=i+1; }
 if(last>first+1) await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{sortRange:{range:{sheetId:sid,startRowIndex:first,endRowIndex:last,startColumnIndex:0,endColumnIndex:H.length},sortSpecs:[{dimensionIndex:c.ipsa,sortOrder:'ASCENDING'}]}}]}});
 // 입사여부 드롭다운
 const ddList=isHD?['지원자','입사완료','입사예정','입사취소']:['입사완료','입사예정','입사취소'];
 await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{setDataValidation:{range:{sheetId:sid,startRowIndex:first,endRowIndex:Math.max(last,first)+300,startColumnIndex:c.입사여부,endColumnIndex:c.입사여부+1},rule:{condition:{type:'ONE_OF_LIST',values:ddList.map(x=>({userEnteredValue:x}))},showCustomUi:true,strict:false}}}]}});
 console.log(`  (${ID.slice(0,8)}) 적용완료`);
}

(async()=>{
 const s=await auth();
 const TD=today();
 const srcList=await buildSrc(s);
 console.log((DRY?'[DRYRUN] ':'')+'소스 생산라인:',srcList.length,'명 (지원자 '+srcList.filter(x=>x.status==='지원자').length+')');
 for(const {ID,TAB} of TARGETS){ await syncOne(s, ID, TAB, srcList, TD); }
 // 동기화 끝나면 지원자추이 스냅샷도 같이 갱신(오늘 행이 항상 형도와 일치하게). 실패해도 sync는 성공 처리.
 if(!DRY){ try{ require('child_process').execFileSync(process.execPath,[path.join(__dirname,'snapshot-jiwonja.cjs')],{stdio:'inherit'}); }catch(e){ console.error('snapshot 연동 실패:',e.message); } }
 console.log('DONE'+(DRY?' (DRYRUN, 미적용)':''));
})().catch(e=>{console.error('ERR:',e.message);if(e.errors)console.error(JSON.stringify(e.errors));process.exit(1)});
