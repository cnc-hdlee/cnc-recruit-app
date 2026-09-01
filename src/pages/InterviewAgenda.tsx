// 면접 일정표 — 월간 달력. 스크롤 없이 한 달치를 한 화면에 본다.
//
// 설계
//   · 기본은 달력(월간 그리드). 날짜 칸에 "시각 + 이름" 칩이 바로 보이고, 칸을 누르면 오른쪽에 상세.
//   · 소스는 캘린더뿐 (시트 면접행은 섞지 않음) — 사용자 요청 "캘린더에 잡힌 면접 일정만".
//   · 분류는 CalendarPage의 isInterviewKind를 그대로 재사용 → 면접 캘린더 페이지와 카드 수가 일치.
//   · 보고 있는 달을 직접 fetch하므로 지난 달·다음 달로 넘겨도 그대로 보인다
//     (앱 공용 store는 -30일~+90일 고정이라 7월 면접이 안 보였다).
//   · 김범준 팀장 / 임한결 주임 개인 일정은 날짜 칸에 점으로, 상세 패널에 전부 표시.
//     비공개 일정은 구글이 제목을 안 주므로 시간만 🔒로 보여준다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { GCalEvent } from '../lib/api';
import { IS_VIEWER } from '../lib/mode';
import { isInterviewKind, parseInterviewTitle } from './CalendarPage';
import { PEOPLE, toEmail } from '../lib/interviewAttendees';
import { INTERVIEW_CAL_IDS } from '../lib/sharedCalendars';

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
  owner: string;
  dt: string;
  tm: string;
  endTm: string;
  allDay: boolean;
  title: string;
  isPrivate: boolean;
  location: string;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ISO → 벽시계 날짜/시각 (PC 타임존과 무관하게 캘린더에 보이는 그대로)
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

function personLabel(email: string): string {
  const id = (email || '').split('@')[0];
  const p = PEOPLE[id];
  return p ? `${p.name}${p.title ? ' ' + p.title : ''}` : id || email;
}

// 같은 면접이 primary 초대 사본 + 공유 면접 캘린더 원본으로 두 벌 들어온다.
// 제목은 primary 사본에만 있고(공유 캘린더를 reader로 읽으면 private), colorId/소속 캘린더는 공유 사본에만 있다.
// → 필드별로 병합해야 "면접 캘린더 + 보라색이면 면접" 신뢰 규칙이 살아난다. (store와 동일한 규칙)
function mergeCopies(results: { calId: string; items: GCalEvent[] }[]) {
  const byId = new Map<string, { calId: string; e: GCalEvent }[]>();
  for (const { calId, items } of results) {
    for (const e of items) {
      if (!e.id) continue;
      const arr = byId.get(e.id);
      if (arr) arr.push({ calId, e });
      else byId.set(e.id, [{ calId, e }]);
    }
  }
  const out: { calId: string; e: GCalEvent }[] = [];
  for (const copies of byId.values()) {
    const base = copies.find((c) => (c.e.summary || '').trim()) || copies[0];
    const shared = copies.find((c) => c.calId !== 'primary');
    const pick = (get: (x: GCalEvent) => string | null | undefined) =>
      (get(base.e) || '').trim() || copies.map((c) => (get(c.e) || '').trim()).find(Boolean) || '';
    out.push({
      calId: shared ? shared.calId : base.calId,
      e: {
        ...base.e,
        colorId: (shared && shared.e.colorId) || base.e.colorId || null,
        summary: pick((x) => x.summary),
        description: pick((x) => x.description),
        location: pick((x) => x.location),
        attendees: base.e.attendees?.length
          ? base.e.attendees
          : copies.map((c) => c.e.attendees).find((a) => a && a.length) || base.e.attendees,
      },
    });
  }
  return out;
}

export function InterviewAgenda() {
  const today = isoDate(new Date());
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() }; // m: 0-11
  });
  const [view, setView] = useState<'month' | 'list'>('month');
  const [showPersonal, setShowPersonal] = useState(true);
  const [hideDupes, setHideDupes] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string>(today);
  const [interviews, setInterviews] = useState<AgendaInterview[]>([]);
  const [personal, setPersonal] = useState<PersonalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const reqId = useRef(0);

  // 보고 있는 달 ±7일 — 달을 넘기면 그 달을 직접 읽는다
  const range = useMemo(() => {
    const from = new Date(cursor.y, cursor.m, 1);
    from.setDate(from.getDate() - 7);
    from.setHours(0, 0, 0, 0);
    const to = new Date(cursor.y, cursor.m + 1, 0);
    to.setDate(to.getDate() + 7);
    to.setHours(23, 59, 59, 0);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }, [cursor]);

  const load = useCallback(async () => {
    if (IS_VIEWER || !api?.google) {
      setLoading(false);
      return;
    }
    const my = ++reqId.current;
    setLoading(true);
    try {
      const calIds = ['primary', ...INTERVIEW_CAL_IDS];
      const results = await Promise.all(
        calIds.map(async (calId) => {
          try {
            const r = await api.google.listCalendar(range.fromISO, range.toISO, calId);
            return { calId, items: r.ok && r.data ? r.data : [] };
          } catch {
            return { calId, items: [] as GCalEvent[] };
          }
        })
      );
      if (my !== reqId.current) return;
      const merged = mergeCopies(results);
      const list: AgendaInterview[] = merged
        .filter(({ calId, e }) => isInterviewKind(e.summary || '', e.colorId, calId))
        // 회의실 예약이 primary에 자동 sync된 그림자 사본 제외 (면접 캘린더 원본만 카드화)
        .filter(({ calId, e }) => {
          const hasResource = (e.attendees || []).some(
            (a) => typeof a.email === 'string' && a.email.includes('resource.calendar.google.com')
          );
          return !(hasResource && calId === 'primary');
        })
        .map(({ e }) => {
          const s = isoParts(e.start);
          const en = isoParts(e.end);
          const p = parseInterviewTitle(e.summary || '');
          const locTokens = (e.location || '').split(/\s+/).filter(Boolean);
          return {
            id: e.id,
            dt: s.dt,
            tm: s.tm,
            endTm: en.dt === s.dt && en.tm !== s.tm ? en.tm : '',
            title: e.summary || '',
            candidate: p.candidate,
            team: p.team,
            site: p.site || locTokens.find((t) => SITE_KEYWORDS.some((k) => t.includes(k))) || '',
            room: p.room || locTokens.find((t) => ROOM_RE.test(t)) || '',
            location: e.location || '',
            attendees: (e.attendees || [])
              .map((a) => a.email || '')
              .filter(
                (x) => x && !x.includes('resource.calendar.google.com') && x !== 'hdlee@cnccosmetic.com'
              ),
            htmlLink: e.htmlLink || null,
            noShow: /불참|노쇼|no.?show/i.test(e.summary || ''),
          };
        })
        .filter((e) => e.dt);
      // 같은 면접의 사본 정리 (날짜+시각+이름)
      const seen = new Set<string>();
      const dedup: AgendaInterview[] = [];
      for (const e of list) {
        const key = `${e.dt}|${e.tm}|${e.candidate || e.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(e);
      }
      setInterviews(dedup);

      // TA 팀 개인 일정 (비공개 포함)
      const pres = await Promise.all(
        TA_MEMBERS.map(async (m) => {
          try {
            const r = await api.google.listCalendar(range.fromISO, range.toISO, m.email);
            return { m, items: r.ok && r.data ? r.data : [], err: r.ok ? null : r.error || null };
          } catch (e) {
            return { m, items: [] as GCalEvent[], err: e instanceof Error ? e.message : String(e) };
          }
        })
      );
      if (my !== reqId.current) return;
      const errs = pres.filter((r) => r.err).map((r) => `${r.m.name}: ${r.err}`);
      setErr(errs.length ? errs.join(' / ') : null);
      const pers: PersonalEvent[] = [];
      for (const { m, items } of pres) {
        for (const e of items) {
          if (e.status === 'cancelled') continue;
          const s = isoParts(e.start);
          if (!s.dt) continue;
          const en = isoParts(e.end);
          const title = (e.summary || '').trim();
          pers.push({
            id: `${m.id}::${e.id}`,
            owner: m.id,
            dt: s.dt,
            tm: s.tm,
            endTm: en.dt === s.dt && en.tm !== s.tm ? en.tm : '',
            allDay: e.allDay || !s.tm,
            title,
            // 남의 private 일정은 구글이 제목 없이(바쁨) 내려준다
            isPrivate: !title || e.visibility === 'private',
            location: e.location || '',
          });
        }
      }
      setPersonal(pers);
      setFetchedAt(Date.now());
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [range.fromISO, range.toISO]);

  // 달 변경 시 즉시 + 2분 폴링 + 창 포커스 (사용자가 새로고침 누를 필요 없음)
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 120_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const shownInterviews = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return interviews;
    return interviews.filter((e) =>
      `${e.title} ${e.candidate} ${e.team} ${e.site} ${e.room}`.toLowerCase().includes(needle)
    );
  }, [interviews, q]);

  const byDate = useMemo(() => {
    const m = new Map<string, AgendaInterview[]>();
    for (const e of shownInterviews) {
      const arr = m.get(e.dt) || [];
      arr.push(e);
      m.set(e.dt, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.tm || '99:99').localeCompare(b.tm || '99:99'));
    return m;
  }, [shownInterviews]);

  // 면접 초대 사본과 겹치는 개인 일정 숨김 (비공개는 절대 숨기지 않음)
  const personalByDate = useMemo(() => {
    const names = new Map<string, string[]>();
    const times = new Set<string>();
    for (const e of interviews) {
      times.add(`${e.dt}|${e.tm}`);
      if (e.candidate) {
        const arr = names.get(e.dt) || [];
        arr.push(e.candidate);
        names.set(e.dt, arr);
      }
    }
    const m = new Map<string, PersonalEvent[]>();
    for (const p of personal) {
      if (hideDupes && !p.isPrivate) {
        const sameName = (names.get(p.dt) || []).some((n) => p.title.includes(n));
        const sameTime = times.has(`${p.dt}|${p.tm}`);
        if (sameName || (sameTime && /면접/.test(p.title))) continue;
      }
      const arr = m.get(p.dt) || [];
      arr.push(p);
      m.set(p.dt, arr);
    }
    for (const arr of m.values())
      arr.sort((a, b) => (a.allDay ? '00:00' : a.tm).localeCompare(b.allDay ? '00:00' : b.tm));
    return m;
  }, [personal, interviews, hideDupes]);

  // 달력 격자 — 그 달의 1일이 포함된 주 일요일부터 6주(42칸)
  const weeks = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const cells: { dt: string; inMonth: boolean; day: number; dow: number }[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({
        dt: isoDate(d),
        inMonth: d.getMonth() === cursor.m,
        day: d.getDate(),
        dow: d.getDay(),
      });
    }
    // 마지막 주가 통째로 다음 달이면 5주만 (한 화면에 더 크게 들어가게)
    const rows: (typeof cells)[] = [];
    for (let i = 0; i < 42; i += 7) rows.push(cells.slice(i, i + 7));
    while (rows.length > 4 && rows[rows.length - 1].every((c) => !c.inMonth)) rows.pop();
    return rows;
  }, [cursor]);

  const monthStats = useMemo(() => {
    const prefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
    const inMonth = shownInterviews.filter((e) => e.dt.startsWith(prefix));
    return {
      total: inMonth.length,
      todayN: shownInterviews.filter((e) => e.dt === today).length,
      unshared: inMonth.filter((e) => e.attendees.length === 0).length,
      priv: personal.filter((p) => p.isPrivate && p.dt.startsWith(prefix)).length,
    };
  }, [shownInterviews, personal, cursor, today]);

  const selDay = {
    intv: byDate.get(selected) || [],
    pers: personalByDate.get(selected) || [],
  };

  const monthLabel = `${cursor.y}년 ${cursor.m + 1}월`;
  const shiftMonth = (delta: number) =>
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <div className="space-y-3">
      {/* 상단 바 — 월 이동 + 요약 + 옵션 */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className="btn px-2 py-1 text-[13px]" onClick={() => shiftMonth(-1)} title="이전 달">
            ‹
          </button>
          <span className="text-[17px] font-bold text-slate-900 tabular-nums px-1.5 min-w-[110px] text-center">
            {monthLabel}
          </span>
          <button className="btn px-2 py-1 text-[13px]" onClick={() => shiftMonth(1)} title="다음 달">
            ›
          </button>
          <button
            className="btn text-[12px] ml-1"
            onClick={() => {
              const d = new Date();
              setCursor({ y: d.getFullYear(), m: d.getMonth() });
              setSelected(today);
            }}
          >
            오늘
          </button>
        </div>

        <div className="flex items-center gap-3 pl-2 text-[12px]">
          <span className="text-slate-900">
            이 달 면접 <b className="text-violet-700 text-[15px]">{monthStats.total}</b>건
          </span>
          <span className="text-slate-900">
            오늘 <b className="text-indigo-700 text-[15px]">{monthStats.todayN}</b>건
          </span>
          <span className={monthStats.unshared ? 'text-rose-600 font-semibold' : 'text-slate-500'}>
            미공유 {monthStats.unshared}건
          </span>
          {showPersonal && <span className="text-amber-700">TA 비공개 {monthStats.priv}건</span>}
        </div>

        <div className="flex-1" />

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 팀 검색"
          className="w-[150px] px-3 py-1.5 rounded-xl border border-[#dfd7f9] text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#a49dbe]"
        />
        <button
          onClick={() => setShowPersonal((v) => !v)}
          className={`px-2.5 py-1.5 rounded-xl text-[12px] font-semibold border ${
            showPersonal ? 'bg-[#eee6ff] border-[#cac3e4] text-[#2a2640]' : 'bg-white border-[#dfd7f9] text-slate-500'
          }`}
        >
          {showPersonal ? '☑' : '☐'} TA 일정
        </button>
        <div className="flex rounded-xl overflow-hidden border border-[#dfd7f9]">
          {(
            [
              ['month', '달력'],
              ['list', '목록'],
            ] as ['month' | 'list', string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`px-3 py-1.5 text-[12px] font-semibold ${
                view === k ? 'bg-[#2a2640] text-white' : 'bg-white text-slate-900 hover:bg-[#f8f0ff]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {loading && <span className="text-[11px] text-slate-400">불러오는 중…</span>}
      </div>

      {err && <div className="card p-2.5 text-[12px] text-rose-700">⚠ 개인 캘린더 일부 실패 — {err}</div>}

      {view === 'month' ? (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_330px] gap-3 items-start">
          {/* 달력 */}
          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 border-b" style={{ borderColor: 'var(--cc-p8)' }}>
              {DOW.map((d, i) => (
                <div
                  key={d}
                  className={`py-1.5 text-center text-[11px] font-bold ${
                    i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : 'text-slate-500'
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div
                key={wi}
                className="grid grid-cols-7 border-b last:border-b-0"
                style={{ borderColor: 'var(--cc-p8)' }}
              >
                {week.map((c) => {
                  const items = byDate.get(c.dt) || [];
                  const pers = showPersonal ? personalByDate.get(c.dt) || [] : [];
                  const isToday = c.dt === today;
                  const isSel = c.dt === selected;
                  return (
                    <button
                      key={c.dt}
                      onClick={() => setSelected(c.dt)}
                      className={`text-left border-r last:border-r-0 p-1 min-h-[92px] align-top transition-colors ${
                        c.inMonth ? '' : 'bg-[#fbfaff]'
                      } ${isSel ? 'ring-2 ring-inset ring-violet-400' : 'hover:bg-[#faf7ff]'}`}
                      style={{ borderColor: 'var(--cc-p8)' }}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <span
                          className={`text-[12px] font-bold tabular-nums px-1 rounded ${
                            isToday
                              ? 'bg-[#2a2640] text-white'
                              : !c.inMonth
                                ? 'text-slate-300'
                                : c.dow === 0
                                  ? 'text-rose-500'
                                  : c.dow === 6
                                    ? 'text-blue-500'
                                    : 'text-slate-900'
                          }`}
                        >
                          {c.day}
                        </span>
                        {items.length > 0 && (
                          <span className="text-[10px] font-bold text-violet-700">{items.length}</span>
                        )}
                        <div className="flex-1" />
                        {pers.length > 0 &&
                          TA_MEMBERS.map((m) => {
                            const n = pers.filter((p) => p.owner === m.id).length;
                            if (!n) return null;
                            return (
                              <span
                                key={m.id}
                                className="w-1.5 h-1.5 rounded-full inline-block"
                                style={{ background: m.accent }}
                                title={`${m.label} ${n}건`}
                              />
                            );
                          })}
                      </div>
                      <div className="space-y-[2px]">
                        {items.slice(0, 3).map((e) => (
                          <div
                            key={e.id}
                            className={`text-[10.5px] leading-tight rounded px-1 py-[1px] truncate ${
                              e.noShow ? 'bg-slate-100 text-slate-400 line-through' : 'bg-violet-100 text-violet-900'
                            }`}
                            title={e.title}
                          >
                            <span className="tabular-nums font-semibold">{e.tm}</span>{' '}
                            {e.candidate || e.title}
                          </div>
                        ))}
                        {items.length > 3 && (
                          <div className="text-[10px] text-slate-500 pl-1">+{items.length - 3}건</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 선택한 날 상세 */}
          <div className="card p-3 lg:sticky lg:top-2 max-h-[calc(100dvh-190px)] overflow-y-auto">
            <DayHeader dt={selected} today={today} intv={selDay.intv.length} />
            {selDay.intv.length === 0 && (
              <div className="text-[12px] text-slate-400 py-3">이 날 등록된 면접이 없습니다.</div>
            )}
            <div className="space-y-2">
              {selDay.intv.map((e) => (
                <InterviewCard key={e.id} e={e} />
              ))}
            </div>
            {showPersonal && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--cc-p8)' }}>
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-1.5">
                  TA 팀 일정
                </div>
                {TA_MEMBERS.map((m) => {
                  const mine = selDay.pers.filter((p) => p.owner === m.id);
                  return (
                    <div key={m.id} className="mb-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <i className="w-2 h-2 rounded-full inline-block" style={{ background: m.accent }} />
                        <span className="text-[11px] font-semibold text-slate-900">{m.label}</span>
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
            )}
            {fetchedAt && (
              <div className="mt-2 text-[10px] text-slate-400">
                {Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))}초 전 동기화 · 2분마다 자동
                갱신
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 목록 보기 — 날짜별 */
        <div className="space-y-2.5 max-h-[calc(100dvh-190px)] overflow-y-auto pr-1">
          {[...byDate.keys()].sort().map((dt) => (
            <section key={dt} className="card overflow-hidden">
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--cc-p8)', background: '#fcfbff' }}>
                <DayHeader dt={dt} today={today} intv={(byDate.get(dt) || []).length} inline />
              </div>
              <div className="p-2.5 space-y-2">
                {(byDate.get(dt) || []).map((e) => (
                  <InterviewCard key={e.id} e={e} />
                ))}
                {showPersonal &&
                  (personalByDate.get(dt) || []).length > 0 &&
                  TA_MEMBERS.map((m) => {
                    const mine = (personalByDate.get(dt) || []).filter((p) => p.owner === m.id);
                    if (!mine.length) return null;
                    return (
                      <div key={m.id} className="pl-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <i className="w-2 h-2 rounded-full inline-block" style={{ background: m.accent }} />
                          <span className="text-[11px] font-semibold text-slate-900">{m.label}</span>
                        </div>
                        <div className="space-y-1 pl-3.5">
                          {mine.map((p) => (
                            <PersonalChip key={p.id} p={p} accent={m.accent} soft={m.soft} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>
          ))}
          {byDate.size === 0 && (
            <div className="card p-10 text-center text-slate-500 text-sm">
              이 기간에 등록된 면접이 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DayHeader({
  dt,
  today,
  intv,
  inline,
}: {
  dt: string;
  today: string;
  intv: number;
  inline?: boolean;
}) {
  const [, mm, dd] = dt.split('-');
  const dow = DOW[new Date(`${dt}T00:00:00+09:00`).getDay()];
  const isToday = dt === today;
  return (
    <div className={`flex items-center gap-2 ${inline ? '' : 'mb-2'}`}>
      <span className="text-[16px] font-bold text-slate-900 tabular-nums">
        {Number(mm)}/{Number(dd)}
      </span>
      <span
        className={`text-[13px] font-semibold ${
          dow === '토' ? 'text-blue-600' : dow === '일' ? 'text-rose-600' : 'text-slate-700'
        }`}
      >
        ({dow})
      </span>
      {isToday && <span className="chip bg-[#2a2640] text-white">오늘</span>}
      <div className="flex-1" />
      <span className="text-[12px] font-semibold text-violet-800">면접 {intv}건</span>
    </div>
  );
}

function InterviewCard({ e }: { e: AgendaInterview }) {
  const shared = e.attendees.length > 0;
  return (
    <div
      className="rounded-xl border bg-white px-2.5 py-2"
      style={{ borderColor: 'var(--cc-p8)', borderLeft: '4px solid #7c3aed' }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[13px] font-bold text-slate-900 tabular-nums">{e.tm || '종일'}</span>
        {e.endTm && <span className="text-[10px] text-slate-400 tabular-nums">~{e.endTm}</span>}
        <span
          className={`text-[14px] font-bold ${e.noShow ? 'line-through text-slate-400' : 'text-slate-900'}`}
        >
          {e.candidate || '(이름 미상)'}
        </span>
        {e.noShow && <span className="chip bg-rose-100 text-rose-700">불참</span>}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
        {e.team && <span className="chip bg-slate-100 text-slate-800">{e.team}</span>}
        {e.site && <span className="chip bg-violet-50 text-violet-800">{e.site}</span>}
        {(e.room || e.location) && (
          <span className="text-[10.5px] text-slate-600 truncate">📍 {e.room || e.location}</span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[10.5px]">
        <span className={shared ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'}>
          {shared ? `🟢 공유됨 · ${e.attendees.length}명` : '🔴 미공유'}
        </span>
        {shared && (
          <span className="text-slate-500 truncate" title={e.attendees.map(personLabel).join(', ')}>
            {e.attendees.map(personLabel).join(', ')}
          </span>
        )}
        {e.htmlLink && (
          <a
            href={e.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-slate-400 hover:text-violet-700"
            title="구글 캘린더에서 열기"
          >
            ↗
          </a>
        )}
      </div>
    </div>
  );
}

function PersonalChip({ p, accent, soft }: { p: PersonalEvent; accent: string; soft: string }) {
  const time = p.allDay ? '종일' : p.endTm ? `${p.tm}–${p.endTm}` : p.tm;
  return (
    <div
      className="flex items-start gap-2 rounded-lg px-2 py-1 text-[11px]"
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
