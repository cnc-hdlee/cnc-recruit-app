// 면접 참석자 자동 채움 — 팀명만 알면 현업 면접관 + TA팀을 참석자로 넣는다.
//
// 회의실 예약 제목("전략구매팀 면접 - 이형도")에서 팀명을 뽑아 이 표를 찾는다.
// 기본값은 2026-08~09 면접 캘린더 46건의 실제 참석자 이력에서 뽑았다.
// (팀별로 매번 들어간 사람만 넣고, 1회성 참석자는 뺐다)

import { api } from './api';

const DOMAIN = '@cnccosmetic.com';
const TEAM_KEY = 'interviewTeamAttendees';
const TA_KEY = 'interviewTaAttendees';

/** 아이디만 넣으면 회사 도메인을 붙여준다 */
export function toEmail(idOrEmail: string): string {
  const v = (idOrEmail || '').trim();
  if (!v) return '';
  return v.includes('@') ? v : `${v}${DOMAIN}`;
}

/**
 * 모든 면접에 공통으로 들어가는 TA팀.
 * hdlee(본인)는 넣지 않는다 — 주최자 본인을 참석자로 넣으면 primary에 초대가 또 생겨
 * 같은 면접이 여러 번 보이는 문제가 있다.
 */
export const DEFAULT_TA_ATTENDEES = ['bjkim4', 'hglim', 'shim'].map(toEmail);

/**
 * 팀 → 현업 면접관.
 * 참석자가 등록된 면접 154건(2026-04~09)에서 팀별로 "절반 이상 참석한 사람"만 채택.
 * 1~2회만 들어온 사람은 제외했다 (일회성 대참을 기본값으로 굳히지 않기 위해).
 */
export const DEFAULT_TEAM_ATTENDEES: Record<string, string[]> = {
  전략구매팀: ['ywkim', 'jhlee3'],
  영업관리팀: ['suhwang'],
  제조1팀: ['jwlee', 'yghan'],
  품질보증팀: ['jemoon'],
  품질관리1팀: ['khjung', 'jekim1'],
  품질관리2팀: ['mhlee', 'mylee'],
  시설안전팀: ['kyhwang'],
  포장2팀: ['hskim3', 'mylee', 'yecho'],
  생산2팀: ['hnkang', 'hscho', 'kyhkim', 'mylee'],
  생산1팀: ['oskim', 'sykim4'],
  품질연구팀: ['kmkim', 'mylee'],
  자재물류1팀: ['sclee'],
  // 생산운영팀은 생산직 대량 면접이 대부분이라 현업이 거의 안 들어온다(99건 중 7건).
  // 기본값으로 넣지 않고, 필요할 때 예약 화면에서 직접 추가하도록 비워둔다.
};

function normalizeMap(raw: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [team, list] of Object.entries(raw)) {
    out[team] = [...new Set((list || []).map(toEmail).filter(Boolean))];
  }
  return out;
}

export async function loadTeamAttendees(): Promise<Record<string, string[]>> {
  const base = normalizeMap(DEFAULT_TEAM_ATTENDEES);
  if (!api?.cfg) return base;
  try {
    const r = await api.cfg.get<Record<string, string[]>>(TEAM_KEY);
    if (r.ok && r.data && Object.keys(r.data).length > 0) {
      // 저장본이 우선, 기본값에만 있는 팀은 남긴다
      return { ...base, ...normalizeMap(r.data) };
    }
    return base;
  } catch {
    return base;
  }
}

export async function saveTeamAttendees(map: Record<string, string[]>): Promise<void> {
  if (!api?.cfg) return;
  await api.cfg.set(TEAM_KEY, normalizeMap(map));
}

export async function loadTaAttendees(): Promise<string[]> {
  if (!api?.cfg) return DEFAULT_TA_ATTENDEES;
  try {
    const r = await api.cfg.get<string[]>(TA_KEY);
    return r.ok && Array.isArray(r.data) && r.data.length > 0
      ? r.data.map(toEmail).filter(Boolean)
      : DEFAULT_TA_ATTENDEES;
  } catch {
    return DEFAULT_TA_ATTENDEES;
  }
}

export async function saveTaAttendees(list: string[]): Promise<void> {
  if (!api?.cfg) return;
  await api.cfg.set(TA_KEY, [...new Set(list.map(toEmail).filter(Boolean))]);
}

/**
 * 팀명에 맞는 현업 면접관을 찾는다.
 * "전략구매팀(원료파트)" 처럼 괄호가 붙어 와도, 공백이 섞여 와도 찾도록 정규화 후 비교.
 */
export function lookupTeam(teamRaw: string, map: Record<string, string[]>): string[] {
  const norm = (s: string) => (s || '').replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '').trim();
  const key = norm(teamRaw);
  if (!key) return [];
  if (map[key]) return map[key];
  for (const [team, list] of Object.entries(map)) {
    if (norm(team) === key) return list;
  }
  return [];
}

/**
 * 최종 참석자 = TA팀 공통 + 해당 팀 현업.
 * 팀을 못 찾으면 TA팀만 돌려주고, 호출한 쪽에서 "현업 미등록"으로 표시한다.
 */
export function resolveAttendees(
  teamRaw: string,
  teamMap: Record<string, string[]>,
  taList: string[]
): { emails: string[]; teamFound: boolean } {
  const team = lookupTeam(teamRaw, teamMap);
  const emails = [...new Set([...taList, ...team])].filter(Boolean);
  return { emails, teamFound: team.length > 0 };
}
