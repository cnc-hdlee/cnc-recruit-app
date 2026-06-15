/* 입사자 명단 자동 미러 (30분 스케줄러). 2026-06-12
 * ※ 채용진행상황(현재) ↔ 채용요청(정규직)DB 자동 미러는 취소(사용자 요청).
 *    이유: 채용요청DB가 재편(OD본부 추가 등)되며 구분(번호)이 위치순번이라 중복/시프트 → 번호 키 매칭 불가.
 *    채용진행상황의 현황/입사예정/필드는 수동 관리. 필요시 안정 키(전자결재 doc id) 확보 후 재검토.
 * [유지] 입사자 명단 ↔ 입사예정(정규직)DB : 성명/입사일 기준 평면 전체 재미러(안전).
 */
const fs=require('node:fs');const path=require('node:path');const{google}=require('googleapis');
const ID='1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const ROSTER='입사자 명단';const HIRE_TAB='입사예정(정규직)DB';
const SRC='1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
const APPLY=process.argv.includes('--apply');
const C=x=>String(x==null?'':x).trim();
const CENTER_OF={'생산기획부':'생산본부','품질경영본부':'생산본부','제조부':'생산본부','생산본부':'생산본부','people&culture실':'경영기획본부','People&culture실':'경영기획본부'};
const BUMUN_OF={'생산본부':'COO','경영기획본부':'CFO','영업본부':'CBO','Makeup Center':'CRIO','Skin Science Center':'CRIO','크리에이티브솔루션본부':'크리에이티브솔루션','OD본부':'OD','CEO직속':'CEO','CEO 직속':'CEO'};
const centerOf=x=>CENTER_OF[x]||x;const bumunOf=c=>BUMUN_OF[c]||c;const normBonbu=x=>x==='CEO 직속'?'CEO직속':x;
async function auth(){const tok=JSON.parse(fs.readFileSync(path.join(__dirname,'.dash-tokens.json'),'utf8'));const o=new google.auth.OAuth2(tok.clientId,tok.clientSecret);o.setCredentials({refresh_token:tok.refresh_token});await o.getAccessToken();return google.sheets({version:'v4',auth:o});}

async function syncRoster(s){
  const hire=(await s.spreadsheets.values.get({spreadsheetId:SRC,range:`'${HIRE_TAB}'!A2:M400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const cur=(await s.spreadsheets.values.get({spreadsheetId:ID,range:`'${ROSTER}'!A1:N400`,valueRenderOption:'FORMATTED_VALUE'})).data.values||[];
  const typeByName={};cur.slice(3).forEach(r=>{const nm=C(r[7]),ty=C(r[13]);if(nm&&ty&&!(nm in typeByName))typeByName[nm]=ty;});
  const desired=hire.filter(r=>C(r[6])&&C(r[0])).map(r=>{const bonbu=C(r[1]);const center=centerOf(bonbu);return [C(r[0]),bumunOf(center),normBonbu(center),center!==bonbu?bonbu:'',C(r[2]),C(r[3]),C(r[6]),C(r[4]),C(r[5]),C(r[7]),C(r[9]),C(r[10]),typeByName[C(r[6])]||''];});
  const curBody=cur.slice(3).filter(r=>C(r[7])).map(r=>[C(r[1]),C(r[2]),C(r[3]),C(r[4]),C(r[5]),C(r[6]),C(r[7]),C(r[8]),C(r[9]),C(r[10]),C(r[11]),C(r[12]),C(r[13])]);
  const same=JSON.stringify(curBody)===JSON.stringify(desired);
  console.log(`[입사자 명단] 소스 ${desired.length}명 / 현재 ${curBody.length}명 — ${same?'동일(무동작)':'변경'}`);
  if(same||!APPLY)return;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`.backup-roster-${stamp}.json`),JSON.stringify(cur,null,2),'utf8');
  await s.spreadsheets.values.update({spreadsheetId:ID,range:`'${ROSTER}'!B4`,valueInputOption:'USER_ENTERED',requestBody:{values:desired}});
  await s.spreadsheets.values.clear({spreadsheetId:ID,range:`'${ROSTER}'!B${4+desired.length}:N400`});
  console.log(`[입사자 명단] 재미러 ${desired.length}명`);
}
async function main(){const s=await auth();await syncRoster(s);if(!APPLY)console.log('[DRY-RUN] 적용: --apply');}
main().catch(e=>{console.error('ERR',e.response&&e.response.data?JSON.stringify(e.response.data):e.message);process.exit(1);});
