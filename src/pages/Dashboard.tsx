import { useMemo } from 'react';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { gmailSearchUrl } from '../lib/gmail';
import type { PageId, MissingAlert } from '../types';

type EventKind = '면접' | '입사' | '퇴사';

interface UnifiedEvent {
  dt: string;
  tm: string;
  title: string;
  kind: EventKind;
  source: 'sheet' | 'calendar';
  htmlLink?: string | null;
  done?: boolean;
  attendees?: string[];
  location?: string;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function ymdAdd(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dowOf(ymd: string): string {
  return DOW[new Date(ymd + 'T00:00:00').getDay()];
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((da - db) / 86400000);
}

interface KindTone {
  bar: string;
  text: string;
  bg: string;
  chip: string;
  label: string;
  border: string;
}

const KIND_TONE: Record<EventKind, KindTone> = {
  면접: { bar: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', chip: 'bg-blue-100 text-blue-700', border: 'border-blue-200', label: '면접' },
  입사: { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', chip: 'bg-amber-100 text-amber-700', border: 'border-amber-200', label: '입사' },
  퇴사: { bar: 'bg-pink-500', text: 'text-pink-700', bg: 'bg-pink-50', chip: 'bg-pink-100 text-pink-700', border: 'border-pink-200', label: '퇴사' },
};

export function Dashboard({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();

  const allEvents = useMemo<UnifiedEvent[]>(() => {
    const sheet: UnifiedEvent[] = [
      ...D.calIntv.map((e) => ({ ...e, kind: '면접' as const, source: 'sheet' as const })),
      ...D.calJoin.map((e) => ({ ...e, kind: '입사' as const, source: 'sheet' as const })),
      ...D.calLeave.map((e) => ({ ...e, kind: '퇴사' as const, source: 'sheet' as const })),
    ];
    const cal: UnifiedEvent[] = liveCalendarEventsNormalized()
      .filter((e) => e.kind !== '기타')
      .map((e) => ({
        dt: e.dt,
        tm: e.tm,
        title: e.title,
        kind: e.kind as EventKind,
        source: 'calendar' as const,
        htmlLink: e.htmlLink,
        location: e.location,
        attendees: e.attendees,
      }));
    const merged = [...sheet, ...cal];
    const seen = new Set<string>();
    const out: UnifiedEvent[] = [];
    for (const e of merged) {
      const k = `${e.kind}|${e.dt}|${e.tm}|${(e.title || '').trim().slice(0, 30)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out;
  }, [D.calIntv, D.calJoin, D.calLeave, live.calendarEvents]);

  const todayEvents = useMemo(
    () =>
      allEvents
        .filter((e) => e.dt === today)
        .sort((a, b) => (a.tm === '종일' ? '00:00' : a.tm).localeCompare(b.tm === '종일' ? '00:00' : b.tm)),
    [allEvents, today]
  );

  const next7 = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const dt = ymdAdd(today, i);
      return { dt, events: allEvents.filter((e) => e.dt === dt) };
    });
  }, [allEvents, today]);

  const upcoming = useMemo(
    () =>
      allEvents
        .filter((e) => e.dt > today && e.dt <= ymdAdd(today, 7))
        .sort((a, b) => (a.dt + a.tm).localeCompare(b.dt + b.tm)),
    [allEvents, today]
  );

  const high = D.missingAlerts.filter((a) => a.priority === 'high');
  const medium = D.missingAlerts.filter((a) => a.priority === 'medium');
  const low = D.missingAlerts.filter((a) => a.priority === 'low');

  const consistency = useMemo(() => {
    const calIntvNoAtt = allEvents.filter(
      (e) => e.source === 'calendar' && e.kind === '면접' && (!e.attendees || e.attendees.length === 0) && e.dt >= today
    );
    const calJoinKeys = new Set(allEvents.filter((e) => e.source === 'calendar' && e.kind === '입사').map((e) => e.dt));
    const sheetOnlyJoinList = D.calJoin.filter((e) => e.dt >= today && !calJoinKeys.has(e.dt));
    const groupedMap = new Map<string, { dt: string; titles: string[] }>();
    for (const e of sheetOnlyJoinList) {
      if (!groupedMap.has(e.dt)) groupedMap.set(e.dt, { dt: e.dt, titles: [] });
      groupedMap.get(e.dt)!.titles.push(e.title);
    }
    const sheetOnlyJoin = Array.from(groupedMap.values()).sort((a, b) => a.dt.localeCompare(b.dt));
    return { calIntvNoAtt, sheetOnlyJoin };
  }, [allEvents, D.calJoin, today]);

  const recentMail = D.teamMail.slice(0, 4);

  const todayCounts = {
    면접: todayEvents.filter((e) => e.kind === '면접').length,
    입사: todayEvents.filter((e) => e.kind === '입사').length,
    퇴사: todayEvents.filter((e) => e.kind === '퇴사').length,
  };
  const weekCounts = {
    면접: allEvents.filter((e) => e.kind === '면접' && e.dt >= today && e.dt <= ymdAdd(today, 7)).length,
    입사: allEvents.filter((e) => e.kind === '입사' && e.dt >= today && e.dt <= ymdAdd(today, 7)).length,
    퇴사: allEvents.filter((e) => e.kind === '퇴사' && e.dt >= today && e.dt <= ymdAdd(today, 7)).length,
  };

  const hasCriticalMisses = high.length > 0 || consistency.calIntvNoAtt.length > 0 || consistency.sheetOnlyJoin.length > 0;

  return (
    <div className="space-y-3">
      <HeroToday today={today} counts={todayCounts} live={live} />

      <SevenDayTimeline next7={next7} today={today} weekCounts={weekCounts} onNavigate={onNavigate} />

      <div className="grid lg:grid-cols-2 gap-3">
        <TodayScheduleCard events={todayEvents} onNavigate={onNavigate} />
        <UpcomingList events={upcoming} today={today} onNavigate={onNavigate} />
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-3">
          {medium.length > 0 && <AlertList title="📋 진행 알림" alerts={medium} accent="amber" />}
          {low.length > 0 && <AlertList title="✅ 참고" alerts={low.slice(0, 6)} accent="emerald" />}
          {medium.length === 0 && low.length === 0 && (
            <div className="card p-3 text-xs text-slate-400 text-center">진행/참고 알림 없음</div>
          )}
        </div>
        <RecentMail mail={recentMail} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

// ───────────────────────── HERO ─────────────────────────

function HeroToday({
  today,
  counts,
  live,
}: {
  today: string;
  counts: Record<EventKind, number>;
  live: ReturnType<typeof useLiveData>;
}) {
  const d = new Date(today + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DOW[d.getDay()];

  return (
    <div
      className="relative overflow-hidden rounded-xl text-white shadow-md"
      style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #4338ca 100%)' }}
    >
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-indigo-300/20 blur-3xl pointer-events-none" />
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[9px] uppercase tracking-[0.25em] text-indigo-200/80 font-bold">TODAY</span>
          <span
            className="text-2xl font-black leading-none tracking-[-0.03em]"
            style={{ background: 'linear-gradient(180deg, #fff, #c7d2fe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            {month}.{day}
          </span>
          <span className={`text-sm font-bold ${dow === '일' ? 'text-rose-300' : dow === '토' ? 'text-blue-300' : 'text-indigo-200'}`}>
            ({dow})
          </span>
          <span className="text-[10px] text-indigo-200/60 ml-1">{today}</span>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-2 min-w-[240px]">
          <HeroStat color="blue" count={counts.면접} label="오늘 면접" />
          <HeroStat color="amber" count={counts.입사} label="오늘 입사" />
          <HeroStat color="pink" count={counts.퇴사} label="오늘 퇴사" />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-indigo-200/70 ml-auto">
          {live.hasLive ? (
            <span className="text-emerald-300 font-semibold">📊 라이브</span>
          ) : (
            <span className="text-amber-300 font-semibold">📦 스냅샷</span>
          )}
          {live.lastTickAt && <span>· {Math.round((Date.now() - live.lastTickAt) / 1000)}s 전</span>}
        </div>
      </div>
    </div>
  );
}

function HeroStat({
  color,
  count,
  label,
}: {
  color: 'blue' | 'amber' | 'pink' | 'red';
  count: number;
  label: string;
}) {
  const numColor = { blue: 'text-blue-200', amber: 'text-amber-200', pink: 'text-pink-200', red: 'text-rose-200' }[color];
  const barColor = { blue: 'bg-blue-300', amber: 'bg-amber-300', pink: 'bg-pink-300', red: 'bg-rose-300' }[color];
  return (
    <div className="rounded-lg px-2.5 py-1.5 bg-white/10 border border-white/15 backdrop-blur relative overflow-hidden flex items-center gap-2">
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${barColor}`} />
      <div className={`text-xl font-black ${numColor} tabular-nums leading-none ml-1`}>{count}</div>
      <div className="text-[10px] text-indigo-100 font-semibold leading-tight">{label}</div>
    </div>
  );
}

// ───────────────────────── 긴급 경보 ─────────────────────────

function CriticalAlerts({
  high,
  calIntvNoAtt,
  sheetOnlyJoin,
  onNavigate,
}: {
  high: MissingAlert[];
  calIntvNoAtt: UnifiedEvent[];
  sheetOnlyJoin: { dt: string; titles: string[] }[];
  onNavigate: (p: PageId) => void;
}) {
  const total = high.length + calIntvNoAtt.length + sheetOnlyJoin.reduce((s, g) => s + g.titles.length, 0);
  return (
    <div className="rounded-xl border-2 border-red-300 bg-gradient-to-br from-red-50 to-rose-50/30 overflow-hidden">
      <div className="px-3 py-2 border-b border-red-200 bg-gradient-to-r from-red-100 to-rose-100/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base animate-breathe">🚨</span>
          <div className="font-bold text-red-800 text-sm">긴급 — 즉시 확인</div>
          <div className="text-[11px] text-red-700/80">{total}건</div>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold">{total}</span>
      </div>
      <div className="p-2 space-y-1.5">
        {high.map((a, i) => (
          <div key={`h-${i}`} className="flex gap-2 p-2 rounded-md bg-white border border-red-100">
            <span className="text-base shrink-0">{a.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-800 text-sm truncate">{a.title}</div>
              <div className="text-[11px] text-slate-500 truncate">{a.desc}</div>
            </div>
            <span className="chip bg-red-100 text-red-700 shrink-0 self-start font-semibold text-[10px]">긴급</span>
          </div>
        ))}
        {calIntvNoAtt.map((e, i) => (
          <div key={`a-${i}`} className="flex gap-2 p-2 rounded-md bg-white border border-amber-100">
            <span className="text-base shrink-0">👥</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-800 text-sm truncate">
                {e.title} <span className="text-slate-400 font-normal">· {e.dt} {e.tm}</span>
              </div>
              <div className="text-[11px] text-amber-700">attendees 누락 — 면접 후보자/면접관 등록 필요</div>
            </div>
            <button onClick={() => onNavigate('calendar')} className="chip bg-amber-100 text-amber-700 shrink-0 self-start hover:bg-amber-200 text-[10px]">
              캘린더 →
            </button>
          </div>
        ))}
        {sheetOnlyJoin.map((g, i) => {
          const d = new Date(g.dt + 'T00:00:00');
          const dow = DOW[d.getDay()];
          const preview = g.titles.slice(0, 3).join(', ') + (g.titles.length > 3 ? ` 외 ${g.titles.length - 3}명` : '');
          return (
            <details key={`s-${i}`} className="group rounded-md bg-white border border-pink-100">
              <summary className="flex gap-2 p-2 cursor-pointer list-none hover:bg-pink-50/50">
                <span className="text-base shrink-0">⚠️</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800 text-sm truncate">
                    {g.dt} ({dow}) 입사 {g.titles.length}명 — 캘린더 미등록
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{preview}</div>
                </div>
                <span className="chip bg-pink-100 text-pink-700 shrink-0 self-start text-[10px]">+{g.titles.length}</span>
                <span className="text-slate-400 self-center text-xs group-open:rotate-90 transition-transform">▶</span>
              </summary>
              <div className="px-3 pb-2 pt-1 grid grid-cols-2 md:grid-cols-3 gap-1">
                {g.titles.map((t, j) => (
                  <div key={j} className="text-[11px] px-2 py-0.5 rounded bg-pink-50 text-slate-700 truncate">
                    {t}
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── 7일 타임라인 ─────────────────────────

function SevenDayTimeline({
  next7,
  today,
  weekCounts,
  onNavigate,
}: {
  next7: { dt: string; events: UnifiedEvent[] }[];
  today: string;
  weekCounts: Record<EventKind, number>;
  onNavigate: (p: PageId) => void;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="font-bold text-sm text-slate-800">📊 다음 7일</h3>
          <div className="text-[11px] text-slate-500">
            면접 <b className="text-blue-700">{weekCounts.면접}</b> · 입사 <b className="text-amber-700">{weekCounts.입사}</b> · 퇴사 <b className="text-pink-700">{weekCounts.퇴사}</b>
          </div>
        </div>
        <button className="btn text-[11px] px-2 py-1" onClick={() => onNavigate('calendar')}>
          캘린더 →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {next7.map(({ dt, events }) => {
          const d = new Date(dt + 'T00:00:00');
          const dow = DOW[d.getDay()];
          const isToday = dt === today;
          const dowTone = d.getDay() === 0 ? 'text-rose-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-500';
          const counts = {
            면접: events.filter((e) => e.kind === '면접').length,
            입사: events.filter((e) => e.kind === '입사').length,
            퇴사: events.filter((e) => e.kind === '퇴사').length,
          };
          const total = counts.면접 + counts.입사 + counts.퇴사;
          return (
            <div
              key={dt}
              className={`rounded-lg p-2 border transition-all ${
                isToday ? 'bg-gradient-to-b from-indigo-50 to-white border-indigo-300 shadow-glow' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className={`text-[18px] font-extrabold leading-none tracking-tight ${isToday ? 'text-indigo-700' : 'text-slate-800'}`}>
                  {d.getDate()}
                </span>
                <span className={`text-[10px] font-semibold ${dowTone}`}>{isToday ? '오늘' : dow}</span>
              </div>
              {total === 0 ? (
                <div className="text-center text-[10px] text-slate-300">-</div>
              ) : (
                <div className="space-y-0.5">
                  {counts.면접 > 0 && <KindBadge kind="면접" count={counts.면접} />}
                  {counts.입사 > 0 && <KindBadge kind="입사" count={counts.입사} />}
                  {counts.퇴사 > 0 && <KindBadge kind="퇴사" count={counts.퇴사} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KindBadge({ kind, count }: { kind: EventKind; count: number }) {
  const t = KIND_TONE[kind];
  return (
    <div className={`flex items-center justify-between px-1.5 py-0.5 rounded ${t.bg}`}>
      <span className={`text-[9px] font-bold ${t.text}`}>{t.label}</span>
      <span className={`text-[10px] font-extrabold ${t.text} tabular-nums`}>{count}</span>
    </div>
  );
}

// ───────────────────────── 오늘 일정 ─────────────────────────

function TodayScheduleCard({ events, onNavigate }: { events: UnifiedEvent[]; onNavigate: (p: PageId) => void }) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
        <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
          🗓️ 오늘의 일정 <span className="text-[11px] font-normal text-slate-400">({events.length}건)</span>
        </h3>
        <button className="btn text-[11px] px-2 py-1" onClick={() => onNavigate('calendar')}>
          전체 →
        </button>
      </div>
      {events.length === 0 ? (
        <div className="py-6 text-center">
          <div className="text-2xl mb-1 opacity-40">🌤️</div>
          <div className="text-[11px] text-slate-400">오늘 예정된 일정 없음</div>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {events.map((e, i) => (
            <CompactEventRow key={i} event={e} dense />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 향후 7일 ─────────────────────────

function UpcomingList({ events, today, onNavigate }: { events: UnifiedEvent[]; today: string; onNavigate: (p: PageId) => void }) {
  const byDate = new Map<string, UnifiedEvent[]>();
  events.forEach((e) => {
    if (!byDate.has(e.dt)) byDate.set(e.dt, []);
    byDate.get(e.dt)!.push(e);
  });
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
        <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
          🔜 향후 7일 <span className="text-[11px] font-normal text-slate-400">({events.length}건)</span>
        </h3>
        <button className="btn text-[11px] px-2 py-1" onClick={() => onNavigate('calendar')}>
          전체 →
        </button>
      </div>
      {events.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-slate-400">예정된 일정 없음</div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {Array.from(byDate.entries()).map(([dt, evs]) => {
            const d = diffDays(dt, today);
            return (
              <div key={dt} className="grid grid-cols-[60px_1fr] gap-2">
                <div className="text-right border-r-2 border-slate-100 pr-2">
                  <div className="font-mono text-sm font-extrabold text-slate-800 leading-tight">
                    {dt.slice(5).replace('-', '/')}
                  </div>
                  <div className="text-[10px] text-slate-500">{dowOf(dt)}</div>
                  <div className="mt-0.5 inline-block px-1.5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold">
                    D-{d}
                  </div>
                </div>
                <div className="space-y-1">
                  {evs.map((e, i) => (
                    <CompactEventRow key={i} event={e} dense />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompactEventRow({ event, dense }: { event: UnifiedEvent; dense?: boolean }) {
  const t = KIND_TONE[event.kind];
  const inner = (
    <div className={`flex items-center gap-2 ${dense ? 'p-1.5' : 'p-2.5'} rounded-md border ${t.border} ${t.bg} hover:shadow-sm transition-shadow`}>
      <span className={`chip ${t.chip} text-[9px] font-semibold py-0`}>{t.label}</span>
      <span className={`font-mono text-[12px] font-bold ${t.text} w-11 tabular-nums shrink-0`}>{event.tm}</span>
      <span className={`text-[12px] text-slate-700 flex-1 truncate ${event.done ? 'line-through opacity-60' : ''}`}>
        {event.title}
        {event.location && <span className="ml-1.5 text-[10px] text-slate-500">📍 {event.location}</span>}
      </span>
      {event.attendees && event.attendees.length > 0 && (
        <span className="text-[10px] text-slate-500 shrink-0">👥{event.attendees.length}</span>
      )}
      {event.source === 'calendar' && <span className="text-[10px] text-slate-400 shrink-0">📅</span>}
    </div>
  );
  if (event.htmlLink) {
    return (
      <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

// ───────────────────────── 알림 + 메일 ─────────────────────────

function AlertList({ title, alerts, accent }: { title: string; alerts: MissingAlert[]; accent: 'amber' | 'emerald' }) {
  const tone = accent === 'amber' ? 'text-amber-700' : 'text-emerald-700';
  return (
    <div className="card p-3">
      <h3 className={`font-bold text-sm mb-2 pb-1.5 border-b border-slate-100 ${tone}`}>
        {title} <span className="text-[11px] font-normal text-slate-400">({alerts.length})</span>
      </h3>
      <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
        {alerts.map((a, i) => (
          <div key={i} className="flex gap-2 text-[12px] p-1.5 rounded-md hover:bg-slate-50">
            <span className="text-sm shrink-0">{a.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-800 text-[12px] truncate">{a.title}</div>
              <div className="text-[10px] text-slate-500 truncate">{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentMail({ mail, onNavigate }: { mail: { dt: string; type: string; subj: string; from: string; to: string }[]; onNavigate: (p: PageId) => void }) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
        <h3 className="font-bold text-sm text-slate-800">✉️ 최근 메일</h3>
        <button className="btn text-[11px] px-2 py-1" onClick={() => onNavigate('mail')}>
          전체 →
        </button>
      </div>
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
        {mail.length === 0 && <div className="text-[11px] text-slate-400 py-4 text-center">최근 메일 없음</div>}
        {mail.map((m, i) => (
          <a
            key={i}
            href={gmailSearchUrl({ subject: m.subj })}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-2 rounded-md bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 border border-slate-100 transition-all cursor-pointer group"
            title="Gmail에서 검색"
          >
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
              <span>{m.dt}</span>
              <span className="chip bg-violet-100 text-violet-700 text-[9px] py-0">{m.type}</span>
            </div>
            <div className="text-[12px] font-semibold text-slate-800 truncate group-hover:text-indigo-700">{m.subj}</div>
            <div className="text-[10px] text-slate-500 truncate">{m.from} → {m.to}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
