// ============================================================
//  채용 Funnel — 전형별 진행 단계 + 시간 stamp 보고용 페이지
// ============================================================
//  사용자 요구 (2026-05-28):
//   - 전형(=포지션)별 이력서 입수 → 서류 → 1차/2차 면접 → 처우 → 최종 합격 funnel
//   - 각 단계 수량 + % + 평균 소요일
//   - 단계별 시간 stamp (언제 이력서 받고, 언제 면접 봤고, 언제 합격 안내)
//   - 시트는 사용자가 만들 예정 → 일단 mock으로 틀 완성, 시트 양식은 아래 SHEET_SPEC에 명시
//
//  데이터 소스: 시트 kind = 'recruit_funnel'  (한 행 = 한 후보자)
//   필요한 컬럼 (헤더는 정확히 일치하지 않아도 pickCol이 부분 매칭으로 잡음):
//
//   ┌────────────────────────────────┬─────────────────────────────────────┐
//   │ 컬럼명                         │ 형식 / 예시                          │
//   ├────────────────────────────────┼─────────────────────────────────────┤
//   │ 포지션ID                       │ 2026-00665                          │
//   │ 본부                           │ 경영기획본부                          │
//   │ 팀                             │ 영업관리팀                           │
//   │ 직무                           │ 해외영업관리                          │
//   │ 채용유형                       │ 신규 / 결원 / 증원 / 부서이동         │
//   │ 우선순위                       │ 즉시 / 결재중 / 장기                  │
//   │ 근무지                         │ 퍼플 / 그린 / 수원 / 방교 / 위워크    │
//   │ 후보자                         │ 박수지                              │
//   │ 채널                           │ 사람인 / 잡코리아 / 원티드 / 링크드인 │
//   │                                │ / 추천 / 일자리센터 / 박람회 / 자체   │
//   │ 이력서_입수일                  │ 2026-05-15 14:00 (YYYY-MM-DD HH:MM) │
//   │ 서류_결과                      │ 합격 / 불합격 / 대기 / 취소           │
//   │ 서류_확정일                    │ 2026-05-17 10:30                    │
//   │ 1차면접_예정일                 │ 2026-05-22 14:30                    │
//   │ 1차면접_결과                   │ 합격 / 불합격 / 대기 / 노쇼 / 포기    │
//   │ 1차면접_확정일                 │ 2026-05-23 16:00                    │
//   │ 2차면접_예정일                 │                                     │
//   │ 2차면접_결과                   │                                     │
//   │ 2차면접_확정일                 │                                     │
//   │ 처우협의_시작일                │                                     │
//   │ 처우협의_확정일                │                                     │
//   │ 최종합격_안내일                │ 합격 안내 메일 발송일                │
//   │ 입사예정일                     │ 2026-06-15                          │
//   │ 최종상태                       │ 입사확정/입사취소/면접포기/탈락/진행중│
//   │ 비고                           │ 자유 텍스트                          │
//   └────────────────────────────────┴─────────────────────────────────────┘
//
//  핵심 원칙:
//   1. 시간 stamp는 YYYY-MM-DD 또는 YYYY-MM-DD HH:MM 형식. 비어있으면 "아직 진행 안 됨".
//   2. 한 포지션(본부+팀+직무)에 여러 후보자가 매핑됨 → 포지션 단위로 그룹핑.
//   3. 시트 미연결 상태에서는 MOCK_FUNNEL로 화면 살아있게 유지.
//   4. 사용자 정책 (메모리): 시트 절대 쓰기 안 함 — read-only.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveData, liveByKindOrScan } from '../store/liveData';

// ============================================================
//  타입 + 시트 행 정규화
// ============================================================

type Stage =
  | 'resume'        // 이력서 입수
  | 'screening'     // 서류 전형
  | 'first'         // 1차 면접
  | 'second'        // 2차 면접
  | 'negotiation'   // 처우 협의
  | 'offer'         // 최종 합격 안내
  | 'hired';        // 입사 확정

type StageResult = 'pass' | 'fail' | 'pending' | 'drop';

interface CandidateRow {
  positionId: string;
  hq: string;
  team: string;
  job: string;
  type: string;       // 신규/결원/증원
  priority: string;   // 즉시/결재중/장기
  site: string;       // 퍼플/그린/수원...
  name: string;
  channel: string;
  resumeAt: string;
  screeningResult: string;
  screeningAt: string;
  first1ScheduledAt: string;
  firstResult: string;
  firstResolvedAt: string;
  second2ScheduledAt: string;
  secondResult: string;
  secondResolvedAt: string;
  negoStartedAt: string;
  negoResolvedAt: string;
  offerSentAt: string;
  joinPlannedAt: string;
  finalStatus: string;
  note: string;
}

function pickCol(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const want = c.replace(/[\s_\-.]+/g, '');
    for (const [k, v] of Object.entries(row)) {
      if (k.replace(/[\s_\-.]+/g, '').includes(want)) return (v || '').trim();
    }
  }
  return '';
}

function normalizeRow(r: Record<string, string>): CandidateRow {
  return {
    positionId: pickCol(r, ['포지션ID', '포지션', '채용요청ID']),
    hq: pickCol(r, ['본부']),
    team: pickCol(r, ['팀']),
    job: pickCol(r, ['직무']),
    type: pickCol(r, ['채용유형', '유형', '사유']),
    priority: pickCol(r, ['우선순위', '우선', '긴급']),
    site: pickCol(r, ['근무지', '사이트']),
    name: pickCol(r, ['후보자', '성명', '이름']),
    channel: pickCol(r, ['채널', '경로', '루트']),
    resumeAt: pickCol(r, ['이력서입수일', '이력서일', '이력서']),
    screeningResult: pickCol(r, ['서류결과', '서류전형결과', '서류']),
    screeningAt: pickCol(r, ['서류확정일', '서류전형확정일']),
    first1ScheduledAt: pickCol(r, ['1차면접예정일', '1차면접일']),
    firstResult: pickCol(r, ['1차면접결과']),
    firstResolvedAt: pickCol(r, ['1차면접확정일', '1차면접결과일']),
    second2ScheduledAt: pickCol(r, ['2차면접예정일', '2차면접일']),
    secondResult: pickCol(r, ['2차면접결과']),
    secondResolvedAt: pickCol(r, ['2차면접확정일']),
    negoStartedAt: pickCol(r, ['처우협의시작일', '처우시작일']),
    negoResolvedAt: pickCol(r, ['처우협의확정일', '처우확정일']),
    offerSentAt: pickCol(r, ['최종합격안내일', '합격안내일', '오퍼발송일']),
    joinPlannedAt: pickCol(r, ['입사예정일', '입사일']),
    finalStatus: pickCol(r, ['최종상태', '상태']),
    note: pickCol(r, ['비고']),
  };
}

// ============================================================
//  MOCK — 시트 비어있을 때 화면 살아있게
// ============================================================

const MOCK_FUNNEL: CandidateRow[] = [
  // 포지션 A: 영업관리팀 / 해외영업관리 — 4명
  mkMock({ positionId: '2026-00665', hq: '경영기획본부', team: '영업관리팀', job: '해외영업관리', type: '결원', priority: '즉시', site: '퍼플', name: '박수지', channel: '사람인', resumeAt: '2026-05-12 09:30', screeningResult: '합격', screeningAt: '2026-05-13 14:00', first1ScheduledAt: '2026-05-19 14:30', firstResult: '합격', firstResolvedAt: '2026-05-20 17:00', second2ScheduledAt: '2026-05-26 11:00', secondResult: '대기', finalStatus: '진행중' }),
  mkMock({ positionId: '2026-00665', hq: '경영기획본부', team: '영업관리팀', job: '해외영업관리', type: '결원', priority: '즉시', site: '퍼플', name: '강다영', channel: '잡코리아', resumeAt: '2026-05-15 11:00', screeningResult: '합격', screeningAt: '2026-05-16 10:00', first1ScheduledAt: '2026-05-22 16:00', firstResult: '대기', finalStatus: '진행중' }),
  mkMock({ positionId: '2026-00665', hq: '경영기획본부', team: '영업관리팀', job: '해외영업관리', type: '결원', priority: '즉시', site: '퍼플', name: '김수연', channel: '추천', resumeAt: '2026-05-10 14:00', screeningResult: '합격', screeningAt: '2026-05-11 09:30', first1ScheduledAt: '2026-05-22 14:30', firstResult: '불합격', firstResolvedAt: '2026-05-23 13:00', finalStatus: '탈락' }),
  mkMock({ positionId: '2026-00665', hq: '경영기획본부', team: '영업관리팀', job: '해외영업관리', type: '결원', priority: '즉시', site: '퍼플', name: '이혜지', channel: '원티드', resumeAt: '2026-05-14 16:00', screeningResult: '불합격', screeningAt: '2026-05-15 11:00', finalStatus: '탈락' }),

  // 포지션 B: 구성원경험팀 — 3명
  mkMock({ positionId: '2026-00701', hq: '경영기획본부', team: '구성원경험팀', job: '평가보상', type: '신규', priority: '결재중', site: '퍼플', name: '이하영', channel: '링크드인', resumeAt: '2026-05-18 10:00', screeningResult: '합격', screeningAt: '2026-05-19 16:00', first1ScheduledAt: '2026-05-27 10:00', firstResult: '대기', finalStatus: '진행중' }),
  mkMock({ positionId: '2026-00701', hq: '경영기획본부', team: '구성원경험팀', job: '평가보상', type: '신규', priority: '결재중', site: '퍼플', name: '김태원', channel: '링크드인', resumeAt: '2026-05-18 10:00', screeningResult: '합격', screeningAt: '2026-05-19 16:00', first1ScheduledAt: '2026-05-27 14:00', firstResult: '대기', finalStatus: '진행중' }),
  mkMock({ positionId: '2026-00701', hq: '경영기획본부', team: '구성원경험팀', job: '평가보상', type: '신규', priority: '결재중', site: '퍼플', name: '강민서', channel: '사람인', resumeAt: '2026-05-08 09:00', screeningResult: '합격', screeningAt: '2026-05-10 11:00', first1ScheduledAt: '2026-05-15 10:00', firstResult: '합격', firstResolvedAt: '2026-05-17 18:00', second2ScheduledAt: '2026-05-22 14:00', secondResult: '합격', secondResolvedAt: '2026-05-23 17:30', negoStartedAt: '2026-05-24 10:00', negoResolvedAt: '2026-05-26 14:00', offerSentAt: '2026-05-27 09:00', joinPlannedAt: '2026-06-15', finalStatus: '입사확정' }),

  // 포지션 C: 제조1팀 — 2명
  mkMock({ positionId: '2026-00218', hq: '생산본부', team: '제조1팀', job: '립제조', type: '결원', priority: '즉시', site: '퍼플', name: '어성철', channel: '잡코리아', resumeAt: '2026-05-19 14:00', screeningResult: '합격', screeningAt: '2026-05-20 11:00', first1ScheduledAt: '2026-05-28 10:00', firstResult: '대기', finalStatus: '진행중' }),
  mkMock({ positionId: '2026-00218', hq: '생산본부', team: '제조1팀', job: '립제조', type: '결원', priority: '즉시', site: '퍼플', name: '한준희', channel: '사람인', resumeAt: '2026-05-16 09:00', screeningResult: '합격', screeningAt: '2026-05-17 14:30', first1ScheduledAt: '2026-05-21 14:00', firstResult: '합격', firstResolvedAt: '2026-05-22 16:00', second2ScheduledAt: '2026-05-29 11:00', secondResult: '대기', finalStatus: '진행중' }),
];

function mkMock(p: Partial<CandidateRow>): CandidateRow {
  return {
    positionId: '', hq: '', team: '', job: '', type: '', priority: '', site: '',
    name: '', channel: '', resumeAt: '',
    screeningResult: '', screeningAt: '',
    first1ScheduledAt: '', firstResult: '', firstResolvedAt: '',
    second2ScheduledAt: '', secondResult: '', secondResolvedAt: '',
    negoStartedAt: '', negoResolvedAt: '', offerSentAt: '', joinPlannedAt: '',
    finalStatus: '', note: '', ...p,
  };
}

// ============================================================
//  단계 분류 + 진행 상태 판정
// ============================================================

function classifyResult(s: string): StageResult {
  const t = (s || '').trim();
  if (!t) return 'pending';
  if (/노쇼|포기|취소|두절/.test(t)) return 'drop';
  if (/불합격|탈락/.test(t)) return 'fail';
  if (/합격|입사확정|입사완료/.test(t)) return 'pass';
  return 'pending';
}

function currentStage(c: CandidateRow): Stage {
  // 가장 진행된 단계를 끝부터 거꾸로 찾는다
  if (c.joinPlannedAt || /입사확정|입사완료/.test(c.finalStatus)) return 'hired';
  if (c.offerSentAt) return 'offer';
  if (c.negoStartedAt || c.negoResolvedAt) return 'negotiation';
  if (c.second2ScheduledAt || c.secondResolvedAt) return 'second';
  if (c.first1ScheduledAt || c.firstResolvedAt) return 'first';
  if (c.screeningResult || c.screeningAt) return 'screening';
  if (c.resumeAt) return 'resume';
  return 'resume';
}

function isAlive(c: CandidateRow): boolean {
  const fin = (c.finalStatus || '').trim();
  if (/탈락|취소|포기|두절|입사취소|불합격/.test(fin)) return false;
  if (classifyResult(c.screeningResult) === 'fail' || classifyResult(c.screeningResult) === 'drop') return false;
  if (classifyResult(c.firstResult) === 'fail' || classifyResult(c.firstResult) === 'drop') return false;
  if (classifyResult(c.secondResult) === 'fail' || classifyResult(c.secondResult) === 'drop') return false;
  return true;
}

// ============================================================
//  날짜 유틸
// ============================================================

function parseDate(s: string): Date | null {
  if (!s) return null;
  // "2026-05-15 14:00" 또는 "2026-05-15" 모두 수용
  const t = s.replace(/\./g, '-').trim();
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const yy = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10) - 1;
  const dd = parseInt(m[3], 10);
  const hh = m[4] ? parseInt(m[4], 10) : 0;
  const mi = m[5] ? parseInt(m[5], 10) : 0;
  return new Date(yy, mm, dd, hh, mi);
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

function fmtAgo(s: string): string {
  const d = parseDate(s);
  if (!d) return '';
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 0) return `${-days}일 후`;
  if (days === 0) {
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return '방금';
    return `${hours}시간 전`;
  }
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

// ============================================================
//  포지션별 그룹핑 + funnel 통계
// ============================================================

interface PositionFunnel {
  key: string;       // hq|team|job
  positionId: string;
  hq: string;
  team: string;
  job: string;
  type: string;
  priority: string;
  site: string;
  candidates: CandidateRow[];
  // 단계별 수량
  counts: {
    resume: number;
    screeningPass: number;
    firstPass: number;
    secondPass: number;
    offer: number;
    hired: number;
  };
  // 평균 소요일
  avg: {
    resumeToFirst: number | null;
    firstToOffer: number | null;
    resumeToHire: number | null;
  };
  // 최근 활동 (가장 최근 단계 변경)
  recent: { name: string; what: string; at: string } | null;
}

function buildPositions(rows: CandidateRow[]): PositionFunnel[] {
  const map = new Map<string, PositionFunnel>();
  for (const c of rows) {
    const key = `${c.hq}|${c.team}|${c.job}`;
    if (!map.has(key)) {
      map.set(key, {
        key, positionId: c.positionId, hq: c.hq, team: c.team, job: c.job,
        type: c.type, priority: c.priority, site: c.site,
        candidates: [],
        counts: { resume: 0, screeningPass: 0, firstPass: 0, secondPass: 0, offer: 0, hired: 0 },
        avg: { resumeToFirst: null, firstToOffer: null, resumeToHire: null },
        recent: null,
      });
    }
    map.get(key)!.candidates.push(c);
  }

  for (const p of map.values()) {
    const cs = p.candidates;
    p.counts.resume = cs.filter((c) => c.resumeAt).length;
    p.counts.screeningPass = cs.filter((c) => classifyResult(c.screeningResult) === 'pass').length;
    p.counts.firstPass = cs.filter((c) => classifyResult(c.firstResult) === 'pass').length;
    p.counts.secondPass = cs.filter((c) => classifyResult(c.secondResult) === 'pass').length;
    p.counts.offer = cs.filter((c) => !!c.offerSentAt).length;
    p.counts.hired = cs.filter((c) => /입사확정|입사완료/.test(c.finalStatus) || !!c.joinPlannedAt).length;

    // 평균 소요일
    const r2f = cs.map((c) => {
      const r = parseDate(c.resumeAt);
      const f = parseDate(c.first1ScheduledAt);
      return r && f ? daysBetween(r, f) : null;
    }).filter((x): x is number => x !== null);
    p.avg.resumeToFirst = r2f.length ? avg(r2f) : null;

    const f2o = cs.map((c) => {
      const f = parseDate(c.first1ScheduledAt);
      const o = parseDate(c.offerSentAt);
      return f && o ? daysBetween(f, o) : null;
    }).filter((x): x is number => x !== null);
    p.avg.firstToOffer = f2o.length ? avg(f2o) : null;

    const r2h = cs.map((c) => {
      const r = parseDate(c.resumeAt);
      const j = parseDate(c.joinPlannedAt);
      return r && j ? daysBetween(r, j) : null;
    }).filter((x): x is number => x !== null);
    p.avg.resumeToHire = r2h.length ? avg(r2h) : null;

    // 최근 활동 — 가장 최근 timestamp 가진 후보자/단계
    type Activity = { name: string; what: string; at: string; ts: number };
    const acts: Activity[] = [];
    for (const c of cs) {
      const push = (what: string, at: string) => {
        const d = parseDate(at);
        if (d) acts.push({ name: c.name, what, at, ts: d.getTime() });
      };
      push('이력서 입수', c.resumeAt);
      push(`서류 ${c.screeningResult || ''}`.trim(), c.screeningAt);
      push(`1차 ${c.firstResult || '예정'}`.trim(), c.firstResolvedAt || c.first1ScheduledAt);
      push(`2차 ${c.secondResult || '예정'}`.trim(), c.secondResolvedAt || c.second2ScheduledAt);
      push('처우 시작', c.negoStartedAt);
      push('처우 종료', c.negoResolvedAt);
      push('합격 안내', c.offerSentAt);
      push('입사 예정', c.joinPlannedAt);
    }
    if (acts.length > 0) {
      acts.sort((a, b) => b.ts - a.ts);
      const top = acts[0];
      p.recent = { name: top.name, what: top.what, at: top.at };
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    // 우선순위: 즉시 > 결재중 > 기타
    const score = (s: string) => /즉시/.test(s) ? 0 : /결재/.test(s) ? 1 : 2;
    const dp = score(a.priority) - score(b.priority);
    if (dp !== 0) return dp;
    return b.candidates.length - a.candidates.length;
  });
}

function avg(xs: number[]): number {
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
}

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

// ============================================================
//  메인 페이지
// ============================================================

export function RecruitFunnel() {
  const live = useLiveData();
  const sheetRows = useMemo(() => {
    if (!live.hasLive) return [];
    return liveByKindOrScan('recruit_funnel').map(normalizeRow).filter((c) => c.name);
  }, [live]);

  const usingMock = sheetRows.length === 0;
  const rows = usingMock ? MOCK_FUNNEL : sheetRows;

  const positions = useMemo(() => buildPositions(rows), [rows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);

  // 상세 뷰 진입 시 뒤로가기 키 처리
  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey]);

  const selectedIdx = selectedKey ? positions.findIndex((p) => p.key === selectedKey) : -1;
  const selectedPosition = selectedIdx >= 0 ? positions[selectedIdx] : null;
  const gotoPrev = () => {
    if (selectedIdx > 0) setSelectedKey(positions[selectedIdx - 1].key);
  };
  const gotoNext = () => {
    if (selectedIdx >= 0 && selectedIdx < positions.length - 1) setSelectedKey(positions[selectedIdx + 1].key);
  };

  // 전체 KPI
  const kpi = useMemo(() => {
    const total = rows.length;
    const aliveCount = rows.filter(isAlive).length;
    const resumes = rows.filter((c) => c.resumeAt).length;
    const screened = rows.filter((c) => c.screeningResult).length;
    const screeningPass = rows.filter((c) => classifyResult(c.screeningResult) === 'pass').length;
    const firstPass = rows.filter((c) => classifyResult(c.firstResult) === 'pass').length;
    const finalHired = rows.filter((c) => /입사확정|입사완료/.test(c.finalStatus)).length;

    const cycleDays = rows.map((c) => {
      const r = parseDate(c.resumeAt);
      const j = parseDate(c.joinPlannedAt);
      return r && j ? daysBetween(r, j) : null;
    }).filter((x): x is number => x !== null);

    return {
      activePositions: positions.length,
      activeCandidates: aliveCount,
      totalResumes: resumes,
      screeningRate: pct(screeningPass, screened),
      interviewPassRate: pct(firstPass, rows.filter((c) => c.firstResult).length),
      finalHireRate: pct(finalHired, total),
      avgCycle: cycleDays.length ? `${avg(cycleDays)}일` : '—',
      thisWeekResumes: rows.filter((c) => {
        const d = parseDate(c.resumeAt);
        if (!d) return false;
        return Date.now() - d.getTime() < 7 * 86_400_000;
      }).length,
    };
  }, [rows, positions]);

  // 채널별 통계
  const channelStats = useMemo(() => {
    const map = new Map<string, { total: number; pass: number }>();
    for (const c of rows) {
      const ch = c.channel || '기타';
      if (!map.has(ch)) map.set(ch, { total: 0, pass: 0 });
      const s = map.get(ch)!;
      s.total++;
      if (classifyResult(c.firstResult) === 'pass' || classifyResult(c.secondResult) === 'pass' || c.offerSentAt) s.pass++;
    }
    return Array.from(map.entries())
      .map(([channel, s]) => ({ channel, ...s, rate: s.total ? s.pass / s.total : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  // ───── 상세 뷰 모드 ─────
  if (selectedPosition) {
    return (
      <PositionDetailView
        position={selectedPosition}
        allPositions={positions}
        onBack={() => setSelectedKey(null)}
        onPrev={selectedIdx > 0 ? gotoPrev : undefined}
        onNext={selectedIdx < positions.length - 1 ? gotoNext : undefined}
        onJump={(k) => setSelectedKey(k)}
        usingMock={usingMock}
      />
    );
  }

  // ───── 목록 모드 ─────
  return (
    <div className="space-y-4">
      {/* 헤더 + 모드 배지 */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">🪜 채용 Funnel</h1>
        <span className="text-sm text-slate-600">전형별 진행 단계 + 시간 stamp 보고</span>
        {usingMock && (
          <span className="ml-auto chip bg-amber-100 text-amber-900 border border-amber-300">
            ⚠ Mock 데이터 — 시트 연결 전
          </span>
        )}
        <button
          onClick={() => setShowSpec(!showSpec)}
          className="ml-auto px-3 py-1.5 text-xs rounded-md border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 font-medium"
        >
          {showSpec ? '시트 양식 닫기' : '📋 시트 양식 보기'}
        </button>
      </div>

      {/* 시트 양식 안내 (접힘) */}
      {showSpec && <SheetSpecCard />}

      {/* 전체 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="진행 중 포지션" value={String(kpi.activePositions)} suffix="개" tone="violet" />
        <KpiCard label="진행 중 후보자" value={String(kpi.activeCandidates)} suffix="명" tone="indigo" />
        <KpiCard label="이번 주 이력서" value={String(kpi.thisWeekResumes)} suffix="건" tone="emerald" />
        <KpiCard label="평균 채용 소요" value={kpi.avgCycle} tone="amber" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <KpiSmall label="서류 합격률" value={kpi.screeningRate} />
        <KpiSmall label="1차 합격률" value={kpi.interviewPassRate} />
        <KpiSmall label="최종 입사율" value={kpi.finalHireRate} />
      </div>

      {/* 채널별 효율 */}
      <ChannelEfficiency stats={channelStats} />

      {/* 포지션별 Funnel */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-900">포지션별 Funnel</h2>
            <p className="text-xs text-slate-600 mt-0.5">카드 클릭 → 후보자별 타임라인 펼침</p>
          </div>
          <span className="text-xs text-slate-600">{positions.length}개 포지션</span>
        </div>
        <div className="p-3 space-y-3 max-h-[640px] overflow-y-auto">
          {positions.map((p) => (
            <PositionCard
              key={p.key}
              p={p}
              onOpen={() => setSelectedKey(p.key)}
            />
          ))}
          {positions.length === 0 && (
            <div className="text-center py-10 text-sm text-slate-500">
              표시할 포지션이 없습니다. 시트를 연결하거나 양식을 확인하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  하위 컴포넌트
// ============================================================

function KpiCard({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone: 'violet' | 'indigo' | 'emerald' | 'amber' }) {
  const bg = {
    violet: 'from-violet-50 to-violet-100 border-violet-200 text-violet-900',
    indigo: 'from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-900',
    emerald: 'from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-900',
    amber: 'from-amber-50 to-amber-100 border-amber-200 text-amber-900',
  }[tone];
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${bg} px-4 py-3`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold">{value}</span>
        {suffix && <span className="text-sm opacity-70">{suffix}</span>}
      </div>
    </div>
  );
}

function KpiSmall({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-600">{label}</div>
      <div className="text-lg font-bold text-slate-900 leading-tight">{value}</div>
    </div>
  );
}

function ChannelEfficiency({ stats }: { stats: { channel: string; total: number; pass: number; rate: number }[] }) {
  const maxTotal = Math.max(...stats.map((s) => s.total), 1);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200">
        <h2 className="font-bold text-slate-900">채널별 효율</h2>
        <p className="text-xs text-slate-600 mt-0.5">이력서 수 + 합격률(면접 이상 통과)</p>
      </div>
      <div className="p-4 space-y-2">
        {stats.length === 0 && <div className="text-sm text-slate-500">데이터 없음</div>}
        {stats.map((s) => (
          <div key={s.channel} className="flex items-center gap-3 text-sm">
            <div className="w-24 shrink-0 text-slate-900 font-medium">{s.channel}</div>
            <div className="flex-1 h-6 bg-slate-100 rounded relative overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-violet-400"
                style={{ width: `${(s.total / maxTotal) * 100}%` }}
              />
              <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-white mix-blend-difference">
                {s.total}건
              </div>
            </div>
            <div className="w-16 text-right text-xs">
              <span className={s.rate >= 0.5 ? 'text-emerald-700 font-bold' : 'text-slate-600'}>
                {pct(s.pass, s.total)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositionCard({ p, onOpen }: { p: PositionFunnel; onOpen: () => void }) {
  const total = p.counts.resume;
  const stages = [
    { key: 'resume', label: '이력서', count: total, color: 'bg-slate-400' },
    { key: 'screening', label: '서류 합격', count: p.counts.screeningPass, color: 'bg-violet-400' },
    { key: 'first', label: '1차 합격', count: p.counts.firstPass, color: 'bg-violet-500' },
    { key: 'second', label: '2차 합격', count: p.counts.secondPass, color: 'bg-violet-600' },
    { key: 'offer', label: '오퍼', count: p.counts.offer, color: 'bg-emerald-500' },
    { key: 'hired', label: '입사', count: p.counts.hired, color: 'bg-emerald-600' },
  ];

  const priChip = (() => {
    if (/즉시/.test(p.priority)) return 'bg-rose-100 text-rose-800 border-rose-300';
    if (/결재/.test(p.priority)) return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-slate-100 text-slate-700 border-slate-300';
  })();

  return (
    <button
      onClick={onOpen}
      className="w-full px-4 py-3 flex items-start gap-3 text-left rounded-lg border border-slate-200 bg-white hover:bg-violet-50 hover:border-violet-300 hover:shadow-md transition-all group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-900">{p.team}</span>
          {p.job && <span className="text-sm text-slate-700">· {p.job}</span>}
          <span className={`chip border ${priChip}`}>{p.priority || '미정'}</span>
          {p.type && <span className="chip bg-slate-100 text-slate-700 border border-slate-300">{p.type}</span>}
          {p.site && <span className="chip bg-indigo-50 text-indigo-700 border border-indigo-200">{p.site}</span>}
          {p.positionId && <span className="text-[10px] font-mono text-slate-500">{p.positionId}</span>}
          <span className="ml-auto text-[11px] text-violet-700 font-bold group-hover:translate-x-0.5 transition-transform">
            상세 보기 →
          </span>
        </div>
        <div className="text-xs text-slate-600 mt-0.5">{p.hq} · 후보자 {p.candidates.length}명</div>

        {/* Funnel 바 */}
        <div className="mt-3 flex items-stretch gap-1">
          {stages.map((s, i) => {
            const w = Math.max((s.count / Math.max(total, 1)) * 100, 8);
            const prev = i > 0 ? stages[i - 1].count : null;
            const drop = prev !== null && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : null;
            return (
              <div key={s.key} className="flex-1 flex flex-col items-center min-w-0">
                <div className="w-full h-8 bg-slate-100 rounded relative overflow-hidden">
                  <div className={`absolute inset-y-0 left-0 ${s.color}`} style={{ width: `${w}%` }} />
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow">
                    {s.count}
                  </div>
                </div>
                <div className="text-[10px] mt-1 text-slate-700 truncate w-full text-center">{s.label}</div>
                {drop !== null && i > 0 && (
                  <div className={`text-[9px] ${drop > 50 ? 'text-rose-600' : 'text-slate-500'}`}>
                    {drop > 0 ? `-${drop}%` : '동일'}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 평균 소요 + 최근 활동 */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
          {p.avg.resumeToFirst !== null && <span>이력서→1차 평균 <b className="text-slate-900">{p.avg.resumeToFirst}일</b></span>}
          {p.avg.firstToOffer !== null && <span>1차→오퍼 평균 <b className="text-slate-900">{p.avg.firstToOffer}일</b></span>}
          {p.recent && (
            <span className="ml-auto">
              최근: <b className="text-slate-900">{p.recent.name}</b> {p.recent.what} <span className="text-slate-500">({fmtAgo(p.recent.at)})</span>
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ============================================================
//  Level 2 — 포지션 상세 풀스크린 뷰
// ============================================================

interface DetailViewProps {
  position: PositionFunnel;
  allPositions: PositionFunnel[];
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onJump: (key: string) => void;
  usingMock: boolean;
}

function PositionDetailView({ position: p, allPositions, onBack, onPrev, onNext, onJump, usingMock }: DetailViewProps) {
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const idx = allPositions.findIndex((x) => x.key === p.key);

  const priChip = (() => {
    if (/즉시/.test(p.priority)) return 'bg-rose-100 text-rose-800 border-rose-300';
    if (/결재/.test(p.priority)) return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-slate-100 text-slate-700 border-slate-300';
  })();

  const total = p.counts.resume;
  const stages = [
    { label: '이력서 입수', count: total, color: 'from-slate-400 to-slate-500' },
    { label: '서류 합격', count: p.counts.screeningPass, color: 'from-violet-400 to-violet-500' },
    { label: '1차 합격', count: p.counts.firstPass, color: 'from-violet-500 to-violet-600' },
    { label: '2차 합격', count: p.counts.secondPass, color: 'from-violet-600 to-violet-700' },
    { label: '오퍼 발송', count: p.counts.offer, color: 'from-emerald-500 to-emerald-600' },
    { label: '입사 확정', count: p.counts.hired, color: 'from-emerald-600 to-emerald-700' },
  ];

  // 채널 분포 (이 포지션 한정)
  const channelDist = (() => {
    const m = new Map<string, number>();
    for (const c of p.candidates) {
      const ch = c.channel || '기타';
      m.set(ch, (m.get(ch) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  })();

  const openIdx = openCandidate ? p.candidates.findIndex((c) => c.name === openCandidate) : -1;
  const openCand = openIdx >= 0 ? p.candidates[openIdx] : null;

  return (
    <div className="space-y-4">
      {/* 상단 네비 */}
      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-sm rounded-md bg-slate-100 hover:bg-slate-200 text-slate-900 font-medium"
        >
          ← 전체 목록
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={!onPrev}
            className="px-2.5 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
            title="이전 전형"
          >
            ◀
          </button>
          <span className="text-xs text-slate-600 px-1 font-mono">
            {idx + 1} / {allPositions.length}
          </span>
          <button
            onClick={onNext}
            disabled={!onNext}
            className="px-2.5 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
            title="다음 전형"
          >
            ▶
          </button>
        </div>
        <select
          value={p.key}
          onChange={(e) => onJump(e.target.value)}
          className="text-sm rounded-md border border-slate-300 bg-white text-slate-900 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400 min-w-[260px]"
        >
          {allPositions.map((q) => (
            <option key={q.key} value={q.key}>
              {q.team} {q.job ? `· ${q.job}` : ''} ({q.candidates.length}명)
            </option>
          ))}
        </select>
        {usingMock && (
          <span className="chip bg-amber-100 text-amber-900 border border-amber-300">⚠ Mock</span>
        )}
        <span className="ml-auto text-[11px] text-slate-500">ESC 키 → 목록</span>
      </div>

      {/* 포지션 헤더 */}
      <div className="bg-gradient-to-r from-violet-50 via-indigo-50 to-violet-50 rounded-xl border border-violet-200 px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">{p.team}</h1>
          {p.job && <span className="text-xl text-slate-700">· {p.job}</span>}
          <span className={`chip border ${priChip} text-xs`}>{p.priority || '미정'}</span>
          {p.type && <span className="chip bg-white text-slate-700 border border-slate-300 text-xs">{p.type}</span>}
          {p.site && <span className="chip bg-indigo-100 text-indigo-800 border border-indigo-300 text-xs">{p.site}</span>}
        </div>
        <div className="text-sm text-slate-700 mt-1">
          {p.hq}{p.positionId && <span className="ml-3 font-mono text-xs text-slate-500">[{p.positionId}]</span>}
        </div>
      </div>

      {/* 메인 그리드: 좌측 메타 + 우측 funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-4">
        {/* 좌측: 메타 + 채널 분포 + 평균 */}
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">전형 통계</h3>
            <div className="space-y-2.5">
              <Stat label="총 후보자" value={`${p.candidates.length}명`} />
              <Stat label="진행 중" value={`${p.candidates.filter(isAlive).length}명`} />
              <Stat label="입사 확정" value={`${p.counts.hired}명`} accent="emerald" />
              <Stat label="탈락/이탈" value={`${p.candidates.filter((c) => !isAlive(c)).length}명`} accent="rose" />
              {p.avg.resumeToFirst !== null && <Stat label="이력서→1차 평균" value={`${p.avg.resumeToFirst}일`} />}
              {p.avg.firstToOffer !== null && <Stat label="1차→오퍼 평균" value={`${p.avg.firstToOffer}일`} />}
              {p.avg.resumeToHire !== null && <Stat label="이력서→입사 평균" value={`${p.avg.resumeToHire}일`} />}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">채널 분포</h3>
            {channelDist.length === 0 && <div className="text-xs text-slate-500">채널 정보 없음</div>}
            {channelDist.map(([ch, n]) => {
              const max = channelDist[0][1];
              return (
                <div key={ch} className="mb-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-900 font-medium">{ch}</span>
                    <span className="text-slate-600">{n}명</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded mt-0.5 overflow-hidden">
                    <div className="h-full bg-violet-500" style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {p.recent && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">최근 활동</h3>
              <div className="text-sm">
                <b className="text-slate-900">{p.recent.name}</b>
                <span className="text-slate-700"> {p.recent.what}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5 font-mono">
                {p.recent.at} <span className="text-slate-400">({fmtAgo(p.recent.at)})</span>
              </div>
            </div>
          )}
        </div>

        {/* 우측: 큰 funnel + 후보자 그리드 */}
        <div className="space-y-3">
          {/* 큰 Funnel */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Funnel — 단계별 통과 인원</h3>
            <div className="space-y-2">
              {stages.map((s, i) => {
                const w = Math.max((s.count / Math.max(total, 1)) * 100, 5);
                const prev = i > 0 ? stages[i - 1].count : null;
                const drop = prev !== null && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : null;
                return (
                  <div key={s.label} className="flex items-center gap-3">
                    <div className="w-24 text-right text-xs font-medium text-slate-700">{s.label}</div>
                    <div className="flex-1 h-9 bg-slate-100 rounded relative overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${s.color} flex items-center justify-end pr-3`}
                        style={{ width: `${w}%` }}
                      >
                        <span className="text-sm font-bold text-white drop-shadow">{s.count}명</span>
                      </div>
                    </div>
                    <div className="w-20 text-xs text-right">
                      {drop !== null && i > 0 && (
                        <span className={drop > 50 ? 'text-rose-600 font-bold' : 'text-slate-600'}>
                          {drop > 0 ? `−${drop}%` : '동일'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 후보자 그리드 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">후보자 {p.candidates.length}명</h3>
              <span className="text-[11px] text-slate-500">카드 클릭 → 단계별 디테일</span>
            </div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[640px] overflow-y-auto">
              {p.candidates.map((c) => (
                <CandidateMiniCard
                  key={`${c.name}-${c.resumeAt}`}
                  c={c}
                  onOpen={() => setOpenCandidate(c.name)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Level 3 모달 */}
      {openCand && (
        <CandidateDetailModal
          candidate={openCand}
          allCandidates={p.candidates}
          onClose={() => setOpenCandidate(null)}
          onPrev={openIdx > 0 ? () => setOpenCandidate(p.candidates[openIdx - 1].name) : undefined}
          onNext={openIdx < p.candidates.length - 1 ? () => setOpenCandidate(p.candidates[openIdx + 1].name) : undefined}
        />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'rose' }) {
  const color = accent === 'emerald' ? 'text-emerald-700' : accent === 'rose' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-slate-600">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
}

function CandidateMiniCard({ c, onOpen }: { c: CandidateRow; onOpen: () => void }) {
  const stage = currentStage(c);
  const alive = isAlive(c);
  const dotColor = !alive ? 'bg-slate-300'
    : stage === 'hired' ? 'bg-emerald-500'
    : stage === 'offer' || stage === 'negotiation' ? 'bg-emerald-400'
    : stage === 'second' ? 'bg-violet-600'
    : stage === 'first' ? 'bg-violet-500'
    : stage === 'screening' ? 'bg-violet-400'
    : 'bg-slate-400';

  return (
    <button
      onClick={onOpen}
      className={`text-left rounded-lg border bg-white hover:border-violet-400 hover:shadow-md transition-all p-3 ${alive ? 'border-slate-200' : 'border-slate-200 opacity-70'}`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="font-bold text-slate-900">{c.name}</span>
        {c.channel && <span className="text-[10px] text-slate-600 ml-auto">{c.channel}</span>}
      </div>
      <div className="text-[11px] text-slate-700 mt-1">
        {alive ? `🟢 ${stageLabel(stage)}` : `⚪ ${c.finalStatus || '종료'}`}
      </div>
      {c.resumeAt && (
        <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
          이력서: {c.resumeAt}
        </div>
      )}
      <div className="mt-2 text-[11px] text-violet-700 font-semibold">
        자세히 보기 →
      </div>
    </button>
  );
}

// ============================================================
//  Level 3 — 후보자 디테일 모달 (모든 단계 + 시간 stamp)
// ============================================================

function CandidateDetailModal({
  candidate: c,
  allCandidates,
  onClose,
  onPrev,
  onNext,
}: {
  candidate: CandidateRow;
  allCandidates: CandidateRow[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  // ESC + 화살표 키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const idx = allCandidates.findIndex((x) => x.name === c.name);
  const stage = currentStage(c);
  const alive = isAlive(c);

  const timeline = [
    { key: 'resume',     label: '이력서 입수',     plannedAt: '',                 resolvedAt: c.resumeAt,          result: c.resumeAt ? 'pass' : '',  detail: c.channel ? `채널: ${c.channel}` : '' },
    { key: 'screening',  label: '서류 전형',       plannedAt: '',                 resolvedAt: c.screeningAt,      result: c.screeningResult,         detail: '' },
    { key: 'first',      label: '1차 면접',        plannedAt: c.first1ScheduledAt, resolvedAt: c.firstResolvedAt,  result: c.firstResult,             detail: '' },
    { key: 'second',     label: '2차 면접',        plannedAt: c.second2ScheduledAt, resolvedAt: c.secondResolvedAt, result: c.secondResult,           detail: '' },
    { key: 'nego',       label: '처우 협의',       plannedAt: c.negoStartedAt,     resolvedAt: c.negoResolvedAt,   result: c.negoResolvedAt ? 'pass' : c.negoStartedAt ? '진행중' : '', detail: '' },
    { key: 'offer',      label: '최종 합격 안내',  plannedAt: '',                 resolvedAt: c.offerSentAt,      result: c.offerSentAt ? 'pass' : '', detail: c.offerSentAt ? '메일 발송 완료' : '' },
    { key: 'hired',      label: '입사',            plannedAt: c.joinPlannedAt,    resolvedAt: '',                 result: /입사확정|입사완료/.test(c.finalStatus) ? 'pass' : '', detail: c.finalStatus },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3 bg-gradient-to-r from-violet-50 to-indigo-50">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{c.name}</h2>
              <span className={`chip text-xs ${alive ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}>
                {alive ? `🟢 ${stageLabel(stage)}` : `⚪ ${c.finalStatus || '종료'}`}
              </span>
            </div>
            <div className="text-xs text-slate-700 mt-1">
              {c.team}{c.job ? ` · ${c.job}` : ''} · {c.hq}
              {c.channel && <span className="ml-2">📥 {c.channel}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onPrev} disabled={!onPrev} className="px-2 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed" title="이전 후보자 (←)">◀</button>
            <span className="text-xs text-slate-600 px-1 font-mono">{idx + 1} / {allCandidates.length}</span>
            <button onClick={onNext} disabled={!onNext} className="px-2 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed" title="다음 후보자 (→)">▶</button>
            <button onClick={onClose} className="ml-2 w-8 h-8 rounded-md hover:bg-slate-200 grid place-items-center text-slate-700" title="닫기 (ESC)">✕</button>
          </div>
        </div>

        {/* 바디: 타임라인 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">단계별 타임라인</h3>
            <ol className="relative border-l-2 border-slate-200 ml-3 space-y-4">
              {timeline.map((t) => {
                const r = classifyResult(t.result);
                const has = t.plannedAt || t.resolvedAt;
                const dotColor = !has ? 'bg-slate-200 border-slate-300'
                  : r === 'pass' ? 'bg-emerald-500 border-emerald-600'
                  : r === 'fail' ? 'bg-rose-500 border-rose-600'
                  : r === 'drop' ? 'bg-slate-400 border-slate-500'
                  : 'bg-violet-500 border-violet-600';
                const resultBadge = !has ? null
                  : r === 'pass' ? <span className="chip bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px]">✓ {t.result || '완료'}</span>
                  : r === 'fail' ? <span className="chip bg-rose-100 text-rose-800 border border-rose-300 text-[10px]">✗ {t.result}</span>
                  : r === 'drop' ? <span className="chip bg-slate-100 text-slate-700 border border-slate-300 text-[10px]">⊘ {t.result}</span>
                  : <span className="chip bg-violet-100 text-violet-800 border border-violet-300 text-[10px]">⏳ {t.result || '대기'}</span>;
                return (
                  <li key={t.key} className="ml-4">
                    <span className={`absolute -left-[9px] w-4 h-4 rounded-full border-2 ${dotColor}`} />
                    <div className="bg-white rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900">{t.label}</span>
                        {resultBadge}
                      </div>
                      {(t.plannedAt || t.resolvedAt) && (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {t.plannedAt && (
                            <div className="rounded bg-violet-50 border border-violet-200 px-2.5 py-1.5">
                              <div className="text-[10px] text-violet-700 font-bold uppercase tracking-wider">예정</div>
                              <div className="font-mono text-slate-900 mt-0.5">{t.plannedAt}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{fmtAgo(t.plannedAt)}</div>
                            </div>
                          )}
                          {t.resolvedAt && (
                            <div className="rounded bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                              <div className="text-[10px] text-slate-700 font-bold uppercase tracking-wider">확정</div>
                              <div className="font-mono text-slate-900 mt-0.5">{t.resolvedAt}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{fmtAgo(t.resolvedAt)}</div>
                            </div>
                          )}
                        </div>
                      )}
                      {t.detail && <div className="text-xs text-slate-700 mt-2">{t.detail}</div>}
                      {!has && <div className="text-xs text-slate-400 mt-1">아직 진행 안 됨</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* 메타 정보 */}
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">메타</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
              <MetaRow label="포지션 ID" value={c.positionId} />
              <MetaRow label="본부" value={c.hq} />
              <MetaRow label="팀" value={c.team} />
              <MetaRow label="직무" value={c.job} />
              <MetaRow label="채용 유형" value={c.type} />
              <MetaRow label="우선순위" value={c.priority} />
              <MetaRow label="근무지" value={c.site} />
              <MetaRow label="채널" value={c.channel} />
              <MetaRow label="최종 상태" value={c.finalStatus} />
            </div>
            {c.note && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <div className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mb-1">비고</div>
                <div className="text-sm text-slate-900">{c.note}</div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600 flex items-center gap-3">
          <span>키보드: <kbd className="px-1.5 py-0.5 rounded border border-slate-300 bg-white font-mono text-[10px]">←</kbd> 이전 <kbd className="px-1.5 py-0.5 rounded border border-slate-300 bg-white font-mono text-[10px]">→</kbd> 다음 <kbd className="px-1.5 py-0.5 rounded border border-slate-300 bg-white font-mono text-[10px]">ESC</kbd> 닫기</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 items-baseline">
      <span className="text-slate-600 shrink-0">{label}:</span>
      <span className="text-slate-900 font-medium truncate">{value || '—'}</span>
    </div>
  );
}

function stageLabel(s: Stage): string {
  return {
    resume: '서류 검토 전',
    screening: '서류 검토 중',
    first: '1차 면접',
    second: '2차 면접',
    negotiation: '처우 협의',
    offer: '합격 안내 발송',
    hired: '입사 확정',
  }[s];
}

// ============================================================
//  시트 양식 안내 카드
// ============================================================

function SheetSpecCard() {
  const cols: Array<{ name: string; type: string; example: string; required: boolean }> = [
    { name: '포지션ID', type: '텍스트', example: '2026-00665', required: false },
    { name: '본부', type: '텍스트', example: '경영기획본부', required: true },
    { name: '팀', type: '텍스트', example: '영업관리팀', required: true },
    { name: '직무', type: '텍스트', example: '해외영업관리', required: true },
    { name: '채용유형', type: '드롭다운', example: '신규 / 결원 / 증원 / 부서이동', required: false },
    { name: '우선순위', type: '드롭다운', example: '즉시 / 결재중 / 장기', required: false },
    { name: '근무지', type: '드롭다운', example: '퍼플 / 그린 / 수원 / 방교 / 위워크', required: false },
    { name: '후보자', type: '텍스트', example: '박수지', required: true },
    { name: '채널', type: '드롭다운', example: '사람인 / 잡코리아 / 원티드 / 링크드인 / 추천 / 일자리센터 / 박람회 / 자체', required: false },
    { name: '이력서_입수일', type: '날짜+시간', example: '2026-05-15 14:00', required: true },
    { name: '서류_결과', type: '드롭다운', example: '합격 / 불합격 / 대기 / 취소', required: false },
    { name: '서류_확정일', type: '날짜+시간', example: '2026-05-17 10:30', required: false },
    { name: '1차면접_예정일', type: '날짜+시간', example: '2026-05-22 14:30', required: false },
    { name: '1차면접_결과', type: '드롭다운', example: '합격 / 불합격 / 대기 / 노쇼 / 포기', required: false },
    { name: '1차면접_확정일', type: '날짜+시간', example: '2026-05-23 16:00', required: false },
    { name: '2차면접_예정일', type: '날짜+시간', example: '', required: false },
    { name: '2차면접_결과', type: '드롭다운', example: '', required: false },
    { name: '2차면접_확정일', type: '날짜+시간', example: '', required: false },
    { name: '처우협의_시작일', type: '날짜+시간', example: '', required: false },
    { name: '처우협의_확정일', type: '날짜+시간', example: '', required: false },
    { name: '최종합격_안내일', type: '날짜+시간', example: '합격 안내 메일 발송일', required: false },
    { name: '입사예정일', type: '날짜', example: '2026-06-15', required: false },
    { name: '최종상태', type: '드롭다운', example: '진행중 / 입사확정 / 입사취소 / 면접포기 / 탈락', required: false },
    { name: '비고', type: '텍스트', example: '자유 텍스트', required: false },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 bg-violet-50">
        <h2 className="font-bold text-slate-900">📋 시트 양식 — kind: <code className="bg-white px-1.5 py-0.5 rounded text-violet-900">recruit_funnel</code></h2>
        <p className="text-xs text-slate-700 mt-1 leading-relaxed">
          한 행 = 한 후보자. 컬럼명은 정확히 일치하지 않아도 부분 매칭으로 잡힙니다 (예: "이력서 입수" / "이력서_입수일" / "이력서일" 모두 OK).
          시트를 만든 뒤 ⚙️ 설정 → 시트 추가 → 새 탭 자동인식("funnel" 단어 포함 시 자동 매핑) 또는 수동 매핑.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">컬럼명</th>
              <th className="px-3 py-2 text-left font-semibold">형식</th>
              <th className="px-3 py-2 text-left font-semibold">예시</th>
              <th className="px-3 py-2 text-center font-semibold">필수</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.name} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-mono text-slate-900">{c.name}</td>
                <td className="px-3 py-1.5 text-slate-700">{c.type}</td>
                <td className="px-3 py-1.5 text-slate-600">{c.example || '(빈칸 가능)'}</td>
                <td className="px-3 py-1.5 text-center">{c.required ? <span className="text-rose-600 font-bold">●</span> : <span className="text-slate-300">○</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-700 leading-relaxed">
        <div><b>날짜 형식:</b> <code>YYYY-MM-DD</code> 또는 <code>YYYY-MM-DD HH:MM</code> 둘 다 인식. 시간 없으면 자정 처리.</div>
        <div className="mt-1"><b>그룹핑:</b> 본부 + 팀 + 직무가 같으면 한 포지션으로 묶임. 한 포지션에 후보자 N명 자동 집계.</div>
        <div className="mt-1"><b>진행 단계 자동 판정:</b> 시간 stamp가 채워진 가장 최근 단계가 현재 단계로 표시됨.</div>
        <div className="mt-1"><b>이탈 판정:</b> 어느 단계든 결과가 <code>불합격</code>/<code>탈락</code>/<code>포기</code>/<code>취소</code>/<code>두절</code>이면 진행 중지로 처리.</div>
      </div>
    </div>
  );
}
