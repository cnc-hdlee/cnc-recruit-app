import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized, liveByKindOrScan, refreshCalendarFromGoogle, refreshNow } from '../store/liveData';
import { api } from '../lib/api';
import type { GCalListEntry } from '../lib/api';
import { SHARED_CAL, isInterviewCalendar } from '../lib/sharedCalendars';
import { gmailMessageUrl } from '../lib/gmail';
import { classifyResourceCalendar, findResourceEmailByLocation, type RoomMeta } from '../lib/meetingRooms';
import { InterviewTitleTidy } from '../components/InterviewTitleTidy';

// 후보자 이름이 첨부파일명에 포함되는지로 "현업에 이력서 공유함" 여부를 매칭하기 위한 보낸함 인덱스.
interface ResumeShareMail {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  date: string;
  to: string;
  attachments: string[];
  // attachmentInfos: 클릭만으로 PDF/문서를 시스템 기본 앱으로 열 때 사용 (attachmentId 필요)
  attachmentInfos: { filename: string; attachmentId: string; mimeType: string; size: number }[];
}

// 이력서/면접 안내 메일 매칭 — 본인(hdlee) 또는 임세현(shim) 발송 메일 중에서
// 후보자 이름이 (a) 첨부 파일명 OR (b) 메일 제목/본문(snippet)에 포함되고
// (c) "면접" 키워드 + (d) 면접일 ±30/1일 윈도우 안에 있고 (e) 첨부 1개 이상 있으면 인정.
//
// 핵심: 첨부 파일명에 "이력서" 단어가 없어도 OK. 메일 본문에 후보자 이름 적혀있고 첨부만 있으면 인정.
//       (사용자 케이스: 임세현 팀장이 보낸 "[TA팀] 품질보증팀 면접 안내" — 첨부는 면접평가표.xlsx +
//       이력서.pdf인데 파일명에 후보자 이름 없고 본문에 "이정아 2026-05-14 15:00" 형태로 들어있음)
function findResumeShare(
  candidate: string,
  interviewDt: string,
  mails: ResumeShareMail[]
): { mail: ResumeShareMail; filename: string; matchKind: 'filename' | 'body' } | null {
  const name = (candidate || '').trim();
  if (name.length < 2) return null;
  const NORM = (s: string) => s.replace(/[\s_\-.()\[\]·ㆍ／（）［］、,，]+/g, '');
  const nameNorm = NORM(name);
  const intvMs = Date.parse(`${interviewDt}T00:00:00+09:00`);
  if (!Number.isFinite(intvMs)) return null;
  // 발송일 윈도우 — 매우 관대: 면접일 120일 이전 ~ 14일 후 (외부 지원자 사전 송부 + 사후 평가표까지)
  const WINDOW_MS = 120 * 24 * 60 * 60 * 1000;
  const TAIL_MS = 14 * 24 * 60 * 60 * 1000;
  // 후보 메일 — filename 매칭 발견 시 즉시 return. 본문 매칭은 일단 후보 모음 → 마지막에 가장 가까운 발송일 채택.
  let bodyHit: { mail: ResumeShareMail; filename: string; sentMs: number } | null = null;
  for (const m of mails) {
    if (!m.attachments || m.attachments.length === 0) continue;
    const sentMs = Date.parse(m.date);
    if (!Number.isFinite(sentMs)) continue;
    if (sentMs > intvMs + TAIL_MS) continue;
    if (sentMs < intvMs - WINDOW_MS) continue;
    // (a) 파일명에 후보자 이름 — 강한 신호. 키워드 필터 없이 즉시 매칭.
    let matchedFn: string | null = null;
    for (const fn of m.attachments) {
      if (NORM(fn).includes(nameNorm)) { matchedFn = fn; break; }
    }
    if (matchedFn) return { mail: m, filename: matchedFn, matchKind: 'filename' };
    // (b) 본문/제목에 후보자 이름 — 키워드 요구 없이도 매칭. 첨부가 있는 이상 이력서로 추정.
    //     이름이 흔한 한글(2자 김민수 등)이라 false-positive 위험은 있지만,
    //     사용자 정책: "이력서로 추정되는거다 연동시켜놔" — 추정 우선.
    const hay = `${m.subject || ''} ${m.snippet || ''}`;
    if (NORM(hay).includes(nameNorm)) {
      if (!bodyHit || Math.abs(sentMs - intvMs) < Math.abs(bodyHit.sentMs - intvMs)) {
        bodyHit = { mail: m, filename: m.attachments[0], sentMs };
      }
    }
  }
  if (bodyHit) return { mail: bodyHit.mail, filename: bodyHit.filename, matchKind: 'body' };
  return null;
}

// 근무지 프리셋 (퍼플/그린/수원/위워크/온라인 등) — 첫 번째 깊이
const SITE_PRESETS = [
  '퍼플',
  '그린',
  '수원',
  '위워크',
  '온라인',
];

// 회의실 프리셋 (사이트별 흔한 룸) — 두 번째 깊이
// ※ 구글 캘린더 리소스 라벨과 정확히 일치 (괄호 안은 수용 인원).
//   findResourceEmailByLocation()이 텍스트→리소스 이메일 매핑하므로 이 라벨이 정확해야 자동 선점이 정확하게 잡힘.
const ROOM_PRESETS_BY_SITE: Record<string, string[]> = {
  퍼플: ['대회의실 (30)', '미팅룸-1 (9)', '미팅룸-2 (7)', '구내식당 (46)'],
  그린: ['대회의실 (30)', '소회의실 (20)'],
  수원: ['2층 회의실 (20)', '3층 회의실 (20)', '3층 카페테리아 (40)', '4층 회의실 (20)'],
  위워크: ['4E 회의실', '5F 회의실'],
  온라인: ['Google Meet', 'Zoom'],
};

interface InterviewForm {
  candidate: string;
  team: string;        // 팀명 (예: 인사팀)
  job: string;         // 직무 (옵션, 비어있으면 team만)
  site: string;        // 근무지 (퍼플/그린/수원/위워크/온라인)
  customSite: string;
  room: string;        // 회의실 (미팅룸 1번 등)
  customRoom: string;
  date: string;
  startTime: string;
  endTime: string;
  interviewers: string;
  notes: string;
  addMeet: boolean;
}

function nextHalfHour(): { date: string; start: string; end: string } {
  const d = new Date();
  d.setSeconds(0, 0);
  // 다음 30분 단위로 올림
  const m = d.getMinutes();
  d.setMinutes(m < 30 ? 30 : 60);
  if (d.getMinutes() === 0) d.setHours(d.getHours() + 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const sh = String(d.getHours()).padStart(2, '0');
  const sm = String(d.getMinutes()).padStart(2, '0');
  d.setHours(d.getHours() + 1);
  const eh = String(d.getHours()).padStart(2, '0');
  const em = String(d.getMinutes()).padStart(2, '0');
  return { date: `${yy}-${mm}-${dd}`, start: `${sh}:${sm}`, end: `${eh}:${em}` };
}

interface InterviewEvent {
  id: string;
  dt: string;
  tm: string;
  endTm: string;
  title: string;
  candidate: string;
  site: string;
  team: string;
  room: string;
  source: 'sheet' | 'calendar' | 'sheet_intv';
  htmlLink?: string | null;
  location: string;
  attendees: string[];
  done: boolean;
  calendarId?: string | null; // 캘린더 출처 시 어느 캘린더인지 (삭제·수정용)
  startISO?: string | null; // 수정 모달 prefill용
  endISO?: string | null;
  description?: string;
}

// 부서명 → 근무지 추정 (시트에 근무지 정보 없을 때 자동 등록용)
const TEAM_TO_SITE: Record<string, string> = {
  영업관리팀: '퍼플',
  전략구매팀: '퍼플',
  품질관리1팀: '퍼플',
  품질관리2팀: '그린',
  품질보증팀: '퍼플',
  자재물류1팀: '방교',
  제조1팀: '퍼플',
  제조2팀: '그린',
  생산1팀: '퍼플',
  생산2팀: '그린',
  생산운영팀: '그린',
  포장2팀: '그린',
  시설안전팀: '퍼플',
  TA팀: '퍼플',
  인사팀: '퍼플',
  재경팀: '퍼플',
  '구성원경험팀': '퍼플',
  경영정보팀: '퍼플',
  MU연구소: '수원',
  SC연구소: '수원',
  연구기획팀: '수원',
  스킨바디케어연구팀: '수원',
  '메이크업연구1팀': '수원',
  '메이크업연구3팀': '수원',
  KPD1팀: '수원',
  KPD2팀: '수원',
  'Cleansing Studio팀': '수원',
  OBM팀: '서울',
  제품기획팀: '서울',
  제품개발팀: '서울',
  GPD: '위워크',
};
function guessSiteFromTeam(team: string): string {
  if (!team) return '';
  const t = team.trim();
  if (TEAM_TO_SITE[t]) return TEAM_TO_SITE[t];
  // 부분 매칭
  for (const [k, v] of Object.entries(TEAM_TO_SITE)) {
    if (t.includes(k) || k.includes(t)) return v;
  }
  return '';
}

function dismissKey(dt: string, tm: string, candidate: string): string {
  return `${dt}|${tm}|${candidate.trim().slice(0, 12)}`;
}

// 면접 이벤트와 회의실 booking을 cross-match.
// 회의실 예약은 보통 cncadmin@/임세현이 별도 이벤트로 잡으므로 면접 이벤트 attendees에는 안 들어옴.
// 매칭 우선순위 (데이터로 검증된 케이스 기반):
//   (1) booking summary/description에 후보자 이름 포함 — 가장 신뢰 ↑
//   (2) 시간 겹침 + booking이 "면접" 키워드 + 면접 location 토큰 또는 site 토큰이
//       booking이 잡힌 회의실명에 포함 — 오타 매칭("엄희선"↔"임희선") + 익명 booking
//       (시간 슬롯에 "면접"만 적힌 케이스 — 임세현이 연속 면접 슬롯을 한 번에 잡음)
function matchRoomBooking(
  candidate: string,
  dt: string,
  startISO: string | null | undefined,
  endISO: string | null | undefined,
  location: string,
  site: string,
  bookings: { resourceId: string; shortName: string; startMs: number; endMs: number; summary: string; description: string }[]
): { shortName: string; via: 'name' | 'timeloc' } | null {
  const name = (candidate || '').trim();
  const dayStart = Date.parse(`${dt}T00:00:00+09:00`);
  const dayEnd = Date.parse(`${dt}T23:59:59+09:00`);
  if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd)) return null;

  // (1) 이름 매칭
  if (name.length >= 2) {
    for (const b of bookings) {
      if (b.endMs < dayStart || b.startMs > dayEnd) continue;
      if (b.summary.includes(name) || b.description.includes(name)) {
        return { shortName: b.shortName, via: 'name' };
      }
    }
  }

  // (2) 시간 겹침 + booking이 "면접" 키워드 + 위치/site 토큰 매칭
  // 단, booking summary에 다른 후보자 이름이 명시되어 있으면 매칭 거부 (false-positive 차단).
  //   예: 엄희선 면접 location이 "미팅룸 2번"이고, 미팅룸-2 booking이 "전략구매팀 면접 - 이건주(부자재)"인 경우.
  //   booking에 "이건주" 이름이 명시되어 있으므로 엄희선과 매칭되면 안 됨. → 회의실 미예약으로 정확히 표시.
  const ivStartMs = startISO ? Date.parse(startISO) : NaN;
  const ivEndMs = endISO ? Date.parse(endISO) : NaN;
  if (Number.isFinite(ivStartMs) && Number.isFinite(ivEndMs)) {
    const loc = (location || '').toLowerCase();
    const siteTok = (site || '').toLowerCase().trim();
    for (const b of bookings) {
      if (b.endMs <= ivStartMs || b.startMs >= ivEndMs) continue;
      if (!/면접|interview/i.test(b.summary)) continue;
      // booking summary에서 명시된 한글 후보자 이름 추출 — 패턴 "면접 - {이름}" 또는 "면접 {이름}"
      // 추출된 이름이 현재 후보자와 다르면 매칭 거부 (다른 후보의 booking).
      const bookingNameMatch = b.summary.match(/면접\s*[-—–]?\s*([가-힣]{2,4})(?:\s*\([^)]*\))?/);
      if (bookingNameMatch) {
        const bookingName = bookingNameMatch[1];
        if (bookingName !== name) continue;
        // 같은 이름이면 (1)에서 이미 매칭됐을 것이므로 여기 안 옴 — 안전망.
      }
      const roomLow = b.shortName.toLowerCase();
      // location의 토큰 중 하나라도 회의실명에 포함 (예: "퍼플 미팅룸 1번" ↔ "퍼플 미팅룸-1")
      const locTokens = loc.split(/[\s()\-_/]+/).filter((t) => t.length >= 2);
      const locMatch = locTokens.some((t) => roomLow.includes(t));
      const siteMatch = !!siteTok && roomLow.includes(siteTok);
      if (locMatch || siteMatch) {
        return { shortName: b.shortName, via: 'timeloc' };
      }
    }
  }

  return null;
}

// 캘린더 ID → 사람 친화적 이름 (중복 정리 dry-run 표시용)
function shortCalName(calId: string | null | undefined): string {
  if (!calId) return '?';
  if (calId === SHARED_CAL.interview) return '면접(메인)';
  if (calId === SHARED_CAL.interviewAlt) return '면접(보조)';
  if (calId === SHARED_CAL.onboardingMain) return '입사';
  if (calId === SHARED_CAL.offboarding) return '퇴사';
  if (calId === 'primary') return 'primary';
  return calId.slice(0, 10) + '…';
}

// Google Calendar colorId → 색깔 이름 (dry-run 표시용)
function colorName(colorId: string | null | undefined): string {
  if (!colorId) return '기본';
  const map: Record<string, string> = {
    '1': '라벤더', '2': '세이지(초록)', '3': '포도(보라)', '4': '플라밍고',
    '5': '바나나(노랑)', '6': '귤(주황)', '7': '공작(파랑)', '8': '흑연',
    '9': '블루베리', '10': '바질(진초록)', '11': '토마토(빨강)',
  };
  return map[colorId] || `c${colorId}`;
}

// "면접 및 처우 현황" 시트의 비고 컬럼에서 datetime 추출.
// 형식 예: "2026-05-06 14:00", "2026-05-08 14:00:00", "2026-5-8 14:00:00"
// 일정 없는 비고("불합격", "1차 면접 결과 대기 중", "CPI 진행 중" 등)는 null 반환.
function parseInterviewSheetNote(note: string): { dt: string; tm: string } | null {
  const m = (note || '').match(/(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const yy = m[1];
  const mm = String(parseInt(m[2], 10)).padStart(2, '0');
  const dd = String(parseInt(m[3], 10)).padStart(2, '0');
  const hh = String(parseInt(m[4], 10)).padStart(2, '0');
  const mi = m[5];
  return { dt: `${yy}-${mm}-${dd}`, tm: `${hh}:${mi}` };
}


const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function diffDays(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((da - db) / 86400000);
}

// 표준 포맷: "퍼플 / 이형도 / 인사팀 / 10:00 / 미팅룸 1번"
//   tokens: [site, candidate, team, time, room]
// 과거 포맷도 위치 무관 토큰 분류로 자동 인식.
const SITE_KEYWORDS = ['퍼플', '그린', '수원', '서울', '오산', '위워크', '온라인', '본사', '판교', '강남'];
const ROOM_KEYWORDS = /회의실|미팅룸|VIP|대회의|소회의|Meet|Zoom|구글|줌|구내식당|식당|카페|로비|라운지|휴게실|강당|세미나실/i;
const TEAM_KEYWORDS = /팀$|본부$|실$|센터$|매니저|기획|개발|디자이너|마케터|연구원|PM|MD|엔지니어|직무|채용/;
// 괄호 안 부연설명 제거 — "김승우(PM)" / "최현아 (원료)" 처럼 이름 뒤에 직무가 붙는 포맷에서
// TEAM_KEYWORDS(PM·MD·기획 …)가 괄호 안 글자에 걸려 후보자를 팀명으로 오분류하던 버그 방지.
// (2026-08-20: "15:00 / 퍼플 / 김승우(PM) / 생산1팀" → 후보자가 "생산"으로 표시되던 문제)
const withoutParens = (s: string) => s.replace(/[(（][^)）]*[)）]/g, ' ').replace(/\s+/g, ' ').trim();

// 후보자 이름이 절대 될 수 없는 단어 (장소/시설명) — 한글 2-4자라도 이름 매칭에서 제외
const NOT_NAME_KEYWORDS =
  /^(구내식당|식당|카페|로비|라운지|휴게실|강당|세미나실|회의실|미팅룸|대회의|소회의|본사|퍼플|그린|수원|서울|판교|강남|온라인|위워크|VIP룸|VIP|회의|미팅|면접|일정|장소|커피챗|그룹면접|협의|지원|모집|안내)/;

export function parseInterviewTitle(title: string): {
  candidate: string;
  site: string;
  team: string;
  room: string;
  time: string;
} {
  const t = (title || '').trim();
  const empty = { candidate: '', site: '', team: '', room: '', time: '' };
  if (!t) return empty;

  // 슬래시가 없는 패턴 — 회의실 예약이 primary에 sync되며 만들어진 "○○팀 면접 - 박은성"
  // 같은 형식이 흔하다. 단순 `[가-힣]{2,4}` greedy 매칭은 "구성원경험팀"에서 "구성원경"을
  // 후보자로 잘못 잡으므로, (1) dash 뒤 이름 우선 (2) 팀/실/센터 suffix 토큰 제외 후 첫 한글.
  if (!t.includes('/')) {
    // 표시용 부가정보 (매니저 캘린더 "(면접) 직무 이름 HH:MM (장소)" 포맷 대응)
    const timeM = t.match(/(\d{1,2}:\d{2})/);
    const mTime = timeM ? timeM[1] : '';
    const mSite = SITE_KEYWORDS.find((s) => t.includes(s)) || '';
    const roomM = t.match(ROOM_KEYWORDS);
    const mRoom = roomM ? roomM[0] : '';
    // 직무/차수/시설 suffix — 이름이 될 수 없는 토큰
    const isName = (tk: string) =>
      tk.length >= 2 && tk.length <= 4 &&
      !NOT_NAME_KEYWORDS.test(tk) &&
      !/(팀|실|센터|본부|장|분석|보안|운영|관리|구매|담당|회계|법무|기획|전략|생산|영업|재무|인사|품질|물류|개발|디자인|보조|지원|협의)$/.test(tk) &&
      !/^(면접|회의|미팅|일정|장소|예약|대기|후보|차수|그룹|커피)$/.test(tk) &&
      !/^\d?차$/.test(tk);
    // "천필용님" 처럼 호칭이 붙은 토큰에서 이름만 떼어낸다
    const stripHonorific = (tk: string) => tk.replace(/(님|씨)$/, '');

    // 직무(소속칸 표시용) = (면접)·끝(장소)·시간·N차·이름 제거하고 남은 문자열
    //   예: "(면접) 원가분석 임소현 10:00 (퍼플-미팅2)" → "원가분석" / "재무회계팀장 1차" → "재무회계팀장"
    const jobOf = (name: string) => t
      .replace(/^[(（]\s*면접\s*[)）]\s*/, '')
      .replace(/\s*[(（][^)）]*[)）]\s*$/, '')
      .replace(/\d{1,2}:\d{2}/g, '')
      .replace(/\d+\s*차/g, '')
      .replace(name, '')
      // 소속 칸에 남는 찌꺼기 정리 — "면접: SC영업팀장" / "생산1팀 면접 -" / "생산1팀 님 면접 일정 협의"
      .replace(/일정\s*협의|협의|면접/g, '')
      .replace(/[·／/:：\-—–[\]]+/g, ' ')
      .replace(/(^|\s)(님|씨)(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // ① 매니저 포맷: 이름은 시간(HH:MM) 직전의 마지막 한글 2-4자 토큰 (직무·차수는 앞에 옴)
    //    예: "(면접) 원가분석 임소현 10:00 (퍼플-미팅2)" → 임소현 / 소속=원가분석
    if (timeM) {
      const ko = t.slice(0, timeM.index).match(/[가-힣]{2,4}/g) || [];
      for (let i = ko.length - 1; i >= 0; i--) {
        if (isName(ko[i])) return { ...empty, candidate: ko[i], team: jobOf(ko[i]), time: mTime, site: mSite, room: mRoom };
      }
      // 제목이 시간으로 시작하면 앞에 아무것도 없다 — 뒤쪽에서 찾는다
      //   예: "15:00 면접 SC영업팀장 이윤기" → 이윤기
      const after = t.slice((timeM.index || 0) + timeM[0].length).match(/[가-힣]{2,5}/g) || [];
      for (let i = after.length - 1; i >= 0; i--) {
        const tk = stripHonorific(after[i]);
        if (isName(tk)) return { ...empty, candidate: tk, team: jobOf(tk), time: mTime, site: mSite, room: mRoom };
      }
    }
    // ② "(면접) …" 포맷인데 시간 없음 → 끝 (장소) 괄호 제거 후 마지막 이름 토큰
    //    예: "(면접) 재무회계팀장 1차 조정연 (퍼플-대)" → 조정연 / 소속=재무회계팀장
    if (/^[(（]\s*면접\s*[)）]/.test(t)) {
      const ko = t.replace(/\s*[(（][^)）]*[)）]\s*$/, '').match(/[가-힣]{2,4}/g) || [];
      for (let i = ko.length - 1; i >= 0; i--) {
        if (isName(ko[i])) return { ...empty, candidate: ko[i], team: jobOf(ko[i]), time: mTime, site: mSite, room: mRoom };
      }
    }

    // ③ (기존) 회의실 sync "○○팀 면접 - 박은성" dash 포맷
    const dashIdx = t.search(/[-—–]/);
    if (dashIdx >= 0) {
      const afterDash = t.slice(dashIdx + 1).match(/[가-힣]{2,4}/);
      if (afterDash && !NOT_NAME_KEYWORDS.test(afterDash[0]) && !/팀$|실$|센터$|본부$/.test(afterDash[0])) {
        // 소속 = dash 앞에서 "면접" 단어를 뺀 부분 ("생산1팀 면접 - 김승우(PM)" → 생산1팀).
        // 부서가 비면 카드에서 소속이 사라져 누락처럼 보이므로 반드시 채운다.
        const beforeDash = t
          .slice(0, dashIdx)
          .replace(/\d{1,2}:\d{2}/g, '')
          .replace(/면접/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        return { ...empty, candidate: afterDash[0], team: beforeDash, time: mTime, site: mSite, room: mRoom };
      }
    }
    // ④ fallback — ①과 같은 isName 기준을 쓴다.
    //    예전엔 "팀/실/센터/본부로 끝나는 것"만 걸러서 직무·부서가 이름으로 잡혔다.
    //    (SC영업팀장 허진영 → '영업팀장', 생산1팀 천필용님 → '생산')
    //    뒤에서부터 본다 — 한국어 제목은 대개 "부서 직무 이름" 순서다.
    const tokens = (t.match(/[가-힣]+/g) || []).map(stripHonorific);
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (isName(tokens[i])) return { ...empty, candidate: tokens[i], team: jobOf(tokens[i]), time: mTime, site: mSite, room: mRoom };
    }
    return { ...empty, candidate: t, time: mTime, site: mSite, room: mRoom };
  }

  const parts = t.split('/').map((p) => p.trim()).filter(Boolean);
  let candidate = '', site = '', team = '', room = '', time = '';
  const leftover: string[] = [];

  // 이름 후보 고르기 — "먼저 나온 토큰이 이김"이 아니라 점수가 가장 높은 토큰을 쓴다.
  //   "영업관리 해외/김미리애/14:00" 에서 앞 토큰(부서)이 이름으로 잡혀 메일이 "영업관리님"으로
  //   나가던 문제(2026-09-01) 때문에 도입. 부서·직무는 뒤에 다른 말이 붙어 있고, 사람 이름은 단독이다.
  //   3점 = 이름만 있는 토큰("김미리애") / 2점 = 이름 + 호칭·차수("이새롬 1차")
  //   1점 = 이름 뒤에 다른 말이 붙음("영업관리 해외") → 더 좋은 후보가 없을 때만 사용
  const ROLE_TAIL = /^(님|씨|후보자|지원자|\d+\s*차|신입|경력|팀장|파트장|과장|대리|사원|주임|차장|부장|이사)$/;
  // 부서·직무처럼 생긴 토큰 (국내영업/해외영업/원가분석/자재개발…). 이름과 같은 자리에 오기 때문에
  // "(면접) 국내영업/윤경근/10:00" 에서 국내영업이 이름으로, 윤경근이 소속으로 뒤집히는 사고가 났다.
  // 하드 배제가 아니라 감점 — 이지원처럼 직무 단어로 끝나는 진짜 이름도 있어서, 다른 후보가 없으면 살린다.
  const DEPT_TAIL =
    /(영업|관리|구매|기획|개발|분석|생산|물류|안전|품질|인사|교육|운영|회계|재무|총무|마케팅|디자인|연구|지원|구성|기술|공정|시설|자재|포장|제조)$/;
  // 흔한 성(姓) — "해외영업"과 "이지원"이 똑같이 감점됐을 때 사람 이름 쪽을 고르는 기준.
  // 부서명은 성으로 시작하지 않는다.
  const SURNAME =
    /^[김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제탁국진어편용봉피]/;
  // 토큰 안의 "단어" 단위로 이름을 찾는다.
  //   "영업관리팀 김광태" 처럼 한 칸에 팀과 이름이 같이 오는 제목이 많다.
  //   단독 토큰(3점) > 구(句) 안의 단어(2점), 부서성 접미사 -2, 성(姓)으로 시작 +1.
  const nameScore = (p: string): { name: string; score: number } | null => {
    const bare = withoutParens(p).replace(/\s+/g, ' ').trim();
    if (!bare) return null;
    if (SITE_KEYWORDS.some((s) => bare.includes(s)) || ROOM_KEYWORDS.test(bare)) return null;
    const words = bare.split(/\s+/);
    let best: { name: string; score: number } | null = null;
    for (const w of words) {
      const word = w.replace(/[(),]/g, '');
      if (!/^[가-힣]{2,4}$/.test(word)) continue;
      if (NOT_NAME_KEYWORDS.test(word)) continue;
      if (/(팀|본부|실|센터)$/.test(word)) continue;
      const solo = words.length === 1;
      const restWords = words.filter((x) => x !== w);
      const roleOnly = restWords.length > 0 && restWords.every((x) => ROLE_TAIL.test(x));
      const base = solo ? 3 : roleOnly ? 2 : 2;
      const adj = base - (DEPT_TAIL.test(word) ? 2 : 0) + (SURNAME.test(word) ? 1 : 0);
      const score = Math.max(1, adj);
      if (!best || score > best.score) best = { name: word, score };
    }
    return best;
  };
  let bestIdx = -1;
  let bestScore = 0;
  parts.forEach((p, i) => {
    // 시간만 있는 토막만 건너뛴다.
    //   예전에는 "시간이 들어있으면" 통째로 건너뛰어서
    //   "(15:00)생산1팀 면접 - 박현석(PM) / 구내식당" 처럼 시간과 이름이 한 칸에 있는 제목에서
    //   이름 후보가 하나도 안 남아 후보자가 통째로 사라졌다(2026-09-02 박현석 건).
    //   nameScore는 한글 2~4자 단어만 이름으로 보므로 시간이 섞여 있어도 안전하다.
    if (/^[(（]?\s*\d{1,2}:\d{2}\s*[)）]?$/.test(p.trim())) return;
    const s = nameScore(p);
    if (s && s.score > bestScore) {
      bestScore = s.score;
      bestIdx = i;
    }
  });
  if (bestIdx >= 0) candidate = nameScore(parts[bestIdx])!.name;

  for (const [idx, p] of parts.entries()) {
    if (idx === bestIdx) {
      // 이름을 뽑아낸 토큰에 팀명이 같이 들어있으면("영업관리팀 김광태") 나머지를 소속으로 쓴다
      const rest = p
        .replace(candidate, ' ')
        .replace(/[(（][^)）]*[)）]/g, ' ')
        // "(15:00)생산1팀 면접 - 박현석(PM)" 처럼 한 칸에 시간·면접·dash가 같이 오는 제목에서
        // 소속이 "생산1팀 면접 -" 로 지저분하게 남던 것 정리
        .replace(/\d{1,2}:\d{2}/g, ' ')
        .replace(/일정\s*협의|협의|면접/g, ' ')
        .replace(/[·／:：\-—–[\]]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (rest && !team && !ROLE_TAIL.test(rest)) team = rest;
      continue;
    }
    // 시간: 토큰 내 어디든
    if (!time) {
      const tm = p.match(/(\d{1,2}:\d{2})/);
      if (tm) { time = tm[1]; continue; }
    }
    // 근무지: 토큰 내 부분 일치
    if (!site && SITE_KEYWORDS.some((s) => p.includes(s))) {
      const matched = SITE_KEYWORDS.find((s) => p.includes(s)) || p;
      site = matched;
      continue;
    }
    if (!room && ROOM_KEYWORDS.test(p)) { room = p; continue; }
    // 후보자: 토큰 시작이 한글 2-4자 (이태호(제조2팀) 같은 형태도 잡음)
    if (!candidate) {
      const nm = p.match(/^([가-힣]{2,4})(?:$|\(|\s)/);
      if (nm && !NOT_NAME_KEYWORDS.test(nm[1]) && !TEAM_KEYWORDS.test(withoutParens(p))) {
        candidate = nm[1]; continue;
      }
      // 영문 이름 단독 토큰 (외국인 후보자) — site/room/팀 키워드 제외
      const en = p.match(/^([A-Za-z][A-Za-z0-9.\-]{1,})$/);
      if (en && !TEAM_KEYWORDS.test(p) && !ROOM_KEYWORDS.test(p) &&
          !SITE_KEYWORDS.some((s) => p.includes(s))) {
        candidate = en[1]; continue;
      }
    }
    if (!team && TEAM_KEYWORDS.test(withoutParens(p))) { team = p; continue; }
    leftover.push(p);
  }

  // 미분류 토큰: 후보자 → 팀 → 회의실 순
  for (const p of leftover) {
    if (!candidate) {
      const nm = p.match(/^([가-힣]{2,4})/);
      if (nm && !NOT_NAME_KEYWORDS.test(nm[1])) { candidate = nm[1]; continue; }
    }
    if (!team) { team = p; continue; }
    if (!room) { room = p; continue; }
  }

  // 그래도 후보자 못 찾았으면 — 장소가 아닌 첫 토큰만
  if (!candidate) {
    candidate = parts.find((p) => !NOT_NAME_KEYWORDS.test(p) && !/^\d/.test(p)) || '';
  }

  // 소속 앞에 붙은 "(면접)" 머리말은 표시용으로 필요 없다 — 칩에 그대로 찍히면 지저분하다
  team = team.replace(/^[(（]\s*면접\s*[)）]\s*/, '').replace(/\s+/g, ' ').trim();

  return { candidate, site, team, room, time };
}

// to-do/업무 액션 동사 — "OOO 발송", "OOO 확인", "그리팅 시안 확인", "채용품의 상신" 등을 면접에서 제외
const TODO_ACTION_KEYWORDS = /(안내|발송|확인|준비|작성|기안|상신|회신|보고|공유|체크|정리|등록|기입|결재|점검|결제|구매|받기|챙기기|제출|신청|수령|반납|발급|취소|기획|품의|시안|크리닝|스크리닝|마감|개시|마감|기록|통보|업데이트)/;

// 조직 이름 안의 글자가 키워드로 오인되지 않게 먼저 걷어낸다.
// '전략구매팀'의 '구매'가 to-do 동사(구매 요청 등)로 잡혀서 전략구매팀 면접 20건이
// 통째로 목록에서 사라졌다 (2026-09-03 임수현 건). 교육팀·세미나실 같은 이름도 같은 함정이다.
const withoutOrgNames = (s: string) =>
  (s || '').replace(/[가-힣A-Za-z0-9]{1,12}(팀|파트|실(?!장)|센터|본부|그룹|스튜디오|랩|Lab|Studio|Center)/g, ' ');

export function isInterviewKind(summary: string, colorId: string | null, calendarId: string | null = null): boolean {
  // 제목 없는 이벤트 제외 — 공유 면접 캘린더를 reader로 읽으면 private이라 제목이 빈 채로 온다.
  // 그 빈 사본이 카드로 뜨면 이름·소속 공란이 되므로 원천 차단(제목 있는 primary 사본만 카드화).
  if (!summary || !summary.trim()) return false;
  // 면접 취소/포기/보류 키워드 — 카드에서 제외 (이력에서 사라짐).
  //   예: "(면접포기)수원/16:20/정예원/Base Lab"
  // 불참/노쇼는 제외하지 않고 줄긋기로만 표시 — 이력 보존 (누가 안 왔는지 기록 가치 있음).
  // 명시적 취소는 다른 어떤 규칙보다 우선 — 사용자가 끄겠다고 한 건 면접 캘 보라색이어도 차단.
  if (/면접포기|면접\s*취소|\(취소\)|취소됨|\(보류\)|면접\s*보류/i.test(summary)) {
    return false;
  }
  // 면접 캘린더(SHARED_CAL.interview) + colorId='3'(보라) 명시 등록 = 사용자 의도 신뢰.
  // 회의실 예약 페이지에서 "면접 캘린더에도 함께 등록" 체크박스로 보내진 건 등
  // 제목이 "면접" 키워드/슬래시 포맷 안 맞아도(예: "포장2팀 ERP파트 - 장성민") 카드로 표시.
  // 다른 분류 키워드(교육/일자리센터/입사 등)보다 우선 — 사용자가 면접 캘에 의도적으로 올린 것이므로.
  if (calendarId === SHARED_CAL.interview && colorId === '3') {
    return true;
  }
  // 면접 전용 공유 캘린더(interviewAlt / interviewMgr / interviewX) = 색/제목 무관 면접으로 신뢰.
  // 남이 만들어 hdlee를 초대한 면접이 primary 초대로만 들어와 앱에 누락되던 문제(2026-08) 해결.
  if (isInterviewCalendar(calendarId)) {
    return true;
  }
  // 입사(colorId 5)·퇴사·휴가·행사 명시적으로 제외
  if (colorId === '5') return false; // 노란색 = 입사
  if (/입사|퇴사|퇴직|휴가|연차|반차|생일|워크샵|워크샾|행사|회식|점심|런치|MT\b|OT\b|교육|세미나|컨퍼런스|타운홀|townhall|holiday|off\b|박람회|일자리센터/i.test(withoutOrgNames(summary))) {
    return false;
  }
  // 일반 회의/미팅 제외 (단, "면접" 단어가 함께 있거나 회의실/미팅룸 같은 장소명은 통과)
  if (/(회의(?!실)|미팅(?!룸)|meeting|\bsync\b|싱크미팅|1on1|1:1)/i.test(summary) && !/면접|interview/i.test(summary)) {
    return false;
  }

  // ① 슬래시 포맷 면접 — 한글/영문 이름 + (시간 OR 근무지 OR 회의실) 중 하나 이상
  //    옛 포맷("11:00 위워크 / 김태리 / OBM(상품기획)")도 통과시키려고 토큰 내 부분일치 허용
  //    영문 이름(외국인 후보자 등)도 통과 — SITE/ROOM/팀 키워드는 제외하고 단독 영문 토큰을 이름으로 인정
  if (summary.includes('/')) {
    const parts = summary.split('/').map((s) => s.trim()).filter(Boolean);
    const hasTime = parts.some((p) => /\d{1,2}:\d{2}/.test(p));
    const hasName = parts.some((p) => {
      // 한글 이름 (2-4자)
      const ko = p.match(/(?:^|\s)([가-힣]{2,4})(?:\s|\(|$)/);
      if (ko && !NOT_NAME_KEYWORDS.test(ko[1]) && !TEAM_KEYWORDS.test(withoutParens(p))) return true;
      // 영문 이름 (단독 토큰, 2자 이상) — site/room/팀 키워드 제외
      const en = p.match(/^([A-Za-z][A-Za-z0-9.\-]{1,})$/);
      if (en) {
        if (SITE_KEYWORDS.some((s) => p.includes(s))) return false;
        if (ROOM_KEYWORDS.test(p)) return false;
        if (TEAM_KEYWORDS.test(p)) return false;
        return true;
      }
      return false;
    });
    const hasSite = parts.some((p) => SITE_KEYWORDS.some((s) => p.includes(s)));
    const hasRoom = parts.some((p) => ROOM_KEYWORDS.test(p));
    if (hasName && (hasTime || hasSite || hasRoom)) return true;
  }

  // ② "면접/interview" 명시 키워드 — 단, to-do 액션 동사가 함께 있으면 차단 (예: "면접 안내문자 발송")
  if (/면접|interview/i.test(summary)) {
    // 괄호 안 직무 설명도 걷어낸다 — "김민주(원료구매)" 의 구매가 to-do 동사로 잡히던 문제.
    // to-do 일정은 "면접 안내문자 발송" 처럼 괄호 없이 동사가 본문에 있다.
    const bare = withoutOrgNames(summary).replace(/[(（][^)）]*[)）]/g, ' ');
    if (TODO_ACTION_KEYWORDS.test(bare)) return false;
    return true;
  }

  // 그 외(colorId=11 단독, 단순 텍스트 등)는 통과 안 함 — to-do로 간주
  return false;
}

export function CalendarPage() {
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();
  const [query, setQuery] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, forceTick] = useState(0);
  const [editingEvent, setEditingEvent] = useState<InterviewEvent | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dismissedLoaded, setDismissedLoaded] = useState(false);
  const [autoRegistering, setAutoRegistering] = useState<Set<string>>(new Set());
  const [cleaningUp, setCleaningUp] = useState(false);
  // 카드 필터 — 상단 요약 카드 클릭으로 토글 (all/today/thisWeek)
  const [cardFilter, setCardFilter] = useState<'all' | 'today' | 'thisWeek'>('all');
  // (이전 버전의 lastAutoCleanupRef는 실제로 throttle에 쓰이지 않아 제거됨)
  // 보낸함 이력서 첨부 인덱스 — 후보자 이름이 첨부파일명에 포함된 메일을 찾아 "현업 공유" 판정에 사용
  const [resumeMails, setResumeMails] = useState<ResumeShareMail[]>([]);
  // 회의실 리소스 캘린더의 예약(booking) 인덱스 — 면접 카드의 "회의실 예약" 판정용.
  // 회의실 예약은 cncadmin@이 별개 이벤트로 잡는 워크플로라 면접 이벤트 attendees에
  // 리소스가 들어있지 않다. summary/description에 후보자 이름 포함 여부로 cross-match.
  const [roomBookings, setRoomBookings] = useState<{
    id: string;
    resourceId: string;
    shortName: string;
    startMs: number;
    endMs: number;
    summary: string;
    description: string;
    htmlLink?: string;
    creatorEmail?: string;
  }[]>([]);
  // 회의실 메타(리소스 캘린더 목록) — 면접 등록/수정 시 location→리소스 이메일 매핑에 사용.
  // 매핑 성공하면 회의실 attendee 자동 추가로 즉시 예약 선점.
  const [roomsMeta, setRoomsMeta] = useState<RoomMeta[]>([]);
  // 로그인된 매니저 이메일 — 매니저 본인 owner인 잔존(러프) booking 자동 단축에 사용.
  const [myEmail, setMyEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.google.status();
        if (!cancelled && r.ok && r.data?.profile?.email) setMyEmail(r.data.profile.email);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // dismissed list 로드 (cfg에 persist) — 사용자가 캘린더에 등록 안 하기로 한 시트 행
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.cfg.get<string[]>('dismissedInterviewKeys');
        if (!cancelled && r.ok && Array.isArray(r.data)) {
          setDismissed(new Set(r.data));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setDismissedLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistDismissed = async (next: Set<string>) => {
    setDismissed(next);
    try {
      await api.cfg.set('dismissedInterviewKeys', Array.from(next));
    } catch {
      /* ignore */
    }
  };

  // 매초 "마지막 동기화 X초 전" 표시 갱신
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 첨부 있는 메일 폴링 — 후보자별 이력서 공유 여부 판정용 (read-only).
  // - 본인(hdlee@) 발송함 + 임세현(shim@) 발송 메일(hdlee가 cc/to/inbox로 보이는 케이스)을 모두 fetch.
  //   임세현이 발송하고 hdlee를 cc로 추가하는 케이스가 흔해서 in:sent만으로는 누락(예: 이정아 메일).
  // 마운트 시 1회 + 5분마다 자동 갱신. 즉시 동기화 버튼에서도 함께 재조회됨.
  const refreshResumeShareIndex = async () => {
    try {
      // 2개 쿼리 병합 fetch:
      //   1) hdlee/shim 발송 — 우리 발송함의 면접 안내·이력서 전달 메일
      //   2) hdlee/shim 수신 + 채용 키워드 — 외부에서 직접 받은 이력서/Fwd 메일 (예: 한준희 입사지원서)
      // 두 쿼리 결과를 id로 dedup. 200건씩 = 최대 400건, 90일치.
      const sentQuery = '(from:hdlee@cnccosmetic.com OR from:shim@cnccosmetic.com) has:attachment newer_than:90d';
      const inboundQuery = '(to:hdlee@cnccosmetic.com OR to:shim@cnccosmetic.com) has:attachment newer_than:90d (이력서 OR 입사지원서 OR 지원자 OR 면접 OR 채용 OR 서류전형)';
      const [sentR, inboundR] = await Promise.all([
        api.google.listGmail(sentQuery, 200),
        api.google.listGmail(inboundQuery, 200),
      ]);
      const merged = new Map<string, ResumeShareMail>();
      const ingest = (r: typeof sentR) => {
        if (!r.ok || !r.data) return;
        for (const m of r.data) {
          if (merged.has(m.id)) continue;
          merged.set(m.id, {
            id: m.id,
            threadId: m.threadId,
            subject: m.subject,
            snippet: m.snippet,
            date: m.date,
            to: m.to,
            attachments: m.attachments || [],
            attachmentInfos: m.attachmentInfos || [],
          });
        }
      };
      ingest(sentR);
      ingest(inboundR);
      setResumeMails(Array.from(merged.values()));
    } catch {
      /* ignore — 일시적 네트워크 오류 */
    }
  };
  useEffect(() => {
    void refreshResumeShareIndex();
    const t = setInterval(() => void refreshResumeShareIndex(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // 회의실 메타(목록) 로드 — 마운트 시 1회만. 회의실 캘린더 목록은 거의 안 변하므로 폴링할 필요 없음.
  // 매번 listCalendarsFull을 호출하던 게 booking refresh 지연의 큰 부분이었다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.google.listCalendarsFull();
        if (cancelled || !r.ok || !r.data) return;
        const rooms = r.data
          .map((e) => classifyResourceCalendar(e as GCalListEntry))
          .filter((m): m is NonNullable<ReturnType<typeof classifyResourceCalendar>> => m !== null);
        setRoomsMeta(rooms);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 회의실 booking 폴링 — 면접 카드의 "회의실 예약" ✅ 판정 + 옆 텍스트(회의실명)에 사용.
  // 범위: today - 3일 ~ today + 30일 (앱이 보여주는 면접 범위 거의 다 커버, fetch 비용 절반).
  // 30초 폴링 + focus/visibility 즉시 갱신 + 등록/수정 직후 fire-and-forget으로 호출.
  const refreshRoomBookings = async () => {
    if (roomsMeta.length === 0) return;
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 3 * 86_400_000);
      const end = new Date(now.getTime() + 30 * 86_400_000);
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      const results = await Promise.all(
        roomsMeta.map(async (r) => {
          try {
            const er = await api.google.listCalendar(startIso, endIso, r.id);
            if (!er.ok || !er.data) return [];
            return er.data.map((e) => ({
              id: e.id,
              resourceId: r.id,
              shortName: r.shortName,
              startMs: Date.parse(e.start),
              endMs: Date.parse(e.end),
              summary: e.summary || '',
              description: e.description || '',
              htmlLink: e.htmlLink,
              creatorEmail: e.creator?.email || undefined,
            }));
          } catch {
            return [];
          }
        })
      );
      setRoomBookings(results.flat());
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    if (roomsMeta.length === 0) return;
    void refreshRoomBookings();
    const t = setInterval(() => void refreshRoomBookings(), 30 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') void refreshRoomBookings(); };
    const onFocus = () => { void refreshRoomBookings(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsMeta]);

  // 매니저 owner의 러프(예비) booking 자동 단축 —
  //   매니저가 회의실을 미리 길게(예: 10-13) 잡아두고 실제 면접 시간(예: 10-11)에 맞춰
  //   booking 시간을 단축해주기. 룰:
  //   1) booking.creator == myEmail (본인 권한으로만 수정)
  //   2) booking summary에 후보자 이름 포함
  //   3) 같은 회의실에 잡힌 면접 캘린더 면접(같은 후보자)이 booking 안에 들어가있고
  //   4) booking 시간이 면접 시간보다 길면 → 면접 시간으로 단축 (start/end).
  //   안전장치: 같은 booking 시간 안에 같은 후보자 면접이 정확히 1건일 때만 처리.
  //   여러 후보자가 같은 booking 안에 들어가있으면 단축 위험 → skip.
  useEffect(() => {
    if (!myEmail || roomBookings.length === 0 || roomsMeta.length === 0) return;
    const calendarInterviews = liveCalendarEventsNormalized()
      .filter((e) => isInterviewKind(e.title, e.raw.colorId, e.raw.calendarId));
    if (calendarInterviews.length === 0) return;
    void (async () => {
      const adjusted = new Set<string>();
      for (const b of roomBookings) {
        if (!b.creatorEmail || b.creatorEmail.toLowerCase() !== myEmail.toLowerCase()) continue;
        // 후보자 이름 추출 — booking summary에 "면접 - {이름}" 또는 "면접 {이름}"
        const nameMatch = b.summary.match(/면접\s*[-—–]?\s*([가-힣]{2,4})(?:\s*\([^)]*\))?/);
        if (!nameMatch) continue;
        const candidateName = nameMatch[1];
        // 같은 회의실 + 같은 후보자 + booking 시간 안에 들어가는 면접 이벤트 찾기
        const matched = calendarInterviews.filter((iv) => {
          if (!iv.title.includes(candidateName)) return false;
          const ivStart = iv.raw.start ? Date.parse(iv.raw.start) : NaN;
          const ivEnd = iv.raw.end ? Date.parse(iv.raw.end) : NaN;
          if (!Number.isFinite(ivStart) || !Number.isFinite(ivEnd)) return false;
          // booking에 포함되는 면접만
          if (ivStart < b.startMs || ivEnd > b.endMs) return false;
          // 회의실 attendee가 같은 리소스인지 확인
          const hasSameRoom = (iv.raw.attendees || []).some(
            (a) => a.email === b.resourceId
          );
          return hasSameRoom;
        });
        if (matched.length !== 1) continue; // 안전: 정확히 1건일 때만
        const iv = matched[0];
        const ivStart = Date.parse(iv.raw.start);
        const ivEnd = Date.parse(iv.raw.end);
        // booking이 면접 시간과 이미 일치하면 skip
        if (b.startMs === ivStart && b.endMs === ivEnd) continue;
        // 단축 (booking 자체 update) — calendarId는 매니저 primary (이벤트 owner)
        const key = `${b.resourceId}-${b.startMs}`;
        if (adjusted.has(key)) continue;
        adjusted.add(key);
        try {
          // booking 이벤트 ID는 회의실 캘린더에서 가져온 ID — 매니저 primary 캘린더에도 같은 이벤트가 있음 (creator 본인).
          // 그러나 우리 roomBookings에는 회의실 캘린더 관점의 이벤트가 들어있어서, primary 쪽 같은 이벤트를 직접 찾아야.
          // 회의실 캘린더 이벤트의 eventId는 회의실 관점이라 매니저 primary 캘린더에서는 다를 수 있음.
          // → primary에서 같은 시간/회의실/후보자로 list_events 매칭이 더 안전하나 비용 큼.
          // 대신 booking htmlLink로 eventId 추출 시도.
          // 회의실 캘린더의 booking 자체에 매니저가 attendee면 primary에 사본 sync됨 (id 다름).
          // primary 사본이 매니저 owner. 직접 update 위해 calendarEvents에서 매칭.
          const primaryCopy = liveCalendarEventsNormalized().find((e) => {
            if (e.raw.calendarId !== 'primary') return false;
            if (e.raw.creator?.email !== myEmail) return false;
            if (Date.parse(e.raw.start) !== b.startMs || Date.parse(e.raw.end) !== b.endMs) return false;
            if (!(e.raw.attendees || []).some((a) => a.email === b.resourceId)) return false;
            return e.title.includes(candidateName);
          });
          if (!primaryCopy) continue;
          await api.google.updateCalEvent(
            'primary',
            primaryCopy.id,
            {
              start: { dateTime: new Date(ivStart).toISOString(), timeZone: 'Asia/Seoul' },
              end: { dateTime: new Date(ivEnd).toISOString(), timeZone: 'Asia/Seoul' },
            },
            'none',
          );
          // eslint-disable-next-line no-console
          console.info(`[auto-shrink] ${candidateName} 러프 booking 단축: ${new Date(b.startMs).toISOString()}~${new Date(b.endMs).toISOString()} → ${new Date(ivStart).toISOString()}~${new Date(ivEnd).toISOString()}`);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[auto-shrink] 단축 실패 (${candidateName}):`, e);
        }
      }
      if (adjusted.size > 0) {
        void refreshRoomBookings();
        void refreshCalendarFromGoogle();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmail, roomBookings, live.calendarEvents]);

  // 회의실 declined 자동 복구 — 사용자가 회의실을 placeholder로 선예약하고 따로 면접 이벤트를
  // 만들면, 면접의 회의실 attendee가 자동 declined 됨 (placeholder가 슬롯 점유 중).
  // 감지 즉시:
  //   1) 같은 시간/같은 회의실의 본인 placeholder (후보자 이름 없는 booking) 삭제
  //   2) 면접 이벤트의 resource attendee를 remove → re-add 하여 Google 재평가 유도
  // 결과: 회의실은 본 면접 이벤트로 정상 예약, 사용자가 placeholder 손볼 필요 없음.
  // 안전장치:
  //   - 본인 owner placeholder만 (creatorEmail === myEmail)
  //   - placeholder 후보 1개일 때만 처리 (여러 개면 모호 → skip + 콘솔 경고)
  //   - 본 면접 이벤트와 같은 id는 placeholder 아님 (resource sync 본)
  //   - 시도한 이벤트는 healAttempted에 기록하여 같은 세션 중복 시도 방지
  const healAttempted = useRef(new Set<string>());
  useEffect(() => {
    if (!myEmail || roomBookings.length === 0 || roomsMeta.length === 0) return;
    const interviews = liveCalendarEventsNormalized()
      .filter((e) => isInterviewKind(e.title, e.raw.colorId, e.raw.calendarId))
      .filter((e) => e.raw.calendarId === SHARED_CAL.interview);
    if (interviews.length === 0) return;
    void (async () => {
      let healed = 0;
      for (const iv of interviews) {
        if (healAttempted.current.has(iv.id)) continue;
        const declinedResource = (iv.raw.attendees || []).find(
          (a) => typeof a.email === 'string'
            && a.email.includes('resource.calendar.google.com')
            && a.responseStatus === 'declined'
        );
        if (!declinedResource || !declinedResource.email) continue;
        const ivStart = iv.raw.start ? Date.parse(iv.raw.start) : NaN;
        const ivEnd = iv.raw.end ? Date.parse(iv.raw.end) : NaN;
        if (!Number.isFinite(ivStart) || !Number.isFinite(ivEnd)) continue;
        const parsed = parseInterviewTitle(iv.title);
        const candidateName = (parsed.candidate || '').trim();
        if (!candidateName) continue;
        // 같은 시간/회의실의 본인 placeholder 찾기 — 후보자 이름 없는 booking
        const placeholders = roomBookings.filter((b) => {
          if (b.id === iv.id) return false;
          if (b.resourceId !== declinedResource.email) return false;
          if (b.startMs >= ivEnd || b.endMs <= ivStart) return false;
          if (!b.creatorEmail || b.creatorEmail.toLowerCase() !== myEmail.toLowerCase()) return false;
          if (b.summary.includes(candidateName)) return false;
          const otherNameMatch = b.summary.match(/면접\s*[-—–]?\s*([가-힣]{2,4})/);
          if (otherNameMatch && otherNameMatch[1] !== candidateName) return false;
          return true;
        });
        if (placeholders.length === 0) continue;
        if (placeholders.length > 1) {
          // eslint-disable-next-line no-console
          console.warn(`[auto-heal] ${candidateName}: placeholder ${placeholders.length}개 발견 — 모호하여 자동 정리 skip. 수동 정리 필요.`);
          healAttempted.current.add(iv.id);
          continue;
        }
        const placeholder = placeholders[0];
        healAttempted.current.add(iv.id);
        try {
          // 1) placeholder 삭제 (회의실 리소스 캘린더 기준 id로 호출)
          await api.google.deleteCalEvent(placeholder.resourceId, placeholder.id, 'none');
          // 2) interview 이벤트에서 resource attendee 제거 (Google 캐시 무효화)
          const otherAttendees = (iv.raw.attendees || [])
            .filter((a) => a.email !== declinedResource.email && typeof a.email === 'string')
            .map((a) => ({ email: a.email as string }));
          const calId = iv.raw.calendarId || SHARED_CAL.interview;
          await api.google.updateCalEvent(calId, iv.id, { attendees: otherAttendees }, 'none');
          // 3) resource attendee 재추가 (Google이 placeholder 없으니 accept함)
          await api.google.updateCalEvent(
            calId,
            iv.id,
            { attendees: [...otherAttendees, { email: declinedResource.email, resource: true }] },
            'none',
          );
          healed += 1;
          // eslint-disable-next-line no-console
          console.info(`[auto-heal] ${candidateName} declined → placeholder 정리 + 회의실 재초대 완료`);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[auto-heal] ${candidateName} 복구 실패:`, e);
        }
      }
      if (healed > 0) {
        void refreshRoomBookings();
        void refreshCalendarFromGoogle();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmail, roomBookings, live.calendarEvents]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    // 캘린더 + 모든 시트 + 보낸함 이력서 인덱스 + 회의실 booking 강제 fetch.
    await Promise.all([
      refreshCalendarFromGoogle(),
      refreshNow(true),
      refreshResumeShareIndex(),
      refreshRoomBookings(),
    ]);
    setRefreshing(false);
  };

  const handleEditEvent = (event: InterviewEvent) => {
    if (event.source !== 'calendar' || !event.calendarId) {
      alert('캘린더에 등록된 이벤트만 수정 가능합니다.\n시트 출처 행은 시트에서 직접 수정하세요.');
      return;
    }
    setEditingEvent(event);
  };

  const handleDeleteEvent = async (event: InterviewEvent) => {
    // 매칭되는 회의실 booking 찾기 — 같은 후보자 + 시간 겹침
    // 별개 캘린더 이벤트(cncadmin/임세현이 만든 booking)와 attendee로 sync된 사본 둘 다 가능.
    // 자기 자신(면접 이벤트 자체가 회의실 캘린더에 sync된 것)은 id 같으면 skip.
    const candidateName = (event.candidate || '').trim();
    const ivS = event.startISO ? Date.parse(event.startISO) : NaN;
    const ivE = event.endISO ? Date.parse(event.endISO) : NaN;
    const matchedBookings = (Number.isFinite(ivS) && Number.isFinite(ivE) && candidateName.length >= 2)
      ? roomBookings.filter((b) => {
          if (b.id === event.id) return false;
          if (b.endMs <= ivS || b.startMs >= ivE) return false;
          return b.summary.includes(candidateName) || b.description.includes(candidateName);
        })
      : [];

    const bookingPart = matchedBookings.length > 0
      ? `\n\n📅 회의실 예약 ${matchedBookings.length}건도 함께 삭제 시도:\n` +
        matchedBookings.map((b) => `  · ${b.shortName} — ${b.creatorEmail || '?'} 만듦`).join('\n')
      : '';
    if (!confirm(
      `'${candidateName || event.title}' 면접을 삭제하시겠습니까?\n\n` +
      `캘린더 이벤트 + 시트 dismiss${bookingPart}\n\n(시트는 변경되지 않음)`
    )) return;

    const key = dismissKey(event.dt, event.tm, event.candidate || event.title);

    // 1) 회의실 booking 삭제 시도.
    //    핵심: 본인이 만든 booking은 primary가 master고 리소스 캘은 그림자.
    //    리소스 캘에서만 지우면 primary master 살아있어서 회의실 점유 계속됨 (5/21 문나은/신지호 사고).
    //    → 본인 owner면 primary 우선 삭제, 그 후 리소스 캘도 정리.
    //    → 다른 사람 owner면 primary 권한 없으니 리소스 캘에서만 시도 (회의실 attendee decline 효과).
    const bookingFails: { booking: typeof matchedBookings[number]; error: string }[] = [];
    for (const b of matchedBookings) {
      const isSelfOwner = !!(b.creatorEmail && myEmail && b.creatorEmail.toLowerCase() === myEmail.toLowerCase());
      let primaryOk = false;
      let resourceOk = false;
      let lastErr = '';
      if (isSelfOwner) {
        try {
          const r = await api.google.deleteCalEvent('primary', b.id, 'all');
          primaryOk = r.ok;
          if (!r.ok) lastErr = (r as { error?: string }).error || 'primary delete failed';
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      try {
        const r = await api.google.deleteCalEvent(b.resourceId, b.id, 'all');
        resourceOk = r.ok;
        if (!r.ok && !primaryOk) lastErr = (r as { error?: string }).error || lastErr || 'resource delete failed';
      } catch (e) {
        if (!primaryOk) lastErr = e instanceof Error ? e.message : String(e);
      }
      if (!primaryOk && !resourceOk) {
        bookingFails.push({ booking: b, error: lastErr || 'unknown' });
      }
    }

    // 2) 면접 이벤트 삭제 (시트 출처는 캘린더 이벤트 없을 수 있으니 dismiss만)
    if (event.source === 'calendar' && event.calendarId) {
      try {
        await api.google.deleteCalEvent(event.calendarId, event.id, 'all');
      } catch {
        // ignore — 이미 삭제됐을 수도
      }
    }

    // 3) dismiss list에 추가 — 시트에 행이 남아있어도 다시 자동 등록 안 됨
    const next = new Set(dismissed);
    next.add(key);
    await persistDismissed(next);

    // 4) booking 삭제 실패 있으면 사용자에게 안내 — 다른 사람 만든 booking은 그쪽에 요청 필요
    if (bookingFails.length > 0) {
      const lines = bookingFails.map((f) =>
        `  · ${f.booking.shortName} (${f.booking.creatorEmail || '?'}): ${f.error}`
      ).join('\n');
      const owners = Array.from(new Set(bookingFails.map((f) => f.booking.creatorEmail).filter(Boolean))).join(', ');
      alert(
        `면접은 삭제됐지만 회의실 예약 ${bookingFails.length}건은 삭제 실패:\n${lines}\n\n` +
        (owners
          ? `다른 사람이 만든 booking은 본인 권한으로 삭제 불가합니다.\n${owners}에게 직접 삭제 요청하세요.`
          : '권한/네트워크 문제일 수 있습니다.')
      );
    }

    // 즉시 캘린더 + 회의실 booking 다시 fetch (UI 반영)
    void refreshCalendarFromGoogle();
    void refreshRoomBookings();
  };

  // 불참 처리 — 면접 이벤트 제목에 "(불참)" 라벨 추가 + 회의실 attendee 자동 제거.
  // 이력 보존이 목적이라 이벤트 자체는 삭제 안 함 (줄긋기로만 표시).
  const handleMarkNoShow = async (event: InterviewEvent) => {
    if (event.source !== 'calendar' || !event.calendarId) {
      alert('캘린더 출처 이벤트만 불참 처리 가능합니다.');
      return;
    }
    if (!confirm(`'${event.candidate || event.title}' 면접을 불참 처리하시겠습니까?\n\n• 제목 앞에 "(불참)" 라벨 추가\n• 회의실 예약 자동 해제\n• 카드에 줄긋기로 표시 (이력 보존)`)) return;
    // 회의실 리소스 attendee만 빼고 사람 attendee는 유지
    const keepAttendees = (event.attendees || [])
      .filter((email) => typeof email === 'string' && !email.includes('resource.calendar.google.com'))
      .map((email) => ({ email }));
    const newSummary = /^\(불참\)/.test(event.title) ? event.title : `(불참) ${event.title}`;
    try {
      const r = await api.google.updateCalEvent(event.calendarId, event.id, {
        summary: newSummary,
        attendees: keepAttendees,
      }, 'all');
      if (!r.ok) {
        alert(`불참 처리 실패: ${(r as { error?: string }).error || '알 수 없는 오류'}`);
        return;
      }
    } catch (e) {
      alert(`불참 처리 오류: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    void refreshCalendarFromGoogle();
    void refreshRoomBookings();
  };

  // 같은 (날짜+시간+이름) 면접이 여러 캘린더/색으로 N중 등록된 것을 정리.
  // 보라색(SHARED_CAL.interview + colorId='3') 1건 우선 보존, 나머지 모두 삭제.
  // silent=true → 자동 진행 (alert/confirm 없음, console만), false → dry-run+confirm 모달.
  const cleanupDuplicates = async (silent: boolean): Promise<void> => {
    if (cleaningUp) return;
    setCleaningUp(true);
    try {
      const interviews = liveCalendarEventsNormalized().filter((e) =>
        isInterviewKind(e.title, e.raw.colorId, e.raw.calendarId)
      );
      // 매우 엄격한 매칭: dt + tm(HH:MM 정확) + 이름 12자
      // 이름 못 뽑은 이벤트, 종일 이벤트는 제외 (false positive 방지)
      const groups = new Map<string, typeof interviews>();
      for (const e of interviews) {
        const p = parseInterviewTitle(e.title);
        const name = (p.candidate || '').trim().slice(0, 12);
        if (!name) continue;
        if (!e.tm || e.tm === '종일') continue;
        const key = `${e.dt}|${e.tm}|${name}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(e);
      }
      type Plan = { keep: typeof interviews[number]; toDelete: typeof interviews };
      const plans: Plan[] = [];
      for (const items of groups.values()) {
        if (items.length < 2) continue;
        const purple = items.find(
          (e) => e.raw.calendarId === SHARED_CAL.interview && e.raw.colorId === '3'
        );
        const mainAny = items.find((e) => e.raw.calendarId === SHARED_CAL.interview);
        const keep = purple || mainAny || items[0];
        const toDelete = items.filter((e) => e.id !== keep.id);
        plans.push({ keep, toDelete });
      }
      if (plans.length === 0) {
        if (!silent) alert('정리할 중복 면접이 없습니다.\n모든 면접이 1건씩만 등록되어 있어요.');
        return;
      }
      // dry-run preview는 manual 모드에서만
      if (!silent) {
        const totalDelete = plans.reduce((sum, p) => sum + p.toDelete.length, 0);
        const previewLines = plans.slice(0, 8).map((p) => {
          const k = p.keep;
          const titleShort = k.title.length > 28 ? k.title.slice(0, 28) + '…' : k.title;
          const keepLabel = `${shortCalName(k.raw.calendarId)}/${colorName(k.raw.colorId)}`;
          const delLabels = p.toDelete
            .map((d) => `${shortCalName(d.raw.calendarId)}/${colorName(d.raw.colorId)}`)
            .join(', ');
          return `• ${k.dt} ${k.tm} ${titleShort}\n   ✓ 유지: ${keepLabel}\n   ✕ 삭제: ${delLabels}`;
        }).join('\n\n');
        const more = plans.length > 8 ? `\n\n… 외 ${plans.length - 8}쌍 더` : '';
        const msg =
          `🧹 중복 면접 정리\n\n` +
          `중복 그룹: ${plans.length}쌍 / 삭제 예정: ${totalDelete}건\n\n` +
          previewLines + more +
          '\n\n원칙: 같은 (날짜+시간+이름) 면접은 보라색(메인 면접 캘린더 + colorId=3) 1건만 남기고 나머지 색깔(초록/주황/노랑 등)은 모두 삭제합니다.\n\n진행할까요?';
        if (!confirm(msg)) return;
      }
      let deleted = 0, failed = 0;
      const failDetails: string[] = [];
      for (const { keep, toDelete } of plans) {
        for (const e of toDelete) {
          if (!e.raw.calendarId) {
            failed++;
            failDetails.push(`${e.dt} ${e.tm} ${e.title.slice(0, 20)} — calendarId 누락`);
            continue;
          }
          try {
            const r = await api.google.deleteCalEvent(e.raw.calendarId, e.id, 'none');
            if (r.ok) {
              deleted++;
              if (silent) {
                // eslint-disable-next-line no-console
                console.info(
                  `[auto-cleanup] 삭제: ${e.dt} ${e.tm} "${e.title.slice(0, 30)}" ` +
                  `${shortCalName(e.raw.calendarId)}/${colorName(e.raw.colorId)} ` +
                  `(보존: ${shortCalName(keep.raw.calendarId)}/${colorName(keep.raw.colorId)})`
                );
              }
            } else {
              failed++;
              failDetails.push(`${e.dt} ${e.tm} ${e.title.slice(0, 20)} — ${r.error || 'unknown'}`);
            }
          } catch (err: unknown) {
            failed++;
            const m = err instanceof Error ? err.message : String(err);
            failDetails.push(`${e.dt} ${e.tm} ${e.title.slice(0, 20)} — ${m}`);
          }
        }
      }
      if (silent) {
        if (deleted > 0) {
          // eslint-disable-next-line no-console
          console.info(`[auto-cleanup] 총 ${deleted}건 삭제, ${failed}건 실패`);
        }
      } else {
        let result = `정리 완료\n\n✓ 삭제 성공: ${deleted}건\n✕ 실패: ${failed}건`;
        if (failed > 0) {
          result += '\n\n실패 상세:\n' + failDetails.slice(0, 6).join('\n');
          if (failDetails.length > 6) result += `\n… 외 ${failDetails.length - 6}건`;
          result += '\n\n실패는 보통 권한 부족(다른 사람 캘린더) 또는 이미 삭제된 경우입니다.';
        }
        alert(result);
      }
      if (deleted > 0) await refreshCalendarFromGoogle();
    } finally {
      setCleaningUp(false);
    }
  };

  // 버튼용 wrapper — manual 모드 (dry-run + confirm)
  const handleCleanupDuplicates = () => { void cleanupDuplicates(false); };


  const fetchedAt = live.calendarFetchedAt ? new Date(live.calendarFetchedAt) : null;
  const fetchedAgoSec = fetchedAt ? Math.round((Date.now() - fetchedAt.getTime()) / 1000) : null;
  const fetchedAgoLabel =
    fetchedAgoSec == null
      ? '동기화 대기'
      : fetchedAgoSec < 5
      ? '방금'
      : fetchedAgoSec < 60
      ? `${fetchedAgoSec}초 전`
      : `${Math.floor(fetchedAgoSec / 60)}분 전`;

  const allEvents = useMemo<InterviewEvent[]>(() => {
    const fromSheet: InterviewEvent[] = D.calIntv
      .filter((e) => isInterviewKind(e.title, null))
      .map((e, i) => {
        const p = parseInterviewTitle(e.title);
        return {
          id: `sheet-${i}-${e.dt}-${e.tm}`,
          dt: e.dt,
          tm: e.tm,
          endTm: '',
          title: e.title,
          candidate: p.candidate,
          site: p.site,
          team: p.team,
          room: p.room,
          source: 'sheet' as const,
          location: '',
          attendees: [],
          done: !!e.done,
        };
      });
    // "면접 및 처우 현황" 시트 — 비고 컬럼에 datetime이 있으면 면접 일정으로 등록
    const interviewSheetRows = liveByKindOrScan('office_interview');
    const fromInterviewSheet: InterviewEvent[] = interviewSheetRows
      .map((row, i): InterviewEvent | null => {
        const note = row['비고'] || row['note'] || '';
        const parsed = parseInterviewSheetNote(note);
        if (!parsed) return null;
        const candidate = (row['성명'] || row['이름'] || '').trim();
        const team = (row['지원부서'] || row['부서'] || '').trim();
        const job = (row['지원구분'] || row['직무'] || '').trim();
        if (!candidate) return null;
        return {
          id: `intv-sheet-${i}-${parsed.dt}-${parsed.tm}-${candidate}`,
          dt: parsed.dt,
          tm: parsed.tm,
          endTm: '',
          title: `${parsed.tm} / ${candidate} / ${team}${job ? ' (' + job + ')' : ''}`,
          candidate,
          site: '',
          team,
          room: '',
          source: 'sheet_intv',
          location: '',
          attendees: [],
          done: false,
        };
      })
      .filter((e): e is InterviewEvent => e !== null);
    // 진단용: 시트 데이터 통계를 window에 노출 (devtools에서 확인 가능)
    if (typeof window !== 'undefined') {
      (window as any).__intvDebug = {
        sheetRowsTotal: interviewSheetRows.length,
        sheetRowsWithDt: fromInterviewSheet.length,
        sheetRowsSample: interviewSheetRows.slice(0, 3),
        snapshotKeys: Object.keys(live.snapshots || {}),
      };
    }
    const fromCalendar: InterviewEvent[] = liveCalendarEventsNormalized()
      .filter((e) => isInterviewKind(e.title, e.raw.colorId, e.raw.calendarId))
      // primary 캘린더에 자동 sync된 회의실 예약 사본만 면접 카드에서 제외.
      // 면접 캘린더(c_d2a3...)에 사용자가 의도적으로 회의실을 attendee로 추가한 경우는
      // 그대로 표시 (회의실 예약 매칭 배지로 시각화).
      .filter((e) => {
        const hasResource = (e.raw.attendees || []).some(
          (a) => typeof a.email === 'string' && a.email.includes('resource.calendar.google.com')
        );
        return !(hasResource && e.raw.calendarId === 'primary');
      })
      .map((e) => {
        const p = parseInterviewTitle(e.title);
        // location 필드가 더 정확하면 site/room 보강
        const locTokens = (e.location || '').split(/\s+/).filter(Boolean);
        const site = p.site || locTokens.find((t) => SITE_KEYWORDS.some((s) => t.includes(s))) || '';
        const room = p.room || locTokens.find((t) => ROOM_KEYWORDS.test(t)) || '';
        return {
          id: e.id,
          dt: e.dt,
          tm: e.tm,
          endTm: '',
          title: e.title,
          candidate: p.candidate,
          site,
          team: p.team,
          room,
          source: 'calendar' as const,
          htmlLink: e.htmlLink,
          location: e.location,
          attendees: e.attendees,
          done: false,
          calendarId: e.raw.calendarId || null,
          startISO: e.raw.start,
          endISO: e.raw.end,
          description: e.raw.description || '',
        };
      });
    // 우선순위: calendar > sheet_intv > sheet (캘린더가 가장 권위 있음).
    // 같은 dt+tm+이름 중복 시 우선순위 높은 쪽 유지.
    const merged = [...fromCalendar, ...fromInterviewSheet, ...fromSheet];
    const seen = new Set<string>();
    const dedup: InterviewEvent[] = [];
    for (const e of merged) {
      const key = dismissKey(e.dt, e.tm, e.candidate || e.title);
      if (seen.has(key)) continue;
      // dismissed 면 화면·자동등록 모두 제외
      if (dismissed.has(key)) continue;
      seen.add(key);
      dedup.push(e);
    }
    return dedup;
  }, [D.calIntv, live.calendarEvents, live.snapshots, live.mappings, dismissed]);

  // 미아 이벤트 감지 — 메인 면접 캘린더(c_d2a3...)에 보라색('3')으로 살아있지만
  // isInterviewKind() 분류기를 통과 못해 카드에 안 보이는 이벤트.
  // 등록 경로 비대칭(회의실 예약 페이지 등)으로 발생. 사용자 항의 전에 시스템이 먼저 발견.
  const orphanInterviews = useMemo(() => {
    const SUSPICIOUS = /^test|test$|asdf|테스트|^임시|^test\b|^tmp|sample/i;
    const todayMs = Date.parse(`${today}T00:00:00+09:00`);
    return liveCalendarEventsNormalized().filter((e) => {
      if (e.raw.calendarId !== SHARED_CAL.interview) return false;
      if (e.raw.colorId !== '3') return false;
      // 분류기 통과 = 정상 카드 → 미아 아님
      if (isInterviewKind(e.title, e.raw.colorId, e.raw.calendarId)) return false;
      // 의심 summary: 4자 미만이거나 테스트/임시 키워드
      const t = (e.title || '').trim();
      const isSuspicious = t.length < 4 || SUSPICIOUS.test(t);
      if (!isSuspicious) return false;
      // 과거(오늘 이전)는 정리 대상에서 제외 — 이력 보존 + 오탐 위험
      const startMs = e.raw.start ? Date.parse(e.raw.start) : NaN;
      if (Number.isFinite(startMs) && startMs < todayMs) return false;
      return true;
    });
  }, [live.calendarEvents, today]);

  // 제목 비공개 면접 — 면접 전용 캘린더에 슬롯은 잡혀 있는데 제목이 빈 채로 내려오는 이벤트.
  // 원인: 그 이벤트의 visibility가 private이고 hdlee는 reader라 제목/참석자를 볼 권한이 없음.
  //       (primary 초대 사본조차 없으면 앱은 이름을 알 방법이 전혀 없다.)
  // 빈 제목으로 카드를 만들면 이름·소속 공란 카드가 되므로 카드에는 못 올리지만,
  // "그 시간에 면접이 있다"는 사실 자체는 반드시 보여야 한다 → 별도 안내 줄로 노출.
  const hiddenTitleInterviews = useMemo(() => {
    const todayMs = Date.parse(`${today}T00:00:00+09:00`);
    return liveCalendarEventsNormalized()
      .filter((e) => isInterviewCalendar(e.raw.calendarId))
      // interviewMgr는 hdlee가 구독조차 안 된 free/busy 전용 캘린더 —
      // 제목·참석자·주최자가 전부 null인 불투명 blocker라 "면접"이라 단정할 근거가 없다.
      // (실제로 1on1·팀미팅 시간대와도 겹침) → 안내줄에서는 제외해 노이즈를 만들지 않는다.
      // 이 캘린더의 진짜 면접은 primary 초대 사본으로 제목이 들어와 정상 카드로 뜬다.
      .filter((e) => e.raw.calendarId !== SHARED_CAL.interviewMgr)
      .filter((e) => !(e.title || '').trim())
      .filter((e) => {
        if (showPast) return true;
        const startMs = e.raw.start ? Date.parse(e.raw.start) : NaN;
        return !Number.isFinite(startMs) || startMs >= todayMs;
      })
      .sort((a, b) => `${a.dt} ${a.tm}`.localeCompare(`${b.dt} ${b.tm}`));
  }, [live.calendarEvents, today, showPast]);

  // 미아 이벤트 일괄 정리 — dry-run preview confirm 후 각각 삭제
  const handleCleanupOrphans = async () => {
    if (orphanInterviews.length === 0) return;
    const lines = orphanInterviews.slice(0, 10).map((e) =>
      `  · ${e.dt} ${e.tm} "${e.title.slice(0, 30)}" (${e.location || '장소 없음'})`
    ).join('\n');
    const more = orphanInterviews.length > 10 ? `\n  … 외 ${orphanInterviews.length - 10}건 더` : '';
    const ok = window.confirm(
      `⚠ 미아 면접 이벤트 정리\n\n` +
      `메인 면접 캘린더에 보라색으로 살아있지만 카드에 안 보이는 이벤트 ${orphanInterviews.length}건:\n\n` +
      lines + more +
      `\n\n특징: summary가 짧거나 "test"/"테스트" 같은 임시 키워드. 회의실 예약 페이지 등에서 잘못 들어왔을 가능성 높음.\n\n` +
      `모두 삭제하시겠습니까?`
    );
    if (!ok) return;
    let deleted = 0;
    let failed = 0;
    const failDetails: string[] = [];
    for (const e of orphanInterviews) {
      try {
        const r = await api.google.deleteCalEvent(SHARED_CAL.interview, e.id, 'all');
        if (r.ok) {
          deleted++;
          // dismiss key에도 추가 (시트 출처면 재등록 방지)
          const p = parseInterviewTitle(e.title);
          const key = dismissKey(e.dt, e.tm, p.candidate || e.title);
          dismissed.add(key);
        } else {
          failed++;
          failDetails.push(`${e.dt} ${e.tm} "${e.title.slice(0, 20)}": ${(r as { error?: string }).error || 'unknown'}`);
        }
      } catch (err) {
        failed++;
        failDetails.push(`${e.dt} ${e.tm} "${e.title.slice(0, 20)}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (dismissed.size > 0) await persistDismissed(new Set(dismissed));
    let msg = `✓ 미아 면접 정리 완료\n\n삭제 성공: ${deleted}건 / 실패: ${failed}건`;
    if (failed > 0) msg += `\n\n실패 상세:\n${failDetails.slice(0, 6).join('\n')}`;
    alert(msg);
    void refreshCalendarFromGoogle();
    void refreshRoomBookings();
  };

  // 시트→캘린더 자동 등록: 시트에 datetime 있는데 캘린더에 없는 후보자 자동 create_event
  // GPD 부서·dismissed 키는 skip. 진행중인 키는 autoRegistering set으로 race condition 방지.
  useEffect(() => {
    if (!dismissedLoaded) return; // dismissed cfg 로드 전에 등록 시작 금지 (재등록 방지)
    const interviewSheetRows = liveByKindOrScan('office_interview');
    if (interviewSheetRows.length === 0) return;
    // 캘린더에 이미 있는 키 set
    const calendarKeys = new Set<string>();
    for (const e of liveCalendarEventsNormalized()) {
      if (!isInterviewKind(e.title, e.raw.colorId, e.raw.calendarId)) continue;
      const p = parseInterviewTitle(e.title);
      const k = dismissKey(e.dt, e.tm, p.candidate || e.title);
      calendarKeys.add(k);
    }
    // 등록 대상 추출
    const toRegister: { row: Record<string, string>; dt: string; tm: string; candidate: string; team: string; job: string }[] = [];
    for (const row of interviewSheetRows) {
      const note = row['비고'] || row['note'] || '';
      const parsed = parseInterviewSheetNote(note);
      if (!parsed) continue;
      const candidate = (row['성명'] || row['이름'] || '').trim();
      const team = (row['지원부서'] || row['부서'] || '').trim();
      const job = (row['지원구분'] || row['직무'] || '').trim();
      if (!candidate) continue;
      // GPD 부서 자동 등록 금지 (메모리 룰)
      if (team === 'GPD') continue;
      const k = dismissKey(parsed.dt, parsed.tm, candidate);
      if (calendarKeys.has(k)) continue; // 이미 캘린더에 있음
      if (dismissed.has(k)) continue; // 사용자가 등록 안 하기로 함
      if (autoRegistering.has(k)) continue; // 다른 등록 작업 진행 중
      toRegister.push({ row, dt: parsed.dt, tm: parsed.tm, candidate, team, job });
    }
    if (toRegister.length === 0) return;
    // race condition 방지 — 등록 시작 전에 set에 추가
    const startedKeys = toRegister.map((t) => dismissKey(t.dt, t.tm, t.candidate));
    setAutoRegistering((prev) => {
      const next = new Set(prev);
      startedKeys.forEach((k) => next.add(k));
      return next;
    });
    (async () => {
      for (const t of toRegister) {
        try {
          const site = guessSiteFromTeam(t.team);
          const teamLabel = t.job ? `${t.team}(${t.job})` : t.team;
          const startISO = `${t.dt}T${t.tm}:00+09:00`;
          // 1시간 default
          const [hh, mm] = t.tm.split(':').map((s) => parseInt(s, 10));
          const endHh = String((hh + 1) % 24).padStart(2, '0');
          const endISO = `${t.dt}T${endHh}:${String(mm).padStart(2, '0')}:00+09:00`;
          const summary = [t.tm, site, t.candidate, teamLabel].filter(Boolean).join(' / ');
          // 시트→캘린더 자동 등록 시점에는 회의실 텍스트가 없으므로 site만으로 매칭 불가 → 회의실 attendee 생략.
          // 사용자가 캘린더에서 직접 편집할 때(EditModal) 회의실 텍스트 채워지면 그때 attendee 자동 추가됨.
          const body: Parameters<typeof api.google.insertCalEvent>[1] = {
            summary,
            description: `후보자: ${t.candidate}\n부서: ${teamLabel}\n※ 시트 office_interview 행에서 자동 등록 (${getTodayStr()})`,
            location: site === '퍼플' ? '퍼플카운티' : site,
            start: { dateTime: startISO, timeZone: 'Asia/Seoul' },
            end: { dateTime: endISO, timeZone: 'Asia/Seoul' },
            attendees: [
              { email: 'shim@cnccosmetic.com' },
            ],
          };
          (body as Record<string, unknown>).colorId = '3';
          (body as Record<string, unknown>).conferenceData = {
            createRequest: { requestId: `meet-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
          };
          await api.google.insertCalEvent(SHARED_CAL.interview, body);
        } catch {
          /* 등록 실패 — 다음 polling에서 재시도 */
        }
      }
      // 등록 완료 후 캘린더 즉시 refresh + 진행중 set 정리
      await refreshCalendarFromGoogle();
      setAutoRegistering((prev) => {
        const next = new Set(prev);
        startedKeys.forEach((k) => next.delete(k));
        return next;
      });
    })();
    // ESLint 경고 비활성: autoRegistering은 순환 의존성 방지 위해 deps에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.snapshots, live.calendarEvents, dismissed, dismissedLoaded]);

  // 이번주 월~일 ISO 범위 계산 (cardFilter 'thisWeek'에서 사용)
  const weekRange = useMemo(() => {
    const t = new Date(today + 'T00:00:00');
    const dow = t.getDay();
    const monday = new Date(t);
    monday.setDate(t.getDate() - ((dow + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { mon: isoDate(monday), sun: isoDate(sunday) };
  }, [today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEvents
      .filter((e) => showPast || e.dt >= today)
      .filter((e) => {
        if (cardFilter === 'today') return e.dt === today;
        if (cardFilter === 'thisWeek') return e.dt >= weekRange.mon && e.dt <= weekRange.sun;
        return true;
      })
      .filter((e) => {
        if (!q) return true;
        const hay = `${e.candidate} ${e.site} ${e.team} ${e.room} ${e.title} ${e.location}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) =>
        (a.dt + (a.tm === '종일' ? '00:00' : a.tm)).localeCompare(b.dt + (b.tm === '종일' ? '00:00' : b.tm))
      );
  }, [allEvents, query, showPast, today, cardFilter, weekRange]);

  const grouped = useMemo(() => {
    const map = new Map<string, InterviewEvent[]>();
    for (const e of filtered) {
      if (!map.has(e.dt)) map.set(e.dt, []);
      map.get(e.dt)!.push(e);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const counts = useMemo(() => {
    const upcoming = allEvents.filter((e) => e.dt >= today);
    const todayCount = upcoming.filter((e) => e.dt === today && !e.done).length;
    const thisWeek = (() => {
      const t = new Date(today + 'T00:00:00');
      const dow = t.getDay(); // 0=Sun
      const monday = new Date(t);
      monday.setDate(t.getDate() - ((dow + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const isoMon = isoDate(monday);
      const isoSun = isoDate(sunday);
      return upcoming.filter((e) => e.dt >= isoMon && e.dt <= isoSun).length;
    })();
    return { todayCount, thisWeek, total: upcoming.length };
  }, [allEvents, today]);

  return (
    <div className="space-y-3">
      {/* 요약 카드 — 클릭하면 해당 범위만 필터링, 다시 누르면 전체 */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard
          label="오늘 면접"
          count={counts.todayCount}
          tone="indigo"
          emphasis
          active={cardFilter === 'today'}
          onClick={() => setCardFilter((v) => (v === 'today' ? 'all' : 'today'))}
        />
        <SummaryCard
          label="이번 주 면접"
          count={counts.thisWeek}
          tone="blue"
          active={cardFilter === 'thisWeek'}
          onClick={() => setCardFilter((v) => (v === 'thisWeek' ? 'all' : 'thisWeek'))}
        />
        <SummaryCard
          label="다가오는 면접"
          count={counts.total}
          tone="slate"
          active={cardFilter === 'all'}
          onClick={() => setCardFilter('all')}
        />
      </div>

      {/* 캘린더 정리 — 중복 이벤트 + 제목 규격 (팀 공용이라 표기가 갈리는 걸 한 곳에서 잡는다) */}
      <InterviewTitleTidy />

      {/* 필터 + 동기화 상태 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* 면접 생성은 회의실 예약 화면으로 일원화 (2026-09-01 사용자 지정).
              여기서 따로 만들면 회의실 예약 없는 면접이 생겨 표기·점유가 갈린다. */}
          <span className="text-[11px] text-slate-500 px-1">
            면접 등록은 <b className="text-slate-700">회의실 예약</b>에서 진행합니다
          </span>
          <Pill active={showPast} onClick={() => setShowPast((v) => !v)}>
            지난 면접 포함
          </Pill>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
            title="구글 캘린더에서 즉시 다시 가져오기"
          >
            <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
            {refreshing ? '동기화 중...' : '즉시 동기화'}
          </button>
          <button
            onClick={handleCleanupDuplicates}
            disabled={cleaningUp}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 disabled:opacity-50 flex items-center gap-1"
            title="같은 날짜·시간·이름 면접이 여러 색깔로 N중 등록된 것을 보라색 1건만 남기고 정리 (dry-run + 컨펌 후 실행)"
          >
            <span>🧹</span>
            {cleaningUp ? '정리 중...' : '중복 정리'}
          </button>
          {orphanInterviews.length > 0 && (
            <button
              onClick={handleCleanupOrphans}
              className="px-3 py-1.5 rounded-full text-xs font-bold border bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200 flex items-center gap-1 animate-pulse"
              title="메인 면접 캘린더에 보라색으로 살아있지만 카드에 안 보이는 미아 이벤트. summary가 짧거나 'test'/'테스트' 같은 임시 키워드. 클릭하면 목록 확인 후 일괄 삭제"
            >
              <span>⚠</span>
              미아 면접 {orphanInterviews.length}건 정리
            </button>
          )}
          <span className="text-[11px] text-slate-500" title={fetchedAt?.toLocaleString() || ''}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse" />
            마지막 동기화 {fetchedAgoLabel} · 60초마다 자동 · 👥 TA팀 공유
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="후보자/직무/장소 검색..."
            className="ml-auto px-3 py-1.5 rounded-full text-sm bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none w-56 text-slate-700"
          />
          <span className="text-xs text-slate-700 font-semibold">{filtered.length}건</span>
        </div>
        {/* 제목 비공개 면접 — 카드로는 못 만들지만 "슬롯이 존재한다"는 사실은 반드시 노출 */}
        {hiddenTitleInterviews.length > 0 && (
          <div className="mt-2 rounded-lg border border-slate-300 bg-slate-50 p-2">
            <div className="text-[11px] font-bold text-slate-900 flex items-center gap-1">
              🔒 제목 비공개 면접 {hiddenTitleInterviews.length}건
              <span className="font-normal text-slate-700">
                — 면접 캘린더에 시간은 잡혀 있으나 비공개(private) 일정이라 앱이 제목·후보자를 읽을 수 없습니다. 구글 캘린더에서 확인하세요.
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {hiddenTitleInterviews.map((e) => (
                <a
                  key={e.id}
                  href={e.htmlLink || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-0.5 rounded-md bg-white border border-slate-300 text-[11px] font-mono text-slate-900 hover:bg-slate-100"
                  title="구글 캘린더에서 열기"
                >
                  {e.dt.slice(5)} {e.tm}
                </a>
              ))}
            </div>
          </div>
        )}
        {/* 진단 배지 — 시트 행 수 / 일정 추출 수 / 스냅샷 키 수 */}
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          {(() => {
            const dbg: any = (typeof window !== 'undefined' && (window as any).__intvDebug) || {};
            const tone = dbg.sheetRowsTotal > 0 && dbg.sheetRowsWithDt > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800';
            return (
              <>
                <span className={`px-1.5 py-0.5 rounded ${tone}`}>
                  📊 시트행: {dbg.sheetRowsTotal ?? '?'} / 일정추출: {dbg.sheetRowsWithDt ?? '?'}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-600">
                  스냅샷: {(dbg.snapshotKeys || []).length}개
                </span>
              </>
            );
          })()}
        </div>
      </div>

      {/* 일정 리스트 */}
      {grouped.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-2 opacity-40">📭</div>
          <div className="text-sm text-slate-400">표시할 면접 일정이 없습니다.</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
          {grouped.map(([dt, events]) => (
            <DayBlock key={dt} dt={dt} events={events} today={today} onDelete={handleDeleteEvent} onEdit={handleEditEvent} onMarkNoShow={handleMarkNoShow} resumeMails={resumeMails} roomBookings={roomBookings} />
          ))}
        </div>
      )}

      {/* 새 면접 생성 모달은 제거 — 면접은 회의실 예약에서만 만든다 (2026-09-01).
          수정/삭제는 그대로 유지한다. */}

      {editingEvent && (
        <InterviewEditModal
          event={editingEvent}
          rooms={roomsMeta}
          roomBookings={roomBookings}
          myEmail={myEmail}
          onClose={() => setEditingEvent(null)}
          onSaved={() => {
            setEditingEvent(null);
            void refreshCalendarFromGoogle();
            void refreshRoomBookings();
          }}
        />
      )}
    </div>
  );
}

type RoomBookingItem = { id: string; resourceId: string; shortName: string; startMs: number; endMs: number; summary: string; description: string; htmlLink?: string; creatorEmail?: string };

// (사용 안 함) 면접 생성은 회의실 예약으로 일원화 — 되돌릴 때를 대비해 코드는 남겨둔다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function InterviewCreateModal({ onClose, onCreated, rooms, roomBookings, myEmail }: { onClose: () => void; onCreated: () => void; rooms: RoomMeta[]; roomBookings: RoomBookingItem[]; myEmail: string | null }) {
  const init = nextHalfHour();
  const [form, setForm] = useState<InterviewForm>({
    candidate: '',
    team: '',
    job: '',
    site: SITE_PRESETS[0],
    customSite: '',
    room: ROOM_PRESETS_BY_SITE[SITE_PRESETS[0]][0],
    customRoom: '',
    date: init.date,
    startTime: init.start,
    endTime: init.end,
    interviewers: '',
    notes: '',
    addMeet: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const update = <K extends keyof InterviewForm>(k: K, v: InterviewForm[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // 사이트가 바뀌면 회의실 첫 번째로 자동
      if (k === 'site') {
        const rooms = ROOM_PRESETS_BY_SITE[v as string] || [];
        if (rooms.length > 0) next.room = rooms[0];
        else next.room = '직접 입력';
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    setErr(null);
    if (!form.candidate.trim()) return setErr('후보자명을 입력하세요.');
    if (!form.date) return setErr('일자를 선택하세요.');
    if (!form.startTime || !form.endTime) return setErr('시작/종료 시간을 입력하세요.');

    const finalSite = form.site === '직접 입력' ? form.customSite.trim() : form.site;
    const finalRoom = form.room === '직접 입력' ? form.customRoom.trim() : form.room;
    const isOnline = /온라인|meet|zoom/i.test(finalSite) || /meet|zoom/i.test(finalRoom);

    // 표준 포맷: "10:00 / 퍼플 / 이형도 / 인사팀"
    //   → 면접시간 / 근무지 / 이름 / 팀
    // 회의실은 location 필드에만 들어감 (summary에서 제외)
    const teamOrJob = form.job.trim() || form.team.trim();
    const parts = [
      form.startTime,
      finalSite,
      form.candidate.trim(),
      teamOrJob,
    ].filter(Boolean);
    const summary = parts.join(' / ');

    const fullLocation = [finalSite, finalRoom].filter(Boolean).join(' ');
    const startISO = `${form.date}T${form.startTime}:00`;
    const endISO = `${form.date}T${form.endTime}:00`;
    const attendees: { email: string; resource?: boolean }[] = form.interviewers
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
      .map((email) => ({ email }));
    // 회의실 자동 선점 — finalSite + finalRoom으로 리소스 이메일 매핑, 매칭되면 attendee에 추가.
    // Google이 같은 슬롯에 이미 잡힌 게 없으면 'accepted', 충돌 시 'declined'로 응답 → 사용자가 결과 확인 가능.
    const roomMapping = findResourceEmailByLocation(finalRoom, finalSite, rooms);
    if (roomMapping) {
      attendees.push({ email: roomMapping.resourceEmail, resource: true });
    }

    // 설명(description) 우선순위: 장소를 맨 위로 — 사용자가 빠르게 보고 이동/준비 가능
    // 후보자/팀/직무는 summary에 이미 있으므로 description은 부가 정보 위주
    const body: Parameters<typeof api.google.insertCalEvent>[1] = {
      summary,
      description:
        (fullLocation ? `📍 장소: ${fullLocation}` : '') +
        (form.candidate ? `${fullLocation ? '\n' : ''}후보자: ${form.candidate.trim()}` : '') +
        (form.team ? `\n팀: ${form.team.trim()}` : '') +
        (form.job ? `\n직무: ${form.job.trim()}` : '') +
        (form.notes ? `\n\n${form.notes.trim()}` : ''),
      location: fullLocation,
      start: { dateTime: startISO, timeZone: 'Asia/Seoul' },
      end: { dateTime: endISO, timeZone: 'Asia/Seoul' },
      attendees,
    };
    // colorId 3 (grape 보라색) for 면접 — 사용자 지정 면접 색상
    (body as Record<string, unknown>).colorId = '3';
    if (form.addMeet || isOnline) {
      (body as Record<string, unknown>).conferenceData = {
        createRequest: { requestId: `meet-${Date.now()}` },
      };
    }

    // 회의실 충돌 사전 체크 — 다른 사람 booking과 겹치면 차단.
    // 단 "본인이 미리 잡아둔 러프 booking 안에 sub-슬롯 면접 추가"는 정상 워크플로 → skip.
    //   예: hdlee가 5/20 10-13 박연수+박혜경+하은서 통booking 잡아두고, 박혜경 11-12 단독 면접 추가.
    //   조건: booking.creator === myEmail && booking이 새 면접을 strictly contain (start <= newStart && end >= newEnd && booking이 더 김)
    if (roomMapping) {
      try {
        const dayStart = `${form.date}T00:00:00+09:00`;
        const dayEnd = `${form.date}T23:59:59+09:00`;
        const existing = await api.google.listCalendar(dayStart, dayEnd, roomMapping.resourceEmail);
        if (existing.ok && existing.data) {
          const ivStart = Date.parse(`${startISO}+09:00`);
          const ivEnd = Date.parse(`${endISO}+09:00`);
          const myEmailLow = (myEmail || '').toLowerCase();
          const conflicts = existing.data.filter((e) => {
            const s = Date.parse(e.start);
            const en = Date.parse(e.end);
            if (!(Number.isFinite(s) && Number.isFinite(en) && s < ivEnd && en > ivStart)) return false;
            // 본인 러프 booking이 새 면접을 strictly contain → 충돌 아님
            const creator = (e.creator?.email || '').toLowerCase();
            if (myEmailLow && creator === myEmailLow && s <= ivStart && en >= ivEnd && (en - s) > (ivEnd - ivStart)) {
              return false;
            }
            return true;
          });
          if (conflicts.length > 0) {
            const lines = conflicts.map((c) => {
              const s = new Date(c.start);
              const en = new Date(c.end);
              const time = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}-${String(en.getHours()).padStart(2, '0')}:${String(en.getMinutes()).padStart(2, '0')}`;
              return `  · ${time} ${c.summary || '(제목 없음)'} (만든이: ${c.creator?.email || '?'})`;
            }).join('\n');
            window.alert(
              `⛔ 회의실 중복 예약 — 등록 불가\n\n` +
              `${roomMapping.shortName}에 ${form.date} ${form.startTime}-${form.endTime} 시간대 ` +
              `이미 다른 예약이 있어 등록할 수 없습니다:\n\n${lines}\n\n` +
              `다른 회의실을 선택하거나 시간을 변경해주세요.`
            );
            setSubmitting(false);
            return;
          }
        }
      } catch {
        /* 충돌 체크 자체가 실패한 경우엔 등록은 진행 (네트워크/권한 이슈로 차단까지 하면 사용성 저하) */
      }
    }

    setSubmitting(true);
    try {
      // 팀 공유 면접 캘린더에 등록 — 모든 TA팀원의 앱에서 동일하게 보임.
      // sendUpdates='all'로 attendees(현업)에게도 초대 메일 발송 (메모리 룰: 면접 attendees 필수).
      const r = await api.google.insertCalEvent(SHARED_CAL.interview, body, 'all');
      if (!r.ok) {
        setErr(r.error || '캘린더 등록 실패');
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">+ 새 면접 일정</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">👥 TA팀 공유 면접 캘린더에 등록됩니다 · 모든 팀원에게 즉시 보임</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2 text-[11px] text-indigo-800 leading-relaxed">
            📋 등록 형식: <b>면접시간 / 근무지 / 이름 / 팀</b><br />
            예: <span className="font-mono">10:00 / 퍼플 / 이형도 / 인사팀</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="일자 *">
              <input
                type="date"
                value={form.date}
                onChange={(e) => update('date', e.target.value)}
                className="input w-full"
              />
            </Field>
            <Field label="① 면접시간 *">
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => update('startTime', e.target.value)}
                className="input w-full"
              />
            </Field>
            <Field label="종료 *">
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => update('endTime', e.target.value)}
                className="input w-full"
              />
            </Field>
          </div>
          <Field label="② 근무지 *">
            <select
              value={form.site}
              onChange={(e) => update('site', e.target.value)}
              className="input w-full"
            >
              {SITE_PRESETS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="직접 입력">직접 입력</option>
            </select>
            {form.site === '직접 입력' && (
              <input
                type="text"
                value={form.customSite}
                onChange={(e) => update('customSite', e.target.value)}
                placeholder="근무지 직접 입력"
                className="input w-full mt-1.5"
              />
            )}
          </Field>
          <Field label="③ 이름 *">
            <input
              type="text"
              value={form.candidate}
              onChange={(e) => update('candidate', e.target.value)}
              placeholder="예: 이형도"
              className="input w-full"
              autoFocus
            />
          </Field>
          <Field label="④ 팀 *">
            <input
              type="text"
              value={form.team}
              onChange={(e) => update('team', e.target.value)}
              placeholder="예: 인사팀"
              className="input w-full"
            />
          </Field>
          <Field label="직무 상세 (옵션 — 비우면 팀명만 표시)">
            <input
              type="text"
              value={form.job}
              onChange={(e) => update('job', e.target.value)}
              placeholder="예: 채용 매니저 / 1차"
              className="input w-full"
            />
          </Field>
          <Field label="장소 (회의실 — 제목에는 안 들어가고 설명·location에만 기록)">
            <select
              value={form.room}
              onChange={(e) => update('room', e.target.value)}
              className="input w-full"
            >
              {(ROOM_PRESETS_BY_SITE[form.site] || []).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="직접 입력">직접 입력</option>
            </select>
            {form.room === '직접 입력' && (
              <input
                type="text"
                value={form.customRoom}
                onChange={(e) => update('customRoom', e.target.value)}
                placeholder="회의실 직접 입력"
                className="input w-full mt-1.5"
              />
            )}
          </Field>
          <RoomAvailabilityPanel
            date={form.date}
            site={form.site}
            rooms={rooms}
            bookings={roomBookings}
            selectedStart={form.startTime}
            selectedEnd={form.endTime}
            selectedRoomLabel={form.room === '직접 입력' ? form.customRoom : form.room}
          />
          <Field label="면접관 이메일 (쉼표/줄바꿈 구분)">
            <textarea
              value={form.interviewers}
              onChange={(e) => update('interviewers', e.target.value)}
              placeholder="shim@cnccosmetic.com, jhlee3@cnccosmetic.com"
              rows={2}
              className="input w-full font-mono text-xs"
            />
          </Field>
          <Field label="비고 (description)">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="추가 메모"
              rows={2}
              className="input w-full"
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.addMeet}
              onChange={(e) => update('addMeet', e.target.checked)}
              className="rounded"
            />
            Google Meet 링크 자동 생성
          </label>
          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
              ⚠ {err}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn">
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.candidate.trim()}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {submitting ? '등록 중...' : '캘린더에 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function DayBlock({ dt, events, today, onDelete, onEdit, onMarkNoShow, resumeMails, roomBookings }: { dt: string; events: InterviewEvent[]; today: string; onDelete: (e: InterviewEvent) => void; onEdit: (e: InterviewEvent) => void; onMarkNoShow: (e: InterviewEvent) => void; resumeMails: ResumeShareMail[]; roomBookings: { id: string; resourceId: string; shortName: string; startMs: number; endMs: number; summary: string; description: string; htmlLink?: string; creatorEmail?: string }[] }) {
  const d = new Date(dt + 'T00:00:00');
  const dow = DOW[d.getDay()];
  const dowTone =
    d.getDay() === 0 ? 'text-rose-600' : d.getDay() === 6 ? 'text-blue-600' : 'text-slate-500';
  const isToday = dt === today;
  const isPast = dt < today;
  const dDelta = diffDays(dt, today);
  const dayLabel =
    dDelta === 0
      ? '오늘'
      : dDelta === 1
      ? '내일'
      : dDelta === -1
      ? '어제'
      : dDelta > 0
      ? `D-${dDelta}`
      : `D+${-dDelta}`;

  return (
    <div className={`card overflow-hidden ${isPast ? 'opacity-60' : ''} ${isToday ? 'ring-2 ring-indigo-400' : ''}`}>
      <div
        className={`px-4 py-2 flex items-center gap-3 border-b ${
          isToday ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-2xl font-black tabular-nums tracking-tight ${
              isToday ? 'text-indigo-700' : 'text-slate-800'
            }`}
          >
            {d.getMonth() + 1}.{d.getDate()}
          </span>
          <span className={`text-sm font-bold ${dowTone}`}>({dow})</span>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            isToday
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-200 text-slate-700'
          }`}
        >
          {dayLabel}
        </span>
        <span className="ml-auto text-xs text-slate-600 font-semibold">{events.length}건</span>
      </div>
      <div className="divide-y divide-slate-100">
        {events.map((e) => (
          <InterviewRow key={e.id} event={e} onDelete={onDelete} onEdit={onEdit} onMarkNoShow={onMarkNoShow} resumeMails={resumeMails} roomBookings={roomBookings} />
        ))}
      </div>
    </div>
  );
}

// 면접 카드 우측 체크리스트의 한 줄. 체크 시 진한 텍스트, 미체크는 흐림.
// href가 있으면 anchor로 — 이력서 메일 등 외부 링크에 사용.
function CheckLine({ checked, label, detail, href, forceDetail }: { checked: boolean; label: string; detail?: string; href?: string; forceDetail?: boolean }) {
  const box = (
    <span
      className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border shrink-0 ${
        checked ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-300'
      }`}
    >
      {checked && <span className="text-[8px] leading-none font-bold">✓</span>}
    </span>
  );
  const showDetail = !!detail && (checked || forceDetail);
  const text = (
    <>
      <span className={`font-semibold ${checked ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
      {showDetail && (
        <span className={`ml-1 text-[10px] truncate ${forceDetail ? 'max-w-[180px]' : 'max-w-[100px]'} ${checked ? 'text-slate-600 font-semibold' : 'text-amber-700'}`}>
          {detail}
        </span>
      )}
    </>
  );
  if (href && checked) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(ev) => ev.stopPropagation()}
        title={`${label}${detail ? ' · ' + detail : ''}`}
        className="inline-flex items-center gap-1 hover:bg-slate-100 rounded px-1 -mx-1 transition-colors"
      >
        {box}
        {text}
      </a>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-1"
      title={`${label}${detail ? ' · ' + detail : ''}`}
    >
      {box}
      {text}
    </div>
  );
}

function InterviewRow({ event, onDelete, onEdit, onMarkNoShow, resumeMails, roomBookings }: { event: InterviewEvent; onDelete: (e: InterviewEvent) => void; onEdit: (e: InterviewEvent) => void; onMarkNoShow: (e: InterviewEvent) => void; resumeMails: ResumeShareMail[]; roomBookings: { id: string; resourceId: string; shortName: string; startMs: number; endMs: number; summary: string; description: string; htmlLink?: string; creatorEmail?: string }[] }) {
  // 불참 처리된 면접 — title에 "(불참)" 또는 "노쇼/no-show" 키워드 있으면 줄긋기로 표시.
  const isNoShow = /^\s*\(불참\)|^\s*불참\b|\(노\s*쇼\)|^\s*노\s*쇼|no[-\s]?show/i.test(event.title);
  // 장소 표시: 캘린더 location 필드 전체를 우선 (예: "퍼플 미팅룸 1번")
  // location이 비어있을 때만 title 파싱 결과(site/room)로 fallback
  const fullLocation = (event.location || '').trim()
    || [event.site, event.room].filter(Boolean).join(' · ');
  // 보낸함에서 후보자 이름이 들어간 이력서 첨부 메일이 있으면 "현업 공유" 인정.
  // 캘린더 면접일과 대조해서 (a)검토용 메일 (b)다른 차수 면접 메일 오인 방지.
  const resumeShare = event.source === 'calendar' ? findResumeShare(event.candidate, event.dt, resumeMails) : null;
  // 회의실 attendee가 있으면 회의실 예약된 면접 — primary sync 사본은 이미 위에서 필터됨.
  const roomAttendees = (event.attendees || []).filter((email) =>
    typeof email === 'string' && email.includes('resource.calendar.google.com')
  );
  // 회의실 booking과 cross-match — cncadmin@/임세현이 별도로 잡은 회의실 예약 인정.
  // 이름 매칭이 1차, 실패하면 시간 겹침 + 회의실명 토큰 매칭이 2차 (오타·익명 booking 케이스).
  const matchedBooking = event.source === 'calendar'
    ? matchRoomBooking(
        event.candidate,
        event.dt,
        event.startISO,
        event.endISO,
        event.location || fullLocation,
        event.site,
        roomBookings,
      )
    : null;

  // 옛/잔존 회의실 예약 감지 — 후보자 이름이 들어간 booking이 면접 이벤트 시간대와 안 겹치면 잔존.
  //   예: 박준상 면접을 5/14→5/13으로 옮겼지만 미팅룸-2 5/14 11:00 booking이 cncadmin@ 소유라 안 지워짐.
  //   매니저가 모르고 지나가지 않게 면접 카드에 경고 배지로 즉시 표시.
  const orphanBookings = (() => {
    if (event.source !== 'calendar') return [];
    const name = (event.candidate || '').trim();
    if (name.length < 2) return [];
    const ivStart = event.startISO ? Date.parse(event.startISO) : NaN;
    const ivEnd = event.endISO ? Date.parse(event.endISO) : NaN;
    return roomBookings.filter((b) => {
      if (!b.summary.includes(name) && !b.description.includes(name)) return false;
      // 면접 시간과 겹치면 정상 매칭 — 잔존 아님
      if (Number.isFinite(ivStart) && Number.isFinite(ivEnd) && b.startMs < ivEnd && b.endMs > ivStart) return false;
      return true;
    });
  })();

  const handleRowClick = (ev: React.MouseEvent) => {
    if (event.htmlLink) {
      window.open(event.htmlLink, '_blank', 'noopener,noreferrer');
      ev.preventDefault();
    }
  };

  return (
    <div
      onClick={handleRowClick}
      className={`px-4 py-2.5 flex items-center gap-4 hover:bg-slate-50/70 transition-colors ${
        event.htmlLink ? 'cursor-pointer' : ''
      } ${event.done ? 'opacity-50' : ''}`}
    >
      {/* 시간 */}
      <div className="w-16 shrink-0 text-center">
        <div
          className={`font-mono font-extrabold tabular-nums ${
            event.tm === '종일' ? 'text-sm text-slate-500' : 'text-lg text-blue-700'
          }`}
        >
          {event.tm}
        </div>
      </div>

      {/* 가운데: 이름 (큰 글씨) + 팀 */}
      <div className="flex-1 min-w-0">
        <div className={`flex items-baseline gap-2 flex-wrap ${isNoShow ? 'line-through text-slate-400' : ''}`}>
          <span className="font-extrabold text-slate-900 text-[15px] tracking-tight">
            {event.candidate || event.title}
          </span>
          {event.team && (
            <span className="text-[12px] font-semibold text-indigo-700">{event.team}</span>
          )}
        </div>
        {fullLocation && (
          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[12px] font-bold">
            <span className="text-[11px]">📍</span>
            <span>{fullLocation}</span>
          </div>
        )}
        {orphanBookings.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {orphanBookings.map((b, i) => {
              const d = new Date(b.startMs);
              const dateLabel = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              const ownerLabel = b.creatorEmail
                ? b.creatorEmail.split('@')[0]
                : '?';
              return (
                <a
                  key={`${b.resourceId}-${b.startMs}-${i}`}
                  href={b.htmlLink || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(ev) => ev.stopPropagation()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-300 text-rose-800 text-[11px] font-bold hover:bg-rose-100"
                  title={`옛 회의실 예약 잔존 — 면접은 ${event.dt}로 옮겨졌는데 회의실 booking은 ${dateLabel} ${b.shortName}에 그대로 남아있음.\nowner: ${ownerLabel} (본인 권한이 아니면 owner한테 해제 요청 필요).\nbooking summary: ${b.summary}`}
                >
                  <span>⚠️ 옛 회의실 잔존</span>
                  <span className="font-mono">{dateLabel}</span>
                  <span>· {b.shortName}</span>
                  <span className="text-rose-500">(owner: {ownerLabel})</span>
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* 우측: 진척 체크리스트 (캘린더 출처만) — 한눈에 체크 */}
      {event.source === 'calendar' && (() => {
        const humanAttendeeCount = (event.attendees || []).filter(
          (e) => typeof e === 'string' && !e.includes('resource.calendar.google.com')
        ).length;
        const shareOk = humanAttendeeCount > 0 || !!resumeShare;
        const resumeOk = !!resumeShare;
        // 회의실 예약 ✅ 판정: (1) 면접 이벤트 attendees에 회의실 리소스 있음
        // 또는 (2) primary/회의실 캘린더에 cncadmin@이 잡은 booking과 cross-match.
        const roomOk = roomAttendees.length > 0 || !!matchedBooking;
        // 옆 텍스트: 매칭된 회의실 shortName 우선 → location 텍스트 → "미예약"
        const roomDetail = matchedBooking
          ? matchedBooking.shortName
          : roomAttendees.length > 0
          ? (fullLocation || `${roomAttendees.length}개`)
          : (fullLocation || undefined);
        return (
          <div className="shrink-0 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
            <CheckLine
              checked={shareOk}
              label="현업 공유"
              detail={shareOk ? (humanAttendeeCount > 0 ? `초대 ${humanAttendeeCount}명` : '이력서') : undefined}
            />
            <div className="flex items-center gap-1 col-span-1">
              <CheckLine
                checked={resumeOk}
                label="이력서 메일"
                href={resumeShare ? gmailMessageUrl(resumeShare.mail.id) : undefined}
                detail={
                  resumeShare
                    ? resumeShare.matchKind === 'filename'
                      ? resumeShare.filename
                      : `본문매칭 · 첨부 ${resumeShare.mail.attachments.length}개`
                    : undefined
                }
              />
              {/* 이력서 첨부만 연동 — 사전질문지/평가표/가이드는 제외. */}
              {resumeShare && (() => {
                const infos = resumeShare.mail.attachmentInfos || [];
                const candidateNorm = (event.candidate || '').replace(/[\s_\-.()\[\]·ㆍ／（）［］、,，]+/g, '');
                if (candidateNorm.length < 2) return null;
                const RESUME = /이력서|이력|resume|cv|portfolio|포트폴리오|자기소개서|자소서|지원서|입사지원|서류전형/i;
                const EXCLUDE = /사전질문|질문지|평가표|평가서|평가지|면접평가|자기평가|인성검사|적성검사|체크리스트|온보딩|입사안내|일정공유|프로세스|가이드/i;
                const isDocFile = (a: { mimeType: string; filename: string }) => {
                  if (a.mimeType?.startsWith('image/')) return false;
                  return /\.(pdf|hwp|hwpx|doc|docx|zip)$/i.test(a.filename || '');
                };
                const norm = (s: string) => s.replace(/[\s_\-.()\[\]·ㆍ／（）［］、,，]+/g, '');
                const filesWithName = infos.filter((a) => isDocFile(a) && norm(a.filename || '').includes(candidateNorm));
                // 다른 후보자 명시된 파일 제외 (multi-candidate 메일 보호)
                const otherCandidateNames = (() => {
                  const names = new Set<string>();
                  for (const a of infos) {
                    if (!isDocFile(a)) continue;
                    const fn = a.filename || '';
                    if (norm(fn).includes(candidateNorm)) continue;
                    const matches = fn.match(/[가-힣]{2,4}/g) || [];
                    for (const tok of matches) {
                      if (/이력서|이력|지원서|지원자|서류|전형|평가|채용|면접|회사|팀|부서|온보딩|입사|사전|질문|품질|보증|영업|관리|생산|포장|제조|연구|TA|HR/.test(tok)) continue;
                      names.add(tok);
                    }
                  }
                  return names;
                })();
                const isSafeForThisCandidate = (filename: string) => {
                  if (norm(filename).includes(candidateNorm)) return true;
                  for (const other of otherCandidateNames) {
                    if (filename.includes(other)) return false;
                  }
                  return true;
                };
                // 사전질문지/평가표는 EXCLUDE — 이력서로 인정 안 함
                // 1순위: 이름 + RESUME 키워드 + EXCLUDE 없음
                const exact = filesWithName.find((a) => RESUME.test(a.filename) && !EXCLUDE.test(a.filename));
                // 2순위: 이름 + EXCLUDE 없음 (파일명에 '이력서' 단어 없어도 EXCLUDE 아니면 이력서로 추정)
                const looseButSafe = !exact && filesWithName.find((a) => !EXCLUDE.test(a.filename));
                // 3순위: 파일명에 이름 없지만 RESUME 키워드 + EXCLUDE 없음 + 다른 후보자 명시 없음
                const inferredResume = !exact && !looseButSafe && infos.find((a) => {
                  if (!isDocFile(a)) return false;
                  if (EXCLUDE.test(a.filename)) return false;
                  if (!RESUME.test(a.filename)) return false;
                  return isSafeForThisCandidate(a.filename);
                });
                // 4순위: 메일에 EXCLUDE 아닌 후보 파일이 1개이고 다른 후보자 없으면 (외부 Fwd 케이스)
                const allCandidate = infos.filter((a) => isDocFile(a) && !EXCLUDE.test(a.filename) && isSafeForThisCandidate(a.filename));
                const fallback = !exact && !looseButSafe && !inferredResume && allCandidate.length === 1 ? allCandidate[0] : null;
                const myPdf = exact || looseButSafe || inferredResume || fallback;
                if (!myPdf) return null;
                return (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void (async () => {
                        try {
                          const r = await api.google.openAttachment(
                            resumeShare.mail.id,
                            myPdf.filename,
                            myPdf.attachmentId,
                          );
                          if (!r.ok) alert(`이력서 PDF 열기 실패: ${r.error || '알 수 없는 오류'}`);
                        } catch (e) {
                          alert(`이력서 PDF 열기 오류: ${e instanceof Error ? e.message : String(e)}`);
                        }
                      })();
                    }}
                    className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                    title={`${myPdf.filename} (${Math.round((myPdf.size || 0) / 1024)} KB)\n클릭 → 시스템 기본 뷰어로 바로 열림`}
                  >
                    📄 이력서
                  </button>
                );
              })()}
            </div>
            <div className="col-span-2">
              <CheckLine
                checked={roomOk}
                label="회의실 예약"
                detail={roomDetail}
                forceDetail
              />
            </div>
          </div>
        );
      })()}

      {/* 출처 / 완료 */}
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-[10px] ml-2">
        {event.source === 'calendar' ? (
          <span className="text-slate-400">📅 캘린더</span>
        ) : (
          <span className="text-slate-400">📋 시트</span>
        )}
        {event.done && <span className="text-emerald-600 font-bold">✓ 완료</span>}
      </div>
      {event.source === 'calendar' && !isNoShow && (
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            onMarkNoShow(event);
          }}
          title="불참 처리 — 제목에 (불참) 라벨 + 회의실 자동 해제 + 줄긋기 표시"
          className="shrink-0 px-2 h-7 rounded-md text-[11px] font-bold text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors flex items-center"
        >
          불참
        </button>
      )}
      {event.source === 'calendar' && (
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            onEdit(event);
          }}
          title="이 면접 수정 (캘린더 이벤트도 함께 변경)"
          className="shrink-0 w-7 h-7 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center justify-center text-sm"
        >
          ✏️
        </button>
      )}
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          onDelete(event);
        }}
        title="이 면접 삭제 (캘린더에서도 삭제, 시트는 유지)"
        className="shrink-0 w-7 h-7 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors flex items-center justify-center text-base font-bold"
      >
        ✕
      </button>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  tone,
  emphasis,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: 'indigo' | 'blue' | 'slate';
  emphasis?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const palette = {
    indigo: { bg: 'bg-indigo-50', num: 'text-indigo-700', bar: 'bg-indigo-500', ring: 'ring-indigo-500' },
    blue: { bg: 'bg-blue-50', num: 'text-blue-700', bar: 'bg-blue-500', ring: 'ring-blue-500' },
    slate: { bg: 'bg-slate-50', num: 'text-slate-700', bar: 'bg-slate-400', ring: 'ring-slate-500' },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card p-3 relative overflow-hidden text-left transition-all ${palette.bg} ${
        active
          ? `ring-2 ${palette.ring} shadow-md scale-[1.01]`
          : emphasis && count > 0
          ? 'ring-2 ring-indigo-400'
          : 'hover:ring-1 hover:ring-slate-300'
      } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${palette.bar}`} />
      <div className="flex items-baseline justify-between ml-1.5">
        <span className={`text-[11px] uppercase tracking-[0.18em] font-bold ${palette.num} flex items-center gap-1`}>
          {label}
          {active && <span className="text-[9px] normal-case tracking-normal font-semibold">● 필터됨</span>}
        </span>
        <div className="flex items-baseline gap-0.5">
          <span className={`text-3xl font-black tabular-nums ${palette.num}`}>{count}</span>
          <span className="text-[10px] text-slate-500">건</span>
        </div>
      </div>
    </button>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

// ISO datetime → "HH:MM" 추출 (Asia/Seoul 기준 wall-clock 그대로)
function isoToHHMM(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : '';
}

// 면접 항목 수정 모달 — 캘린더 출처 이벤트만 가능. updateCalEvent 호출하여 캘린더 동시 변경.
function InterviewEditModal({
  event,
  onClose,
  onSaved,
  rooms,
  roomBookings,
  myEmail,
}: {
  event: InterviewEvent;
  onClose: () => void;
  onSaved: () => void;
  rooms: RoomMeta[];
  roomBookings: RoomBookingItem[];
  myEmail: string | null;
}) {
  // 기존 시간 prefill — startISO/endISO에서 추출. 없으면 event.tm/+1h 사용
  const startTm = isoToHHMM(event.startISO) || (event.tm !== '종일' ? event.tm : '10:00');
  const endTm = isoToHHMM(event.endISO) || (() => {
    const [hh, mm] = startTm.split(':').map((s) => parseInt(s, 10));
    if (Number.isNaN(hh)) return '11:00';
    const eh = String((hh + 1) % 24).padStart(2, '0');
    return `${eh}:${String(mm).padStart(2, '0')}`;
  })();

  // 기존 site/room — InterviewEvent.site/room이 파싱된 값. 프리셋에 있으면 그대로, 없으면 직접 입력으로
  const isSitePreset = SITE_PRESETS.includes(event.site);
  const sitePresetVal = isSitePreset ? event.site : (event.site ? '직접 입력' : SITE_PRESETS[0]);
  const presetRooms = ROOM_PRESETS_BY_SITE[sitePresetVal] || [];
  const isRoomPreset = presetRooms.includes(event.room);
  const roomPresetVal = isRoomPreset ? event.room : (event.room ? '직접 입력' : (presetRooms[0] || '직접 입력'));

  const [form, setForm] = useState<InterviewForm>({
    candidate: event.candidate,
    team: event.team,
    job: '',
    site: sitePresetVal,
    customSite: isSitePreset ? '' : event.site,
    room: roomPresetVal,
    customRoom: isRoomPreset ? '' : event.room,
    date: event.dt,
    startTime: startTm,
    endTime: endTm,
    // 회의실 리소스 이메일은 폼에서 제외 — 매니저가 보기 흉하고, submit 때 자동 매핑이 새로 추가하므로 중복 방지.
    interviewers: event.attendees
      .filter((email) => !email.includes('resource.calendar.google.com'))
      .join(', '),
    // notes는 사용자가 추가로 적는 메모만 받음.
    // event.description 전체를 prefill 하면 표준 prefix(📍 장소·후보자·팀)가 두 번 적히는 중복 버그.
    notes: '',
    addMeet: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const update = <K extends keyof InterviewForm>(k: K, v: InterviewForm[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'site') {
        const rooms = ROOM_PRESETS_BY_SITE[v as string] || [];
        next.room = rooms.length > 0 ? rooms[0] : '직접 입력';
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    setErr(null);
    if (!form.candidate.trim()) return setErr('후보자명을 입력하세요.');
    if (!form.date) return setErr('일자를 선택하세요.');
    if (!form.startTime || !form.endTime) return setErr('시작/종료 시간을 입력하세요.');
    if (!event.calendarId) return setErr('캘린더 ID 누락 — 수정 불가');

    const finalSite = form.site === '직접 입력' ? form.customSite.trim() : form.site;
    const finalRoom = form.room === '직접 입력' ? form.customRoom.trim() : form.room;
    const teamOrJob = form.job.trim() || form.team.trim();
    const summary = [form.startTime, finalSite, form.candidate.trim(), teamOrJob].filter(Boolean).join(' / ');
    const fullLocation = [finalSite, finalRoom].filter(Boolean).join(' ');
    const startISO = `${form.date}T${form.startTime}:00`;
    const endISO = `${form.date}T${form.endTime}:00`;
    const attendeeEmails = form.interviewers
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    // 회의실 자동 선점 — 수정 시에도 finalSite+finalRoom 매핑하여 attendees에 회의실 리소스 포함.
    // 회의실이 바뀌면 Google이 기존 리소스에서 해제하고 새 리소스에 새로 invite 보냄.
    const builtAttendees: { email: string; resource?: boolean }[] = attendeeEmails.map((email) => ({ email }));
    const roomMapping = findResourceEmailByLocation(finalRoom, finalSite, rooms);
    if (roomMapping) {
      builtAttendees.push({ email: roomMapping.resourceEmail, resource: true });
    }

    const body: Record<string, unknown> = {
      summary,
      description:
        (fullLocation ? `📍 장소: ${fullLocation}` : '') +
        (form.candidate ? `${fullLocation ? '\n' : ''}후보자: ${form.candidate.trim()}` : '') +
        (form.team ? `\n팀: ${form.team.trim()}` : '') +
        (form.job ? `\n직무: ${form.job.trim()}` : '') +
        (form.notes ? `\n\n${form.notes.trim()}` : ''),
      location: fullLocation,
      start: { dateTime: startISO, timeZone: 'Asia/Seoul' },
      end: { dateTime: endISO, timeZone: 'Asia/Seoul' },
      attendees: builtAttendees,
      colorId: '3', // 보라색 면접 라벨 유지
    };

    // 회의실 충돌 사전 체크는 EDIT 모달에서 완전 제거 — 사용자 인용:
    //   "내가 예약한 글인데 왜 수정이 안되는거야 ? 상식적으로"
    // 자기 이벤트의 회의실 sync 본을 충돌로 잘못 잡거나 (eventId/이름 매칭 실패),
    // strictly-contain 보호도 종종 미스해서 정상 수정이 막히는 사고 반복.
    // 정책 변경: EDIT는 무조건 통과 (사용자가 예약한 본인 이벤트). 충돌 발생 시 Google이 회의실
    // 리소스 응답으로 declined 처리하므로 데이터는 깨지지 않음. CREATE는 여전히 차단함.
    void roomMapping; // intentionally unused — kept for future re-enable

    setSubmitting(true);
    try {
      const r = await api.google.updateCalEvent(event.calendarId, event.id, body, 'all');
      if (!r.ok) {
        setErr((r as { error?: string }).error || '캘린더 수정 실패');
        setSubmitting(false);
        return;
      }
      // 회의실 booking 이름 자동 동기화 — 사용자가 면접 잡기 전에 회의실을 임시 이름으로
      // 선예약한 경우, 면접 이벤트의 새 이름을 같은 시간대/같은 회의실의 본인 booking에도 반영.
      // 안전장치:
      //  - id === event.id (resource attendee sync 본) → 제외, Google이 알아서 동기화함
      //  - creatorEmail === myEmail → 본인이 만든 booking만 (타인 booking 절대 금지)
      //  - resourceId === roomMapping.resourceEmail → 새 location에 매핑된 회의실만
      //  - 시간 겹침 (옛/새 슬롯) → 다른 시간대 booking 보호
      //  - 이미 new candidate name 포함 → 이미 sync됨, skip
      //  - 다른 한글 후보자 이름 명시되어 있고 그게 옛 이름도 아님 → 다른 사람 booking, skip
      // onSaved() 전에 await — onSaved → refreshRoomBookings 순서 보장하여 모달 닫힌 직후 갱신 표시.
      const newName = form.candidate.trim();
      if (newName && roomMapping) {
        const oldName = (event.candidate || '').trim();
        const oldStartMs = event.startISO ? Date.parse(event.startISO) : Date.parse(startISO);
        const oldEndMs = event.endISO ? Date.parse(event.endISO) : Date.parse(endISO);
        const newStartMs = Date.parse(startISO);
        const newEndMs = Date.parse(endISO);
        const bookingsToSync = roomBookings.filter((b) => {
          if (b.id === event.id) return false;
          if (b.resourceId !== roomMapping.resourceEmail) return false;
          if (myEmail && b.creatorEmail && b.creatorEmail !== myEmail) return false;
          const overlapOld = Number.isFinite(oldStartMs) && Number.isFinite(oldEndMs)
            && b.startMs < oldEndMs && b.endMs > oldStartMs;
          const overlapNew = b.startMs < newEndMs && b.endMs > newStartMs;
          if (!overlapOld && !overlapNew) return false;
          if (b.summary.includes(newName)) return false;
          // booking summary에 한글 이름이 명시되어 있으면 그게 옛 이름과 일치해야만 안전
          const otherNameMatch = b.summary.match(/면접\s*[-—–]?\s*([가-힣]{2,4})/);
          if (otherNameMatch) {
            const bookingName = otherNameMatch[1];
            if (bookingName !== oldName && bookingName !== newName) return false;
          }
          return true;
        });
        if (bookingsToSync.length > 0) {
          // 새 booking summary — 면접 표준 컨벤션 "○○팀 면접 - 이름"
          const newBookingSummary = teamOrJob
            ? `${teamOrJob} 면접 - ${newName}`
            : `면접 - ${newName}`;
          await Promise.allSettled(bookingsToSync.map((b) =>
            api.google.updateCalEvent(b.resourceId, b.id, { summary: newBookingSummary }, 'none')
          ));
        }
      }
      onSaved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">✏️ 면접 일정 수정</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">👥 캘린더 이벤트도 함께 변경됩니다 · 시트는 유지</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2 text-[11px] text-indigo-800 leading-relaxed">
            📋 표준 형식: <b>면접시간 / 근무지 / 이름 / 팀</b>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="일자 *">
              <input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} className="input w-full" />
            </Field>
            <Field label="시작 *">
              <input type="time" value={form.startTime} onChange={(e) => update('startTime', e.target.value)} className="input w-full" />
            </Field>
            <Field label="종료 *">
              <input type="time" value={form.endTime} onChange={(e) => update('endTime', e.target.value)} className="input w-full" />
            </Field>
          </div>
          <Field label="근무지 *">
            <select value={form.site} onChange={(e) => update('site', e.target.value)} className="input w-full">
              {SITE_PRESETS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="직접 입력">직접 입력</option>
            </select>
            {form.site === '직접 입력' && (
              <input type="text" value={form.customSite} onChange={(e) => update('customSite', e.target.value)} placeholder="근무지 직접 입력" className="input w-full mt-1.5" />
            )}
          </Field>
          <Field label="이름 *">
            <input type="text" value={form.candidate} onChange={(e) => update('candidate', e.target.value)} className="input w-full" autoFocus />
          </Field>
          <Field label="팀 *">
            <input type="text" value={form.team} onChange={(e) => update('team', e.target.value)} placeholder="예: 인사팀" className="input w-full" />
          </Field>
          <Field label="직무 (옵션)">
            <input type="text" value={form.job} onChange={(e) => update('job', e.target.value)} placeholder="예: 채용 매니저 / 1차" className="input w-full" />
          </Field>
          <Field label="회의실 (location에만 기록)">
            <select value={form.room} onChange={(e) => update('room', e.target.value)} className="input w-full">
              {(ROOM_PRESETS_BY_SITE[form.site] || []).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="직접 입력">직접 입력</option>
            </select>
            {form.room === '직접 입력' && (
              <input type="text" value={form.customRoom} onChange={(e) => update('customRoom', e.target.value)} placeholder="회의실 직접 입력" className="input w-full mt-1.5" />
            )}
          </Field>
          <RoomAvailabilityPanel
            date={form.date}
            site={form.site}
            rooms={rooms}
            bookings={roomBookings}
            selectedStart={form.startTime}
            selectedEnd={form.endTime}
            selectedRoomLabel={form.room === '직접 입력' ? form.customRoom : form.room}
          />
          <Field label="면접관 이메일 (쉼표 구분)">
            <textarea value={form.interviewers} onChange={(e) => update('interviewers', e.target.value)} rows={2} className="input w-full font-mono text-xs" />
          </Field>
          <Field label="비고 (description)">
            <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={3} className="input w-full" />
          </Field>
          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">⚠ {err}</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn">취소</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.candidate.trim()}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {submitting ? '저장 중...' : '캘린더 수정 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 면접 등록/수정 모달 안에 보여주는 회의실 현황 패널 (Gantt-style 시간 막대).
// 가로축: 8시 ~ 19시 (11시간). 회의실마다 1줄. booking은 회색 막대, 선택한 면접 시간은 indigo 윤곽.
// 선택 시간이 booking과 겹치면 막대 + 회의실명 빨강. 사이트(퍼플/그린/수원) 변경하면 즉시 갱신.
const PANEL_HOUR_START = 8;
const PANEL_HOUR_END = 19;
const PANEL_HOUR_RANGE = PANEL_HOUR_END - PANEL_HOUR_START;

function RoomAvailabilityPanel({
  date,
  site,
  rooms,
  bookings,
  selectedStart,
  selectedEnd,
  selectedRoomLabel,
}: {
  date: string;
  site: string;
  rooms: RoomMeta[];
  bookings: RoomBookingItem[];
  selectedStart: string;
  selectedEnd: string;
  selectedRoomLabel: string;
}) {
  const SITE_KEY: Record<string, 'purple' | 'green' | 'suwon'> = { 퍼플: 'purple', 그린: 'green', 수원: 'suwon' };
  const wantSite = SITE_KEY[site];
  if (!wantSite || !date) {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        💡 위워크/온라인 또는 직접 입력 사이트는 회의실 현황 표시가 없습니다.
      </div>
    );
  }
  const siteRooms = rooms.filter((r) => r.site === wantSite && r.kind === 'room');
  const axisStart = Date.parse(`${date}T${String(PANEL_HOUR_START).padStart(2, '0')}:00:00+09:00`);
  const axisEnd = Date.parse(`${date}T${String(PANEL_HOUR_END).padStart(2, '0')}:00:00+09:00`);
  // axisStart/End가 NaN이면 (date 형식 오류) 안전하게 패널 자체를 표시하지 않음
  if (!Number.isFinite(axisStart) || !Number.isFinite(axisEnd) || axisEnd <= axisStart) {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        💡 날짜 형식이 올바르지 않아 회의실 현황을 표시할 수 없습니다.
      </div>
    );
  }
  const totalMs = axisEnd - axisStart;
  const selStartMs = selectedStart ? Date.parse(`${date}T${selectedStart}:00+09:00`) : NaN;
  const selEndMs = selectedEnd ? Date.parse(`${date}T${selectedEnd}:00+09:00`) : NaN;
  const hasSelection = Number.isFinite(selStartMs) && Number.isFinite(selEndMs) && selEndMs > selStartMs;
  const pct = (ms: number): number => {
    if (!Number.isFinite(ms)) return 0;
    const clamped = Math.max(axisStart, Math.min(axisEnd, ms));
    return ((clamped - axisStart) / totalMs) * 100;
  };
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  // 선택 시간이 축 범위 밖이면 좌/우 가장자리에 marker 잘려보이지 않도록 표시 여부 결정
  const selVisible = hasSelection && selEndMs > axisStart && selStartMs < axisEnd;
  // 사용자가 폼에서 고른 회의실의 resourceId 식별 — 빨간색 충돌 표시는 이 회의실에만 적용.
  // 다른 회의실들은 정보 제공용으로 회색 chip만 (사용자가 빈 회의실 골라보라고).
  const selectedRoom = selectedRoomLabel ? findResourceEmailByLocation(selectedRoomLabel, site, rooms) : null;
  const selectedRoomId = selectedRoom?.resourceEmail || null;
  return (
    <div className="rounded-lg bg-amber-50/70 border border-amber-200 px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-amber-900">
          📅 {date} {site} 회의실 현황 ({PANEL_HOUR_START}~{PANEL_HOUR_END}시)
        </span>
        {hasSelection && (
          <span className="text-[10px] text-amber-800">
            선택 <b>{selectedStart}-{selectedEnd}</b> · ⭐=내가 고른 회의실, <span className="text-indigo-700 font-bold">파랑=내 시간</span>, 🔴=충돌(내 회의실만)
          </span>
        )}
      </div>
      {siteRooms.length === 0 ? (
        <div className="text-[11px] text-slate-500">{site} 회의실 리소스가 없습니다.</div>
      ) : (
        <div className="space-y-1.5">
          {/* 시간 축 헤더 — 1시간 단위 라벨 (양 끝은 안쪽으로 정렬해서 잘림 방지) */}
          <div className="flex items-stretch gap-2">
            <div className="shrink-0 w-24" />
            <div className="relative flex-1 h-3.5">
              {Array.from({ length: PANEL_HOUR_RANGE + 1 }, (_, i) => {
                const isFirst = i === 0;
                const isLast = i === PANEL_HOUR_RANGE;
                const transform = isFirst ? 'translateX(0)' : isLast ? 'translateX(-100%)' : 'translateX(-50%)';
                return (
                  <span
                    key={i}
                    className="absolute top-0 text-[9px] text-slate-500 font-medium tabular-nums"
                    style={{ left: `${(i / PANEL_HOUR_RANGE) * 100}%`, transform }}
                  >
                    {PANEL_HOUR_START + i}
                  </span>
                );
              })}
            </div>
          </div>
          {/* 회의실별 막대 */}
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {siteRooms.map((r) => {
              const dayBookings = bookings
                .filter((b) =>
                  b.resourceId === r.id
                  && Number.isFinite(b.startMs)
                  && Number.isFinite(b.endMs)
                  && b.endMs > b.startMs
                  && b.endMs > axisStart
                  && b.startMs < axisEnd
                )
                .sort((a, b) => a.startMs - b.startMs);
              // 빨간색 충돌 표시는 "사용자가 폼에서 고른 회의실"에만 적용.
              // 다른 회의실 booking은 정보 제공용 회색만 (사용자가 빈 회의실 골라보라고).
              const isSelectedRoom = !!selectedRoomId && r.id === selectedRoomId;
              const conflict = isSelectedRoom && hasSelection && dayBookings.some((b) => b.startMs < selEndMs && b.endMs > selStartMs);
              return (
                <div key={r.id} className="flex items-stretch gap-2">
                  <span
                    className={`shrink-0 w-24 truncate text-[11px] font-semibold leading-6 ${
                      conflict ? 'text-rose-700' : isSelectedRoom ? 'text-indigo-700' : 'text-slate-700'
                    }`}
                    title={r.shortName + (isSelectedRoom ? ' (선택됨)' : '')}
                  >
                    {conflict ? '🔴 ' : isSelectedRoom ? '⭐ ' : ''}{r.shortName}
                  </span>
                  {/* 막대 영역 */}
                  <div className={`relative flex-1 h-6 rounded border overflow-hidden ${
                    isSelectedRoom ? 'border-indigo-300 bg-emerald-50' : 'border-emerald-200 bg-emerald-50'
                  }`}>
                    {/* 1시간 grid line */}
                    {Array.from({ length: PANEL_HOUR_RANGE - 1 }, (_, i) => (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 w-px bg-emerald-200/70"
                        style={{ left: `${((i + 1) / PANEL_HOUR_RANGE) * 100}%` }}
                      />
                    ))}
                    {/* booking 막대 — 선택 회의실의 충돌 booking만 빨간색, 그 외(다른 회의실 또는 비충돌)는 회색 */}
                    {dayBookings.map((b) => {
                      const left = pct(b.startMs);
                      const width = Math.max(0.5, pct(b.endMs) - left);
                      const overlap = isSelectedRoom && hasSelection && b.startMs < selEndMs && b.endMs > selStartMs;
                      const label = `${fmt(b.startMs)} ${b.summary}`.slice(0, 24);
                      return (
                        <div
                          key={b.id}
                          className={`absolute top-0.5 bottom-0.5 rounded px-1 text-[9px] font-medium truncate flex items-center ${
                            overlap
                              ? 'bg-rose-500 text-white border border-rose-700'
                              : 'bg-slate-400/80 text-white border border-slate-500'
                          }`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${fmt(b.startMs)}-${fmt(b.endMs)} ${b.summary}\n생성자: ${b.creatorEmail || '?'}`}
                        >
                          {width > 6 ? label : ''}
                        </div>
                      );
                    })}
                    {/* 선택한 면접 시간 indigo 윤곽 */}
                    {selVisible && (() => {
                      const left = pct(selStartMs);
                      const width = Math.max(0.8, pct(selEndMs) - left);
                      return (
                        <div
                          className="absolute -top-px -bottom-px border-2 border-indigo-600 rounded pointer-events-none shadow-sm"
                          style={{ left: `${left}%`, width: `${width}%`, boxShadow: '0 0 0 1px rgba(255,255,255,0.6)' }}
                          title={`내 면접 시간 ${selectedStart}-${selectedEnd}`}
                        />
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
