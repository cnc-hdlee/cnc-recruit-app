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
  품질관리2팀: ['mhlee'],
  시설안전팀: ['kyhwang'],
  포장2팀: ['hskim3', 'yecho'],
  생산2팀: ['hnkang', 'hscho', 'kyhkim'],
  생산1팀: ['oskim', 'sykim4'],
  품질연구팀: ['kmkim'],
  자재물류1팀: ['sclee'],
  // 한옥성 부문장은 생산운영부문 면접관이라 생산운영팀 면접에 항상 들어간다.
  생산운영팀: ['oshan'],
};

/**
 * 사업장 고정 참석자 — 팀과 무관하게 그 사업장 면접이면 무조건 들어가는 사람.
 * 그린카운티(용인)는 이민영(People Ops)이 담당이며, 사업장 고정은 이 한 명뿐이다.
 * (팀별 명단에 중복으로 넣지 않고 여기서만 관리한다)
 */
export const SITE_ATTENDEES: Record<string, string[]> = {
  그린: ['mylee'],
};

/**
 * 팀의 소속 사업장. 회의실을 어디로 잡든 팀이 정해지면 사업장도 정해진다.
 *
 * 규칙: "○○2팀"은 전부 그린카운티(용인), "○○1팀"은 퍼플카운티.
 * 면접 이력과도 일치한다 — 포장2팀 그린 5/5, 생산2팀 3/3, 제조2팀 2/2,
 * 생산1팀 퍼플 6/6, 제조1팀 6/6, 품질관리1팀 8/8, 자재물류1팀 3/3.
 */
const TEAM_SITE_FIXED: Record<string, string> = {
  품질연구팀: '그린',
  // 생산운영팀은 그린(생산직 대량)·퍼플이 섞여 있어 고정하지 않고 회의실 기준으로 둔다.
};

export function teamHomeSite(teamRaw: string): string {
  const t = (teamRaw || '').replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '').trim();
  if (!t) return '';
  if (TEAM_SITE_FIXED[t]) return TEAM_SITE_FIXED[t];
  if (/2팀$/.test(t)) return '그린';
  if (/1팀$/.test(t)) return '퍼플';
  return '';
}

/**
 * 계정 → 실명/소속. 화면에 ywkim 대신 "김영욱 팀장(전략구매팀)"으로 보이게 하기 위한 표.
 * Slack 프로필에서 확인한 값이며, 없는 사람은 계정 아이디 그대로 표시된다.
 */
export const PEOPLE: Record<string, { name: string; title?: string; team?: string }> = {
  // TA팀
  shim: { name: '임세현', team: 'TA팀' },
  bjkim4: { name: '김범준', title: '팀장', team: 'TA팀' },
  hglim: { name: '임한결', team: 'TA팀' },
  hdlee: { name: '이형도', team: 'TA팀' },
  // People Ops
  mylee: { name: '이민영', team: 'People Ops팀 · 그린카운티 담당' },
  // 현업
  ywkim: { name: '김영욱', title: '팀장', team: '전략구매팀' },
  jhlee3: { name: '이준희', title: '차장', team: '전략구매팀' },
  suhwang: { name: '황선욱', title: '팀장', team: '영업관리팀' },
  jwlee: { name: '이재욱', title: '대리', team: '제조1팀' },
  yghan: { name: '한윤구', title: '팀장', team: '제조1팀' },
  jemoon: { name: '문지은', title: '팀장', team: '품질보증팀' },
  khjung: { name: '정기현', title: '팀장', team: '품질관리1팀' },
  jekim1: { name: '김지은', title: '차장', team: '품질관리1팀' },
  mhlee: { name: '이민호', title: '팀장', team: '품질관리2팀' },
  kyhwang: { name: '황기연', title: '팀장', team: '시설안전팀' },
  hskim3: { name: '김현수', title: '팀장', team: '포장2팀' },
  yecho: { name: '조예은', title: '행정서무', team: '포장2팀' },
  hnkang: { name: '강하나', title: '사원', team: '생산2팀' },
  hscho: { name: '조현성', title: '공장장', team: '생산2부' },
  kyhkim: { name: '김경한', title: '팀장', team: '생산2팀' },
  oskim: { name: '김옥상', title: '팀장', team: '생산1팀' },
  sykim4: { name: '김소영', title: '사원', team: '생산1팀' },
  kmkim: { name: '김광민', title: '팀장', team: '품질연구팀' },
  sclee: { name: '이상철', title: '팀장', team: '자재물류1팀' },
  oshan: { name: '한옥성', title: '부문장', team: '생산운영부문' },
};

/** "김영욱 팀장" 처럼 사람이 읽는 이름. 모르는 계정은 아이디 그대로. */
export function personLabel(email: string): string {
  const id = (email || '').split('@')[0];
  const p = PEOPLE[id];
  if (!p) return id;
  return p.title ? `${p.name} ${p.title}` : p.name;
}

/** 이름 + 소속까지 (툴팁·설정 화면용) */
export function personFull(email: string): string {
  const id = (email || '').split('@')[0];
  const p = PEOPLE[id];
  if (!p) return id;
  const t = p.title ? ` ${p.title}` : '';
  return p.team ? `${p.name}${t} · ${p.team}` : `${p.name}${t}`;
}

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

/** 회의실 사이트("그린", "퍼플" …)에 걸린 고정 참석자 */
export function lookupSite(siteRaw: string): string[] {
  const s = (siteRaw || '').trim();
  if (!s) return [];
  for (const [site, list] of Object.entries(SITE_ATTENDEES)) {
    if (s.includes(site)) return list.map(toEmail);
  }
  return [];
}

/**
 * 최종 참석자 = TA팀 공통 + 해당 팀 현업 + 사업장 고정 참석자.
 * 팀을 못 찾으면 TA팀(+사업장)만 돌려주고, 호출한 쪽에서 "현업 미등록"으로 표시한다.
 */
export function resolveAttendees(
  teamRaw: string,
  teamMap: Record<string, string[]>,
  taList: string[],
  roomSiteRaw = ''
): {
  emails: string[];
  teamFound: boolean;
  siteEmails: string[];
  /** 참석자 계산에 실제로 쓴 사업장 */
  site: string;
  /** 팀 소속 사업장과 잡은 회의실 사업장이 다를 때 (오예약 신호) */
  siteMismatch: boolean;
} {
  const team = lookupTeam(teamRaw, teamMap);
  // 팀이 사업장을 결정한다. 팀으로 못 정하면 잡은 회의실의 사업장을 쓴다.
  const home = teamHomeSite(teamRaw);
  const site = home || roomSiteRaw;
  const siteEmails = lookupSite(site);
  const emails = [...new Set([...taList, ...team, ...siteEmails])].filter(Boolean);
  const siteMismatch = !!home && !!roomSiteRaw && !roomSiteRaw.includes(home);
  return { emails, teamFound: team.length > 0, siteEmails, site, siteMismatch };
}

// ── Slack 조직도 동기화 (2026-09-01) ─────────────────────────────────────────
// Slack 프로필 표시명이 "팀/이름/직급" 포맷이라 그대로 옮겼다.
// 면접 참석자 이름 표시, 이력서 팀 자동 분류(실재하는 팀만 인정)에 함께 쓴다.
// 갱신하려면 Slack에서 "팀장"으로 사용자 검색 후 이 표를 다시 채우면 된다.
export const TEAM_LEADS: Record<string, { name: string; team: string; title: string }> = {
  nedjang: { name: '장광남', team: 'GPD3팀', title: '팀장' },
  yrjang: { name: '장예리', team: '품질관리2팀', title: '주임' },
  jwoo: { name: '우정', team: 'Efficacy Design Studio', title: '팀장' },
  swpark: { name: '박성우', team: '생산3팀', title: '팀장' },
  sywoo: { name: '우선영', team: '디지털전략팀', title: '팀장' },
  helena: { name: '이슬이', team: 'KPD1팀', title: '팀장' },
  yhkim3: { name: '김요한', team: '포장3팀', title: '팀장' },
  syjang2: { name: '장수영', team: 'Lip Studio 1팀', title: '연구원' },
  jhoh: { name: '오지훈', team: 'Base Studio팀', title: '팀장' },
  ewjang2: { name: '장은우', team: '품질관리1팀', title: '사원' },
  hsong: { name: '송희', team: 'Lip Studio 2팀', title: '팀장' },
  sjjang: { name: '장수진', team: '생산2팀', title: '사원' },
  khpark: { name: '박광호', team: '디지털인프라팀', title: '팀장' },
  kcshin: { name: '신관철', team: '포장2팀', title: '팀장' },
  khjung: { name: '정기현', team: '품질관리1팀', title: '팀장' },
  igchoi: { name: '최인규', team: '포장1팀', title: '팀장' },
  hrjeong: { name: '정혜리', team: '기반연구팀', title: '팀장' },
  mhso: { name: '소문희', team: 'KPD4팀', title: '팀장' },
  sjjung: { name: '정소정', team: '제품전략팀', title: '팀장' },
  eakim: { name: '김은아', team: 'Cleansing Studio팀', title: '팀장' },
  sojbae: { name: '배소정', team: 'Powder Studio팀', title: '팀장' },
  khkim: { name: '김광훈', team: '생산4팀', title: '팀장' },
  ehjang: { name: '장은희', team: '생산3팀', title: '사원' },
  sjlee: { name: '이승지', team: 'KPD2팀', title: '팀장' },
  kmkim: { name: '김광민', team: '품질연구팀', title: '팀장' },
  mkson: { name: '손민경', team: 'KPD3팀', title: '팀장' },
  khan: { name: '한결', team: 'GPD3팀', title: '팀장' },
  nkpark: { name: '박노권', team: 'FPNA팀', title: '팀장' },
  mhlee: { name: '이민호', team: '품질관리2팀', title: '팀장' },
  ejoh: { name: '오은지', team: 'Lip Studio 1팀', title: '팀장' },
  kyhwang: { name: '황기연', team: '시설안전팀', title: '팀장' },
  smkim4: { name: '김수민', team: '글로벌규제팀', title: '팀장' },
  suhwang: { name: '황선욱', team: '영업관리팀', title: '팀장' },
  kyhkim: { name: '김경한', team: '생산2팀', title: '팀장' },
  juddoh: { name: '오서준', team: 'GPD1팀', title: '팀장' },
  dklee: { name: '이동기', team: '생산기술팀', title: '팀장' },
  jemoon: { name: '문지은', team: '품질보증팀', title: '팀장' },
  yjunglee: { name: '이윤정', team: '자금팀', title: '팀장' },
  jscheon: { name: '천진수', team: '자재물류2팀', title: '팀장' },
  hskim3: { name: '김현수', team: '공정혁신팀', title: '팀장' },
  sekim4: { name: '김승은', team: 'Scent Design Studio', title: '팀장' },
  yghan: { name: '한윤구', team: '제조1팀', title: '팀장' },
  ywkim: { name: '김영욱', team: '전략구매팀', title: '팀장' },
  oskim: { name: '김옥상', team: '생산1팀', title: '팀장' },
  dhko: { name: '고다희', team: '재무회계팀', title: '팀장' },
  eblee2: { name: '이은범', team: '구성원경험팀', title: '팀장' },
  jskim3: { name: '김진성', team: '거버넌스전략팀', title: '팀장' },
  sclee: { name: '이상철', team: '자재물류1팀', title: '팀장' },
  shhan3: { name: '한상현', team: 'People Ops팀', title: '팀장' },
  bjkim4: { name: '김범준', team: 'Talent Acquisition팀', title: '팀장' },
};

/** 회사에 실재하는 팀 목록 — 파일명·메일에서 팀을 찾을 때 오탐을 막는 화이트리스트 */
export const ALL_TEAMS: string[] = [...new Set(Object.values(TEAM_LEADS).map((t) => t.team))].sort(
  (a, b) => b.length - a.length
);

// PEOPLE에 병합 — 수기로 넣어둔 값보다 Slack 조직도를 우선한다(소속이 바뀐 사람 반영).
for (const [id, v] of Object.entries(TEAM_LEADS)) {
  PEOPLE[id] = { name: v.name, title: v.title, team: v.team };
}
