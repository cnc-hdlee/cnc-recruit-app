/* RAW DATA_정리본 복구 + 엑셀(2025이후 면접일정) 데이터 최대 주입
 * 대시보드 컬럼 레이아웃 기준. 빈 곳은 추정 매핑/역산으로 가능한 한 채움.
 * 사용: node rebuild-jeongribon.cjs        (DRY: 검증만)
 *      node rebuild-jeongribon.cjs --write  (실제 시트 쓰기)
 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const XLSX = require('xlsx');

const SS_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const SHEET = 'RAW DATA_정리본';
const XLSX_PATH = 'C:\\Users\\user\\Downloads\\260313_씨앤씨 면접일정(업데이트 중).xlsx';
const TAB = '2025이후 면접일정';
const WRITE = process.argv.includes('--write');

const HEADERS = [
  '채용요청문서번호','본부','센터','실/부','팀','직무','채용유형','근무지','후보자명','신입/경력',
  '채널','이력서_링크','이력서_지원일','서류_결과','1차면접_결과','1차면접_확정일','2차면접_결과','2차면접_확정일','CPI_결과','CPI_확정일',
  '처우협의_결과','처우협의_확정일','최종상태','탈락단계','입사예정일','실제입사일','비고','현재단계','총소요일수','채용요청',
  'TO인원','신규집계','','','리드타임','','','채용필요',
]; // A..AL (38)

// 지원부서 → [본부, 센터, 실/부, 팀]  (대시보드 분류 체계로 best-effort 매핑)
const DEPT = {
  '영업팀':['CBO','영업본부','','영업팀'],
  '영업관리팀':['CBO','영업본부','','영업관리팀'],
  '고객대응팀':['CBO','영업본부','','고객대응팀'],
  'KPD1팀':['CBO','영업본부','KPD실','KPD1팀'],
  'KPD2팀':['CBO','영업본부','KPD실','KPD2팀'],
  'KPD팀':['CBO','영업본부','KPD실','KPD팀'],
  'KPD':['CBO','영업본부','KPD실','KPD'],
  'GPD':['CBO','영업본부','GPD실','GPD'],
  '재경팀':['CFO','경영기획본부','CFO Office실','재경팀'],
  '재무기획팀':['CFO','경영기획본부','CFO Office실','재무기획팀'],
  '경영정보팀':['CFO','경영기획본부','CFO Office실','경영정보팀'],
  '인사팀':['CFO','경영기획본부','People&Culture실','인사팀'],
  'Talent Acquisition팀':['CFO','경영기획본부','People&Culture실','TA팀'],
  '총무팀':['CFO','경영기획본부','Workplace Experience실','총무팀'],
  '구성원경험팀':['CFO','경영기획본부','Workplace Experience실','구성원경험팀'],
  'OD본부':['CFO','경영기획본부','','OD본부'],
  '품질관리팀':['COO','생산본부','직속','품질관리팀'],
  '품질관리1팀':['COO','생산본부','직속','품질관리1팀'],
  '품질관리2팀':['COO','생산본부','직속','품질관리2팀'],
  '품질보증팀':['COO','생산본부','직속','품질보증팀'],
  '품질연구팀':['COO','생산본부','직속','품질연구팀'],
  '안전관리팀':['COO','생산본부','직속','안전관리팀'],
  '전략구매팀':['COO','생산본부','직속','전략구매팀'],
  '제조1팀':['COO','생산본부','제조부','제조1팀'],
  '제조2팀':['COO','생산본부','제조부','제조2팀'],
  '제조':['COO','생산본부','제조부','제조'],
  '생산팀':['COO','생산본부','','생산팀'],
  '생산1팀':['COO','생산본부','생산1부','생산1팀'],
  '생산2팀':['COO','생산본부','','생산2팀'],
  '생산3팀':['COO','생산본부','생산3부','생산3팀'],
  '생산운영팀':['COO','생산본부','','생산운영팀'],
  '충포장팀장':['COO','생산본부','','충포장팀'],
  '충포장':['COO','생산본부','','충포장'],
  '포장1팀':['COO','생산본부','','포장1팀'],
  '포장3팀':['COO','생산본부','','포장3팀'],
  '자재물류1팀':['COO','생산본부','생산1부','자재물류1팀'],
  '자재물류2팀':['COO','생산본부','','자재물류2팀'],
  '자재물류팀':['COO','생산본부','','자재물류팀'],
  '산업기능요원':['COO','생산본부','','산업기능요원'],
  'MU연구소':['CRIO','MakeUp Center','','MU연구소'],
  '메이크업연구팀':['CRIO','MakeUp Center','','메이크업연구팀'],
  '연구소':['CRIO','MakeUp Center','','연구소'],
  '연구기획팀':['CRIO','MakeUp Center','','연구기획팀'],
  '연구개발팀':['CRIO','MakeUp Center','','연구개발팀'],
  '제품개발팀':['CRIO','MakeUp Center','','제품개발팀'],
  'SC연구소':['CRIO','Skin Science Center','','SC연구소'],
  '스킨케어바디연구팀':['CRIO','Skin Science Center','SC Innovation Lab','스킨케어바디연구팀'],
  '스킨바디케어연구팀':['CRIO','Skin Science Center','SC Innovation Lab','스킨바디케어연구팀'],
  'Cleansing Studio팀':['CRIO','Skin Science Center','SC Innovation Lab','Cleansing Studio팀'],
  '제품기획팀':['크리에이티브솔루션','크리에이티브 솔루션 본부','직속','제품기획팀'],
  '제품전략팀':['크리에이티브솔루션','크리에이티브 솔루션 본부','직속','제품전략팀'],
  'OBM팀':['크리에이티브솔루션','크리에이티브 솔루션 본부','직속','OBM팀'],
  'OBM':['크리에이티브솔루션','크리에이티브 솔루션 본부','직속','OBM팀'],
  '콘텐츠팀':['크리에이티브솔루션','크리에이티브 솔루션 본부','직속','콘텐츠팀'],
  '컨텐츠팀':['크리에이티브솔루션','크리에이티브 솔루션 본부','직속','콘텐츠팀'],
  '컨턴츠팀':['크리에이티브솔루션','크리에이티브 솔루션 본부','직속','콘텐츠팀'],
};
function worksite(b, dept) {
  if (b === 'CBO') return '그린';
  if (b === 'CRIO' || b === 'CFO' || b === '크리에이티브솔루션') return '퍼플';
  if (b === 'COO') { if (/품질/.test(dept) || /생산3/.test(dept)) return '3공장'; return '수원'; }
  return '';
}

const pd = (s) => {
  if (s == null) return null; s = String(s).trim();
  if (!s || s === '-' || s === '미정') return null;
  let m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/);
  if (m) { let [_, mo, da, yr] = m; yr = yr.length === 2 ? '20' + yr : yr; return `${yr}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`; }
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `2025-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  return null;
};
const pf = (v) => { v = String(v||'').trim(); if (!v || v === '-') return ''; if (v.includes('불')) return '불합격'; if (v.includes('합') || v.includes('통과')) return '합격'; return ''; };
const dd = (a, b) => { if (!a || !b) return ''; const x=new Date(a), y=new Date(b); if (isNaN(x)||isNaN(y)) return ''; return Math.round((y-x)/86400000); };

function buildRows() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[TAB], { header: 1, defval: '', raw: false });
  const out = []; const unmapped = {};
  for (let i = 5; i < rows.length; i++) {
    const r = rows[i];
    const no = String(r[1]||'').trim(), name = String(r[6]||'').trim();
    if (!name || !/^\d+$/.test(no)) continue;
    if (!/[가-힣A-Za-z]/.test(name)) continue; // 성명에 한글/영문 없으면 쓰레기 행 제거

    const deptRaw = String(r[2]||'').trim();
    const jikgu = String(r[3]||'').trim();
    const sinkyung = String(r[4]||'').trim();
    const channel = String(r[5]||'').trim();
    const r1res = pf(r[20]), r1date = pd(r[17]);
    const cpiType = String(r[21]||'').trim();
    const r2res = pf(r[25]), r2date = pd(r[22]);
    const hap = String(r[26]||'').trim();
    const hobong = String(r[27]||'').trim(), jikgeup = String(r[28]||'').trim();
    const ipsaPlan = pd(r[29]);
    const ipsaYn = String(r[30]||'').trim();
    const giveup = String(r[31]||'').trim();

    const map = DEPT[deptRaw] || ['','','',deptRaw||''];
    if (!DEPT[deptRaw] && deptRaw) unmapped[deptRaw] = (unmapped[deptRaw]||0)+1;
    const [b, c, d, e] = map;
    const site = worksite(b, deptRaw);

    // 입사예정일 = 실제입사일 동일화. 입사 확정자(입사여부=입사) 기준.
    // 날짜가 있으면 날짜, 없으면 '입사' 표시(향후 실제 날짜로 교체). 두 컬럼 항상 동일.
    const declined = /포기|취소|불참|반려|거절|보류|불가/.test(ipsaYn);
    const joined = !declined && /입사/.test(ipsaYn);
    const hireDate = joined ? (ipsaPlan || '입사') : '';
    const realIpsa = hireDate;
    const offer = !!(realIpsa || hobong || jikgeup || hap === '합격');

    // 최종상태
    let status;
    if (realIpsa || hap === '합격') status = '합격';
    else if (/포기/.test(hap) || /포기/.test(giveup)) status = '탈락';
    else if (hap === '불합격' || r2res === '불합격' || r1res === '불합격') status = '탈락';
    else status = '진행중';

    // 단계 역산
    const hadInterview = !!(r1date || r1res || r2date || r2res);
    const seoryu = (hadInterview || offer) ? '합격' : (status === '탈락' ? '불합격' : '');
    const cpiRes = offer ? '통과' : '';            // 오퍼 신호 → CPI 통과로 간주
    const chowoo = offer ? '동의' : '';            // 오퍼 신호 → 처우 동의로 간주

    let stage;
    if (realIpsa) stage = '입사';
    else if (offer) stage = '처우 동의';
    else if (status === '탈락') stage = (r2res === '불합격') ? '2차 탈락' : (r1res === '불합격' ? '1차 탈락' : (/포기/.test(hap+giveup) ? '포기' : '서류 탈락'));
    else if (r2res === '합격') stage = '2차 합격';
    else if (r2date) stage = '2차 면접';
    else if (r1res === '합격') stage = '1차 합격';
    else if (r1date) stage = '1차 면접';
    else stage = '지원접수';

    let drop = '';
    if (status === '탈락') drop = (r2res === '불합격') ? '2차면접' : (r1res === '불합격' ? '1차면접' : (/포기/.test(hap+giveup) ? '면접포기' : (hadInterview ? '' : '서류')));

    const lead = realIpsa ? dd(r1date, realIpsa) : '';

    const row = new Array(38).fill('');
    row[1]=b; row[2]=c; row[3]=d; row[4]=e;       // B 본부 / C 센터 / D 실·부 / E 팀
    row[5]=jikgu;                                  // F 직무
    row[7]=site;                                   // H 근무지
    row[8]=name;                                   // I 후보자명
    row[9]=sinkyung;                               // J 신입/경력
    row[10]=channel;                               // K 채널
    row[13]=seoryu;                                // N 서류결과
    row[14]=r1res; row[15]=r1date||'';             // O,P 1차
    row[16]=r2res; row[17]=r2date||'';             // Q,R 2차
    row[18]=cpiRes;                                // S CPI결과
    row[20]=chowoo;                                // U 처우결과
    row[22]=status;                                // W 최종상태
    row[23]=drop;                                  // X 탈락단계
    row[24]=hireDate;                              // Y 입사예정일 (= 실제입사일 동일)
    row[25]=hireDate;                              // Z 실제입사일 (= 입사예정일 동일)
    row[26]=giveup||(hobong?`처우:${hobong} ${jikgeup}`.trim():''); // AA 비고
    row[27]=stage;                                 // AB 현재단계
    row[28]=lead; row[34]=lead;                    // AC,AI 리드타임
    out.push(row);
  }
  return { out, unmapped };
}

async function main() {
  const { out: data, unmapped } = buildRows();
  console.log(`매핑된 후보자 행: ${data.length}`);
  const f = (k,val) => data.filter(r=>r[k]===val).length;
  console.log(`본부 채움: ${data.filter(r=>r[1]).length} (빈 본부: ${data.filter(r=>!r[1]).length})`);
  console.log(`본부 분포: COO=${f(1,'COO')} CRIO=${f(1,'CRIO')} CBO=${f(1,'CBO')} CFO=${f(1,'CFO')} 크리에이티브솔루션=${f(1,'크리에이티브솔루션')}`);
  console.log(`최종상태: 합격=${f(22,'합격')} 탈락=${f(22,'탈락')} 진행중=${f(22,'진행중')} / 실제입사=${data.filter(r=>r[25]).length}`);
  console.log(`서류합격=${f(13,'합격')} 1차합격=${f(14,'합격')} 2차합격=${f(16,'합격')} CPI통과=${f(18,'통과')} 처우동의=${f(20,'동의')}`);
  console.log(`근무지: 퍼플=${f(7,'퍼플')} 그린=${f(7,'그린')} 수원=${f(7,'수원')} 3공장=${f(7,'3공장')}`);
  if (Object.keys(unmapped).length) console.log('미매핑 부서:', JSON.stringify(unmapped));
  console.log('샘플:', data.slice(0,4).map(r=>`${r[8]}[${r[1]}/${r[4]}/${r[7]}] 직무:${r[5]} 상태:${r[22]} 단계:${r[27]}`).join(' | '));

  if (!WRITE) { console.log('\n[DRY] --write 시 반영'); return; }
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });
  await sheets.spreadsheets.values.clear({ spreadsheetId: SS_ID, range: `'${SHEET}'!A1:AL1300` });
  await sheets.spreadsheets.values.update({ spreadsheetId: SS_ID, range: `'${SHEET}'!A1`, valueInputOption: 'USER_ENTERED', requestBody: { values: [HEADERS, ...data] } });
  console.log(`\n[WRITE] 완료: 헤더 + 데이터 ${data.length}행.`);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
