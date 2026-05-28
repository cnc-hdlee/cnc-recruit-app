import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import type { GCalEvent, GCalListEntry } from '../lib/api';
import {
  classifyResourceCalendar,
  siteLabel,
  SITE_LIST,
  type RoomMeta,
  type RoomSite,
} from '../lib/meetingRooms';
import { SHARED_CAL } from '../lib/sharedCalendars';
import { refreshCalendarFromGoogle } from '../store/liveData';

// 회의실 예약 블록을 빨간 박스로 강조할 직원 이메일.
// - 이형도(hdlee@)는 본인이라 항상 빨강(기존 isMine 로직과 통합).
// - 임세현@cnccosmetic.com 정확한 이메일이 확인되면 아래에 추가.
const FLAG_EMAILS = new Set<string>([
  'hdlee@cnccosmetic.com', // 이형도
  'shim@cnccosmetic.com',  // 임세현
]);
// 임세현 이름이 organizer displayName으로 보일 때도 잡기 위한 fallback (한글 이름 매치)
const FLAG_DISPLAY_NAMES = ['이형도', '임세현'];

// 회의실 예약 title을 면접 캘린더 표준 포맷으로 변환하는 헬퍼.
// 메모리 룰: feedback_interview_cal_summary_format — "HH:MM / 사이트 / 이름 / 부서팀(직무)" 컨벤션, 부서 누락 절대 금지.
// 입력 예시:
//   "영업관리팀 면접 - 박수지"        → { deptDisplay: "영업관리팀",        name: "박수지" }
//   "제조1팀 립제조 면접 - 어성철"     → { deptDisplay: "제조1팀(립제조)",   name: "어성철" }
//   "포장2팀 ERP파트 - 장성민"         → { deptDisplay: "포장2팀(ERP파트)",  name: "장성민" }
// dash 종류는 -, –, — 모두 허용. " - " 패턴 없으면 null (caller가 fallback).
function parseRoomBookingTitle(rawTitle: string): { deptDisplay: string; name: string } | null {
  const m = rawTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return null;
  const name = m[2].trim();
  let left = m[1].replace(/\s*면접\s*/g, ' ').trim();
  if (!name || !left) return null;
  const tokens = left.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const deptDisplay = tokens.length === 1
    ? tokens[0]
    : `${tokens[0]}(${tokens.slice(1).join(' ')})`;
  return { deptDisplay, name };
}

// room.shortName("퍼플 미팅룸-1 (9)" / "그린 소회의실 (20)" 등)에서 사이트 키워드 추출.
function extractSiteFromRoom(roomShortName: string): string {
  const SITES = ['퍼플', '그린', '수원', '방교', '위워크', '서울', '온라인'];
  return SITES.find((s) => roomShortName.includes(s)) || roomShortName.split(/\s+/)[0] || '';
}

// 회의실 예약 현황판 — 시간표 그리드 형식.
//
// 가로: 시간(08:00 ~ 22:00, 30분 슬롯 = 28칸)
// 세로: 회의실/차량 12개 (사이트별 그룹 헤더)
// 셀 안에 예약 블록을 분 단위 비례로 겹쳐 그림.
// 빈 영역 클릭 → 그 시간으로 prefill된 예약 모달.
// ← / → 버튼으로 다른 날짜 이동, 미래 예약도 자유롭게 확인.

const HOUR_START = 8;
const HOUR_END = 22; // 22:00까지 표시 (= 마지막 슬롯 끝)
const SLOT_MIN = 30;
const SLOT_WIDTH_PX = 48; // 30분 슬롯 너비
const ROW_HEIGHT_PX = 36;
const SLOT_COUNT = ((HOUR_END - HOUR_START) * 60) / SLOT_MIN; // 28
const TOTAL_WIDTH_PX = SLOT_COUNT * SLOT_WIDTH_PX;
const ROOM_COL_WIDTH_PX = 180;

// 사이트별 예약 블록 색 (배경/테두리/텍스트)
const SITE_COLORS: Record<RoomSite, { bg: string; border: string; text: string; bar: string }> = {
  purple: { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-900', bar: 'bg-indigo-500' },
  green: { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-900', bar: 'bg-emerald-500' },
  suwon: { bg: 'bg-sky-100', border: 'border-sky-300', text: 'text-sky-900', bar: 'bg-sky-500' },
  unknown: { bg: 'bg-slate-100', border: 'border-slate-300', text: 'text-slate-900', bar: 'bg-slate-500' },
};

interface InterviewEvt {
  id: string;
  startMin: number;
  endMin: number;
  startWall: string;
  endWall: string;
  summary: string;
  location: string;
  candidate: string;  // 후보자 이름
  team: string;       // 부서/팀
  htmlLink?: string;
}

interface RoomBooking {
  id: string;
  roomId: string;
  startMin: number; // 분 단위, 자정 0시 기준
  endMin: number;
  startWall: string; // "HH:MM"
  endWall: string;
  summary: string;
  description: string;     // 본문 — 면접자 이름이 description에만 있는 케이스 매칭용
  organizer: string;       // 표시용 person 이메일
  organizerName?: string;  // displayName (한글 이름)
  htmlLink?: string;
  isOwner: boolean;     // 본인이 진짜 만든 예약 (creator/organizer가 본인)
  isAttendee: boolean;  // 본인이 attendee로만 초대된 예약 (cncadmin 등이 만들고 본인 초대)
  isMine: boolean;      // isOwner || isAttendee — UI 표기·삭제 버튼 노출용
  isFlagged: boolean;   // FLAG_EMAILS/FLAG_DISPLAY_NAMES 매치 → 빨간 박스 강조
}

function isoToMinutes(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return parseInt(m[4], 10) * 60 + parseInt(m[5], 10);
}

function isoToWall(iso: string): { dt: string; tm: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return { dt: iso.slice(0, 10), tm: '' };
  return { dt: `${m[1]}-${m[2]}-${m[3]}`, tm: `${m[4]}:${m[5]}` };
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function strToDate(s: string): Date {
  return new Date(s + 'T00:00:00');
}

function addDays(s: string, n: number): string {
  const d = strToDate(s);
  d.setDate(d.getDate() + n);
  return dateToStr(d);
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function dayLabel(s: string, today: string): { main: string; sub: string; tone: string } {
  const d = strToDate(s);
  const dow = d.getDay();
  // 평일은 진한 검정, 일/토는 빨강/파랑으로 대비
  const tone = dow === 0 ? 'text-rose-600' : dow === 6 ? 'text-blue-600' : 'text-black';
  const delta = Math.round((d.getTime() - strToDate(today).getTime()) / 86400000);
  const sub = delta === 0 ? '오늘' : delta === 1 ? '내일' : delta === -1 ? '어제' : delta > 0 ? `D-${delta}` : `D+${-delta}`;
  return { main: `${d.getMonth() + 1}.${d.getDate()} (${DOW[dow]})`, sub, tone };
}

function snapToSlot(minutes: number): number {
  // 셀 클릭 시 슬롯 시작 분으로 스냅
  return Math.floor(minutes / SLOT_MIN) * SLOT_MIN;
}

function minsToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// 면접 이벤트의 summary/description에서 후보자 이름·팀 추출
// 패턴 예시:
//   "10:00 / 퍼플 / 박수지 / 영업관리팀"
//   "전략구매팀 면접 - 박준상(부자재)"
//   "박수현 / KPD2(PM) / 미팅룸1"
// description에 "후보자: X\n팀: Y" 패턴이 있으면 그걸 우선 사용.
function parseInterviewMeta(summary: string, description: string): { candidate: string; team: string } {
  const desc = description || '';
  const dCand = /후보자\s*:\s*([^\n]+)/.exec(desc);
  const dTeam = /(?:팀|부서|직무)\s*:\s*([^\n]+)/.exec(desc);
  if (dCand) {
    return { candidate: dCand[1].trim(), team: (dTeam?.[1] || '').trim() };
  }
  // summary 패턴 1: "팀명 면접 - 이름(메모)"
  const m1 = /^(.+?)\s*면접\s*-\s*([가-힣A-Za-z]{2,5})/.exec(summary);
  if (m1) return { candidate: m1[2].trim(), team: m1[1].trim() };
  // summary 패턴 2: "HH:MM / 사이트 / 이름 / 팀" — slash 분할
  const parts = summary.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    // 시간 토큰 제거, 한글 이름으로 보이는 토큰 찾기
    const nameIdx = parts.findIndex((p) => /^[가-힣]{2,5}$/.test(p));
    if (nameIdx >= 0) {
      const team = parts[nameIdx + 1] || parts.slice(nameIdx + 1).join(' ') || '';
      return { candidate: parts[nameIdx], team };
    }
  }
  return { candidate: summary, team: '' };
}

export function MeetingRooms() {
  const today = useMemo(() => dateToStr(new Date()), []);
  const [date, setDate] = useState<string>(today);
  const [rooms, setRooms] = useState<RoomMeta[]>([]);
  const [bookings, setBookings] = useState<Map<string, RoomBooking[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [creating, setCreating] = useState<{ roomId: string | null; startMin: number; endMin: number } | null>(null);
  const [splitting, setSplitting] = useState<RoomBooking | null>(null);
  const [siteFilter, setSiteFilter] = useState<RoomSite | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  // 면접 캘린더에서 가져온 오늘 날짜 이벤트 (면접자 회의실 예약 현황 박스에 사용)
  const [interviewEvents, setInterviewEvents] = useState<InterviewEvt[]>([]);

  // 로그인된 사용자 이메일 — 본인 예약 판정에 사용
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.google.status();
        if (!cancelled && r.ok && r.data?.profile?.email) setMyEmail(r.data.profile.email);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // 현재 시각 인디케이터 (오늘 view에서만 표시) — 1분마다 갱신
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // 회의실 메타 로드 (한 번)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.google.listCalendarsFull();
        if (cancelled) return;
        if (!r.ok || !r.data) {
          setError(r.error || '캘린더 목록을 불러오지 못했습니다.');
          return;
        }
        const meta: RoomMeta[] = [];
        for (const e of r.data) {
          const m = classifyResourceCalendar(e as GCalListEntry);
          if (m) meta.push(m);
        }
        meta.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'room' ? -1 : 1;
          return a.label.localeCompare(b.label, 'ko');
        });
        setRooms(meta);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshBookings = useCallback(async () => {
    if (rooms.length === 0) return;
    setLoading(true);
    try {
      const dayStart = `${date}T00:00:00+09:00`;
      const dayEnd = `${date}T23:59:59+09:00`;
      // 회의실 fetch와 병행: 면접 메인 + 보조(임세현 owner) 캘린더 둘 다 가져와 dedup.
      const interviewFetch = Promise.all([
        api.google.listCalendar(dayStart, dayEnd, SHARED_CAL.interview).catch(() => ({ ok: false } as const)),
        api.google.listCalendar(dayStart, dayEnd, SHARED_CAL.interviewAlt).catch(() => ({ ok: false } as const)),
      ]).then((results) => {
        const merged: GCalEvent[] = [];
        const seen = new Set<string>();
        for (const er of results) {
          if (!er.ok || !('data' in er) || !er.data) continue;
          for (const ev of er.data as GCalEvent[]) {
            if (!ev.id || seen.has(ev.id)) continue;
            seen.add(ev.id);
            merged.push(ev);
          }
        }
        return merged
          .filter((e) => e.start && !e.allDay && isoToWall(e.start).dt === date)
          .map((e): InterviewEvt => {
            const sMin = isoToMinutes(e.start) ?? 0;
            const eMin = isoToMinutes(e.end) ?? sMin + 30;
            const meta = parseInterviewMeta(e.summary || '', e.description || '');
            return {
              id: e.id,
              startMin: sMin,
              endMin: eMin,
              startWall: minsToHHMM(sMin),
              endWall: minsToHHMM(eMin),
              summary: e.summary || '(제목 없음)',
              location: e.location || '',
              candidate: meta.candidate,
              team: meta.team,
              htmlLink: e.htmlLink,
            };
          })
          .sort((a, b) => a.startMin - b.startMin);
      });
      const results = await Promise.all(
        rooms.map(async (r): Promise<[string, RoomBooking[]]> => {
          try {
            const er = await api.google.listCalendar(dayStart, dayEnd, r.id);
            if (!er.ok || !er.data) return [r.id, []];
            const list: RoomBooking[] = (er.data as GCalEvent[])
              .filter((e) => e.start && !e.allDay && isoToWall(e.start).dt === date)
              // 회의실 attendee responseStatus가 declined면 그 슬롯은 회의실 안 잡힘 → 그리드에서도 숨김
              // (기존엔 잔재 표시되어 통 booking과 시각 중복 발생: 5/19 손유민 declined 사고)
              .filter((e) => {
                const ras = (e.attendees || []).find((a) => {
                  const em = (a as { email?: string }).email;
                  return em && em.toLowerCase() === r.id.toLowerCase();
                });
                return !ras || (ras as { responseStatus?: string }).responseStatus !== 'declined';
              })
              .map((e) => {
                const sMin = isoToMinutes(e.start) ?? 0;
                const rawEMin = isoToMinutes(e.end) ?? sMin + 30;
                // 익일까지 이어지는 booking (예: 5/19 00:00 → 5/20 00:00 같은 24h 점유)은
                // isoToMinutes가 다음 날의 00:00을 그냥 0분으로 환산하여 endMin=0 → 박스 길이 0 → 빈 칸으로 보이는 버그.
                // start.dt < end.dt 이면 24:00 (1440분)으로 clamp하여 그리드 끝까지 막대 표시.
                const sDt = isoToWall(e.start).dt;
                const eDt = isoToWall(e.end).dt;
                const eMin = eDt > sDt ? 24 * 60 : rawEMin;
                // 진짜 예약자(person) 추출 — 회의실 캘린더 이벤트의 organizer/creator는 보통
                //   · 회의실 자체(*@resource.calendar.google.com)
                //   · 면접/입사 공유 캘린더(*@group.calendar.google.com)
                //   · cncadmin@ (일괄 등록 봇)
                // 어느 쪽도 진짜 사람이 아니라, 캘 도메인은 모두 제외하고 attendees → organizer → creator 순으로 fallback.
                const isCalendarLikeEmail = (s?: string) =>
                  !!s && /\.calendar\.google\.com$/i.test(s);
                type ExtAttendee = { email?: string; resource?: boolean; displayName?: string };
                type ExtOrganizer = { email?: string; displayName?: string };
                const attendeesExt: ExtAttendee[] = (e.attendees || []) as unknown as ExtAttendee[];
                const orgExt = (e.organizer || undefined) as unknown as ExtOrganizer | undefined;
                const personAttendee = attendeesExt.find(
                  (a) => a.email && !a.resource && !isCalendarLikeEmail(a.email)
                );
                const orgIsPerson = !!orgExt?.email && !isCalendarLikeEmail(orgExt.email);
                const creatorIsPerson = !!e.creator?.email && !isCalendarLikeEmail(e.creator.email);
                const personOrganizerEmail =
                  personAttendee?.email ||
                  (orgIsPerson ? orgExt!.email! : '') ||
                  (creatorIsPerson ? e.creator!.email! : '');
                const personOrganizerName =
                  personAttendee?.displayName ||
                  (orgExt?.displayName && orgIsPerson ? orgExt.displayName : undefined);
                // isOwner: 본인이 진짜 만든 사람 (events.delete 가능)
                // isAttendee: 본인이 attendee로만 초대된 케이스 (declined 처리만 가능)
                const isOwner = !!myEmail &&
                  ((e.creator?.email === myEmail) || (orgIsPerson && orgExt!.email === myEmail));
                const isAttendee = !!myEmail && !isOwner && attendeesExt.some((a) => a.email === myEmail);
                const isMine = isOwner || isAttendee;
                const flagByEmail = FLAG_EMAILS.has((personOrganizerEmail || '').toLowerCase());
                const flagByName = !!personOrganizerName && FLAG_DISPLAY_NAMES.some((n) => personOrganizerName.includes(n));
                const isFlagged = isMine || flagByEmail || flagByName;
                return {
                  id: e.id,
                  roomId: r.id,
                  startMin: sMin,
                  endMin: eMin,
                  startWall: minsToHHMM(sMin),
                  endWall: minsToHHMM(eMin),
                  summary: e.summary || '(제목 없음)',
                  description: e.description || '',
                  organizer: personOrganizerEmail,
                  organizerName: personOrganizerName,
                  htmlLink: e.htmlLink,
                  isOwner,
                  isAttendee,
                  isMine,
                  isFlagged,
                };
              })
              .sort((a, b) => a.startMin - b.startMin);
            return [r.id, list];
          } catch {
            return [r.id, []];
          }
        })
      );
      setBookings(new Map(results));
      const iv = await interviewFetch;
      setInterviewEvents(iv);
      setFetchedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [rooms, date, myEmail]);

  useEffect(() => {
    void refreshBookings();
    const t = setInterval(() => void refreshBookings(), 60_000);
    return () => clearInterval(t);
  }, [refreshBookings]);

  // 키보드 ← / → 로 날짜 이동
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === 'ArrowLeft') setDate((d) => addDays(d, -1));
      else if (ev.key === 'ArrowRight') setDate((d) => addDays(d, 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const visibleRooms = useMemo(
    () => rooms.filter((r) => !siteFilter || r.site === siteFilter),
    [rooms, siteFilter]
  );

  // 사이트별 그룹핑 (그리드에서도 사이트 헤더 행)
  const groupedRooms = useMemo(() => {
    const map = new Map<RoomSite, RoomMeta[]>();
    for (const r of visibleRooms) {
      if (!map.has(r.site)) map.set(r.site, []);
      map.get(r.site)!.push(r);
    }
    return Array.from(map.entries());
  }, [visibleRooms]);

  const labelInfo = dayLabel(date, today);
  const todayBookingCount = useMemo(() => {
    let n = 0;
    for (const list of bookings.values()) n += list.length;
    return n;
  }, [bookings]);

  // 현재 시각 인디케이터 (오늘 view에서)
  const nowMin = useMemo(() => {
    void nowTick; // re-eval each tick
    const d = new Date();
    if (dateToStr(d) !== date) return null;
    return d.getHours() * 60 + d.getMinutes();
  }, [date, nowTick]);

  const handleCellClick = (roomId: string, startMin: number) => {
    setCreating({ roomId, startMin, endMin: startMin + 60 });
  };

  // 회의실 예약 삭제.
  // - isOwner(본인이 만든 것): events.delete로 모든 참가자/회의실 캘에서 완전 삭제 시도
  //   순서: 회의실 캘 → primary (둘 다 같은 eventId 공유하지만 권한 다름)
  // - isAttendee only (cncadmin 등이 만들고 본인 초대): events.delete는 권한 부족으로 실패하므로
  //   updateCalEvent로 본인 attendee 응답을 "declined"로 패치 → 본인 캘린더에서 사라짐
  const handleDelete = useCallback(async (booking: RoomBooking) => {
    if (!booking.isMine) return;
    if (!myEmail) {
      alert('내 이메일을 알 수 없어 삭제 권한을 판정할 수 없습니다.');
      return;
    }

    if (booking.isOwner) {
      const ok = window.confirm(
        `이 예약을 구글 캘린더에서 삭제하시겠어요?\n\n${booking.startWall}~${booking.endWall}\n${booking.summary}\n\n취소할 수 없습니다.`
      );
      if (!ok) return;
      try {
        const r1 = await api.google.deleteCalEvent(booking.roomId, booking.id, 'all');
        const r2 = r1.ok ? null : await api.google.deleteCalEvent('primary', booking.id, 'all');
        // 두 시도 모두 ok=false여도 실제로는 사라진 케이스가 있어 polling으로 검증한 뒤에만 alert.
        await refreshBookings();
        if (!r1.ok && r2 && !r2.ok) {
          const stillThere = (bookings.get(booking.roomId) || []).some((b) => b.id === booking.id);
          if (stillThere) {
            alert(`삭제 실패: ${r2.error || r1.error || '권한 부족'}\n\n구글 캘린더에서 직접 삭제해 주세요.`);
          }
        }
      } catch (e: unknown) {
        alert(`삭제 중 오류: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    // attendee only — 완전 삭제는 권한 부족이라 거절(declined) 처리만 가능
    const ok = window.confirm(
      `이 예약은 다른 사람(${booking.organizerName || booking.organizer || '주최자'})이 만든 일정이라 완전 삭제는 권한 부족이에요.\n\n대신 "참석 거절(declined)" 처리해서 내 캘린더에서 제거할까요?\n(회의실 캘 자체에는 그대로 남고, 주최자에게 거절 통지가 갑니다)\n\n${booking.startWall}~${booking.endWall}\n${booking.summary}`
    );
    if (!ok) return;
    try {
      const r1 = await api.google.updateCalEvent(
        booking.roomId,
        booking.id,
        { attendees: [{ email: myEmail, responseStatus: 'declined' }] },
        'all'
      );
      const r2 = r1.ok ? null : await api.google.updateCalEvent(
        'primary',
        booking.id,
        { attendees: [{ email: myEmail, responseStatus: 'declined' }] },
        'all'
      );
      // polling 후 진짜 반영됐는지 검증한 뒤에만 alert.
      await refreshBookings();
      if (!r1.ok && r2 && !r2.ok) {
        const stillThere = (bookings.get(booking.roomId) || []).some((b) => b.id === booking.id);
        if (stillThere) {
          alert(`거절 처리 실패: ${r2.error || r1.error || '권한 부족'}\n\n구글 캘린더에서 직접 응답해 주세요.`);
        }
      }
    } catch (e: unknown) {
      alert(`처리 중 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refreshBookings, myEmail, bookings]);

  return (
    <div className="space-y-3">
      {/* 날짜 헤더 + 액션 */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="px-2.5 py-1.5 rounded-md text-lg font-black leading-none bg-white border border-slate-300 text-slate-900 hover:bg-slate-100"
          title="이전 날 (←)"
        >
          ‹
        </button>
        <div className="flex items-center gap-2 px-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-2 py-1 rounded-md border border-slate-300 bg-white text-black text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
          />
          <div className="flex items-baseline gap-1.5">
            <span className={`text-xl font-black tabular-nums tracking-tight ${labelInfo.tone}`}>{labelInfo.main}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${date === today ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {labelInfo.sub}
            </span>
          </div>
        </div>
        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          className="px-2.5 py-1.5 rounded-md text-lg font-black leading-none bg-white border border-slate-300 text-slate-900 hover:bg-slate-100"
          title="다음 날 (→)"
        >
          ›
        </button>
        <button
          onClick={() => setDate(today)}
          disabled={date === today}
          className="px-3 py-1.5 rounded-full text-xs font-bold border bg-white text-black border-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          오늘
        </button>

        <span className="ml-2 text-xs font-semibold text-slate-800">
          이 날 예약 <b className="text-black">{todayBookingCount}</b>건
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setCreating({ roomId: null, startMin: 10 * 60, endMin: 11 * 60 })}
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
          >
            + 새 예약
          </button>
          <button
            onClick={() => void refreshBookings()}
            disabled={loading}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
            title="즉시 새로고침"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span>
          </button>
        </div>
      </div>

      {/* 필터 */}
      <div className="card p-2 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-500 px-1">사이트</span>
        <SiteFilterPill active={siteFilter === null} onClick={() => setSiteFilter(null)}>전체</SiteFilterPill>
        {SITE_LIST.map((s) => (
          <SiteFilterPill key={s} active={siteFilter === s} onClick={() => setSiteFilter(s)}>
            {siteLabel(s)}
          </SiteFilterPill>
        ))}
        <span className="ml-auto text-[10px] text-slate-400">
          ← / → 키로 날짜 이동 · {fetchedAt ? `${fetchedAt.toLocaleTimeString()}` : '대기'} · 60초 자동
        </span>
      </div>

      {error && (
        <div className="card p-3 bg-rose-50 border border-rose-200 text-rose-800 text-sm">{error}</div>
      )}

      {/* 시간표 그리드 */}
      {rooms.length === 0 && !loading && !error ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-2 opacity-40">🚪</div>
          <div className="text-sm text-slate-400">분류된 회의실/차량 캘린더가 없습니다.</div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-260px)]">
            <div style={{ width: ROOM_COL_WIDTH_PX + TOTAL_WIDTH_PX, minWidth: '100%' }}>
              {/* 시간 헤더 */}
              <div className="sticky top-0 z-20 bg-white border-b border-slate-200 flex">
                <div
                  className="shrink-0 bg-slate-50 border-r border-slate-200 px-3 py-2 text-xs font-bold text-slate-500"
                  style={{ width: ROOM_COL_WIDTH_PX }}
                >
                  회의실 / 차량
                </div>
                <div className="flex" style={{ width: TOTAL_WIDTH_PX }}>
                  {Array.from({ length: SLOT_COUNT }, (_, i) => {
                    const startMin = HOUR_START * 60 + i * SLOT_MIN;
                    const isHour = startMin % 60 === 0;
                    return (
                      <div
                        key={i}
                        className={`shrink-0 text-[10px] py-2 text-center border-r ${
                          isHour ? 'border-slate-300 text-slate-700 font-bold bg-slate-50' : 'border-slate-100 text-slate-400'
                        }`}
                        style={{ width: SLOT_WIDTH_PX }}
                      >
                        {isHour ? minsToHHMM(startMin) : ''}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 회의실 행들 — 사이트별 그룹 헤더 + 행 */}
              {groupedRooms.map(([site, list]) => (
                <div key={site}>
                  <div
                    className="sticky left-0 z-10 bg-slate-100 border-b border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 flex items-center gap-2"
                    style={{ width: ROOM_COL_WIDTH_PX + TOTAL_WIDTH_PX }}
                  >
                    <span>{siteLabel(site)}</span>
                    <span className="text-[10px] font-normal text-slate-400">{list.length}개</span>
                  </div>
                  {list.map((r) => {
                    const list = bookings.get(r.id) || [];
                    const colors = SITE_COLORS[r.site];
                    // 표시 윈도우(8:00~22:00) 밖에 있는 이벤트 카운트 — 차량처럼 종일/새벽 예약은
                    // 그리드에서 안 보일 수 있어 row 헤더에 배지로 알려준다.
                    const dayStartMin = HOUR_START * 60;
                    const dayEndMin = HOUR_END * 60;
                    const offWindow = list.filter((b) => b.endMin <= dayStartMin || b.startMin >= dayEndMin);
                    return (
                      <div key={r.id} className="flex border-b border-slate-100 hover:bg-slate-50/50" style={{ height: ROW_HEIGHT_PX }}>
                        {/* 회의실 이름 (sticky left) */}
                        <div
                          className="sticky left-0 z-10 bg-white shrink-0 border-r border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-800 truncate flex items-center gap-1"
                          style={{ width: ROOM_COL_WIDTH_PX }}
                          title={r.label}
                        >
                          <span className="text-xs">{r.kind === 'car' ? '🚗' : '🏢'}</span>
                          <span className="truncate">{r.shortName}</span>
                          {offWindow.length > 0 && (
                            <span
                              className="ml-auto shrink-0 px-1 py-0.5 rounded-full text-[9px] font-bold bg-amber-200 text-amber-900 border border-amber-300"
                              title={
                                `이 그리드(${HOUR_START}:00~${HOUR_END}:00) 밖 예약 ${offWindow.length}건:\n` +
                                offWindow.map((b) => `· ${b.startWall}~${b.endWall} ${b.summary}`).join('\n')
                              }
                            >
                              ⏰ {offWindow.length}
                            </span>
                          )}
                        </div>
                        {/* 슬롯 영역 — relative로 두고 booking 절대 위치 */}
                        <div
                          className="relative shrink-0"
                          style={{ width: TOTAL_WIDTH_PX, height: ROW_HEIGHT_PX }}
                        >
                          {/* 셀 배경 (30분 그리드선) */}
                          <div className="absolute inset-0 flex">
                            {Array.from({ length: SLOT_COUNT }, (_, i) => {
                              const slotMin = HOUR_START * 60 + i * SLOT_MIN;
                              const isHour = slotMin % 60 === 0;
                              return (
                                <button
                                  key={i}
                                  onClick={() => handleCellClick(r.id, slotMin)}
                                  className={`shrink-0 hover:bg-indigo-50/60 transition-colors border-r ${
                                    isHour ? 'border-slate-200' : 'border-slate-100'
                                  }`}
                                  style={{ width: SLOT_WIDTH_PX, height: ROW_HEIGHT_PX }}
                                  title={`${r.shortName} · ${minsToHHMM(slotMin)} 부터 예약`}
                                />
                              );
                            })}
                          </div>
                          {/* 예약 블록 */}
                          {list.map((b) => {
                            // 시간 윈도우 밖이면 클램프
                            const dayStartMin = HOUR_START * 60;
                            const dayEndMin = HOUR_END * 60;
                            const s = Math.max(b.startMin, dayStartMin);
                            const e = Math.min(b.endMin, dayEndMin);
                            if (e <= s) return null;
                            const left = ((s - dayStartMin) / SLOT_MIN) * SLOT_WIDTH_PX;
                            const width = ((e - s) / SLOT_MIN) * SLOT_WIDTH_PX;
                            // 폭에 따라 단계적 표시: 좁으면 짧은 시간만, 넓으면 제목/예약자까지
                            const veryNarrow = width < 56;  // 30분 블록 = 48px
                            const narrow = width < 100;     // ~1시간 미만
                            const wide = width >= 140;      // 1.5시간 이상
                            const timeText = veryNarrow ? b.startWall : `${b.startWall}~${b.endWall}`;
                            // sub-segment 시각화는 비활성화 — 2026-05-15 사고
                            // location 텍스트 매칭이 false-positive를 계속 만들어 회의실 예약 그리드에 잘못된 보라색 overlay 발생.
                            // 분할 정보는 면접 캘린더 view (CalendarPage)에서 충분히 보이므로 회의실 그리드는 순수 room booking만 표시.
                            const subSegs: InterviewEvt[] = [];
                            // 이형도/임세현/본인 예약은 빨간 박스로 강조
                            const flagged = b.isFlagged;
                            const bgCls = flagged ? 'bg-rose-50' : colors.bg;
                            const textCls = flagged ? 'text-rose-900' : colors.text;
                            const borderCls = flagged
                              ? 'border-rose-500 border-2 ring-1 ring-rose-300'
                              : `${colors.border} border-l-2 ${colors.bar.replace('bg-', 'border-l-')} border`;
                            const ownerLabel = b.organizerName || b.organizer;
                            return (
                              <div
                                key={b.id}
                                role="button"
                                tabIndex={0}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  if (b.htmlLink) window.open(b.htmlLink, '_blank', 'noopener,noreferrer');
                                }}
                                className={`group absolute top-0.5 bottom-0.5 ${bgCls} ${textCls} ${borderCls} rounded-md px-1.5 py-0.5 overflow-hidden shadow-sm hover:shadow-md hover:brightness-95 hover:z-10 transition-all flex flex-col justify-center leading-[1.1] cursor-pointer`}
                                style={{ left: left + 1, width: Math.max(width - 2, 14) }}
                                title={`${b.startWall}~${b.endWall} · ${b.summary}${ownerLabel ? ' · ' + ownerLabel : ''}${b.isMine ? ' · (내 예약)' : flagged ? ' · (강조 예약)' : ''}\n클릭: 구글 캘린더에서 열기${b.isMine ? '\n× 버튼: 삭제' : ''}`}
                              >
                                <div className="font-mono font-bold text-[10px] tabular-nums whitespace-nowrap">
                                  {flagged && <span className="text-rose-600 mr-0.5">●</span>}
                                  {timeText}
                                </div>
                                {!narrow && (
                                  <div className="truncate font-semibold text-[11px]">{b.summary}</div>
                                )}
                                {wide && b.organizer && (
                                  <div className="truncate text-[9px] opacity-70">{b.organizer.split('@')[0]}</div>
                                )}
                                {/* 분할 시각화 — 면접 캘린더에 sub-segment가 있으면 vertical divider + 라벨 */}
                                {subSegs.length > 0 && (
                                  <div className="absolute inset-0 pointer-events-none">
                                    {subSegs.map((iv) => {
                                      const segLeft = ((iv.startMin - b.startMin) / (b.endMin - b.startMin)) * 100;
                                      const segWidth = ((iv.endMin - iv.startMin) / (b.endMin - b.startMin)) * 100;
                                      return (
                                        <div
                                          key={iv.id}
                                          className="absolute top-0 bottom-0 border-l-2 border-r-2 border-violet-700/80 bg-violet-700/20 flex flex-col items-center justify-center text-[8px] font-bold text-violet-900 leading-tight overflow-hidden"
                                          style={{ left: `${segLeft}%`, width: `${segWidth}%` }}
                                          title={`✂ 분할: ${iv.startWall}~${iv.endWall} · ${iv.candidate || iv.summary}`}
                                        >
                                          <span className="truncate w-full text-center px-0.5">{iv.candidate || '?'}</span>
                                          <span className="font-mono text-[7px] opacity-80">{iv.startWall}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {b.isMine && (
                                  <>
                                    <button
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        setSplitting(b);
                                      }}
                                      className="absolute top-0.5 right-5 h-4 px-1 rounded-full text-white text-[9px] font-black leading-none flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity z-30 bg-violet-600 hover:bg-violet-700"
                                      title={`이 슬롯을 N개 면접으로 분할 등록 (회의실은 이 예약 그대로 유지, 면접 캘린더에만 N건 추가)`}
                                    >
                                      ✂ 분할
                                    </button>
                                    <button
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        void handleDelete(b);
                                      }}
                                      className={`absolute top-0.5 right-0.5 w-4 h-4 rounded-full text-white text-[10px] font-black leading-none flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity z-30 ${
                                        b.isOwner ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-500 hover:bg-amber-600'
                                      }`}
                                      title={
                                        b.isOwner
                                          ? '이 예약을 구글 캘린더에서 완전 삭제'
                                          : `다른 사람이 만든 일정 — "참석 거절"로 내 캘린더에서만 제거`
                                      }
                                    >
                                      ×
                                    </button>
                                  </>
                                )}
                              </div>
                            );
                          })}
                          {/* 현재 시각 인디케이터 */}
                          {nowMin !== null && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60 && (
                            <div
                              className="absolute top-0 bottom-0 w-px bg-rose-500 pointer-events-none z-20"
                              style={{ left: ((nowMin - HOUR_START * 60) / SLOT_MIN) * SLOT_WIDTH_PX }}
                            >
                              <div className="absolute -top-0.5 -left-1 w-2 h-2 rounded-full bg-rose-500" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="px-3 py-1.5 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 flex items-center gap-3">
            <span>빈 칸 = 예약 · 블록 클릭 = 구글 캘린더 열기 · 호버 ×: 빨강=내 예약 삭제, 주황=초대 거절</span>
            <span className="ml-auto">표시 범위 {HOUR_START}:00 – {HOUR_END}:00 · 30분 단위</span>
          </div>
        </div>
      )}

      {/* 면접자 회의실 예약 현황 — 면접 캘린더와 위 회의실 예약을 매칭 */}
      <InterviewBookingsCard
        date={date}
        today={today}
        interviewEvents={interviewEvents}
        bookings={bookings}
        rooms={rooms}
      />

      {creating && (
        <NewBookingModal
          rooms={rooms}
          initialDate={date}
          initialRoomId={creating.roomId}
          initialStartMin={creating.startMin}
          initialEndMin={creating.endMin}
          onClose={() => setCreating(null)}
          onCreated={async () => {
            setCreating(null);
            await refreshBookings();
          }}
        />
      )}

      {splitting && (
        <SplitInterviewModal
          booking={splitting}
          date={date}
          room={rooms.find((r) => r.id === splitting.roomId) || null}
          onClose={() => setSplitting(null)}
          onCreated={async () => {
            setSplitting(null);
            await refreshBookings();
          }}
        />
      )}
    </div>
  );
}

// 면접자 회의실 예약 현황 카드.
// 면접 캘린더의 오늘 일정과 회의실 예약을 비교해 매칭/미매칭 표시.
function InterviewBookingsCard({
  date,
  today,
  interviewEvents,
  bookings,
  rooms,
}: {
  date: string;
  today: string;
  interviewEvents: InterviewEvt[];
  bookings: Map<string, RoomBooking[]>;
  rooms: RoomMeta[];
}) {
  const labelInfo = dayLabel(date, today);
  const roomById = useMemo(() => {
    const m = new Map<string, RoomMeta>();
    for (const r of rooms) m.set(r.id, r);
    return m;
  }, [rooms]);

  // 각 면접에 대해 매칭되는 회의실 예약을 찾는다.
  // 우선순위:
  //   (1) byName  : 회의실 예약 summary/description에 후보자 이름 포함 — 가장 신뢰 ↑
  //   (2) byLoc   : 면접 location 텍스트가 회의실명(token 1개 이상) 포함 — 사람이 직접 지정
  //   (3) "면접" 키워드 + 동시간대만으로는 매칭하지 않음 (동시간 다중 매칭 false-positive 방지)
  // byName이 하나라도 잡히면 byLoc는 무시. 둘 다 없으면 textOnlyHint로 안내.
  const ROOM_KEYWORDS = /회의실|카페테리아|미팅룸|대회의|소회의|VIP|구내식당|로비|라운지|식당/;
  // location 텍스트와 회의실명을 토큰 단위로 비교 — 한글/숫자/특수문자 기준 분리
  const tokenize = (s: string): string[] =>
    s.replace(/[()\[\]_/\\\-,.]/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  const rows = useMemo(() => {
    return interviewEvents.map((iv) => {
      const byName: { room: RoomMeta; booking: RoomBooking }[] = [];
      const byLoc: { room: RoomMeta; booking: RoomBooking }[] = [];
      for (const [roomId, list] of bookings) {
        const room = roomById.get(roomId);
        if (!room) continue;
        for (const b of list) {
          const overlap = b.startMin < iv.endMin && b.endMin > iv.startMin;
          if (!overlap) continue;
          // (1) byName — summary OR description에 후보자 이름 포함
          if (iv.candidate && (b.summary.includes(iv.candidate) || b.description.includes(iv.candidate))) {
            byName.push({ room, booking: b });
            continue;
          }
          // (2) byLoc — 면접 location의 토큰 중 회의실명 토큰과 2글자 이상 매칭되는 것 있는지
          if (iv.location) {
            const locTokens = tokenize(iv.location);
            const roomTokens = tokenize(`${room.shortName} ${room.rawSummary}`);
            const hit = locTokens.some((lt) => roomTokens.some((rt) => lt.includes(rt) || rt.includes(lt)));
            if (hit) byLoc.push({ room, booking: b });
          }
        }
      }
      const matches = byName.length > 0 ? byName : byLoc;
      // 회의실 캘에 매칭 안 됐을 때, 면접 summary/location 텍스트에 회의실 키워드 있으면 안내용 텍스트
      const textOnlyHint = matches.length === 0 && (
        ROOM_KEYWORDS.test(iv.summary) || ROOM_KEYWORDS.test(iv.location)
      )
        ? (iv.location || iv.summary).trim()
        : null;
      return { iv, matches, textOnlyHint };
    });
  }, [interviewEvents, bookings, roomById]);

  return (
    <div className="card overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <span className="text-sm font-bold text-slate-800">📋 면접자 회의실 예약 현황</span>
        <span className="text-[11px] text-slate-500">{labelInfo.main} · 면접 {interviewEvents.length}건</span>
        <span className="ml-auto text-[10px] text-slate-400">면접 캘린더 ↔ 회의실 예약 매칭</span>
      </div>
      {interviewEvents.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">
          이 날 면접 캘린더에 등록된 면접이 없습니다.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
          {rows.map(({ iv, matches, textOnlyHint }) => {
            const matched = matches.length > 0;
            return (
              <div key={iv.id} className="px-3 py-2 flex items-start gap-3 hover:bg-slate-50">
                <div className="shrink-0 w-20">
                  <div className="text-[13px] font-mono font-bold tabular-nums text-slate-900">
                    {iv.startWall}
                  </div>
                  <div className="text-[10px] text-slate-400">~{iv.endWall}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[14px] font-bold text-slate-900">{iv.candidate}</span>
                    {iv.team && (
                      <span className="text-[11px] text-slate-500">· {iv.team}</span>
                    )}
                    <a
                      href={iv.htmlLink || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-indigo-600 hover:underline ml-auto"
                    >
                      면접 일정 열기 ↗
                    </a>
                  </div>
                  {iv.location && (
                    <div className="text-[11px] text-slate-500 mt-0.5">📍 캘린더 location: {iv.location}</div>
                  )}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {matched ? (
                      <>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
                          🚪 회의실 예약됨 · {matches.length}건
                        </span>
                        {matches.map((m) => (
                          <a
                            key={m.booking.id}
                            href={m.booking.htmlLink || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                              m.booking.isFlagged
                                ? 'bg-rose-50 border-rose-400 text-rose-800'
                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                            }`}
                            title={`${m.booking.startWall}~${m.booking.endWall} · ${m.booking.summary}${m.booking.organizerName || m.booking.organizer ? ' · ' + (m.booking.organizerName || m.booking.organizer) : ''}`}
                          >
                            {m.room.kind === 'car' ? '🚗' : '🏢'} {m.room.shortName}
                            <span className="text-slate-400 ml-1 font-mono">
                              {m.booking.startWall}
                            </span>
                          </a>
                        ))}
                      </>
                    ) : textOnlyHint ? (
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-900 border border-yellow-400"
                        title={`면접 일정에 회의실/장소가 텍스트로 명시되어 있지만, 회의실 캘린더에 별도 예약이 등록되지 않았습니다.\n명시된 텍스트: ${textOnlyHint}`}
                      >
                        🟡 텍스트 명시 ({textOnlyHint.length > 18 ? textOnlyHint.slice(0, 18) + '…' : textOnlyHint})
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                        ⚠️ 회의실 예약 미발견
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500">
        🟢 매칭 = 회의실 예약 summary에 후보자 이름 포함 우선, 없으면 location 텍스트 매칭 · 🟡 = 면접에 회의실 텍스트만 있고 실제 예약 없음 · 60초 자동
      </div>
    </div>
  );
}

function SiteFilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function NewBookingModal({
  rooms,
  initialDate,
  initialRoomId,
  initialStartMin,
  initialEndMin,
  onClose,
  onCreated,
}: {
  rooms: RoomMeta[];
  initialDate: string;
  initialRoomId: string | null;
  initialStartMin: number;
  initialEndMin: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [roomId, setRoomId] = useState<string>(initialRoomId || (rooms[0]?.id ?? ''));
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(minsToHHMM(snapToSlot(initialStartMin)));
  const [end, setEnd] = useState(minsToHHMM(snapToSlot(initialEndMin)));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  // 면접 캘린더 동시 등록 — 제목에 "면접" 들어가면 자동 ON.
  // "면접" 없는데 사용자가 수동으로 켜려 하면 confirm 한 번 띄워서 오동작 방지
  // (산업안전/일자리센터 등 비-면접 오염 방지). 장성민 같은 진짜 면접(직무명만 쓴 케이스)은
  // 사용자가 confirm 통과시켜 등록 가능.
  // 단, 차량(kind='car') 예약은 면접이 아니므로 면접 캘린더 등록을 처음부터 차단.
  const selectedRoom = rooms.find((r) => r.id === roomId) || null;
  const isCarBooking = selectedRoom?.kind === 'car';
  const titleHasInterview = /면접/.test(title) && !isCarBooking;
  const [alsoInterview, setAlsoInterview] = useState(false);
  useEffect(() => {
    if (isCarBooking) { setAlsoInterview(false); return; }
    setAlsoInterview(titleHasInterview);
  }, [titleHasInterview, isCarBooking]);
  const handleAlsoInterviewToggle = (checked: boolean) => {
    if (isCarBooking) {
      // 차량 예약은 절대 면접 캘린더로 가지 않음 — "안성 채용박람회 참석"이 면접으로 잡혔던 사고 차단
      alert('🚗 차량 예약은 면접이 아니므로 면접 캘린더에 등록할 수 없습니다.');
      return;
    }
    if (checked && !titleHasInterview) {
      const ok = window.confirm(
        `제목에 "면접" 단어가 없습니다.\n\n현재 제목: "${title || '(없음)'}"\n\n정말 면접 일정이 맞나요?\n` +
        `→ 예: 직무명만 쓴 진짜 면접 (예: "포장2팀 ERP파트 - 장성민") → 확인\n` +
        `→ 아니오: 산업안전/일자리센터/대기실 등 비-면접 → 취소`
      );
      if (!ok) return;
    }
    setAlsoInterview(checked);
  };
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // 모달 mount 직후엔 outside DOM 클릭/포커스 stealing과 경합이 있어
    // 한 틱 뒤 강제로 포커스 — 한글 IME 사용 시도 안정적으로 잡힘.
    const t = window.setTimeout(() => titleRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  const room = rooms.find((r) => r.id === roomId) || null;

  const handleSubmit = async () => {
    console.log('[MeetingRooms] 예약하기 클릭', { room: room?.shortName, date, start, end, title });
    if (!room) { setErr('회의실을 선택해 주세요.'); return; }
    if (!title.trim()) { setErr('제목을 입력해 주세요.'); return; }
    if (!date || !start || !end) { setErr('날짜와 시간을 입력해 주세요.'); return; }
    if (start >= end) { setErr('종료 시간은 시작 시간 이후여야 합니다.'); return; }
    setErr(null);
    setSubmitting(true);
    try {
      const body = {
        summary: title.trim(),
        description: note.trim() || undefined,
        location: room.shortName,
        start: { dateTime: `${date}T${start}:00`, timeZone: 'Asia/Seoul' },
        end: { dateTime: `${date}T${end}:00`, timeZone: 'Asia/Seoul' },
        attendees: [{ email: room.resourceEmail }],
      };
      console.log('[MeetingRooms] insertCalEvent 호출', body);
      const r = await api.google.insertCalEvent('primary', body, 'all');
      console.log('[MeetingRooms] insertCalEvent 응답', r);
      if (!r.ok) {
        setErr(r.error || '예약에 실패했습니다. (응답 ok=false, error 없음)');
        return;
      }
      // 면접 캘린더에도 동시 등록 — 메모리 룰: colorId=3(보라), location 명시.
      // 차량 예약일 때는 alsoInterview가 강제로 false라 진입 안 됨 (위 useEffect/handleAlsoInterviewToggle 가드).
      // 한 번 더 방어: room.kind==='car'면 절대 면접 캘린더 insert 금지.
      if (alsoInterview && room.kind !== 'car') {
        // 회의실 예약 title("○○팀 면접 - 이름" / "○○팀 ○○파트 - 이름")을
        // 면접 캘린더 표준 summary("HH:MM / 사이트 / 이름 / 부서팀(직무)")로 변환.
        // 메모리 룰: feedback_interview_cal_summary_format — 부서 누락 절대 금지.
        const parsed = parseRoomBookingTitle(title.trim());
        const site = extractSiteFromRoom(room.shortName);
        const standardSummary = parsed && site
          ? `${start} / ${site} / ${parsed.name} / ${parsed.deptDisplay}`
          : title.trim(); // 파싱 실패 시 fallback — 최소한 정상 케이스는 표준 포맷.
        const interviewBody = {
          summary: standardSummary,
          description: (note.trim() ? note.trim() + '\n\n' : '') +
            `📍 장소: ${room.shortName}\n` +
            (parsed ? `후보자: ${parsed.name}\n팀: ${parsed.deptDisplay}\n` : '') +
            '※ 회의실 예약 페이지에서 함께 등록됨',
          location: room.shortName,
          start: { dateTime: `${date}T${start}:00`, timeZone: 'Asia/Seoul' },
          end: { dateTime: `${date}T${end}:00`, timeZone: 'Asia/Seoul' },
          colorId: '3',
          // 면접 캘에는 attendees 안 넣음 — 회의실 캘은 primary 이벤트가 attendee로 처리됨,
          // 면접 캘 이벤트가 또 회의실 attendee 가지면 중복 회의실 예약 발생.
        };
        const r2 = await api.google.insertCalEvent(SHARED_CAL.interview, interviewBody, 'none');
        console.log('[MeetingRooms] 면접 캘린더 등록 응답', r2);
        if (!r2.ok) {
          // 회의실 예약은 성공했으니 fatal로 처리 안 함, 경고만
          alert(`회의실 예약은 성공했지만 면접 캘린더 등록 실패: ${r2.error || '알 수 없는 오류'}\n구글 캘린더에서 수동으로 추가해 주세요.`);
        }
      }
      onCreated();
    } catch (e: unknown) {
      console.error('[MeetingRooms] insertCalEvent 예외', e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-3 relative"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🚪</span>
          <h3 className="text-lg font-bold text-slate-900">새 회의실 예약</h3>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-700 mb-1 block">회의실 / 차량</label>
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
          >
            {SITE_LIST.map((s) => {
              const items = rooms.filter((r) => r.site === s);
              if (!items.length) return null;
              return (
                <optgroup key={s} label={siteLabel(s)}>
                  {items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.kind === 'car' ? '🚗 ' : '🏢 '}{r.shortName}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1 block">날짜</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-2 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1 block">시작</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full px-2 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 mb-1 block">종료</label>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full px-2 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-sm" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-700 mb-1 block">제목</label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 전략구매팀 면접 - 김홍길"
            autoFocus
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-700 mb-1 block">메모 (선택)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-900 placeholder-slate-400 text-sm resize-none" />
        </div>

        {/* 면접 캘린더 동시 등록 — 제목에 "면접" 들어가면 자동 ON.
            "면접" 없는데 수동으로 켜려 하면 confirm으로 한 번 묻는다 (오염 방지 + 장성민 케이스 허용). */}
        <label
          className={`flex items-center gap-2 p-2 rounded-md border ${
            isCarBooking
              ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
              : alsoInterview
                ? 'bg-purple-50 border-purple-300 cursor-pointer'
                : 'bg-slate-50 border-slate-200 cursor-pointer'
          }`}
        >
          <input
            type="checkbox"
            checked={alsoInterview}
            disabled={isCarBooking}
            onChange={(e) => handleAlsoInterviewToggle(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-xs font-semibold text-slate-800">
            🟣 면접 캘린더에도 함께 등록 (보라색)
          </span>
          {isCarBooking ? (
            <span className="ml-auto text-[10px] text-slate-500 font-bold">🚗 차량 예약은 등록 불가</span>
          ) : alsoInterview && titleHasInterview ? (
            <span className="ml-auto text-[10px] text-purple-600 font-bold">자동 감지됨</span>
          ) : alsoInterview ? (
            <span className="ml-auto text-[10px] text-amber-700 font-bold">수동 확인됨</span>
          ) : (
            <span className="ml-auto text-[10px] text-slate-500">제목에 "면접" 없으면 수동 확인 필요</span>
          )}
        </label>

        {err && <div className="p-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">{err}</div>}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); void handleSubmit(); }}
            disabled={submitting}
            className="flex-1 py-2 rounded-md text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? '등록 중...' : '예약하기'}
          </button>
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onClose(); }}
            disabled={submitting}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// 회의실을 N분 단위로 러프하게 잡아두고, 실제 면접자별로 시간을 쪼개 등록하는 모달.
// - 회의실 attendee를 또 넣지 않음 (parent booking이 이미 잡고 있음)
// - 면접 캘린더(SHARED_CAL.interview)에 colorId='3'(보라)로 등록
// - hdlee@cnccosmetic.com을 attendees에 절대 안 넣음 (memory: feedback_no_self_in_attendees)
// - 행 추가/삭제, 시간 균등 분할 자동 생성 지원
interface SplitRow {
  candidate: string;
  team: string;
  start: string; // "HH:MM"
  end: string;
}

function SplitInterviewModal({
  booking,
  date,
  room,
  onClose,
  onCreated,
}: {
  booking: RoomBooking;
  date: string;
  room: RoomMeta | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const slotStartMin = booking.startMin;
  const slotEndMin = booking.endMin;
  const slotDurMin = Math.max(0, slotEndMin - slotStartMin);

  // 균등 분할로 N개 row를 생성. 기본 N=2.
  const buildEvenRows = (n: number): SplitRow[] => {
    const each = Math.max(1, Math.floor(slotDurMin / Math.max(1, n)));
    const rows: SplitRow[] = [];
    for (let i = 0; i < n; i++) {
      const s = slotStartMin + i * each;
      const e = i === n - 1 ? slotEndMin : s + each;
      rows.push({ candidate: '', team: '', start: minsToHHMM(s), end: minsToHHMM(e) });
    }
    return rows;
  };

  const [rows, setRows] = useState<SplitRow[]>(() => buildEvenRows(2));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: { idx: number; error: string }[] } | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const submittedRef = useRef(false); // double-submit 방지 (HMR로 onClick 복제될 때 안전장치)

  const updateRow = (idx: number, patch: Partial<SplitRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRow = () => {
    setRows((prev) => {
      // 마지막 row의 끝부터, 슬롯 끝까지 남은 시간을 빈 row로 추가
      const last = prev[prev.length - 1];
      const lastEndMin = last ? hhmmToMin(last.end) : slotStartMin;
      const newStart = Math.min(lastEndMin, slotEndMin - 15);
      const newEnd = slotEndMin;
      return [...prev, { candidate: '', team: '', start: minsToHHMM(newStart), end: minsToHHMM(newEnd) }];
    });
  };
  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };
  const redistribute = () => setRows(buildEvenRows(rows.length));

  const validate = (): string | null => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.candidate.trim()) return `${i + 1}번 행: 후보자 이름을 입력해 주세요.`;
      if (!r.team.trim()) return `${i + 1}번 행: 부서팀(직무)을 입력해 주세요. 면접 캘린더 컨벤션상 필수입니다.`;
      const sM = hhmmToMin(r.start);
      const eM = hhmmToMin(r.end);
      if (sM < slotStartMin || eM > slotEndMin) {
        return `${i + 1}번 행: 시간이 회의실 슬롯(${minsToHHMM(slotStartMin)}~${minsToHHMM(slotEndMin)}) 밖입니다.`;
      }
      if (sM >= eM) return `${i + 1}번 행: 종료 시간이 시작보다 빨라요.`;
    }
    return null;
  };

  const handleSubmit = async () => {
    if (submittedRef.current) return; // 더블클릭/HMR 복제 방어
    const v = validate();
    if (v) { setErr(v); return; }
    submittedRef.current = true;
    setErr(null);
    setSubmitting(true);
    setProgress({ done: 0, total: rows.length, failed: [] });
    const failed: { idx: number; error: string }[] = [];
    // 사이트 라벨 — 면접 캘린더 기존 컨벤션 "HH:MM / 사이트 / 이름 / 팀(직무)" 따라가기 위함
    const siteShort = room?.site === 'purple' ? '퍼플'
      : room?.site === 'green' ? '그린'
      : room?.site === 'suwon' ? '수원'
      : '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // summary 포맷: 기존 면접 캘린더 표준 "HH:MM / 사이트 / 이름 / 팀" 준수
      // 예) "10:00 / 퍼플 / 문나은 / 영업관리팀(해외영업관리)"
      const teamLabel = r.team.trim();
      const namePart = r.candidate.trim();
      const tail = teamLabel ? ` / ${teamLabel}` : '';
      const summary = siteShort
        ? `${r.start} / ${siteShort} / ${namePart}${tail}`
        : `${r.start} / ${namePart}${tail}`;
      const description =
        `🟣 회의실 슬롯에서 분할 등록\n` +
        `📍 장소: ${room?.shortName || booking.summary}\n` +
        `🕐 슬롯: ${booking.startWall}~${booking.endWall} (${booking.summary})\n` +
        (r.team ? `👥 부서/직무: ${r.team}\n` : '') +
        `👤 후보자: ${r.candidate.trim()}`;
      const body = {
        summary,
        description,
        location: room?.shortName || booking.summary,
        start: { dateTime: `${date}T${r.start}:00`, timeZone: 'Asia/Seoul' },
        end: { dateTime: `${date}T${r.end}:00`, timeZone: 'Asia/Seoul' },
        colorId: '3',
        // attendees 비움 — 회의실은 parent booking이 잡고 있고, hdlee@는 절대 self-invite 금지
      };
      try {
        const r2 = await api.google.insertCalEvent(SHARED_CAL.interview, body, 'none');
        if (!r2.ok) failed.push({ idx: i, error: r2.error || '응답 ok=false' });
      } catch (e: unknown) {
        failed.push({ idx: i, error: e instanceof Error ? e.message : String(e) });
      }
      setProgress({ done: i + 1, total: rows.length, failed: [...failed] });
    }
    // ⚠️ parent stub 자동 삭제는 절대 금지 — 2026-05-15 사고
    // 면접 캘린더의 parent 이벤트에 회의실 resource attendee가 붙어있는 경우,
    // 그 이벤트를 삭제하면 회의실 booking도 함께 사라져버려 슬롯이 풀림.
    // 사용자 인용: "5/21 미팅룸 예약 사라졌잖아 빨리 해 뭐하냐 시발".
    // 정책: parent stub 정리는 사용자가 수동으로 판단하는 게 안전. 자동 삭제 안 함.
    setSubmitting(false);
    if (failed.length === 0) {
      // 1) app의 면접 캘린더 view (CalendarPage) 즉시 새로고침
      void refreshCalendarFromGoogle();
      // 2) 모달에 성공 메시지 0.8초 표시 후 닫기 (사용자가 결과 확인 가능)
      setSuccessCount(rows.length);
      setTimeout(() => {
        onCreated();
      }, 800);
    } else {
      setErr(`${failed.length}/${rows.length}건 실패. 첫 오류: ${failed[0].error}`);
      submittedRef.current = false; // 실패 시 재시도 가능
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-2xl p-5 space-y-3 relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">✂️</span>
          <h3 className="text-lg font-bold text-slate-900">회의실 슬롯 분할 등록</h3>
        </div>

        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-[12px]">
          <div className="font-bold text-violet-900 mb-0.5">
            🚪 {room?.shortName || '(회의실)'} · {booking.startWall}~{booking.endWall} ({slotDurMin}분)
          </div>
          <div className="text-violet-800/80">
            기존 예약: <span className="font-semibold">{booking.summary}</span>
          </div>
          <div className="mt-1 text-[11px] text-violet-700/80">
            ⓘ 이 슬롯 안에서 면접 캘린더(보라)에 N건의 개별 면접을 등록합니다.
            회의실은 위 예약이 그대로 잡혀 있고, 면접 일정만 추가됩니다.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">분할 행 ({rows.length}개)</span>
          <button
            type="button"
            onClick={redistribute}
            className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
            title="행 개수에 맞춰 시간을 균등하게 다시 나눔"
          >
            ⚖ 시간 균등 분할
          </button>
          <button
            type="button"
            onClick={addRow}
            className="ml-auto px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700"
          >
            + 행 추가
          </button>
        </div>

        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
              <div className="col-span-1 text-center text-[11px] font-bold text-slate-500">{i + 1}</div>
              <input
                type="text"
                value={r.candidate}
                onChange={(e) => updateRow(i, { candidate: e.target.value })}
                placeholder="후보자 이름"
                className="col-span-3 px-2 py-1.5 rounded-md border border-slate-300 bg-white text-slate-900 text-sm"
              />
              <input
                type="text"
                value={r.team}
                onChange={(e) => updateRow(i, { team: e.target.value })}
                placeholder="부서팀(직무) 필수"
                className={`col-span-3 px-2 py-1.5 rounded-md border bg-white text-slate-900 text-sm ${r.team.trim() ? 'border-slate-300' : 'border-amber-400 ring-1 ring-amber-200'}`}
                title="기존 면접 캘린더 컨벤션: '시간 / 사이트 / 이름 / 부서팀(직무)' — 부서팀은 반드시 채워주세요"
              />
              <input
                type="time"
                value={r.start}
                onChange={(e) => updateRow(i, { start: e.target.value })}
                step={300}
                className="col-span-2 px-1 py-1.5 rounded-md border border-slate-300 bg-white text-slate-900 text-sm"
              />
              <input
                type="time"
                value={r.end}
                onChange={(e) => updateRow(i, { end: e.target.value })}
                step={300}
                className="col-span-2 px-1 py-1.5 rounded-md border border-slate-300 bg-white text-slate-900 text-sm"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length <= 1}
                className="col-span-1 px-1 py-1 rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-30 text-sm font-bold"
                title="이 행 삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {progress && (
          <div className="rounded-md bg-slate-50 border border-slate-200 p-2 text-[11px]">
            진행 {progress.done}/{progress.total}
            {progress.failed.length > 0 && (
              <span className="ml-2 text-rose-700 font-semibold">실패 {progress.failed.length}건</span>
            )}
          </div>
        )}
        {successCount > 0 && (
          <div className="p-2 rounded-md bg-emerald-50 border border-emerald-300 text-emerald-800 text-sm font-semibold flex items-center gap-2">
            <span className="text-lg">✅</span>
            {successCount}건 면접 캘린더 등록 완료 — 잠시 후 닫힙니다
          </div>
        )}
        {err && <div className="p-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">{err}</div>}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); void handleSubmit(); }}
            disabled={submitting}
            className="flex-1 py-2 rounded-md text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {submitting ? `등록 중... (${progress?.done || 0}/${rows.length})` : `${rows.length}건 모두 등록`}
          </button>
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onClose(); }}
            disabled={submitting}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function hhmmToMin(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
