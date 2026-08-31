// 부서별 업무 편제표 — 누가 무엇을 맡고 있는지.
//
// 부서를 추가하려면 이 파일에 항목 하나만 넣으면 된다.
// 사이드바 소분류 탭과 라우팅은 이 배열에서 자동으로 만들어진다.

export interface ChartMember {
  /** 담당 업무 (제조 / 충전 / 포장 …) */
  role: string;
  /** 담당자. 비었으면 공석 */
  person: string;
  /** 직급·비고 (주임(P), 사원 …) */
  grade?: string;
  vacant?: boolean;
}

export interface ChartGroup {
  /** 사이트·파트 이름 (퍼플카운티 / 그린카운티 / 3공장 …) */
  name: string;
  /** 편제 인원 */
  headcount?: number;
  /** 이 파트가 맡는 업무 */
  duties?: string[];
  members: ChartMember[];
}

export interface Vendor {
  /** 담당 공정 (포장/심조립 …) */
  category?: string;
  name: string;
  site?: string;
}

export interface DeptChart {
  /** 사이드바/라우팅 키 */
  id: string;
  /** 부서명 */
  dept: string;
  /** 소속 본부 */
  hq?: string;
  /** 편제 총원 */
  headcount?: number;
  /** 팀장·책임자 */
  lead?: string;
  /** 기준일 */
  asOf: string;
  /** 원본 파일 */
  source: string;
  groups: ChartGroup[];
  /** 외주 전용 업체 */
  vendors?: Vendor[];
  /** 원본에 적힌 특이사항 */
  notes?: string[];
}

const PRODUCTION_OPS: DeptChart = {
  id: 'prodops',
  dept: '생산운영팀',
  hq: '생산본부',
  headcount: 13,
  asOf: '2026-09-01',
  source: '생산운영팀 편제표_0814.pptx',
  groups: [
    {
      name: '팀 직속',
      members: [
        { role: '신제품 L/T (생산계획자)', person: '', grade: 'C-레벨', vacant: true },
        { role: '외주계획', person: '손유림', grade: '사원' },
        { role: '외주처리', person: '백승엽', grade: '사원' },
      ],
    },
    {
      name: '퍼플카운티',
      headcount: 3,
      members: [
        { role: '제조', person: '장용진', grade: '주임(P)' },
        { role: '생산', person: '김원진', grade: '사원' },
        { role: '포장', person: '임예진', grade: '사원' },
      ],
    },
    {
      name: '그린카운티',
      headcount: 4,
      members: [
        { role: '제조', person: '이준석', grade: '주임(P)' },
        { role: '타정/본딩', person: '박창헌', grade: '사원' },
        { role: '충전', person: '김형준', grade: '사원' },
        { role: '포장', person: '지민희', grade: '사원' },
      ],
    },
    {
      name: '3공장',
      headcount: 2,
      members: [
        { role: '충전', person: '서성원', grade: '주임(P)' },
        { role: '포장', person: '', vacant: true },
      ],
    },
    {
      name: '외주관리',
      headcount: 2,
      members: [{ role: '외주관리자', person: '', vacant: true }],
    },
  ],
  vendors: [
    { category: '포장/심조립', name: '퍼스투' },
    { category: '틴트/가온', name: '비피에스' },
    { category: '틴트/가온', name: '오드컬러' },
    { category: '몰딩/가온', name: '하이브팩토리' },
    { category: '제심펜슬', name: '카르마' },
  ],
  notes: [
    '한현영 대리 — 휴직 (2026-04-24 ~ 10-23). 신제품 L/T & ERP 고도화 담당',
    '외주계획자 — 오드컬러 / 비피에스 외주 충포장 담당자 1명 충원 필요',
    '외주업체 사이트 표기(3공장 · 퍼플 · 그린 · 그린 · 퍼플 · 퍼플)는 원본에서 행 대응이 불명확해 비워둠',
  ],
};

const STRATEGIC_PURCHASING: DeptChart = {
  id: 'purchasing',
  dept: '전략구매팀',
  hq: '생산본부',
  asOf: '2026-07-01',
  source: '2026년도 전략구매팀 조직도_20260701.pdf',
  lead: '김영욱 팀장',
  groups: [
    {
      name: '원자재구매관리 · 구매',
      duties: ['원료 조달구매', '원산지 관리', '매입 마감'],
      members: [
        { role: '구매', person: '권민아', grade: '주임' },
        { role: '구매', person: '김태형', grade: '주임' },
        { role: '구매', person: '김소영', grade: '사원' },
        { role: '구매', person: '', grade: '채용 예정', vacant: true },
      ],
    },
    {
      name: '원자재구매관리 · 창고',
      duties: ['원료창고 패킹', '원료 관리'],
      members: [
        { role: '창고', person: '한룡진', grade: '사원' },
        { role: '창고', person: '이수현', grade: '사원' },
        { role: '창고', person: '장재훈', grade: '사원' },
        { role: '창고', person: '한상정', grade: '사원' },
        { role: '창고', person: '정용기', grade: '사원' },
        { role: '창고', person: '조민기', grade: '사원' },
      ],
    },
    {
      name: '부자재구매관리 · 국내',
      duties: ['부자재 조달구매(국내)', '매입 마감'],
      members: [
        { role: '국내', person: '이송현', grade: '대리' },
        { role: '국내', person: '유다슬', grade: '대리' },
        { role: '국내', person: '김소연', grade: '주임' },
        { role: '국내', person: '이상민', grade: '사원' },
        { role: '국내', person: '신정수', grade: '사원' },
        { role: '국내', person: '황인우', grade: '사원' },
        { role: '국내', person: '안대건', grade: '사원 (신규)' },
      ],
    },
    {
      name: '부자재구매관리 · 해외',
      duties: ['부자재 조달구매(해외)', '매입 마감'],
      members: [
        { role: '해외', person: '조나단', grade: '대리' },
        { role: '해외', person: '김세언', grade: '사원' },
        { role: '해외', person: '갈윤정', grade: '사원' },
      ],
    },
    {
      name: '자재개발 · 소싱디자인',
      duties: ['자재 소싱', '감리 업무', '디자인'],
      members: [
        { role: '소싱디자인', person: '이준희', grade: '차장' },
        { role: '소싱디자인', person: '반다예', grade: '사원' },
        { role: '소싱디자인', person: '박지영', grade: '사원' },
        { role: '소싱디자인', person: '이윤정', grade: '사원 (7/16 퇴사예정)' },
        { role: '소싱디자인', person: '이성호', grade: '사원 (신규)' },
        { role: '소싱디자인', person: '', grade: '채용 예정', vacant: true },
      ],
    },
  ],
  notes: [
    '원본 PDF에 숫자 글리프가 빠져 있어 파트별 편제 인원 수는 넣지 않았습니다 (사람·업무만 반영)',
  ],
};

export const ORG_CHARTS: DeptChart[] = [PRODUCTION_OPS, STRATEGIC_PURCHASING];

export function getOrgChart(id: string): DeptChart | null {
  return ORG_CHARTS.find((c) => c.id === id) || null;
}

/** 편제 인원 집계 — 공석 포함/제외를 나눠서 센다 */
export function countChart(chart: DeptChart): { filled: number; vacant: number; total: number } {
  let filled = 0;
  let vacant = 0;
  for (const g of chart.groups) {
    for (const m of g.members) {
      if (m.vacant || !m.person) vacant++;
      else filled++;
    }
  }
  return { filled, vacant, total: filled + vacant };
}
