// 매일 09:00 - 본부별 상세(Openings/Hired/Residue/FillRate) + 전체 트렌드 스냅샷
// 대상: 본부별 채용현황판 1HViqfG / Summary 탭(gid 7607122)
// 표: K3 제목 / K4 그룹헤더 / K5 항목헤더 / K6~ 데이터(아래로 누적)
// 열: K=날짜  경영기획(L~O) 영업(P~S) 생산(T~W) 연구소(X~AA) 전체(AB~AE)  각 그룹 = Op,Hi,Re,FR
// 값 출처: Summary 좌측표를 '이름/헤더'로 찾아 추출(위치 이동에 강함). 17행~ 김범준 표는 안 건드림
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const F='1HViqfG68untk-fx_CA_qdSgn_-N9oZXzrz3hRYFIQcw';
const SUM='Summary', SID=7607122, DATA_START=6; // 데이터 첫 행
async function auth(){const t=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(t.clientId,t.clientSecret);o.setCredentials({refresh_token:t.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const serial=(y,m,d)=>Math.floor((Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000);
const N=v=>{if(v===''||v==null)return '';const n=Number(v);return isFinite(n)?n:'';};
const norm=v=>String(v==null?'':v).replace(/\s/g,'');
function extract(rows){
 let total=null, div={};
 for(let i=0;i<rows.length;i++){const r=rows[i]||[];
   if(norm(r[2])==='Openings'){const nx=rows[i+1]||[];total={op:N(nx[2]),hi:N(nx[3]),re:N(nx[4]),fr:N(nx[5])};}
   if(norm(r[2])==='Division'){
     for(let j=i+1;j<rows.length;j++){const d=rows[j]||[];const nm=norm(d[2]);
       if(!nm)break; if(!nm.includes('본부')&&nm!=='연구소')break;
       div[nm]={op:N(d[3]),hi:N(d[4]),re:N(d[5]),fr:N(d[6])};}
   }
 }
 return {total,div};
}
(async()=>{
 const s=await auth();
 // 1) 값 추출(이름 기반)
 const rows=(await s.spreadsheets.values.get({spreadsheetId:F,range:`'${SUM}'!A1:H80`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
 const {total,div}=extract(rows);
 if(!total){console.log('ERR 전체 KPI 못찾음(레이아웃 변경?) — 기록 중단');process.exit(1);}
 const G=n=>div[norm(n)]||{op:'',hi:'',re:'',fr:''};
 const blk=o=>[o.op,o.hi,o.re,o.fr];
 // 2) 오늘 날짜
 const now=new Date();const y=now.getFullYear(),m=now.getMonth()+1,d=now.getDate();
 const todaySerial=serial(y,m,d);
 const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 const rowVals=[iso,...blk(G('경영기획본부')),...blk(G('영업본부')),...blk(G('생산본부')),...blk(G('연구소')),...blk(total)];
 // 3-0) self-heal: 과거/중복 날짜 행 제거(첫 등장만 유지) → "하루 1줄" 영구 보장. K~AE만 손댐(왼쪽표·17행 김범준표 무관)
 {
   const kae=(await s.spreadsheets.values.get({spreadsheetId:F,range:`'${SUM}'!K${DATA_START}:AE400`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
   const best=new Map(), order=[]; let nonEmpty=0; const cnt=r=>r.filter(x=>x!==''&&x!=null).length;
   for(const r of kae){ if(!r||r[0]===''||r[0]==null) break; nonEmpty++; const dv=Math.round(Number(r[0]));
     if(!best.has(dv)){ best.set(dv,r); order.push(dv); } else if(cnt(r)>cnt(best.get(dv))){ best.set(dv,r); } }
   const keep=order.map(dv=>best.get(dv));
   if(keep.length<nonEmpty){
     const rows=keep.map(r=>{const a=r.slice(0,21); while(a.length<21)a.push(''); return a;});
     await s.spreadsheets.values.update({spreadsheetId:F,range:`'${SUM}'!K${DATA_START}:AE${DATA_START+rows.length-1}`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
     await s.spreadsheets.values.clear({spreadsheetId:F,range:`'${SUM}'!K${DATA_START+rows.length}:AE400`});
     console.log('self-heal: 중복 날짜 정리 '+nonEmpty+' -> '+keep.length);
   }
 }
 // 3) 연속 블록 append(첫 빈칸). 오늘 이미 있으면 갱신. 아래 딴 표(17행~) 무시
 const kcol=(await s.spreadsheets.values.get({spreadsheetId:F,range:`'${SUM}'!K${DATA_START}:K400`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values||[];
 let targetRow=-1, nextRow=DATA_START;
 for(let i=0;i<kcol.length;i++){
   const v=(kcol[i]||[])[0];
   if(v===''||v==null){nextRow=DATA_START+i;break;}
   if(Math.round(Number(v))===todaySerial){targetRow=DATA_START+i;break;}
   nextRow=DATA_START+i+1;
 }
 const writeRow=targetRow>0?targetRow:nextRow;
 await s.spreadsheets.values.update({spreadsheetId:F,range:`'${SUM}'!K${writeRow}:AE${writeRow}`,valueInputOption:'USER_ENTERED',requestBody:{values:[rowVals]}});
 // 4) 테두리 확장
 await s.spreadsheets.batchUpdate({spreadsheetId:F,requestBody:{requests:[
   {updateBorders:{range:{sheetId:SID,startRowIndex:2,endRowIndex:writeRow,startColumnIndex:10,endColumnIndex:31},top:{style:'SOLID',color:{red:0.6,green:0.6,blue:0.6}},bottom:{style:'SOLID',color:{red:0.6,green:0.6,blue:0.6}},left:{style:'SOLID',color:{red:0.6,green:0.6,blue:0.6}},right:{style:'SOLID',color:{red:0.6,green:0.6,blue:0.6}},innerHorizontal:{style:'SOLID',color:{red:0.85,green:0.85,blue:0.85}},innerVertical:{style:'SOLID',color:{red:0.85,green:0.85,blue:0.85}}}}
 ]}});
 console.log(`기록: ${iso} -> K${writeRow}${targetRow>0?'(갱신)':'(신규)'} | 전체FR ${total.fr} | ${JSON.stringify(rowVals)}`);
 if(writeRow>=16)console.log('경고: 17행 김범준 표에 근접 — 자리 조정 필요');
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
