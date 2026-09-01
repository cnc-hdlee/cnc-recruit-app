// 면접 일정표 (Agenda) — "캘린더에 잡힌 면접만" 날짜별로 한눈에.
//
// 기존 면접 캘린더 페이지(CalendarPage)는 등록/수정/회의실/이력서 등 운영 도구가 함께 있어
// "오늘·이번 주 누가 언제 오는지"만 빠르게 보기엔 정보가 많다. 이 페이지는 읽기 전용 요약이다.
//   · 소스는 캘린더뿐 (시트 면접행은 섞지 않음) — 사용자 요청 "캘린더에 잡힌 면접 일정만"
//   · 분류는 CalendarPage의 isInterviewKind를 그대로 재사용 → 카드 수가 두 페이지에서 항상 일치
//   · 오른쪽 레인에 김범준 팀장 / 임한결 주임의 개인 캘린더를 함께 붙인다.
//     비공개(visibility=private) 일정은 구글이 제목을 안 주므로 시간만 "🔒 비공개"로 표시한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { IS_VIEWER } from '../lib/mode';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { isInterviewKind, parseInterviewTitle } from './CalendarPage';
import { PEOPLE, toEmail } from '../lib/interviewAttendees';

// 개인 캘린더를 함께 보는 TA팀 멤버 (사용자 요청: 김범준 팀장 / 임한결 주임)
const TA_MEMBERS = [
  { id: 'bjkim4', accent: '#4f46e5', soft: '#eef2ff' },
  { id: 'hglim', accent: '#0d9488', soft: '#ecfdf5' },
].map((m) => {
  const p = PEOPLE[m.id];
  return {
    ...m,
    email: toEmail(m.id),
    name: p?.name || m.id,
    label: `${p?.name || m.id}${p?.title ? ' ' + p.title : ''}`,
  };
});

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const SITE_KEYWORDS = ['퍼플', '그린', '수원', '오산', '위워크', '온라인', '본사', '판교', '강남'];
const ROOM_RE = /회의실|미팅룸|VIP|대회의|소회의|Meet|Zoom|라운지|세미나실/i;

type RangeKey = 'week' | '2w' | 'month' | 'all';
const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: 'week', label: '이번 주', days: 7 },
  { key: '2w', label: '2주', days: 14 },
  { key: 'month', label: '한 달', days: 31 },
  { key: 'all', label: '전체(90일)', days: 90 },
];

interface AgendaInterview {
  id: string;
  dt: string;
  tm: string;
  endTm: string;
  title: string;
  candidate: string;
  team: string;
  site: string;
  room: string;
  location: string;
  attendees: string[];
  htmlLink: string | null;
  noShow: boolean;
}

interface PersonalEvent {
  id: string;
  owner: string; // TA_MEMBERS.id
  dt: string;
  tm: string;
  endTm: string;
  allDay: boolean;
  title: string;
  isPrivate: boolean;
  location: string;
  htmlLink: string | null;
  attendeeCount: number;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ISO → 벽시계 날짜/시각. 오프셋을 직접 읽어 PC 타임존과 무관하게 캘린더에 보이는 시각 그대로.
function isoParts(iso: string | null | undefined): { dt: string; tm: string; allDay: boolean } {
  if (!iso) return { dt: '', tm: '', allDay: true };
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { dt: iso, tm: '', allDay: true };
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (m) return { dt: `${m[1]}-${m[2]}-${m[3]}`, tm: `${m[4]}:${m[5]}`, allDay: false };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dt: '', tm: '', allDay: true };
  return {
    dt: isoDate(d),
    tm: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    allDay: false,
  };
}

function diffDays(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00+09:00`);
  const tb = Date.parse(`${b}T00:00:00+09:00`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((ta - tb) / 86400000);
}

function personLabel(email: string): string {
  const id = (email || '').split('@')[0];
  const p = PEOPLE[id];
  if (!p) return id || email;
  return `${p.name}${p.title ? ' ' + p.title : ''}`;
}

export function InterviewAgenda() {
  const live = useLiveData();
  const [rangeKey, setRangeKey] = useState<RangeKey>('2w');
  const [showPast, setShowPast] = useState(false);
  const [showPersonal, setShowPersonal] = useState(true);
  const [hideDupes, setHideDupes] = useState(true);
  const [q, setQ] = useState('');
  const [personal, setPersonal] = useState<PersonalEvent[]>([]);
  const [pLoading, setPLoading] = useState(false);
  const [pError, setPError] = useState<string | null>(null);
  const [pAt, setPAt] = useState<number | null>(null);

  const today = isoDate(new Date());
  const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 14;

  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    if (showPast) from.setDate(from.getDate() - days);
    const to = new Date();
    to.setHours(23, 59, 59, 0);
    to.setDate(to.getDate() + days);
    return {
      fromDt: isoDate(from),
      toDt: isoDate(to),
      fromISO: from.toISOString(),
      toISO: to.toISOString(),
    };
  }, [days, showPast]);

  // ── 김범준/임한결 개인 캘린더 (비공개 일정 포함) ──────────────────────────
  // 앱 공용 store는 READ_CALENDAR_IDS(면접/입사/퇴사 공유 캘린더)만 읽으므로 여기서 직접 fetch한다.
  // 읽기 전용이며 viewer(모바일 배포본)에서는 electronAPI가 없어 자동으로 skip된다.
  const loadPersonal = useCallback(async () => {
    if (IS_VIEWER || !api?.google) return;
    setPLoading(true);
    try {
      const results = await Promise.all(
        TA_MEMBERS.map(async (m) => {
          try {
            const r = await api.google.listCalendar(range.fromISO, range.toISO, m.email);
            if (!r.ok || !r.data) return { m, items: [], err: r.error || '읽기 실패' };
            return { m, items: r.data, err: null as string | null };
          } catch (e) {
            return { m, items: [], err: e instanceof Error ? e.message : String(e) };
          }
        })
      );
      const errs = results.filter((r) => r.err).map((r) => `${r.m.name}: ${r.err}`);
      setPError(errs.length ? errs.join(' / ') : null);
      const out: PersonalEvent[] = [];
      for (const { m, items } of results) {
        for (const e of items) {
          if (e.status === 'cancelled') continue;
          const s = isoParts(e.start);
          if (!s.dt) continue;
          const en = isoParts(e.end);
          const title = (e.summary || '').trim();
          out.push({
            id: `${m.id}::${e.id}`,
            owner: m.id,
            dt: s.dt,
            tm: s.tm,
            // 종료가 다른 날이거나 시작과 같으면(휴가 등 길이 0 이벤트) 종료시각 표기 생략
            endTm: en.dt === s.dt && en.tm !== s.tm ? en.tm : '',
            allDay: e.allDay || !s.tm,
            title,
            // 구글은 남의 private 일정을 제목 없이(바쁨) 내려준다 → 제목 없음 = 비공개로 표시
            isPrivate: !title || (e as { visibility?: string }).visibility === 'private',
            location: e.location || '',
            htmlLink: e.htmlLink || null,
            attendeeCount: (e.attendees || []).filter(
              (a) => a.email && !a.email.includes('resource.calendar.google.com')
            ).length,
          });
        }
      }
      out.sort((a, b) =>
        a.dt === b.dt ? (a.tm || '00:00').localeCompare(b.tm || '00:00') : a.dt.localeCompare(b.dt)
      );
      setPersonal(out);
      setPAt(Date.now());
    } finally {
      setPLoading(false);
    }
  }, [range.fromISO, range.toISO]);

  // 자동 동기화 — 마운트/범위변경 즉시 + 2분 폴링 + 창 포커스. 사용자가 버튼 누를 필요 없음.
  useEffect(() => {
    void loadPersonal();
    const t = setInterval(() => void loadPersonal(), 120_000);
    const onFocus = () => void loadPersonal();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadPersonal]);

  // ── 면접 (캘린더 전용) ────────────────────────────────────────────────────
  const interviews = useMemo<AgendaInterview[]>(() => {
    const list = liveCalendarEventsNormalized()
      .filter((e) => isInterviewKind(e.title, e.raw.colorId, e.raw.calendarId))
      // 회의실 예약이 primary에 자동 sync된 그림자 사본은 제외 (면접 캘린더 원본만 카드화)
      .filter((e) => {
        const hasResource = (e.raw.attendees || []).some(
          (a) => typeof a.email === 'string' && a.email.includes('resource.calendar.google.com')
        );
        return !(hasResource && e.raw.calendarId === 'primary');
      })
      .map((e): AgendaInterview => {
        const p = parseInterviewTitle(e.title);
        const locTokens = (e.location || '').split(/\s+/).filter(Boolean);
        const endParts = isoParts(e.raw.end);
        return {
          id: e.id,
          dt: e.dt,
          tm: e.tm,
          endTm: endParts.dt === e.dt ? endParts.tm : '',
          title: e.title,
          candidate: p.candidate,
          team: p.team,
          site: p.site || locTokens.find((t) => SITE_KEYWORDS.some((s) => t.includes(s))) || '',
          room: p.room || locTokens.find((t) => ROOM_RE.test(t)) || '',
          location: e.location || '',
          attendees: (e.raw.attendees || [])
            .map((a) => a.email || '')
            .filter(
              (x) =>
                x && !x.includes('resource.calendar.google.com') && x !== 'hdlee@cnccosmetic.com'
            ),
          htmlLink: e.htmlLink,
          noShow: /불참|노쇼|no.?show/i.test(e.title),
        };
      })
      .filter((e) => e.dt >= range.fromDt && e.dt <= range.toDt);
    // 같은 면접이 여러 캘린더 사본으로 들어오는 경우 대비 — 날짜+시각+후보자로 dedup
    const seen = new Set<string>();
    const out: AgendaInterview[] = [];
    for (const e of list) {
      const key = `${e.dt}|${e.tm}|${e.candidate || e.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    const needle = q.trim().toLowerCase();
    return needle
      ? out.filter((e) =>
          `${e.title} ${e.candidate} ${e.team} ${e.site} ${e.room}`.toLowerCase().includes(needle)
        )
      : out;
  }, [live.calendarEvents, range.fromDt, range.toDt, q]);

  // 면접과 겹치는 개인 일정(= 같은 면접 초대 사본) 숨김용 키
  const intvKeys = useMemo(() => {
    const byTime = new Set<string>();
    const names = new Map<string, string[]>();
    for (const e of interviews) {
      byTime.add(`${e.dt}|${e.tm}`);
      if (e.candidate) {
        const arr = names.get(e.dt) || [];
        arr.push(e.candidate);
        names.set(e.dt, arr);
      }
    }
    return { byTime, names };
  }, [interviews]);

  const personalInRange = useMemo(() => {
    const base = personal.filter((p) => p.dt >= range.fromDt && p.dt <= range.toDt);
    if (!hideDupes) return base;
    return base.filter((p) => {
      if (p.isPrivate) return true; // 비공개는 절대 숨기지 않음 (사용자 요청)
      const sameTime = intvKeys.byTime.has(`${p.dt}|${p.tm}`);
      const sameName = (intvKeys.names.get(p.dt) || []).some((n) => p.title.includes(n));
      return !(sameName || (sameTime && /면접/.test(p.title)));
    });
  }, [personal, range.fromDt, range.toDt, hideDupes, intvKeys]);

  // ── 날짜별 그룹 ───────────────────────────────────────────────────────────
  const dayList = useMemo(() => {
    const map = new Map<string, { intv: AgendaInterview[]; pers: PersonalEvent[] }>();
    const get = (dt: string) => {
      let v = map.get(dt);
      if (!v) {
        v = { intv: [], pers: [] };
        map.set(dt, v);
      }
      return v;
    };
    for (const e of interviews) get(e.dt).intv.push(e);
    if (showPersonal) for (const p of personalInRange) get(p.dt).pers.push(p);
    for (const v of map.values()) {
      v.intv.sort((a, b) => (a.tm || '99:99').localeCompare(b.tm || '99:99'));
      v.pers.sort((a, b) =>
        (a.allDay ? '00:00' : a.tm).localeCompare(b.allDay ? '00:00' : b.tm)
      );
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dt, v]) => ({ dt, ...v }));
  }, [interviews, personalInRange, showPersonal]);

  const stats = useMemo(() => {
    const todayN = interviews.filter((e) => e.dt === today).length;
    const upcoming = interviews.filter((e) => e.dt >= today);
    const week = upcoming.filter((e) => diffDays(e.dt, today) < 7).length;
    const unshared = upcoming.filter((e) => e.attendees.length === 0).length;
    const priv = personalInRange.filter((p) => p.isPrivate && p.dt >= today).length;
    return { todayN, week, total: interviews.length, unshared, priv };
  }, [interviews, personalInRange, today]);

  return (
    <div className="space-y-4">
      {/* ── 상단 요약 ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <Kpi label="오늘 면접" value={stats.todayN} tone="violet" suffix="건" />
        <Kpi label="향후 7일" value={stats.week} tone="indigo" suffix="건" />
        <Kpi
          label={`표시 범위 · ${RANGES.find((r) => r.key === rangeKey)?.label}`}
          value={stats.total}
          tone="slate"
          suffix="건"
        />
        <Kpi
          label="현업 미공유"
          value={stats.unshared}
          tone={stats.unshared ? 'rose' : 'emerald'}
          suffix="건"
        />
        <Kpi label="TA 비공개 일정" value={stats.priv} tone="amber" suffix="건" />
      </div>

      {/* ── 컨트롤 바 ───────────────────────────────────────────── */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl overflow-hidden border border-[#dfd7f9]">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                rangeKey === r.key
                  ? 'bg-[#2a2640] text-white'
                  : 'bg-white text-slate-900 hover:bg-[#f8f0ff]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Toggle on={showPast} onClick={() => setShowPast((v) => !v)} label="지난 일정 포함" />
        <Toggle on={showPersonal} onClick={() => setShowPersonal((v) => !v)} label="TA 팀 개인 일정" />
        {showPersonal && (
          <Toggle on={hideDupes} onClick={() => setHideDupes((v) => !v)} label="면접 중복 숨김" />
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 팀 · 장소 검색"
          className="flex-1 min-w-[160px] px-3 py-1.5 rounded-xl border border-[#dfd7f9] text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#a49dbe]"
        />
        <button className="btn text-[12px]" onClick={() => void loadPersonal()} disabled={pLoading}>
          {pLoading ? '불러오는 중…' : '↻ 새로고침'}
        </button>
        {pAt && (
          <span className="text-[11px] text-slate-500">
            TA 일정 {Math.max(0, Math.round((Date.now() - pAt) / 1000))}초 전 동기화
          </span>
        )}
      </div>

      {pError && (
        <div className="card p-3 text-[12px] text-rose-700" style={{ background: '#fff1f2' }}>
          ⚠ 개인 캘린더를 일부 못 읽었습니다 — {pError}
        </div>
      )}

      {/* ── 범례 ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 px-1">
        <span className="flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-full bg-[#7c3aed] inline-block" /> 면접 (캘린더 등록분)
        </span>
        {TA_MEMBERS.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5">
            <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: m.accent }} />
            {m.label}
          </span>
        ))}
        <span>🔒 비공개 — 구글이 제목을 주지 않아 시간만 표시됩니다</span>
      </div>

      {/* ── 날짜별 리스트 ───────────────────────────────────────── */}
      <div className="space-y-3 max-h-[calc(100dvh-330px)] overflow-y-auto pr-1">
        {dayList.length === 0 && (
          <div className="card p-10 text-center text-slate-500 text-sm">
            이 기간에 캘린더에 등록된 면접이 없습니다.
          </div>
        )}
        {dayList.map((d) => {
          const dd = diffDays(d.dt, today);
          const dow = DOW[new Date(`${d.dt}T00:00:00+09:00`).getDay()];
          const isToday = d.dt === today;
          const past = dd < 0;
          const [, mm, day] = d.dt.split('-');
          return (
            <section key={d.dt} className={`card overflow-hidden ${past ? 'opacity-70' : ''}`}>
              <header
                className="flex items-center gap-3 px-4 py-2.5 border-b"
                style={{
                  borderColor: 'var(--cc-p8)',
                  background: isToday ? 'linear-gradient(90deg,#eee6ff,#ffffff)' : '#fcfbff',
                }}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-slate-900 tabular-nums">
                    {Number(mm)}/{Number(day)}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      dow === '토' ? 'text-blue-600' : dow === '일' ? 'text-rose-600' : 'text-slate-700'
                    }`}
                  >
                    ({dow})
                  </span>
                </div>
                {isToday ? (
                  <span className="chip bg-[#2a2640] text-white">오늘</span>
                ) : dd === 1 ? (
                  <span className="chip bg-violet-100 text-violet-800">내일</span>
                ) : dd > 1 ? (
                  <span className="chip bg-slate-100 text-slate-700">D-{dd}</span>
                ) : (
                  <span className="chip bg-slate-100 text-slate-500">{-dd}일 전</span>
                )}
                <div className="flex-1" />
                <span className="text-[12px] font-semibold text-violet-800">
                  면접 {d.intv.length}건
                </span>
                {showPersonal && d.pers.length > 0 && (
                  <span className="text-[12px] text-slate-500">TA 일정 {d.pers.length}건</span>
                )}
              </header>

              <div
                className={`grid ${
                  showPersonal ? 'md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : 'grid-cols-1'
                }`}
              >
                {/* 면접 타임라인 */}
                <div className="p-3 sm:p-4 space-y-2">
                  {d.intv.length === 0 && (
                    <div className="text-[12px] text-slate-400 py-2">등록된 면접 없음</div>
                  )}
                  {d.intv.map((e) => (
                    <InterviewCard key={e.id} e={e} />
                  ))}
                </div>

                {/* TA 팀 개인 일정 레인 */}
                {showPersonal && (
                  <div
                    className="p-3 sm:p-4 border-t md:border-t-0 md:border-l"
                    style={{ borderColor: 'var(--cc-p8)', background: '#fbfaff' }}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-2">
                      TA 팀 일정
                    </div>
                    <div className="space-y-3">
                      {TA_MEMBERS.map((m) => {
                        const mine = d.pers.filter((p) => p.owner === m.id);
                        return (
                          <div key={m.id}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <i
                                className="w-2 h-2 rounded-full inline-block"
                                style={{ background: m.accent }}
                              />
                              <span className="text-[11px] font-semibold text-slate-900">
                                {m.label}
                              </span>
                              <span className="text-[10px] text-slate-400">{mine.length}건</span>
                            </div>
                            {mine.length === 0 ? (
                              <div className="text-[11px] text-slate-400 pl-3.5">일정 없음</div>
                            ) : (
                              <div className="space-y-1 pl-3.5">
                                {mine.map((p) => (
                                  <PersonalChip key={p.id} p={p} accent={m.accent} soft={m.soft} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── 조각 컴포넌트 ──────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone: 'violet' | 'indigo' | 'slate' | 'rose' | 'emerald' | 'amber';
}) {
  const tones: Record<string, string> = {
    violet: 'text-violet-700',
    indigo: 'text-indigo-700',
    slate: 'text-slate-900',
    rose: 'text-rose-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 leading-tight truncate">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone]}`}>
        {value}
        {suffix && <span className="text-[12px] font-semibold ml-0.5 text-slate-500">{suffix}</span>}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition-colors ${
        on ? 'bg-[#eee6ff] border-[#cac3e4] text-[#2a2640]' : 'bg-white border-[#dfd7f9] text-slate-500'
      }`}
    >
      {on ? '☑' : '☐'} {label}
    </button>
  );
}

function InterviewCard({ e }: { e: AgendaInterview }) {
  const shared = e.attendees.length > 0;
  return (
    <div
      className="group flex gap-3 rounded-xl border bg-white px-3 py-2.5 transition-colors hover:bg-[#faf7ff]"
      style={{ borderColor: 'var(--cc-p8)', borderLeft: '4px solid #7c3aed' }}
    >
      <div className="w-[68px] shrink-0 text-right">
        <div className="text-[15px] font-bold text-slate-900 tabular-nums leading-tight">
          {e.tm || '종일'}
        </div>
        {e.endTm && (
          <div className="text-[11px] text-slate-400 tabular-nums leading-tight">~{e.endTm}</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[15px] font-bold ${
              e.noShow ? 'line-through text-slate-400' : 'text-slate-900'
            }`}
          >
            {e.candidate || '(이름 미상)'}
          </span>
          {e.team && <span className="chip bg-slate-100 text-slate-800">{e.team}</span>}
          {e.site && <span className="chip bg-violet-50 text-violet-800">{e.site}</span>}
          {e.noShow && <span className="chip bg-rose-100 text-rose-700">불참</span>}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
          <span className={shared ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'}>
            {shared ? `🟢 공유됨 · ${e.attendees.length}명` : '🔴 미공유'}
          </span>
          {shared && (
            <span
              className="text-slate-500 truncate max-w-[300px]"
              title={e.attendees.map(personLabel).join(', ')}
            >
              {e.attendees.map(personLabel).join(', ')}
            </span>
          )}
        </div>
        {(e.room || e.location) && (
          <div className="mt-0.5 text-[11px] text-slate-600 truncate">📍 {e.room || e.location}</div>
        )}
        <div className="mt-0.5 text-[10px] text-slate-400 truncate">{e.title}</div>
      </div>
      {e.htmlLink && (
        <a
          href={e.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="self-start text-[11px] text-slate-400 hover:text-violet-700 opacity-0 group-hover:opacity-100 transition-opacity"
          title="구글 캘린더에서 열기"
        >
          ↗
        </a>
      )}
    </div>
  );
}

function PersonalChip({ p, accent, soft }: { p: PersonalEvent; accent: string; soft: string }) {
  const time = p.allDay ? '종일' : p.endTm ? `${p.tm}–${p.endTm}` : p.tm;
  return (
    <div
      className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-[11px]"
      style={{
        background: p.isPrivate ? '#f5f3ff' : soft,
        borderLeft: `3px solid ${p.isPrivate ? '#a49dbe' : accent}`,
      }}
    >
      <span className="tabular-nums font-semibold text-slate-900 shrink-0">{time}</span>
      {p.isPrivate ? (
        <span className="text-slate-500 italic">🔒 비공개</span>
      ) : (
        <span className="text-slate-900 leading-snug break-words">
          {p.title}
          {p.location && <span className="text-slate-500"> · {p.location}</span>}
        </span>
      )}
    </div>
  );
}
