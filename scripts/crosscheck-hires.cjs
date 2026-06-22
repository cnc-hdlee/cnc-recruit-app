/* [읽기전용] 입사자 명단 ↔ 입사예정(정규직)DB 이름기준 대조. 불일치만 출력, 수정 안 함. */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',HR='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const C=x=>String(x==null?'':x).trim();
const nm=x=>C(x).replace(/\(.*?\)/g,'').replace(/\s+/g,'').toLowerCase();
const eq=(a,b)=>C(a).replace(/\s+/g,'').toLowerCase()===C(b).replace(/\s+/g,'').toLowerCase();
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // DB: A일 B본부 C팀 D직무 E직급 F신입 G성명 J근무지 K직간접 L비고
  const db=(await s.spreadsheets.values.get({spreadsheetId:HR,range:`입사예정(정규직)DB!A2:M400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const dbMap={};db.forEach((r,i)=>{const name=C(r[6]);if(!name)return;dbMap[nm(name)]={name,rn:i+2,date:C(r[0]),bon:C(r[1]),team:C(r[2]),job:C(r[3]),grade:C(r[4]),fresh:C(r[5]),loc:C(r[9]),di:C(r[10]),memo:C(r[11])};});
  // 명단: B일 D본부 F팀 G직무 H성명 I직급 J신입 L근무지 M직간접 P비고
  const ms=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`입사자 명단!A4:P400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const msMap={};const msRows=[];
  ms.forEach((r,i)=>{const name=C(r[7]);if(!name)return;const o={name,rn:i+4,date:C(r[1]),bon:C(r[3]),team:C(r[5]),job:C(r[6]),grade:C(r[8]),fresh:C(r[9]),loc:C(r[11]),di:C(r[12]),memo:C(r[15])};msMap[nm(name)]=o;msRows.push(o);});

  console.log(`입사자 명단 ${msRows.length}명 ↔ 입사예정(정규직)DB ${Object.keys(dbMap).length}명\n`);

  // 1) 명단엔 있는데 정규DB엔 없음 (도급/외국인일 수 있음)
  const onlyMs=msRows.filter(m=>!dbMap[nm(m.name)]);
  console.log(`■ 명단에만 있고 정규직DB엔 없음 (${onlyMs.length}명 — 도급/외국인이거나 누락):`);
  onlyMs.forEach(m=>console.log(`  R${m.rn} ${m.name} | ${m.team}/${m.job} | ${m.di} | 비고:${m.memo}`));

  // 2) 정규DB엔 있는데 명단엔 없음
  const onlyDb=Object.values(dbMap).filter(d=>!msMap[nm(d.name)]);
  console.log(`\n■ 정규직DB에만 있고 명단엔 없음 (${onlyDb.length}명 — 아직 명단 미반영):`);
  onlyDb.forEach(d=>console.log(`  DB R${d.rn} ${d.name} | ${d.team}/${d.job} | ${d.date} | ${d.memo}`));

  // 3) 양쪽 다 있는데 필드 불일치
  console.log(`\n■ 양쪽 매칭되나 값 불일치:`);
  let diffN=0;
  msRows.forEach(m=>{const d=dbMap[nm(m.name)];if(!d)return;
    const diffs=[];
    if(!eq(m.team,d.team))diffs.push(`팀: 명단[${m.team}] ≠ DB[${d.team}]`);
    if(!eq(m.job,d.job))diffs.push(`직무: 명단[${m.job}] ≠ DB[${d.job}]`);
    if(!eq(m.grade,d.grade))diffs.push(`직급: 명단[${m.grade}] ≠ DB[${d.grade}]`);
    if(!eq(m.loc,d.loc))diffs.push(`근무지: 명단[${m.loc}] ≠ DB[${d.loc}]`);
    if(!eq(m.di,d.di))diffs.push(`직간접: 명단[${m.di}] ≠ DB[${d.di}]`);
    if(!eq(m.fresh,d.fresh))diffs.push(`신입/경력: 명단[${m.fresh}] ≠ DB[${d.fresh}]`);
    if(!eq(m.date,d.date))diffs.push(`입사일: 명단[${m.date}] ≠ DB[${d.date}]`);
    if(diffs.length){diffN++;console.log(`  ${m.name} (명단R${m.rn}/DB R${d.rn}):`);diffs.forEach(x=>console.log(`      - ${x}`));}
  });
  if(!diffN)console.log('  (필드 불일치 없음)');

  // 4) 비고 대조 (상태 오기 탐지 — 위효선 케이스). DB비고가 링크면 무시, 상태성 텍스트만 비교.
  console.log(`\n■ 비고 불일치 (상태성 텍스트만; 링크/빈칸 제외):`);
  let memoN=0;const isLink=t=>/전자결재|gw|http|링크|미상신/i.test(t);
  msRows.forEach(m=>{const d=dbMap[nm(m.name)];if(!d)return;
    const a=C(m.memo),b=C(d.memo);if(eq(a,b))return;
    if((!a||isLink(a))&&(!b||isLink(b)))return; // 양쪽 다 링크/빈칸이면 무시
    memoN++;console.log(`  ${m.name} (명단R${m.rn}): 명단비고[${a||'(빈칸)'}] ≠ DB비고[${b||'(빈칸)'}]`);
  });
  if(!memoN)console.log('  (상태성 비고 불일치 없음)');
  console.log(`\n요약: 명단전용 ${onlyMs.length} · DB전용 ${onlyDb.length} · 필드불일치 ${diffN} · 비고(상태)불일치 ${memoN}`);
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
