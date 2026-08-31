// 경쟁사 조직도 데이터 — 한국콜마(KKM), 코스맥스㈜.
//
// 원본: 형도님이 받은 조직도 파일(KKM_조직도.pptx / 코스맥스(주)_간편조직도_260301.pdf)에서
// 텍스트·좌표를 추출해 트리로 재구성한 것. 이미지 캡처가 아니라 데이터라서
// 앱에서 검색·펼침·집계가 된다.
//
// 레벨 규칙: unit(부문/총괄/본부/연구원) > group(그룹/연구소/센터/실) > team(팀)

export interface OrgNode {
  name: string;
  /** 하위 조직 */
  children?: OrgNode[];
  /** 참고 메모 (원본에 표기된 특이사항) */
  note?: string;
}

export interface CompetitorOrg {
  id: string;
  /** 사이드바/탭에 쓰는 짧은 이름 */
  short: string;
  /** 정식 명칭 */
  name: string;
  /** 조직도 기준일 */
  asOf: string;
  /** 원본 파일에 적힌 요약 문구 (있으면) */
  summary?: string;
  /** 원본 파일명 */
  source: string;
  /** 최상위 조직들 */
  tree: OrgNode[];
  /** 원본에 적힌 조직 개편 이력 */
  changes?: string[];
}

// ─────────────────────────────────────────────────────────────
// 한국콜마 (KKM)
// ─────────────────────────────────────────────────────────────
const KOLMAR: CompetitorOrg = {
  id: 'kolmar',
  short: '한국콜마',
  name: '한국콜마 (KKM)',
  asOf: '2026-08 입수본',
  source: 'KKM_조직도.pptx',
  tree: [
    {
      name: 'CSO',
      children: [
        { name: '경영진단팀' },
        { name: '준법지원팀' },
        { name: 'ESG경영팀' },
        { name: '여주아카데미' },
      ],
    },
    {
      name: '글로벌생산총괄',
      children: [
        {
          name: '품질본부',
          children: [
            { name: '품질관리1팀' },
            { name: '품질관리2팀' },
            { name: '품질관리3팀' },
            { name: '품질관리4팀' },
            { name: '품질보증팀' },
            { name: '패키지엔지니어팀' },
            { name: '스케일업팀' },
          ],
        },
      ],
    },
    {
      name: '디지털그룹',
      children: [{ name: '경영정보팀' }, { name: 'DT운영팀' }, { name: 'PI기획팀' }],
    },
    { name: '감사' },
    { name: '테스트부서' },
    {
      name: '마케팅크리에이티브본부',
      children: [
        {
          name: '마케팅그룹',
          children: [
            { name: '마케팅1팀' },
            { name: '마케팅2팀' },
            { name: '글로벌마케팅팀' },
            { name: '마케팅전략팀' },
          ],
        },
        {
          name: '디자인그룹',
          children: [
            { name: '디자인개발1팀' },
            { name: '디자인개발2팀' },
            { name: '디자인기술개발팀' },
            { name: '그래픽디자인팀' },
          ],
        },
      ],
    },
    {
      name: '영업본부',
      children: [
        { name: '영업1그룹', children: [{ name: '영업1팀' }, { name: '영업2팀' }, { name: '영업3팀' }] },
        { name: '영업2그룹', children: [{ name: '영업4팀' }, { name: '영업5팀' }, { name: '영업6팀' }] },
        {
          name: '영업기획그룹',
          children: [{ name: '영업기획팀' }, { name: 'CSM1팀' }, { name: 'CSM2팀' }, { name: 'New Biz팀' }],
        },
      ],
    },
    {
      name: '생산본부',
      children: [
        {
          name: '스킨케어생산그룹',
          children: [
            { name: '제조기술팀' },
            { name: '포장기술팀' },
            { name: '칭량기술팀' },
            { name: '공장관리팀' },
            { name: '공정기술혁신팀' },
            { name: '용역(세종)' },
          ],
        },
        {
          name: '메이크업생산그룹',
          children: [
            { name: '메이크업제조기술팀' },
            { name: '메이크업생산기술팀' },
            { name: '메이크업공정혁신팀' },
          ],
        },
        {
          name: '엔지니어링그룹',
          children: [{ name: '엔지니어링1팀' }, { name: '엔지니어링2팀' }, { name: '환경안전팀' }],
        },
        {
          name: 'SCM그룹',
          children: [
            { name: '생산계획팀(세종)' },
            { name: '생산계획팀(부천)' },
            { name: '협력생산팀' },
            { name: '물류팀(세종)' },
            { name: '물류팀(부천)' },
            { name: '원료구매팀' },
            { name: '패키지구매팀' },
            { name: '전략구매팀' },
          ],
        },
      ],
    },
    {
      name: '성장경영본부',
      children: [
        { name: '기획그룹', children: [{ name: '기획팀' }, { name: '원가기획팀' }] },
        { name: '인사그룹', children: [{ name: '인사팀' }, { name: '인재개발팀' }, { name: '총무팀' }] },
        {
          name: '재무그룹',
          children: [
            { name: '회계팀' },
            { name: '재무팀' },
            { name: '내부통제팀' },
            { name: '채권관리팀' },
            { name: 'IR팀' },
            { name: '공시팀' },
          ],
        },
      ],
    },
    {
      name: '글로벌성장혁신부문',
      children: [
        { name: 'R&I GROUP' },
        { name: '성장경영본부(KML)' },
        { name: 'GXH영업본부' },
        { name: 'GBD본부' },
        { name: 'GXH연구소' },
        { name: '글로벌성장혁신팀' },
        { name: '북미법인' },
        { name: 'KMW' },
        { name: 'KMB' },
      ],
    },
    {
      name: '기술연구원',
      children: [
        {
          name: '스킨케어연구소',
          children: [
            { name: '스킨케어1팀' },
            { name: '스킨케어2팀' },
            { name: '스킨케어3팀' },
            { name: '마스크팀' },
            { name: '전략소재개발팀' },
          ],
        },
        {
          name: '메이크업연구소',
          children: [{ name: '파우더연구팀' }, { name: '스틱연구팀' }, { name: '리퀴드연구팀' }],
        },
        {
          name: '유브이테크이노베이션연구소',
          children: [
            { name: '선케어1팀' },
            { name: '선케어2팀' },
            { name: '선케어3팀' },
            { name: '베이스메이크업팀' },
            { name: 'Global UV Formulation팀' },
          ],
        },
        {
          name: '퍼스널케어연구소',
          children: [{ name: '헤어연구팀' }, { name: '바디연구팀' }, { name: '덴탈연구팀' }, { name: 'C/T연구팀' }],
        },
        {
          name: '융합기술연구소',
          children: [{ name: '테크프론티어팀' }, { name: '에이아이앤이노베이션팀' }],
        },
        {
          name: '피부천연물연구소',
          children: [{ name: '소재개발팀' }, { name: '피부연구팀' }, { name: '안전성학술팀' }],
        },
        { name: '분석센터', children: [{ name: '분석연구팀' }, { name: '미생물연구팀' }] },
        {
          name: 'RAS센터',
          children: [{ name: '규제정책팀' }, { name: '허가인증팀' }, { name: '제품지원팀' }, { name: '연구전략팀' }],
        },
        { name: 'Chroma Kolmar Studio', children: [{ name: 'Chroma Kolmar팀' }] },
        { name: "U'r Lab", children: [{ name: "U'r팀" }] },
        { name: '향료연구센터' },
        { name: '바이오스킨랩TF' },
        { name: '글로벌메이크업연구소' },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────
// 코스맥스㈜
// ─────────────────────────────────────────────────────────────
const COSMAX: CompetitorOrg = {
  id: 'cosmax',
  short: '코스맥스',
  name: '코스맥스㈜',
  asOf: '2026-03-01 기준',
  summary: '11개 부문 · 9개 연구소 · 20개 본부 · 24개 Lab · 2개 실 · 116개 팀 (R&I 포함)',
  source: '코스맥스(주)_간편조직도_260301.pdf',
  changes: [
    '신설 — 향료연구소 (R&I Unit 산하)',
    '조직명 변경 — 향료연구팀 → 향료연구1팀 / 글로벌향료연구팀 → 향료연구2팀',
    '조직명 변경 — BM1팀 → OBM1팀 / BM2팀 → OBM2팀',
    '폐쇄 — OBM마케팅팀',
  ],
  tree: [
    { name: '감사' },
    { name: '경영진단실', children: [{ name: '경영진단팀' }] },
    {
      name: '경영지원부문',
      children: [
        { name: '자금본부', children: [{ name: '자금팀' }] },
        { name: '인도사무소' },
        { name: '인사운영팀' },
        { name: '법무팀' },
        { name: '해외법무팀' },
      ],
    },
    {
      name: '기획관리부문',
      children: [
        { name: '경영관리팀' },
        { name: '경영기획팀' },
        { name: '수출유통추진팀' },
        { name: '지속가능경영실', children: [{ name: '지속가능경영팀' }] },
        { name: '준법경영실' },
      ],
    },
    {
      name: 'PI혁신부문',
      children: [{ name: 'PI혁신팀' }],
    },
    {
      name: '마케팅부문',
      children: [
        {
          name: '국내마케팅본부',
          note: '마케팅1~8팀 운영',
          children: [
            { name: '마케팅1팀' },
            { name: '마케팅2팀' },
            { name: '마케팅3팀' },
            { name: '마케팅4팀' },
            { name: '마케팅5팀' },
            { name: '마케팅6팀' },
            { name: '마케팅7팀' },
            { name: '마케팅8팀' },
          ],
        },
        { name: '영업관리본부', children: [{ name: '영업관리팀' }, { name: '전략팀' }] },
        { name: '소비자연구본부', children: [{ name: '소비자연구팀' }] },
      ],
    },
    {
      name: '전략마케팅부문',
      children: [
        {
          name: '전략마케팅본부',
          note: '전략마케팅1~7팀 운영',
          children: [
            { name: '전략마케팅1팀' },
            { name: '전략마케팅2팀' },
            { name: '전략마케팅3팀' },
            { name: '전략마케팅4팀' },
            { name: '전략마케팅5팀' },
            { name: '전략마케팅6팀' },
            { name: '전략마케팅7팀' },
          ],
        },
      ],
    },
    {
      name: '디자인R&I부문',
      children: [
        {
          name: '디자인본부',
          children: [
            { name: '패키지디자인1팀' },
            { name: '패키지디자인2팀' },
            { name: '패키지디자인3팀' },
            { name: '프로덕트디자인팀' },
            { name: '프로덕트디벨럽먼트팀' },
          ],
        },
      ],
    },
    {
      name: '생산부문',
      children: [
        {
          name: '구매본부',
          children: [
            { name: '패키징구매1팀' },
            { name: '패키징구매2팀' },
            { name: '원료구매팀' },
            { name: '공장지원팀' },
          ],
        },
        {
          name: '생산본부',
          children: [
            { name: '생산운영팀' },
            { name: '외주관리팀' },
            { name: '생산1팀' },
            { name: '생산2팀' },
            { name: '생산3팀' },
          ],
        },
        { name: '물류본부', children: [{ name: '물류팀' }] },
        {
          name: '생산기술본부',
          children: [
            { name: '공정개발팀' },
            { name: '자동화팀' },
            { name: '기획팀' },
            { name: '생산기술1팀' },
            { name: '생산기술2팀' },
            { name: '환경안전1팀' },
            { name: '환경안전2팀' },
          ],
        },
        {
          name: '품질본부',
          children: [
            { name: '품질보증팀' },
            { name: '입고검사팀' },
            { name: '제품검사팀' },
            { name: '품질분석팀' },
          ],
        },
      ],
    },
    {
      name: '개인화플랫폼추진본부',
      children: [{ name: '부자재실' }, { name: '원료실' }, { name: '제품실' }],
    },
    {
      name: '혁신본부',
      children: [{ name: '혁신팀' }, { name: '혁신마케팅팀' }],
    },
    {
      name: 'R&I (연구부문)',
      note: '9개 연구소 · 24개 Lab 체계. 간편조직도에는 Lab 단위 명칭이 표기되지 않음',
      children: [
        { name: '선케어연구소' },
        { name: '스킨케어연구소' },
        { name: '베이스 메이크업연구소' },
        { name: '포트 메이크업연구소', children: [{ name: '색채연구팀' }] },
        {
          name: '글로벌연구소',
          children: [{ name: '글로벌1팀' }, { name: '글로벌2팀' }, { name: '글로벌3팀' }],
        },
        {
          name: '기반기술연구소',
          children: [
            { name: '감성연구팀' },
            { name: '안전평가연구팀' },
            { name: '미생물연구팀' },
            { name: '분석연구팀' },
            { name: '피부임상연구팀' },
            { name: '포장재상용성연구팀' },
            { name: '기반기술연구팀' },
            { name: '기반소재연구팀' },
          ],
        },
        {
          name: '향료연구소',
          note: '2026-03-01 신설',
          children: [{ name: '향료연구1팀' }, { name: '향료연구2팀' }],
        },
        {
          name: '연구경영본부',
          children: [{ name: '연구경영1팀' }, { name: '연구경영2팀' }, { name: '연구경영3팀' }],
        },
      ],
    },
  ],
};

export const COMPETITORS: CompetitorOrg[] = [KOLMAR, COSMAX];

export function getCompetitor(id: string): CompetitorOrg | null {
  return COMPETITORS.find((c) => c.id === id) || null;
}

/** 트리 전체를 훑어 레벨별 개수를 센다 */
export function countOrg(nodes: OrgNode[]): { units: number; groups: number; teams: number; total: number } {
  let units = 0, groups = 0, teams = 0, total = 0;
  const walk = (list: OrgNode[], depth: number) => {
    for (const n of list) {
      total++;
      if (/팀$/.test(n.name)) teams++;
      else if (depth === 0) units++;
      else groups++;
      if (n.children) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return { units, groups, teams, total };
}
