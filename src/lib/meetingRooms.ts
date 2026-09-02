// 회의실/차량 리소스 캘린더 메타 — Settings의 라벨 정리 카드와
// 회의실 예약 페이지가 같은 분류 규칙을 공유한다.

import type { GCalListEntry } from './api';

export type RoomSite = 'purple' | 'seoul' | 'green' | 'suwon' | 'unknown';
export type RoomKind = 'room' | 'car';

export interface RoomMeta {
  id: string;
  kind: RoomKind;
  site: RoomSite;
  // 원본 캘린더 summary (Google 측 기본 이름)
  rawSummary: string;
  // override 후 라벨 (실제 summaryOverride 이거나, 그렇지 않으면 우리 분류에서 만든 정규 라벨)
  label: string;
  // 짧은 표시명 (예: "퍼플 대회의실", "퍼플 1285 레이")
  shortName: string;
  // Google Calendar API에 attendee로 넣을 이메일 = 리소스 캘린더 id
  resourceEmail: string;
}

const SITE_LABEL: Record<RoomSite, string> = {
  purple: '퍼플',
  seoul: '서울(위워크)',
  green: '그린',
  suwon: '수원',
  unknown: '기타',
};

// 퍼플 바로 아래에 서울(위워크) — 사용자 지정 순서 (2026-09-02)
export const SITE_LIST: RoomSite[] = ['purple', 'seoul', 'green', 'suwon'];

export function siteLabel(site: RoomSite): string {
  return SITE_LABEL[site];
}

function classifySite(summary: string): RoomSite {
  // 회의실 캘린더 이름은 "{사이트}-{층}-..." 패턴 ("퍼플-6층-...", "수원-2-...", "그린-4-...").
  // "수원-2-수원_2층 퍼플(회의실)"처럼 시설명에 다른 사이트 키워드가 섞이는 케이스가 있어서
  // 반드시 첫 prefix(또는 차량 이름)로만 분류해야 site=purple 회의실 매핑이 엉뚱한 곳에 가지 않는다.
  if (/^퍼플/.test(summary) || /퍼플차량/.test(summary)) return 'purple';
  if (/^그린/.test(summary) || /그린차량/.test(summary)) return 'green';
  if (/^수원/.test(summary) || /수원차량/.test(summary)) return 'suwon';
  if (/위워크|wework/i.test(summary)) return 'seoul';
  return 'unknown';
}

function shortenRoomName(rawSummary: string, isCar: boolean): string {
  if (isCar) {
    return rawSummary
      .replace(/^\(자동차\)-?/, '')
      .replace(/^퍼플차량_?/, '')
      .replace(/_/g, ' ')
      .trim();
  }
  return rawSummary
    .replace(/^퍼플-?\d*층?-?퍼플_?/, '')
    .replace(/^그린-?\d*층?-?그린_?/, '')
    .replace(/^그린-\d+-그린_?/, '')
    .replace(/^수원-?\d+층?-?수원_?/, '')
    .replace(/^수원-\d+-수원_?/, '')
    .replace(/_/g, ' ')
    .trim();
}

export function classifyResourceCalendar(entry: GCalListEntry): RoomMeta | null {
  if (!entry.id.includes('resource.calendar.google.com')) return null;
  const raw = entry.summary || '';
  const isCar = /자동차|차량/.test(raw);
  const isRoom = /회의실|미팅룸|대회의|소회의|구내식당|식당|카페|로비|라운지|VIP/.test(raw);
  if (!isCar && !isRoom) return null;

  const site = classifySite(raw);
  const short = shortenRoomName(raw, isCar);
  const kind: RoomKind = isCar ? 'car' : 'room';
  const prefix = isCar ? '🚗 차량' : '🏢 회의실';
  // override가 이미 있으면 그걸 사용, 없으면 우리 정규 라벨로 fallback
  const label = (entry.summaryOverride && entry.summaryOverride.trim())
    || `${prefix} · ${SITE_LABEL[site]} · ${short}`;

  return {
    id: entry.id,
    kind,
    site,
    rawSummary: raw,
    label,
    shortName: `${SITE_LABEL[site]} ${short}`,
    resourceEmail: entry.id, // resource 캘린더 id = attendee로 넣을 이메일
  };
}

// 회의실 예약 시 사용할 색깔 권장
export const PROPOSED_COLOR_BY_SITE: Record<RoomSite, string> = {
  purple: '1', // Lavender
  seoul: '9',  // Blueberry
  green: '2',  // Sage
  suwon: '7',  // Peacock
  unknown: '1',
};

// 사용자가 입력한 회의실 텍스트(location, site)를 실제 리소스 캘린더 이메일로 매핑.
// 면접 등록/수정 시 attendees에 회의실 리소스를 자동 포함시켜 Google이 즉시 예약을 잡도록 한다.
// 매핑 실패 → null (회의실 attendee 없이 등록, location 텍스트만).
//
// 매핑 규칙 (점수가 가장 높은 후보 1개):
//   1) site 일치 (퍼플/그린/수원만 — 위워크/온라인은 리소스 없음) 필수.
//   2) location에 숫자(1번, 2번)가 있으면 회의실명에 같은 숫자 있는지(`-1`, `-2`) 가장 중요.
//   3) "대회의실" / "소회의실" 키워드 일치.
//   4) "미팅룸" / "회의실" 일반 키워드는 약한 신호 (사이트 일치만 있을 때 첫 미팅룸으로 fallback 안 함).
const SITE_TO_INTERNAL: Record<string, RoomSite> = {
  퍼플: 'purple',
  그린: 'green',
  수원: 'suwon',
};

export function findResourceEmailByLocation(
  location: string,
  site: string,
  rooms: RoomMeta[]
): { resourceEmail: string; shortName: string } | null {
  const siteTok = (site || '').trim();
  const wantSite = SITE_TO_INTERNAL[siteTok];
  if (!wantSite) return null;
  const candidates = rooms.filter((r) => r.site === wantSite && r.kind === 'room');
  if (candidates.length === 0) return null;

  const loc = (location || '').toLowerCase();
  const numMatch = loc.match(/(\d+)\s*번?/);
  const num = numMatch ? numMatch[1] : null;
  const wantBig = /대회의/.test(loc);
  const wantSmall = /소회의/.test(loc);
  const wantVip = /vip/i.test(location || '');
  const wantCafe = /카페테리아|카페/.test(loc);
  const wantCanteen = /구내식당|식당/.test(loc);
  // 수원-2층 퍼플(회의실)은 location에 "퍼플"이 들어가도 사이트=수원이므로,
  // wantSite 필터로 이미 걸러진 후 "층 정보" 매칭에 의존.
  const floorMatch = loc.match(/(\d+)\s*층/);
  const wantFloor = floorMatch ? floorMatch[1] : null;

  let best: { room: RoomMeta; score: number } | null = null;
  for (const r of candidates) {
    const rLow = r.shortName.toLowerCase();
    const rawLow = r.rawSummary.toLowerCase();
    let score = 0;
    if (num && (rLow.includes(`-${num}`) || rawLow.includes(`-${num}`))) score += 10;
    if (wantBig && /대회의/.test(rLow)) score += 8;
    if (wantSmall && /소회의/.test(rLow)) score += 8;
    if (wantVip && /vip/.test(rLow)) score += 8;
    if (wantCafe && /카페테리아|카페/.test(rLow)) score += 8;
    if (wantCanteen && /구내식당|식당/.test(rLow)) score += 8;
    // 층 매칭 (수원: "2층 회의실" → "수원_2층 퍼플(회의실)")
    if (wantFloor && rLow.includes(`${wantFloor}층`)) score += 6;
    if (score === 0) continue;
    if (!best || score > best.score) best = { room: r, score };
  }
  if (!best) return null;
  return { resourceEmail: best.room.resourceEmail, shortName: best.room.shortName };
}

// ── 기본 회의실·차량 목록 (2026-09-02) ─────────────────────────────────────
// 회의실은 각자 구글 캘린더에 "추가"한 사람에게만 calendarList로 내려온다.
// 그래서 배포본을 처음 쓰는 사람은 회의실 목록이 통째로 비어 회의실 예약이 동작하지 않았다.
// (2026-09-02 동료 제보) 회사 공용 리소스 캘린더는 고정이므로 앱에 내장해 두고,
// 사용자의 calendarList에 있으면 그쪽 라벨/권한 정보를 우선 사용한다.
export const DEFAULT_RESOURCE_CALENDARS: { id: string; summary: string }[] = [
  { id: 'c_1885j8ar79lsojtok2q61knlfi9ba@resource.calendar.google.com', summary: '퍼플-6층-퍼플_대회의실 (30)' },
  { id: 'c_18871d3hrtpjoilvinc2b61sqtbf0@resource.calendar.google.com', summary: '퍼플-6층-퍼플_미팅룸-1 (9)' },
  { id: 'c_1885ni0ml4ldcigikdpk8431isbbo@resource.calendar.google.com', summary: '퍼플-6층-퍼플_미팅룸-2 (7)' },
  { id: 'c_188fosfpg2sp4ih9ibd4op9q5fj7i@resource.calendar.google.com', summary: '퍼플-6층-퍼플_구내식당 (46)' },
  { id: 'c_188bo662v0p6qjq6jieccrfcqg0qg@resource.calendar.google.com', summary: '그린-4-그린_대회의실 (30)' },
  { id: 'c_1881r2krji1omgmcj4u492fm4ndjs@resource.calendar.google.com', summary: '그린-4-그린_소회의실 (20)' },
  { id: 'c_1885u5n1uecasg20gvs02936q9gl4@resource.calendar.google.com', summary: '수원-4-수원_4층 회의실 (20)' },
  { id: 'c_188182fk0g99ojcqm1jogbmqicqt8@resource.calendar.google.com', summary: '수원-3-수원_3층 회의실 (20)' },
  { id: 'c_1880ir1hs6sp8gp7jr4jaktb6qb8c@resource.calendar.google.com', summary: '수원-3-수원_3층 카페테리아 (40)' },
  { id: 'c_188bgkgvprnaijg1gkm1b0r69b8su@resource.calendar.google.com', summary: '수원-2-수원_2층 (회의실) (20)' },
  { id: 'c_1888h6ip3vflojbgjlkmsn03cndm0@resource.calendar.google.com', summary: '(자동차)-퍼플차량_1285_레이' },
  { id: 'c_188cumtkjp98egr7j5fc31rqnnc50@resource.calendar.google.com', summary: '(자동차)-퍼플차량_7139_모닝' },
];

// ── 리소스 캘린더가 없는 장소 (2026-09-02 사용자 요청) ──────────────────────
// 서울 위워크는 구글 리소스 캘린더가 없어서 자동 예약 대상이 아니다.
// 그래도 면접 장소로 자주 쓰이므로 "가상 회의실"로 올려 두고, 예약 시에는
// 리소스 참석자 없이 일정만 만든다(장소 = 서울(위워크)).
export const VIRTUAL_ROOMS: RoomMeta[] = [
  {
    id: 'virtual:wework-seoul',
    kind: 'room',
    site: 'seoul',
    rawSummary: '서울 위워크',
    label: '🏢 회의실 · 서울(위워크)',
    shortName: '서울(위워크)',
    resourceEmail: '', // 리소스 캘린더 없음 → attendee로 넣지 않는다
  },
];

/** 리소스 캘린더가 없는 가상 장소인지 */
export const isVirtualRoom = (r: { id: string; resourceEmail: string }) =>
  r.id.startsWith('virtual:') || !r.resourceEmail;
