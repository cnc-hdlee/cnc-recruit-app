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
 const src=[]; const seen=new Set(); const allNames=new Set(); const lineTeamNames=new Set();
 const take=(all,소속)=>{ if(!all||!all.length)return; const H=all[0]||[];
   // 상태 컬럼: 도급직DB=M열'채용결과', 정규직DB=N열'입사여부' (컬럼명이 서로 다름). 순서대로 첫 매칭 사용.
   const cP=idx(H,['입사예정일']),cT=idx(H,['팀명']),cJ=idx(H,['직무']),cN=idx(H,['성명']),cLoc=idx(H,['근무지']),cG=idx(H,['직급']),cS=idx(H,['신입/경력']),cR=idx(H,['채용결과','입사여부']),cJW=idx(H,['지원일','서류접수일']),cNat=idx(H,['국적']),cPath=idx(H,['입사경로']);
   for(let i=1;i<all.length;i++){const r=all[i]||[];const 팀=(r[cT]||'').trim(),직무=(r[cJ]||'').trim(),성명=(r[cN]||'').trim();
     if(성명)allNames.add(성명); // 원본 전체 이름(팀/직무 무관)
     if(성명&&LINE.includes(팀))lineTeamNames.add(성명); // 생산라인 팀(1/2/3팀)에 이름 있음 — 직무 무관. 팀이 포장 등으로 나가야만 이탈로 판정
     if(성명&&LINE.includes(팀)&&직무==='생산'&&!seen.has(성명+'|'+소속)){seen.add(성명+'|'+소속); // 중복키=성명+소속: 에스텍/정규직 동시존재는 각각 유지, 같은 DB 내 동명중복만 합침
       const 근무지=(소속==='에스텍플러스'&&DOG_LOC[팀])?DOG_LOC[팀]:(r[cLoc]||'');
       const status=cR>=0?mapStat(r[cR]):'';
       const ipsaRaw=norm(r[cP]); const jwRaw=cJW>=0?norm(r[cJW]):'';
       src.push({소속,본부:'생산본부',팀,직무,직급:(r[cG]||'사원'),신입:(r[cS]||'신입'),성명,근무지,간접:'직접',status,ipsaRaw,jwRaw,국적:((cNat>=0?(r[cNat]||'').trim():'')||(소속==='㈜씨앤씨인터내셔널'?'내국인':'')),입사경로:((소속==='에스텍플러스')?'에스텍플러스':(cPath>=0?(r[cPath]||'').trim():''))});}}};
 take(reg,'㈜씨앤씨인터내셔널'); take(dog,'에스텍플러스');
 src.allNames=allNames; src.lineTeamNames=lineTeamNames;
 return src;
}
// 면접 소스 경로맵(형도 지원자 등 DB밖 인원용): 1TtCbTyZ '생산직 면접 내용' A열=경로, D열=이름. 이름(공백제거)→경로.
const MJ_SRC='1TtCbTyZ9XIItZ08APYNuYbxPppZHN3iAJGiWewmcJGw', MJ_TAB='생산직 면접 내용';
const strip=v=>String(v||'').replace(/\s/g,'').trim();
async function loadMyeonjeopPath(s){
 try{ const v=(await s.spreadsheets.values.get({spreadsheetId:MJ_SRC,range:`'${MJ_TAB}'!A1:D3000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
   const m=new Map(); for(let i=1;i<v.length;i++){const r=v[i]||[];const nm=strip(r[3]);const 경로=String(r[0]||'').trim();if(nm&&경로&&!m.has(nm))m.set(nm,경로);} return m;
 }catch(e){ console.error('면접경로 로드 실패(무시):',e.message); return new Map(); }
}
// 지원일 규칙(형도만): 채용결과=지원자면 소스 날짜(서류접수일 or 입사예정일칸)=지원일, 입사예정일(A) 공란.
// 비지원자·상현시트: 입사예정일→A, 지원일은 안 채움(지원자 전용). 남의 시트(상현)는 지원자 규칙 미적용.
const deriveDates=(x,isHD)=>{ if(isHD && x.status==='지원자') return {ipsa:'', jiwon:(x.jwRaw||x.ipsaRaw||'')}; return {ipsa:x.ipsaRaw, jiwon:''}; };

async function syncOne(s, ID, TAB, srcList, TD, mjPath){
 const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId,title))'});
 const prop=meta.data.sheets.find(x=>x.properties.title===TAB); if(!prop){console.log('  ('+ID.slice(0,8)+') "'+TAB+'" 탭 없음 — 건너뜀');return;}
 const sid=prop.properties.sheetId;
 const isHD=ID===HD_ID;
 const eff=st=>(st==='지원자'&&!isHD)?'':st;   // 상현 시트엔 지원자 안 씀
 let tv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A1:R2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
 let hr=tv.findIndex(r=>r&&r.join('|').includes('입사예정일')&&r.join('|').includes('성명'));
 if(hr<0){console.log('  ('+ID.slice(0,8)+') 헤더 못찾음 — 건너뜀');return;}
 const H=tv[hr]||[];
 const c={ipsa:idx(H,['입사예정일']),jiwon:idx(H,['지원일']),소속:idx(H,['소속']),본부:idx(H,['본부명']),팀:idx(H,['팀명']),직무:idx(H,['직무']),직급:idx(H,['직급']),신입:idx(H,['신입/경력']),성명:idx(H,['성명']),국적:idx(H,['국적']),근무지:idx(H,['근무지']),간접:idx(H,['직/간접구분','직/간접분류']),입사여부:idx(H,['입사여부']),입사경로:idx(H,['입사경로']),환산인원:idx(H,['환산인원']),비고:idx(H,['비고','비고(외국인)'])};
 if(c.성명<0||c.입사여부<0||c.ipsa<0){console.log('  ('+ID.slice(0,8)+') 필수컬럼 못찾음',JSON.stringify(c));return;}
 const first=hr+1;
 // 생산라인 이탈자 자동 제거: 원본에 이름은 있는데 생산1/2/3팀 기록이 하나도 없음 = 포장 등 다른 팀으로 이동 → 형도탭에서 제거. (직무만 바뀌고 팀은 생산라인 유지면 안 지움. 원본에 아예 없는 수기 인원도 보존)
 const lineTeamNames=srcList.lineTeamNames||new Set(); const allSrcNames=srcList.allNames||new Set();
 if(isHD){ const delIdx=[]; const cYb0=idx(H,['입사여부']); for(let i=first;i<tv.length;i++){const nm=(tv[i]&&tv[i][idx(H,['성명'])]||'').trim(); if(!nm)continue; const yb=(tv[i][cYb0]||'').trim();
     const offLine=!lineTeamNames.has(nm)&&allSrcNames.has(nm);   // 원본에 있으나 생산라인 이탈(포장 등)
     const ghost=(yb==='입사예정')&&!allSrcNames.has(nm);          // 예정인데 원본에 아예 없는 유령(한송희 케이스). 지원자/입사완료/입사취소는 이력이라 보존
     if(offLine||ghost)delIdx.push(i);}
   if(delIdx.length){ const who=delIdx.map(i=>tv[i][idx(H,['성명'])]).join(', ');
     if(DRY){ console.log('  ('+ID.slice(0,8)+') 이탈/유령 제거예정 '+delIdx.length+'명: '+who); }
     else { await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:delIdx.slice().sort((a,b)=>b-a).map(i=>({deleteDimension:{range:{sheetId:sid,dimension:'ROWS',startIndex:i,endIndex:i+1}}}))}});
       console.log('  ('+ID.slice(0,8)+') 생산라인 이탈/유령(예정無원본) 제거: '+who);
       tv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!A1:R2000`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[]; } } }
 // 매칭 키: 형도(isHD)는 성명+소속(에스텍/정규직 별도행 유지), 상현은 기존대로 성명. keep-first로 상현 동작 불변(정규직 우선).
 const K=(nm,so)=> isHD ? (String(nm||'').trim()+'|'+String(so||'').trim()) : String(nm||'').trim();
 const srcNames=new Set(srcList.map(x=>K(x.성명,x.소속)));
 const smap=new Map(); srcList.forEach(x=>{const k=K(x.성명,x.소속); if(eff(x.status)&&!smap.has(k))smap.set(k,eff(x.status));});
 const dmap=new Map(); srcList.forEach(x=>{const k=K(x.성명,x.소속); if(!dmap.has(k))dmap.set(k,deriveDates(x,isHD));});
 const pathmap=new Map(); srcList.forEach(x=>{const k=K(x.성명,x.소속); if(x.입사경로&&!pathmap.has(k))pathmap.set(k,x.입사경로);}); // 입사경로(정규직DB P열), 값 있는 것만
 const KOR=v=>(v==='대한민국'||v==='한국')?'내국인':v; // 국적 통일: 대한민국→내국인
 const natmap=new Map(); srcList.forEach(x=>{const k=K(x.성명,x.소속); if(x.국적&&!natmap.has(k))natmap.set(k,KOR(x.국적));}); // 국적(도급직DB H열), 대한민국은 내국인 표기
 const yb=일자=>{const d=norm(일자); if(!d) return isHD?'지원자':'입사예정'; return d<=TD?'입사완료':'입사예정';};
 const tmap=new Map(); let lastRow=first;
 for(let i=first;i<tv.length;i++){const r=tv[i];const nm=r&&(r[c.성명]||'').trim();if(nm){tmap.set(K(nm,r[c.소속]),{row:i+1});lastRow=i+1;}}
 const upd=[]; // {range,values,why}
 const PUT=(col,row,val,why)=>upd.push({range:`'${TAB}'!${colL(col)}${row}`,values:[[val]],why});
 // 기존 행 갱신
 for(let i=first;i<tv.length;i++){const r=tv[i];const nm=r&&(r[c.성명]||'').trim();if(!nm)continue;const key=K(nm,r[c.소속]);if(!srcNames.has(key))continue; // 수기 인원 절대 무변경
   const rowN=i+1, d=dmap.get(key), st=smap.get(key);
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
   // 국적: 형도 탭에만. 도급직DB 국적 + 정규직 공란은 '내국인' 기본값. 칸이 비었거나 '대한민국'일 때만 씀.
   //  → 그 외 형도님 수동수정값(태국/중국(F-5) 등)은 새로고침·재동기화돼도 절대 안 덮음(유지 보장).
   if(isHD && c.국적>=0){ const curNat=(r[c.국적]||'').trim(); const srcNat=natmap.get(key); if(srcNat&&(!curNat||curNat==='대한민국')) PUT(c.국적,rowN,srcNat,`${nm} 국적 ${curNat||'공란'}→${srcNat}`); }
   // 입사여부(M): 소스 상태 있으면 반영, 없으면 빈칸만 초기값
   if(smap.has(key)){ if(curSt!==st) PUT(c.입사여부,rowN,st,`${nm} 입사여부 ${curSt||'공란'}→${st}`); }
   else if(!curSt){ PUT(c.입사여부,rowN,yb(r[c.ipsa]),`${nm} 입사여부 공란→${yb(r[c.ipsa])}`); }
 }
 // 입사경로 종합(형도만): 에스텍=무조건 에스텍플러스(force), 그 외=정규직DB P열 > 면접소스 A열 순으로 빈칸일 때만 채움(수동 보호). 표기통일 CANON 적용. srcNames 밖 면접지원자도 포함.
 const CANON={'수원일자리센터':'수원시일자리센터','안성일자리센터':'안성시일자리센터'};
 if(isHD && c.입사경로>=0){ for(let i=first;i<tv.length;i++){const r=tv[i];const nm=r&&(r[c.성명]||'').trim();if(!nm)continue;
   const so=(r[c.소속]||'').trim(); const cur=(r[c.입사경로]||'').trim();
   if(so==='에스텍플러스'){ if(cur!=='에스텍플러스') PUT(c.입사경로,i+1,'에스텍플러스',`${nm} 입사경로(에스텍) ${cur||'공란'}→에스텍플러스`); }
   else { let want=pathmap.get(K(nm,so))||(mjPath&&mjPath.get(strip(nm)))||''; want=CANON[want]||want;
     if(want){ if(cur!==want) PUT(c.입사경로,i+1,want,`${nm} 입사경로 ${cur||'공란'}→${want}`); } // 소스 마스터: 소스값 있으면 항상 따라감(변경·삭제 전파, stale 제거)
     else if(cur&&CANON[cur]){ PUT(c.입사경로,i+1,CANON[cur],`${nm} 입사경로 통일 ${cur}→${CANON[cur]}`); } } } } // 소스 없는 수기인원=값 보존(표기통일만)
 // 형도: 입사예정일·지원일 둘 다 공란 & 입사여부 공란 → 지원자
 if(isHD){ for(let i=first;i<tv.length;i++){const r=tv[i];const nm=r&&(r[c.성명]||'').trim();if(!nm)continue;
   const a=norm(r[c.ipsa]), jw=c.jiwon>=0?(r[c.jiwon]||'').trim():'', cur=(r[c.입사여부]!=null&&String(r[c.입사여부]).trim())||'';
   if(!a&&!jw&&!cur) PUT(c.입사여부,i+1,'지원자',`${nm} 무날짜→지원자`); } }
 // 신규 인원 append (헤더 순서대로 배치)
 const add=srcList.filter(x=>!tmap.has(K(x.성명,x.소속)));
 let addRows=[];
 if(add.length && tmap.size>50 && add.length>15){ console.log(`  ⚠️ 추가대상 ${add.length}명 비정상(tmap ${tmap.size}) — 부분읽기 의심, append 건너뜀`); }
 else if(add.length){ const width=H.length;
   addRows=add.map(x=>{const d=deriveDates(x,isHD);const row=new Array(width).fill('');
     const set=(col,v)=>{if(col>=0&&col<width)row[col]=v;};
     set(c.ipsa,d.ipsa); set(c.jiwon,d.jiwon); set(c.소속,x.소속); set(c.본부,x.본부); set(c.팀,x.팀); set(c.직무,x.직무); set(c.직급,x.직급); set(c.신입,x.신입); set(c.성명,x.성명); set(c.근무지,x.근무지); set(c.간접,x.간접); set(c.국적, isHD?(natmap.get(K(x.성명,x.소속))||''):''); set(c.입사여부, eff(x.status)||yb(d.ipsa)); set(c.입사경로, x.입사경로||''); // 국적=형도만, 비고=공란(수동)
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
 // 환산인원(형도만): 새 행 포함 전체 데이터행에 per-row 수식 자동채움(값 아님·수식). 각 행이 자기 경로 입사율=완료/(완료+취소) 계산. INDIRECT로 정렬 안정.
 if(isHD && c.환산인원>=0){ const Nl=colL(c.입사경로),Ml=colL(c.입사여부),Ol=colL(c.환산인원);
   const nmv=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!${colL(c.성명)}1:${colL(c.성명)}2000`})).data.values||[];
   let lastD=first; for(let i=first;i<nmv.length;i++){ if(nmv[i]&&String(nmv[i][0]||'').trim()) lastD=i+1; }
   const rf=`=IFERROR(COUNTIFS($${Nl}:$${Nl},INDIRECT("${Nl}"&ROW()),$${Ml}:$${Ml},"입사완료")/(COUNTIFS($${Nl}:$${Nl},INDIRECT("${Nl}"&ROW()),$${Ml}:$${Ml},"입사완료")+COUNTIFS($${Nl}:$${Nl},INDIRECT("${Nl}"&ROW()),$${Ml}:$${Ml},"입사취소")),0)`;
   const startRow=first+1;
   // 수동 보호: 형도님이 직접 입력한 환산인원(숫자값)은 보존. 빈칸·기존 자동수식인 행만 자동수식으로 채움.
   const curO=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${TAB}'!${Ol}${startRow}:${Ol}${lastD}`,valueRenderOption:'FORMULA'})).data.values||[];
   const oform=[]; for(let r=startRow;r<=lastD;r++){ const cv=(curO[r-startRow]&&curO[r-startRow][0]); const cs=String(cv==null?'':cv).trim();
     oform.push([ (cs!=='' && !cs.startsWith('=')) ? cv : rf ]); }
   if(oform.length) await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${TAB}'!${Ol}${startRow}:${Ol}${lastD}`,valueInputOption:'USER_ENTERED',requestBody:{values:oform}}); }
 // 입사여부 드롭다운
 const ddList=isHD?['지원자','입사완료','입사예정','입사취소']:['입사완료','입사예정','입사취소'];
 await s.spreadsheets.batchUpdate({spreadsheetId:ID,requestBody:{requests:[{setDataValidation:{range:{sheetId:sid,startRowIndex:first,endRowIndex:Math.max(last,first)+300,startColumnIndex:c.입사여부,endColumnIndex:c.입사여부+1},rule:{condition:{type:'ONE_OF_LIST',values:ddList.map(x=>({userEnteredValue:x}))},showCustomUi:true,strict:false}}}]}});
 console.log(`  (${ID.slice(0,8)}) 적용완료`);
}

(async()=>{
 const s=await auth();
 const TD=today();
 const srcList=await buildSrc(s);
 const mjPath=await loadMyeonjeopPath(s);
 console.log((DRY?'[DRYRUN] ':'')+'소스 생산라인:',srcList.length,'명 (지원자 '+srcList.filter(x=>x.status==='지원자').length+') · 면접경로맵 '+mjPath.size+'명');
 for(const {ID,TAB} of TARGETS){ await syncOne(s, ID, TAB, srcList, TD, mjPath); }
 // 동기화 끝나면 지원자추이 스냅샷도 같이 갱신(오늘 행이 항상 형도와 일치하게). 실패해도 sync는 성공 처리.
 if(!DRY){ try{ require('child_process').execFileSync(process.execPath,[path.join(__dirname,'snapshot-jiwonja.cjs')],{stdio:'inherit'}); }catch(e){ console.error('snapshot 연동 실패:',e.message); } }
 console.log('DONE'+(DRY?' (DRYRUN, 미적용)':''));
})().catch(e=>{console.error('ERR:',e.message);if(e.errors)console.error(JSON.stringify(e.errors));process.exit(1)});
