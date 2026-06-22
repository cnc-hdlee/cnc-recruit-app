/* [읽기전용] 대시보드 전체 검증 — RAW DATA 기준 대조. PASS/FAIL 출력. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',GID=500969666,REQ='RAW DATA_채용진행상황(현재)';
const C=x=>String(x==null?'':x).trim();const N=x=>parseFloat(C(x).replace(/[^0-9.-]/g,''))||0;
const PASS=(b,m)=>console.log(`  ${b?'✅':'❌'} ${m}`);
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
const g=async(s,r,f)=>(await s.spreadsheets.values.get({spreadsheetId:ID,range:r,valueRenderOption:f||'FORMATTED_VALUE'})).data.values||[];
async function main(){
  const s=await auth();
  // ── RAW 그라운드 트루스 ──
  const v=await g(s,`${REQ}!E4:P90`);
  const pf=await g(s,`${REQ}!P4:P5`,'FORMULA');
  let rows=0,sumO=0,sumP=0;const byBu={},byBon={},hyun={};
  v.forEach(r=>{const E=C(r[0]),F=C(r[1]),H=C(r[3]),Nn=C(r[9]),O=N(r[10]),P=N(r[11]);if(!E||E.includes('부문'))return;rows++;sumO+=O;sumP+=P;
    byBu[E]=byBu[E]||{o:0,p:0};byBu[E].o+=O;byBu[E].p+=P;
    byBon[F]=byBon[F]||{o:0,p:0};byBon[F].o+=O;byBon[F].p+=P;
    if(Nn)hyun[Nn]=(hyun[Nn]||0)+1;});
  console.log(`\n=== RAW 기준값: 데이터 ${rows}행 · 채용필요 ${sumO} · 입사예정 ${sumP} · 달성률 ${(100*sumP/sumO).toFixed(1)}% ===`);

  // ── 1. 트리 전사합계/부문소계 ──
  console.log('\n[1] 트리 (부문 기준)');
  const tree=await g(s,`대시보드!A5:E130`);
  const findRow=re=>tree.find(r=>re.test(C(r[0])));
  const tot=findRow(/전사 합계/);
  PASS(tot&&N(tot[1])===sumO&&N(tot[2])===sumP,`전사합계 필요${tot&&C(tot[1])}/입사${tot&&C(tot[2])} == RAW ${sumO}/${sumP}`);
  const buMap={'COO 소계':'COO','CRIO 소계':'CRIO','CBO 소계':'CBO','CFO 소계':'CFO','CEO 소계':'CEO'};
  Object.entries(buMap).forEach(([lbl,bu])=>{const rr=findRow(new RegExp('^'+lbl));const exp=byBu[bu]||{o:0,p:0};if(rr)PASS(N(rr[1])===exp.o&&N(rr[2])===exp.p,`${lbl}: ${C(rr[1])}/${C(rr[2])} == RAW ${exp.o}/${exp.p}`);});
  const cre=findRow(/크리에이티브솔루션 소계/);const ce=byBu['크리에이티브솔루션']||{o:0,p:0};
  if(cre)PASS(N(cre[1])===ce.o,`크리에이티브 소계: ${C(cre[1])}/${C(cre[2])} == RAW ${ce.o}/${ce.p}`);

  // ── 2. 본부별 표 (G4:J11) ──
  console.log('\n[2] 본부별 표 (본부 기준)');
  const bp=await g(s,`대시보드!G5:J11`);
  bp.forEach(r=>{const bon=C(r[0]);if(!bon)return;const exp=byBon[bon];if(!exp){PASS(false,`${bon}: RAW에 없는 본부?!`);return;}PASS(N(r[1])===exp.o&&N(r[2])===exp.p,`${bon}: ${C(r[1])}/${C(r[2])} == RAW ${exp.o}/${exp.p}`);});

  // ── 3. 현황 표 (G25:H31) ──
  console.log('\n[3] 현황 단계 표');
  const hv=await g(s,`대시보드!G25:H31`);
  let hsum=0;hv.forEach(r=>{const st=C(r[0]);if(!st)return;const exp=hyun[st]||0;hsum+=N(r[1]);PASS(N(r[1])===exp,`${st}: ${C(r[1])} == RAW ${exp}`);});
  PASS(hsum===rows,`현황 합계 ${hsum} == 데이터행 ${rows}`);

  // ── 4. 추이 (RAW 연동) ──
  console.log('\n[4] 추이 (끝점 = RAW 달성률)');
  const tr=await g(s,`대시보드!A114:D114`);const e=tr[0]||[];
  PASS(N(e[2])===sumO,`추이 채용필요 ${C(e[2])} == RAW ${sumO}`);
  const rate=(sumP/sumO);PASS(Math.abs(N(String(e[3]).replace('%',''))/100-rate)<0.005,`추이 달성률 ${C(e[3])} ≈ RAW ${(100*rate).toFixed(1)}%`);

  // ── 5. P4/P5 IMPORTRANGE 잠금 ──
  console.log('\n[5] 생산1/2팀 P 수식 잠금');
  PASS(C(pf[0]&&pf[0][0]).startsWith('=IMPORTRANGE'),`P4 = IMPORTRANGE (${C((v[0]||[])[11])})`);
  PASS(C(pf[1]&&pf[1][0]).startsWith('=IMPORTRANGE'),`P5 = IMPORTRANGE (${C((v[1]||[])[11])})`);

  // ── 6. People Ops 줄 존재 ──
  console.log('\n[6] People Ops 트리 줄');
  PASS(!!findRow(/People Ops/),`People Ops 줄 존재`);

  // ── 7. 차트 4개 ──
  console.log('\n[7] 차트');
  const meta=await s.spreadsheets.get({spreadsheetId:ID,fields:'sheets(properties(sheetId),charts(chartId,spec(title,basicChart(chartType,series))))'});
  const sh=meta.data.sheets.find(x=>x.properties.sheetId===GID);
  const want={167562285:['COLUMN',1],1159675598:['COLUMN',2],570111091:['COLUMN',7],330002883:['LINE',2]};
  (sh.charts||[]).forEach(ch=>{const bc=ch.spec.basicChart;const w=want[ch.chartId];if(!w)return;PASS(bc&&bc.chartType===w[0]&&bc.series.length===w[1],`[${ch.chartId}] "${ch.spec.title}" ${bc&&bc.chartType}·${bc&&bc.series.length}계열 (기대 ${w[0]}·${w[1]})`);});
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
