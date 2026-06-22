/* 채용진행상황(현재) → 채용요청(정규직)DB 100% 정렬 (1회성).
 * - 채용필요(O)=DB 요청인원, 입사예정(P)=DB 입사예정. 부자재 중복은 첫행만 값·나머지 0.
 * - 생산1/2팀 IMPORTRANGE → DB 정적값 고정. 완료 3행(충전QC/RA/총무)·SCM·영상편집은 O/P 보존.
 * - Q(잔여)=O-P, R(달성률)=IFERROR(P/O,0) 수식. ■부문 헤더 = 라이브 수식. P2 헤더="입사예정인원".
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',REQ='RAW DATA_채용진행상황(현재)';
const HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const C=x=>String(x==null?'':x).trim();
const norm=x=>C(x).replace(/\s+/g,'').toLowerCase();
const key=(t,j)=>norm(t)+'|'+norm(j);
const NUM=x=>parseFloat(C(x).replace(/[^0-9.-]/g,''))||0;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

function buHeaderFormula(bu){
  const R='$E$4:$E$80',O='$O$4:$O$80',P='$P$4:$P$80';
  const so=`SUMIF(${R},"${bu}",${O})`,sp=`SUMIF(${R},"${bu}",${P})`;
  return `="■ ${bu}    (채용필요 "&${so}&"명 · 입사예정 "&${sp}&"명 · 잔여 "&(${so}-${sp})&"명 · 달성률 "&TEXT(IFERROR(${sp}/${so},0),"0.0%")&")"`;
}

async function main(){
  const s=await auth();
  // DB 정규직 map
  const db=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`채용요청(정규직)DB!A2:O56`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const dbmap={};let dbReq=0,dbYe=0;
  db.forEach(r=>{const tm=C(r[4]),jb=C(r[5]);if(!tm&&!jb)return;const g=NUM(r[6]),ye=NUM(r[14]);dbmap[key(tm,jb)]={req:g,ye};dbReq+=g;dbYe+=ye;});
  // 현재 시트
  const vals=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!A1:R80`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const data=[];const seen={};const buSeen=new Set();let writes={O:0,P:0,skipKeep:0,dupZero:0,buHdr:0};
  for(let i=0;i<vals.length;i++){
    const r=vals[i]||[];const rn=i+1;const A=C(r[0]),E=C(r[4]),H=C(r[7]),I=C(r[8]);
    // ■ 부문 헤더 → 라이브 수식
    if(A.startsWith('■')){
      // 부문코드 = 아래 첫 데이터행의 E
      let bu='';for(let j=i+1;j<vals.length;j++){const e=C((vals[j]||[])[4]);if(e&&!e.includes('부문')&&!C((vals[j]||[])[0]).startsWith('■')){bu=e;break;}}
      if(bu){data.push({range:`${REQ}!A${rn}`,values:[[buHeaderFormula(bu)]]});writes.buHdr++;}
      continue;
    }
    if(!E||E.includes('부문'))continue; // 헤더/구분행
    // 데이터행: Q/R 수식 항상 세팅
    data.push({range:`${REQ}!Q${rn}`,values:[[`=O${rn}-P${rn}`]]});
    data.push({range:`${REQ}!R${rn}`,values:[[`=IFERROR(P${rn}/O${rn},0)`]]});
    const k=key(H,I);const m=dbmap[k];
    if(m){
      if(buSeen.has('dup'+k)){ // 중복(부자재 2번째행) → 0/0
        data.push({range:`${REQ}!O${rn}`,values:[[0]]});data.push({range:`${REQ}!P${rn}`,values:[[0]]});writes.dupZero++;
      }else{
        buSeen.add('dup'+k);
        data.push({range:`${REQ}!O${rn}`,values:[[m.req]]});data.push({range:`${REQ}!P${rn}`,values:[[m.ye]]});
        writes.O++;writes.P++;
      }
    }else{
      writes.skipKeep++; // DB 미존재(완료/라벨차이/영상편집) → O/P 보존
    }
  }
  // P2 헤더 라벨
  data.push({range:`${REQ}!P2`,values:[['입사예정인원']]});
  console.log(`DB: 요청 ${dbReq} · 예정 ${dbYe}`);
  console.log(`적용: O/P매칭 ${writes.O}행 · 중복0처리 ${writes.dupZero} · 보존 ${writes.skipKeep} · ■헤더수식 ${writes.buHdr} · P2라벨`);
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data}});
  console.log('✅ 적용 완료\n');

  // ── 검증 ──
  const v2=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!E4:R80`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  let oTot=0,pTot=0,direct=0,indirect=0;const byBu={};
  v2.forEach(r=>{const E=C(r[0]),H=C(r[3]),M=C(r[8]),O=NUM(r[10]),P=NUM(r[11]);if(!E||E.includes('부문'))return;
    oTot+=O;pTot+=P;byBu[E]=byBu[E]||{o:0,p:0};byBu[E].o+=O;byBu[E].p+=P;
    if(M==='직접')direct+=O;else indirect+=O;});
  console.log('=== 검증 (채용진행상황 vs DB) ===');
  console.log(`요청합(O): ${oTot}  [DB 118 + 완료3행4 = 122 기대]`);
  console.log(`예정합(P): ${pTot}`);
  console.log(`직접 소계: ${direct}  [DB 30 기대]   간접 소계: ${indirect}  [DB 88+완료4=92 기대]`);
  console.log('부문별:',Object.entries(byBu).map(([k,v])=>`${k} 필요${v.o}/예정${v.p}`).join(' | '));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
