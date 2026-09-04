// 메일 발송 프리셋 — 사업장(퍼플카운티/용인) · 본부(생산/영업/연구소/크솔).
//
// 왜 필요한가: 같은 "1차 면접 안내"라도 사업장마다 장소·주소·오시는길이 다르고,
// 본부마다 담당자/문구가 달라 양식을 따로 골라야 한다는 요구(2026-08).
// 사이트/본부 정보는 코드 기본값 + 인앱 수정본(cfg 저장)을 머지해서 쓴다.

import { api } from './api';

export interface MailSite {
  id: string;
  label: string;
  /** 메일 본문 {{면접장소}} / {{입사장소}} 에 들어가는 전체 주소 */
  address: string;
  /** 주소 뒤에 붙는 안내 문구 ({{장소안내}}) — 줄바꿈 포함 가능 */
  guide: string;
  /** 캘린더 제목/장소에서 이 사업장을 알아보는 별칭 (면접 캘린더는 '퍼플/그린/수원'으로 적힘) */
  aliases?: string[];
}

export interface MailHq {
  id: string;
  label: string;
  /** 면접 캘린더 제목의 팀/직무 문자열이 이 키워드를 포함하면 이 본부로 분류 */
  match: string[];
}

const SITE_KEY = 'mailSites';
const HQ_KEY = 'mailHqs';
const HQ_OVERRIDE_KEY = 'mailHqOverrides'; // 후보자 이름 → 본부 id 수동 지정

// 주소는 형도님 메일 서명 기준 (2026-08 확인).
export const DEFAULT_SITES: MailSite[] = [
  {
    id: 'purple',
    label: '퍼플카운티',
    address: '(주)씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로 5길 39, 우편번호 18449)',
    guide: '\n도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.',
    aliases: ['퍼플', '퍼플카운티', '동탄', '화성'],
  },
  {
    // 서울 사무소 — 면접 캘린더에는 '서울(4E회의실)' 형태로 적힌다.
    // 주소는 설정에서 채워 넣으면 메일 {{면접장소}}에 그대로 들어간다.
    id: 'seoul',
    label: '서울(위워크)',
    address: '',
    guide: '\n도착하시어 안내데스크에서 대기해주시면 안내 도와드리겠습니다.',
    aliases: ['서울', '위워크', 'wework', '4E'],
  },
  {
    id: 'yongin',
    label: '그린카운티(용인)',
    address: '(주)씨앤씨인터내셔널 그린카운티 (경기도 용인시 처인구 이동읍 덕성산단1로28번길 12-1, 우편번호 17130)',
    guide: '\n도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.',
    aliases: ['그린', '그린카운티', '용인'],
  },
  {
    id: 'suwon',
    label: 'R&I센터(수원)',
    address: '(주)씨앤씨인터내셔널 R&I센터 (경기도 수원시 영통구 신원로 198번길 15-13, 우편번호 16676)',
    guide: '\n도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.',
    aliases: ['수원', 'R&I', 'RI센터', '영통'],
  },
];

export const DEFAULT_HQS: MailHq[] = [
  {
    id: 'prod',
    label: '생산본부',
    match: ['생산', '제조', '포장', '품질', '물류', '자재', '구매', '설비', '원료', '공무', '안전', '생산관리', 'ERP'],
  },
  {
    id: 'sales',
    label: '영업본부',
    match: ['영업', '마케팅', '상품기획', 'MD', '고객', '국내영업', '해외', '영업관리', '온라인'],
  },
  {
    // 경영기획본부 — 관리 조직.
    // 생산·영업 뒤, 연구소 앞에 둔다. 뒤에 두면 'FP&A팀 원가분석'이 연구소의 '분석'에 먼저 걸린다.
    // 앞에 두면 '상품기획'이 영업본부로 먼저 잡히는 순서가 깨지므로 위치가 중요하다.
    id: 'plan',
    label: '경영기획본부',
    match: [
      '경영기획', '거버넌스', '재무', '회계', 'FP&A', '원가',
      '인사', 'HR', 'People', 'Culture', '구성원경험', '총무', '법무',
      '정보보안', '디지털전략', 'TalentAcquisition', 'Talent', '채용',
    ],
  },
  {
    id: 'rnd',
    label: '연구소',
    match: ['연구', '연구소', 'MU', 'SC', '처방', '제형', '분석', '기초', '색조', '파우더', 'Lab', '랩', 'Studio', 'Center', 'Powder', 'Skincare', 'Cleansing', 'Scent'],
  },
  {
    id: 'csol',
    label: '크솔본부',
    match: ['크솔', 'CSOL', 'C-SOL', '솔루션'],
  },
];

/** 어느 본부에도 안 잡히는 후보자를 담는 버킷 — 절대 숨기지 않는다(누락 방지). */
export const HQ_UNSET = { id: '__none__', label: '미분류' };

export async function loadSites(): Promise<MailSite[]> {
  if (!api?.cfg) return DEFAULT_SITES;
  try {
    const r = await api.cfg.get<MailSite[]>(SITE_KEY);
    const saved = r.ok && Array.isArray(r.data) ? r.data : [];
    if (saved.length === 0) return DEFAULT_SITES;
    // 기본 사업장은 항상 남기고, 저장본이 있으면 그 값으로 덮어씀.
    // aliases는 UI에서 편집하지 않으므로 저장본에 없으면 기본값을 유지한다(사업장 인식 깨짐 방지).
    const byId = new Map(saved.map((s) => [s.id, s]));
    const merged = DEFAULT_SITES.map((d) => {
      const s = byId.get(d.id);
      return s ? { ...d, ...s, aliases: s.aliases && s.aliases.length > 0 ? s.aliases : d.aliases } : d;
    });
    for (const s of saved) if (!merged.find((m) => m.id === s.id)) merged.push(s);
    return merged;
  } catch {
    return DEFAULT_SITES;
  }
}

export async function saveSites(sites: MailSite[]): Promise<void> {
  if (!api?.cfg) return;
  await api.cfg.set(SITE_KEY, sites);
}

export async function loadHqs(): Promise<MailHq[]> {
  if (!api?.cfg) return DEFAULT_HQS;
  try {
    const r = await api.cfg.get<MailHq[]>(HQ_KEY);
    const saved = r.ok && Array.isArray(r.data) ? r.data : [];
    if (saved.length === 0) return DEFAULT_HQS;
    const byId = new Map(saved.map((h) => [h.id, h]));
    const merged = DEFAULT_HQS.map((d) => byId.get(d.id) || d);
    for (const h of saved) if (!merged.find((m) => m.id === h.id)) merged.push(h);
    return merged;
  } catch {
    return DEFAULT_HQS;
  }
}

export async function saveHqs(hqs: MailHq[]): Promise<void> {
  if (!api?.cfg) return;
  await api.cfg.set(HQ_KEY, hqs);
}

// 메일 대상에서 제외할 내부 인원 — TA팀이 테스트로 만든 본인 이름 면접 일정 등이
// 후보자로 잡히던 문제(2026-08-31) 때문에 추가. 설정에서 편집 가능.
const EXCLUDE_NAMES_KEY = 'mailExcludeNames';
export const DEFAULT_EXCLUDE_NAMES = ['이형도', '임세현', '김범준', '임한결'];

export async function loadExcludeNames(): Promise<string[]> {
  if (!api?.cfg) return DEFAULT_EXCLUDE_NAMES;
  try {
    const r = await api.cfg.get<string[]>(EXCLUDE_NAMES_KEY);
    return r.ok && Array.isArray(r.data) && r.data.length > 0 ? r.data : DEFAULT_EXCLUDE_NAMES;
  } catch {
    return DEFAULT_EXCLUDE_NAMES;
  }
}

export async function saveExcludeNames(names: string[]): Promise<void> {
  if (!api?.cfg) return;
  await api.cfg.set(EXCLUDE_NAMES_KEY, names);
}

export async function loadHqOverrides(): Promise<Record<string, string>> {
  if (!api?.cfg) return {};
  try {
    const r = await api.cfg.get<Record<string, string>>(HQ_OVERRIDE_KEY);
    return r.ok && r.data ? r.data : {};
  } catch {
    return {};
  }
}

export async function saveHqOverride(name: string, hqId: string): Promise<void> {
  if (!api?.cfg) return;
  const cur = await loadHqOverrides();
  cur[name] = hqId;
  await api.cfg.set(HQ_OVERRIDE_KEY, cur);
}

/**
 * 팀/직무 문자열 → 본부 id 추론. 못 맞히면 HQ_UNSET.id.
 * 캘린더 제목의 "부서팀(직무)" 조각과 이벤트 설명을 그대로 넣으면 된다.
 */
export function inferHq(text: string, hqs: MailHq[]): string {
  const t = (text || '').replace(/\s+/g, '');
  if (!t) return HQ_UNSET.id;
  for (const hq of hqs) {
    for (const kw of hq.match) {
      if (!kw) continue;
      if (t.toUpperCase().includes(kw.toUpperCase())) return hq.id;
    }
  }
  return HQ_UNSET.id;
}

/** 캘린더 제목/장소에서 사업장 id 추론 (퍼플 → purple, 그린/용인 → yongin, 수원 → suwon) */
export function inferSite(text: string, sites: MailSite[]): string | null {
  const t = (text || '').replace(/\s+/g, '').toUpperCase();
  if (!t) return null;
  for (const s of sites) {
    const keys = s.aliases && s.aliases.length > 0 ? s.aliases : [s.label];
    for (const k of keys) {
      if (k && t.includes(k.replace(/\s+/g, '').toUpperCase())) return s.id;
    }
  }
  return null;
}
