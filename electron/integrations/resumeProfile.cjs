// 이력서 텍스트 → 처우산정표 인적사항.
//
// 처우산정표에 사람이 손으로 옮겨 적던 것들(출생연도·성별·학교·전공·학위·경력)을 이력서에서 읽는다.
// 사내 이력서 대부분이 잡코리아 인쇄 양식이라 그 구조를 먼저 보고, 안 맞으면 일반 패턴으로 떨어진다.
//
// 금액(연봉)은 "직전연봉" 참고용으로만 뽑는다. 처우 산정 숫자는 형도님이 직접 넣는 게 원칙이다.

/** 학제 표기 → 학위 */
const DEGREE_RULES = [
  [/박사/, '박사'],
  [/대학원|석사/, '석사'],
  [/대학\s*\(\s*4\s*년|4년제|학사/, '학사'],
  [/대학\s*\(\s*2\s*,?\s*3\s*년|전문대|2,\s*3년/, '전문학사'],
  [/고등학교|고졸/, '고졸'],
];

/** "2019. 03 ~ 2022. 08" / "2024. 01 ~ 재직중" */
const PERIOD_RE = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*~\s*(재직\s*중|현재|(\d{4})\s*[.\-/]\s*(\d{1,2}))/;

const ROLE_RE = /(사원|주임|대리|과장|차장|부장|팀장|파트장|인턴|연구원|매니저|담당자|담당)/;
const COMPANY_RE = /((?:\(주\)|㈜|주식회사)\s*[가-힣A-Za-z0-9.&·]+|[가-힣A-Za-z0-9.&·]{2,20}(?:주식회사|㈜))/;

function profileFromText(text, candidate) {
  const t = String(text || '').replace(/\r/g, '');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { birth: '', gender: '', school: '', major: '', degree: '', careerTotal: '', careers: [], lastSalary: '' };

  // ── 성별·출생연도 — "김보민 여 2000년 (만 25세)" 한 줄에 같이 온다
  const nm = String(candidate || '').replace(/\s+/g, '');
  const head = lines.find(
    (l) => nm && l.replace(/\s+/g, '').startsWith(nm) && /(^|\s)(남|여)(\s|$)/.test(l) && /\d{4}\s*년/.test(l)
  );
  if (head) {
    const g = head.match(/(?:^|\s)(남|여)(?:\s|$)/);
    if (g) out.gender = g[1] === '남' ? '남성' : '여성';
    const y = head.match(/(\d{4})\s*년/);
    if (y) out.birth = `${y[1]}년생`;
  }
  if (!out.birth) {
    const y = t.match(/(19\d{2}|20\d{2})\s*년\s*생/) || t.match(/생년월일[^0-9]{0,8}(19\d{2}|20\d{2})/);
    if (y) out.birth = `${y[1]}년생`;
  }
  if (!out.gender) {
    const g = t.match(/성\s*별[^가-힣]{0,4}(남자|여자|남성|여성|남|여)/);
    if (g) out.gender = /남/.test(g[1]) ? '남성' : '여성';
  }

  // ── 학교 — 여러 개면 가장 높은 학력을 쓴다
  const schools = [...t.matchAll(/([가-힣A-Za-z]{2,10}(?:대학원|대학교|대학))(?![가-힣])/g)].map((m) => m[1]);
  const uniq = [...new Set(schools)];
  out.school = uniq.find((x) => /대학원/.test(x)) || uniq[0] || '';

  // ── 전공 — "유아교육과(3년제)" 처럼 '학과'가 아니라 '과'로 끝나는 학과명이 더 많다
  const major =
    t.match(/([가-힣]{2,12}(?:학과|학부|공학|학전공))/) ||
    t.match(/([가-힣]{3,12}과)\s*[(（]/) ||
    t.match(/전\s*공[^가-힣]{0,4}([가-힣]{2,12})/);
  if (major) out.major = major[1];

  // ── 학위
  for (const [re, deg] of DEGREE_RULES) {
    if (re.test(t)) {
      out.degree = deg;
      break;
    }
  }
  // 대학을 중퇴했으면 최종학력은 고졸이다 — 학위도, 학교도 고등학교 기준으로 잡는다.
  // (형도님 지시: "중퇴는 고졸이야")
  if (/중퇴/.test(t) && /대학/.test(t)) {
    out.degree = '고졸';
    const hs = t.match(/([가-힣A-Za-z]{2,12}고등학교)/);
    if (hs) out.school = hs[1];
    out.major = ''; // 고졸이면 전공 칸은 비운다
  }

  // ── 총 경력 — "총 3년 7개월"
  const total = t.match(/총\s*(\d+\s*년(?:\s*\d+\s*개월)?|\d+\s*개월)/);
  if (total) out.careerTotal = total[1].replace(/\s+/g, ' ').trim();

  // ── 경력 — 기간이 있는 줄을 기준으로 회사·직무·연봉을 모은다
  const careers = [];
  for (let i = 0; i < lines.length && careers.length < 3; i++) {
    const l = lines[i];
    const m = l.match(PERIOD_RE);
    if (!m) continue;
    // 학력 줄(학과·학교)은 경력이 아니다 — 같은 기간 표기를 쓰기 때문에 먼저 걸러낸다
    if (/학과|학부|대학|고등학교|졸업|중퇴|[가-힣]{3,12}과\s*[(（]/.test(l)) continue;

    const end = /재직|현재/.test(m[3]) ? '재직중' : `${m[4]}. ${String(m[5]).padStart(2, '0')}`;
    const period = `${m[1]}. ${String(m[2]).padStart(2, '0')} ~ ${end}`;

    // 잡코리아 인쇄본은 한 줄이 탭으로 갈린다 — "보안팀 사원 \t 2024.01 ~ 재직중 \t 주식회사 더 가디언스"
    // 칸 단위로 봐야 "주식회사 더 가디언스"가 중간 공백에서 잘리지 않는다.
    const fields = l.split(/\t|\s{2,}/).map((x) => x.trim()).filter(Boolean);
    // 회사명이 같은 줄에 없고 바로 다음 줄에 따로 오는 이력서도 있다
    //   "사원 \t 2022. 12 ~ 2023. 06" / "7개월" / "(주)케이지에프앤비"
    const nearby = lines.slice(i + 1, i + 4).find((x) => COMPANY_RE.test(x) && x.length <= 30);
    const co =
      fields.find((f) => COMPANY_RE.test(f)) ||
      (l.match(COMPANY_RE) || [])[1] ||
      nearby ||
      fields.find((f) => !PERIOD_RE.test(f) && !ROLE_RE.test(f) && /[가-힣]{2,}/.test(f)) ||
      '';
    if (!co || co.length > 30) continue;
    const role = (l.match(ROLE_RE) || [])[1] || '';
    // 회사 표기도 직위도 없으면 경력 줄이 아니다 (학력·자격증 줄이 섞여 들어온다)
    if (!COMPANY_RE.test(co) && !role) continue;
    let salary = '';
    let duty = '';
    for (let k = i + 1; k <= i + 3 && k < lines.length; k++) {
      const s = lines[k];
      if (!salary && /연봉/.test(s)) {
        const sm = s.match(/([\d,]{3,7})\s*만원/);
        if (sm) salary = `${sm[1]}만원`;
      }
      if (!duty && /주요직무/.test(s)) duty = s.replace(/주요직무/g, '').replace(/\s+/g, ' ').trim();
    }
    careers.push({ company: co, period, role, duty, salary });
  }
  out.careers = careers.map((c) => ({
    company: c.company,
    role: [c.duty, c.role].filter(Boolean).join(' / '),
    period: c.period,
    salary: c.salary,
  }));
  out.lastSalary = (careers.find((c) => c.salary) || {}).salary || '';
  return out;
}

module.exports = { profileFromText };
