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

export const DEFAULT_SITES: MailSite[] = [
  {
    id: 'purple',
    label: '퍼플카운티',
    address: '(주)씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로5길 39)',
    guide: '\n도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.',
  },
  {
    id: 'yongin',
    label: '용인',
    // 주소는 형도님이 [⚙ 사업장 설정]에서 한 번 입력하면 이후 자동으로 채워짐.
    address: '',
    guide: '',
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
    id: 'rnd',
    label: '연구소',
    match: ['연구', '연구소', 'MU', 'SC', '처방', '제형', '분석', '기초', '색조', '파우더', 'Lab', '랩'],
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
    // 기본 사업장은 항상 남기고, 저장본이 있으면 그 값으로 덮어씀
    const byId = new Map(saved.map((s) => [s.id, s]));
    const merged = DEFAULT_SITES.map((d) => byId.get(d.id) || d);
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

/** 캘린더 제목/장소에서 사업장 id 추론 (퍼플 → purple, 용인 → yongin) */
export function inferSite(text: string, sites: MailSite[]): string | null {
  const t = (text || '').replace(/\s+/g, '');
  if (!t) return null;
  for (const s of sites) {
    // 라벨 전체("퍼플카운티") 또는 앞 두 글자("퍼플")로 매칭
    if (t.includes(s.label) || (s.label.length >= 2 && t.includes(s.label.slice(0, 2)))) return s.id;
  }
  return null;
}
