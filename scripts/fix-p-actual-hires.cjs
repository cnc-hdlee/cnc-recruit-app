/* 입사예정(P)을 "실제 입사자 명단" 기준으로 재계산 (1회성).
 * P = MIN( 입사자명단 팀+직무 매칭수 , 채용필요(O) )  ← 채용필요에서 캡(최대 100%).
 * 라벨 불일치로 매칭 0이지만 기존에 완료(P>0)였던 행은 기존값 보존(완료 입사자 유실 방지).
 * 분모(O)·달성률(R=P/O 수식)은 안 건드림. 생산1/2팀 등 전 팀 달성률 부활.
 */
const fs=require('node:fs'),path=require('node:path'),{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4',REQ='RAW DATA_채용진행상황(현재)';
const C=x=>String(x==null?'':x).trim();
const norm=x=>C(x).replace(/\s+/g,'').toLowerCase();
const NUM=x=>parseFloat(C(x).replace(/[^0-9.-]/g,''))||0;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}
async function main(){
  const s=await auth();
  // 입사자 명단: F팀(5) G직무(6) P비고(15) — 비고 "포기/취소"는 입사 카운트 제외(명단엔 보존)
  const ros=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`입사자 명단!A4:P400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const cntTJ={};let totHire=0,declined=0;
  ros.forEach(r=>{const t=C(r[5]),j=C(r[6]);if(!t)return;if(/포기|취소|불참|거절/.test(C(r[15]))){declined++;return;}totHire++;const k=norm(t)+'|'+norm(j);cntTJ[k]=(cntTJ[k]||0)+1;});
  if(declined)console.log(`(입사포기/취소 ${declined}명 카운트 제외)`);
  // 채용진행상황
  const vals=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!A1:R80`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  // ⚠️⚠️ P가 수식(생산1/2팀 IMPORTRANGE 등)인 행은 절대 안 건드림 — 형도님 지시(2026-06-16). 마스터(전사인원현황) 연동 보존.
  const pForm=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`${REQ}!P1:P80`,valueRenderOption:'FORMULA'})).data.values||[];
  const data=[];const rep=[];let usedKeys=new Set(),skippedF=0;
  for(let i=0;i<vals.length;i++){
    const r=vals[i]||[];const rn=i+1;const E=C(r[4]),H=C(r[7]),I=C(r[8]);
    if(!E||E.includes('부문')||C(r[0]).startsWith('■'))continue;
    if(C(pForm[i]&&pForm[i][0]).startsWith('=')){skippedF++;continue;} // 수식 P셀 보존(생산1/2팀 IMPORTRANGE)
    const O=NUM(r[14]),prevP=NUM(r[15]);
    const k=norm(H)+'|'+norm(I);const cnt=cntTJ[k]||0;usedKeys.add(k);
    let p;
    if(cnt>0)p=Math.min(cnt,O);
    else p=Math.min(prevP,O); // 매칭0 → 기존 완료값 보존
    data.push({range:`${REQ}!P${rn}`,values:[[p]]});
    rep.push({rn,bu:E,tm:H,jb:I,O,cnt,p});
  }
  await s.spreadsheets.values.batchUpdate({spreadsheetId:ID,requestBody:{valueInputOption:'USER_ENTERED',data}});
  console.log(`입사자 명단 총 ${totHire}명 기준 P 재계산 · ${data.length}행 반영\n`);

  // 부문/팀 집계
  const byBu={};let tO=0,tP=0;
  rep.forEach(x=>{tO+=x.O;tP+=x.p;byBu[x.bu]=byBu[x.bu]||{o:0,p:0};byBu[x.bu].o+=x.O;byBu[x.bu].p+=x.p;});
  console.log('=== 부문별 달성률 ===');
  Object.entries(byBu).forEach(([k,v])=>console.log(`  ${k}: 입사 ${v.p} / 필요 ${v.o} = ${(v.o?100*v.p/v.o:0).toFixed(1)}%`));
  console.log(`  ── 전체: 입사 ${tP} / 필요 ${tO} = ${(100*tP/tO).toFixed(1)}%`);
  console.log('\n=== 생산직 확인 ===');
  rep.filter(x=>/생산[12]팀/.test(x.tm)).forEach(x=>console.log(`  R${x.rn} ${x.tm}/${x.jb}: 매칭 ${x.cnt} → P ${x.p} / O ${x.O} = ${(x.O?100*x.p/x.O:0).toFixed(0)}%`));
  // 매칭 0인데 O>0인 행(라벨 불일치 의심) 경고
  console.log('\n=== 매칭 0 & 완료보존도 0 (입사 미반영 — 라벨 확인 권장) ===');
  rep.filter(x=>x.cnt===0&&x.p===0&&x.O>0).forEach(x=>console.log(`  R${x.rn} ${x.bu}/${x.tm}/${x.jb} (필요 ${x.O})`));
}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
