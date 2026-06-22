/* [읽기전용] 채용진행상황(현재) vs 채용요청(정규직)DB 대조. 수정 안 함. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const PROG='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const REQ='RAW DATA_채용진행상황(현재)';
const C=x=>String(x==null?'':x).trim();const N=x=>parseFloat(C(x).replace(/[^0-9.-]/g,''))||0;
const norm=x=>C(x).replace(/\s+/g,'').toLowerCase();const key=(t,j)=>norm(t)+'|'+norm(j);
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 진행상황: H팀(7) I직무(8) O필요(14) P예정(15) Q잔여(16)
  const pv=(await s.spreadsheets.values.get({spreadsheetId:PROG,range:`${REQ}!E4:Q90`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const prog={};let pRows=0,pO=0,pP=0,pQ=0;
  pv.forEach(r=>{const E=C(r[0]),H=C(r[3]),I=C(r[4]);if(!E||E.includes('부문'))return;pRows++;const O=N(r[10]),P=N(r[11]),Q=N(r[12]);pO+=O;pP+=P;pQ+=Q;
    const k=key(H,I);(prog[k]=prog[k]||{tm:H,jb:I,o:0,p:0,n:0}).o+=O;prog[k].p+=P;prog[k].n++;});
  // DB: E팀(4) F직무(5) G요청(6) O예정(14) P잔여(15) — 데이터행만(구분이 숫자)
  const dv=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`채용요청(정규직)DB!A2:Q72`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const db={};let dRows=0,dG=0,dYe=0;let totRow=null;
  dv.forEach(r=>{const gubun=C(r[0]),tm=C(r[4]),jb=C(r[5]);
    if(/합계/.test(gubun)){totRow=r;return;}
    if(!/^[0-9]+$/.test(gubun))return; // 데이터행만(구분=숫자)
    if(!tm&&!jb)return;dRows++;const G=N(r[6]),Ye=N(r[14]);dG+=G;dYe+=Ye;
    const k=key(tm,jb);(db[k]=db[k]||{tm,jb,g:0,ye:0,n:0}).g+=G;db[k].ye+=Ye;db[k].n++;});

  console.log('================ 총량 비교 ================');
  console.log(`항목 수:    진행상황 ${pRows}행  vs  DB ${dRows}행   (차이 ${pRows-dRows})`);
  console.log(`채용필요:   진행상황 ${pO}     vs  DB 요청 ${dG}      (차이 ${pO-dG})`);
  console.log(`입사예정:   진행상황 ${pP}     vs  DB 예정 ${dYe}      (차이 ${pP-dYe})`);
  if(totRow)console.log(`(DB 합계행: 요청 ${C(totRow[6])} · 현재채용 ${C(totRow[7])} · 예정 ${C(totRow[14])} · 잔여 ${C(totRow[15])})`);

  console.log('\n================ 진행상황엔 있고 DB엔 없음 (미러 초과) ================');
  Object.values(prog).forEach(p=>{if(!db[key(p.tm,p.jb)])console.log(`  + ${p.tm} / ${p.jb}  (필요 ${p.o}·예정 ${p.p})`);});
  console.log('\n================ DB엔 있고 진행상황엔 없음 (미러 누락) ================');
  Object.values(db).forEach(d=>{if(!prog[key(d.tm,d.jb)])console.log(`  - ${d.tm} / ${d.jb}  (요청 ${d.g}·예정 ${d.ye})`);});

  console.log('\n================ 양쪽 있으나 수치 다름 ================');
  let diff=0;Object.values(prog).forEach(p=>{const d=db[key(p.tm,p.jb)];if(!d)return;const dO=p.o!==d.g,dP=p.p!==d.ye;
    if(dO||dP){diff++;console.log(`  ~ ${p.tm}/${p.jb}: 필요 ${p.o}${dO?'≠DB'+d.g:'=DB'} · 예정 ${p.p}${dP?'≠DB'+d.ye:'=DB'}`);}});
  if(!diff)console.log('  (수치 일치)');
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
