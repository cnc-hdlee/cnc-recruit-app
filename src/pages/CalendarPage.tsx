import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized, liveByKindOrScan, refreshCalendarFromGoogle, refreshNow } from '../store/liveData';
import { api } from '../lib/api';
import { SHARED_CAL } from '../lib/sharedCalendars';

// 근무지 프리셋 (퍼플/그린/수원/위워크/온라인 등) — 첫 번째 깊이
const SITE_PRESETS = [
  '퍼플',
  '그린',
  '수원',
  '위워크',
  '온라인',
];

// 회의실 프리셋 (사이트별 흔한 룸) — 두 번째 깊이
const ROOM_PRESETS_BY_SITE: Record<string, string[]> = {
  퍼플: ['VIP룸', '미팅룸 1번', '미팅룸 2번', '미팅룸 3번'],
  그린: ['회의실 A', '회의실 B', '회의실 C'],
  수원: ['회의실 A', '회의실 B', '대회의실'],
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
const SITE_KEYWORDS = ['퍼플', '그린', '수원', '위워크', '온라인', '본사', '판교', '강남'];
const ROOM_KEYWORDS = /회의실|미팅룸|VIP|대회의|소회의|Meet|Zoom|구글|줌|구내식당|식당|카페|로비|라운지|휴게실|강당|세미나실/i;
const TEAM_KEYWORDS = /팀$|본부$|실$|센터$|매니저|기획|개발|디자이너|마케터|연구원|PM|MD|엔지니어|직무|채용/;
// 후보자 이름이 절대 될 수 없는 단어 (장소/시설명) — 한글 2-4자라도 이름 매칭에서 제외
const NOT_NAME_KEYWORDS = /^(구내식당|식당|카페|로비|라운지|휴게실|강당|세미나실|회의실|미팅룸|대회의|소회의|본사|퍼플|그린|수원|판교|강남|온라인|위워크|VIP룸|VIP|회의|미팅|면접|일정|장소)/;

function parseInterviewTitle(title: string): {
  candidate: string;
  site: string;
  team: string;
  room: string;
  time: string;
} {
  const t = (title || '').trim();
  const empty = { candidate: '', site: '', team: '', room: '', time: '' };
  if (!t) return empty;

  // 슬래시가 없으면 한글 이름만 추출
  if (!t.includes('/')) {
    const m = t.match(/[가-힣]{2,4}/);
    return { ...empty, candidate: m ? m[0] : t };
  }

  const parts = t.split('/').map((p) => p.trim()).filter(Boolean);
  let candidate = '', site = '', team = '', room = '', time = '';
  const leftover: string[] = [];

  for (const p of parts) {
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
      if (nm && !NOT_NAME_KEYWORDS.test(nm[1]) && !TEAM_KEYWORDS.test(p)) {
        candidate = nm[1]; continue;
      }
    }
    if (!team && TEAM_KEYWORDS.test(p)) { team = p; continue; }
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

  return { candidate, site, team, room, time };
}

// to-do/업무 액션 동사 — "OOO 발송", "OOO 확인", "그리팅 시안 확인", "채용품의 상신" 등을 면접에서 제외
const TODO_ACTION_KEYWORDS = /(안내|발송|확인|준비|작성|기안|상신|회신|보고|공유|체크|정리|등록|기입|결재|점검|결제|구매|받기|챙기기|제출|신청|수령|반납|발급|취소|기획|품의|시안|크리닝|스크리닝|마감|개시|마감|기록|통보|업데이트)/;

function isInterviewKind(summary: string, colorId: string | null): boolean {
  // 입사(colorId 5)·퇴사·휴가·행사 명시적으로 제외
  if (colorId === '5') return false; // 노란색 = 입사
  if (/입사|퇴사|퇴직|휴가|연차|반차|생일|워크샵|워크샾|행사|회식|점심|런치|MT\b|OT\b|교육|세미나|컨퍼런스|타운홀|townhall|holiday|off\b|박람회|일자리센터/i.test(summary)) {
    return false;
  }
  // 일반 회의/미팅 제외 (단, "면접" 단어가 함께 있거나 회의실/미팅룸 같은 장소명은 통과)
  if (/(회의(?!실)|미팅(?!룸)|meeting|\bsync\b|싱크미팅|1on1|1:1)/i.test(summary) && !/면접|interview/i.test(summary)) {
    return false;
  }

  // ① 슬래시 포맷 면접 — 한글 이름 + (시간 OR 근무지 OR 회의실) 중 하나 이상
  //    옛 포맷("11:00 위워크 / 김태리 / OBM(상품기획)")도 통과시키려고 토큰 내 부분일치 허용
  if (summary.includes('/')) {
    const parts = summary.split('/').map((s) => s.trim()).filter(Boolean);
    const hasTime = parts.some((p) => /\d{1,2}:\d{2}/.test(p));
    const hasName = parts.some((p) => {
      const m = p.match(/(?:^|\s)([가-힣]{2,4})(?:\s|\(|$)/);
      if (!m) return false;
      if (NOT_NAME_KEYWORDS.test(m[1])) return false;
      if (TEAM_KEYWORDS.test(p)) return false;
      return true;
    });
    const hasSite = parts.some((p) => SITE_KEYWORDS.some((s) => p.includes(s)));
    const hasRoom = parts.some((p) => ROOM_KEYWORDS.test(p));
    if (hasName && (hasTime || hasSite || hasRoom)) return true;
  }

  // ② "면접/interview" 명시 키워드 — 단, to-do 액션 동사가 함께 있으면 차단 (예: "면접 안내문자 발송")
  if (/면접|interview/i.test(summary)) {
    if (TODO_ACTION_KEYWORDS.test(summary)) return false;
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
  const [creating, setCreating] = useState(false);
  const [editingEvent, setEditingEvent] = useState<InterviewEvent | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dismissedLoaded, setDismissedLoaded] = useState(false);
  const [autoRegistering, setAutoRegistering] = useState<Set<string>>(new Set());
  const [cleaningUp, setCleaningUp] = useState(false);
  // 카드 필터 — 상단 요약 카드 클릭으로 토글 (all/today/thisWeek)
  const [cardFilter, setCardFilter] = useState<'all' | 'today' | 'thisWeek'>('all');
  // 자동 silent cleanup 30초 throttle — 너무 자주 안 돌게
  const lastAutoCleanupRef = useRef(0);

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

  const handleManualRefresh = async () => {
    setRefreshing(true);
    // 캘린더 + 모든 시트(면접 및 처우 현황 포함) 강제 fetch — 60초 polling 기다리지 않음
    await Promise.all([refreshCalendarFromGoogle(), refreshNow()]);
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
    if (!confirm(`'${event.candidate || event.title}' 면접을 삭제하시겠습니까?\n\n캘린더 이벤트도 함께 삭제됩니다 (시트는 변경되지 않음).`)) return;
    const key = dismissKey(event.dt, event.tm, event.candidate || event.title);
    // 시트 출처는 캘린더 이벤트가 없을 수 있으니 dismiss만 추가 (재등록 방지)
    if (event.source === 'calendar' && event.calendarId) {
      try {
        await api.google.deleteCalEvent(event.calendarId, event.id, 'all');
      } catch {
        // ignore — 이미 삭제됐을 수도
      }
    }
    // dismiss list에 추가 — 시트에 행이 남아있어도 다시 자동 등록 안 됨
    const next = new Set(dismissed);
    next.add(key);
    await persistDismissed(next);
    // 즉시 캘린더 다시 fetch (UI 반영)
    void refreshCalendarFromGoogle();
  };

  // 같은 (날짜+시간+이름) 면접이 여러 캘린더/색으로 N중 등록된 것을 정리.
  // 보라색(SHARED_CAL.interview + colorId='3') 1건 우선 보존, 나머지 모두 삭제.
  // silent=true → 자동 진행 (alert/confirm 없음, console만), false → dry-run+confirm 모달.
  const cleanupDuplicates = async (silent: boolean): Promise<void> => {
    if (cleaningUp) return;
    setCleaningUp(true);
    try {
      const interviews = liveCalendarEventsNormalized().filter((e) =>
        isInterviewKind(e.title, e.raw.colorId)
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
      .filter((e) => isInterviewKind(e.title, e.raw.colorId))
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

  // 시트→캘린더 자동 등록: 시트에 datetime 있는데 캘린더에 없는 후보자 자동 create_event
  // GPD 부서·dismissed 키는 skip. 진행중인 키는 autoRegistering set으로 race condition 방지.
  useEffect(() => {
    if (!dismissedLoaded) return; // dismissed cfg 로드 전에 등록 시작 금지 (재등록 방지)
    const interviewSheetRows = liveByKindOrScan('office_interview');
    if (interviewSheetRows.length === 0) return;
    // 캘린더에 이미 있는 키 set
    const calendarKeys = new Set<string>();
    for (const e of liveCalendarEventsNormalized()) {
      if (!isInterviewKind(e.title, e.raw.colorId)) continue;
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
          const body: Parameters<typeof api.google.insertCalEvent>[1] = {
            summary,
            description: `후보자: ${t.candidate}\n부서: ${teamLabel}\n※ 시트 office_interview 행에서 자동 등록 (${getTodayStr()})`,
            location: site === '퍼플' ? '퍼플카운티' : site,
            start: { dateTime: startISO, timeZone: 'Asia/Seoul' },
            end: { dateTime: endISO, timeZone: 'Asia/Seoul' },
            attendees: [
              { email: 'shim@cnccosmetic.com' },
              { email: 'hdlee@cnccosmetic.com' },
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

      {/* 필터 + 동기화 상태 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-full text-xs font-bold border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 shadow-sm flex items-center gap-1"
          >
            <span>+</span>
            새 면접 일정
          </button>
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
            <DayBlock key={dt} dt={dt} events={events} today={today} onDelete={handleDeleteEvent} onEdit={handleEditEvent} />
          ))}
        </div>
      )}

      {creating && (
        <InterviewCreateModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refreshCalendarFromGoogle();
          }}
        />
      )}

      {editingEvent && (
        <InterviewEditModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSaved={async () => {
            setEditingEvent(null);
            await refreshCalendarFromGoogle();
          }}
        />
      )}
    </div>
  );
}

function InterviewCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    const attendees = form.interviewers
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
      .map((email) => ({ email }));

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

    setSubmitting(true);
    try {
      // 팀 공유 면접 캘린더에 등록 — 모든 TA팀원의 앱에서 동일하게 보임
      const r = await api.google.insertCalEvent(SHARED_CAL.interview, body);
      if (!r.ok) {
        setErr(r.error || '캘린더 등록 실패');
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch (e: any) {
      setErr(e?.message || String(e));
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

function DayBlock({ dt, events, today, onDelete, onEdit }: { dt: string; events: InterviewEvent[]; today: string; onDelete: (e: InterviewEvent) => void; onEdit: (e: InterviewEvent) => void }) {
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
          <InterviewRow key={e.id} event={e} onDelete={onDelete} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}

function InterviewRow({ event, onDelete, onEdit }: { event: InterviewEvent; onDelete: (e: InterviewEvent) => void; onEdit: (e: InterviewEvent) => void }) {
  const noAttendees = event.source === 'calendar' && event.attendees.length === 0;
  // 근무지가 location에만 있고 파싱은 못 했을 때 fallback
  const locParts = (event.location || '').split(/\s+/).filter(Boolean);
  const siteFallback = event.site
    || locParts.find((t) => SITE_KEYWORDS.some((s) => t.includes(s)))
    || locParts[0]
    || '';
  const roomFallback = event.room
    || locParts.find((t) => ROOM_KEYWORDS.test(t) && t !== siteFallback)
    || (locParts.length > 1 && locParts[locParts.length - 1] !== siteFallback ? locParts.slice(1).join(' ') : '')
    || '';
  // 장소 합치기 — 강조용 단일 문자열
  const fullLocation = [siteFallback, roomFallback].filter(Boolean).join(' · ');

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

      {/* 가운데: 이름 (큰 글씨) + 팀 + 장소(강조) */}
      <div className="flex-1 min-w-0">
        <div className={`flex items-baseline gap-2 flex-wrap ${event.done ? 'line-through' : ''}`}>
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
        {event.attendees.length > 0 && (
          <div className="text-[11px] text-slate-500 mt-1">
            👥 면접관 {event.attendees.length}명
          </div>
        )}
      </div>

      {/* 우측: 출처 / 경고 / 삭제 버튼 */}
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-[10px]">
        {event.source === 'calendar' ? (
          <span className="text-slate-400">📅 캘린더</span>
        ) : (
          <span className="text-slate-400">📋 시트</span>
        )}
        {noAttendees && (
          <span className="chip bg-amber-100 text-amber-800 text-[10px] font-bold">⚠ 면접관 ✗</span>
        )}
        {event.done && <span className="text-emerald-600 font-bold">✓ 완료</span>}
      </div>
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
}: {
  event: InterviewEvent;
  onClose: () => void;
  onSaved: () => void;
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
    interviewers: event.attendees.join(', '),
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
      attendees: attendeeEmails.map((email) => ({ email })),
      colorId: '3', // 보라색 면접 라벨 유지
    };

    setSubmitting(true);
    try {
      const r = await api.google.updateCalEvent(event.calendarId, event.id, body, 'all');
      if (!r.ok) {
        setErr((r as { error?: string }).error || '캘린더 수정 실패');
        setSubmitting(false);
        return;
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
