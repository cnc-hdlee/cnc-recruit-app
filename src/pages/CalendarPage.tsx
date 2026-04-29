import { useMemo, useState } from 'react';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import type { CalEvent } from '../types';

type Kind = '면접' | '입사' | '퇴사';
type Source = 'sheet' | 'calendar';
interface DayEvent extends CalEvent {
  kind: Kind;
  source: Source;
  htmlLink?: string | null;
  location?: string;
  attendees?: string[];
}

type FilterKind = '전체' | Kind;

export function CalendarPage() {
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();
  const [filter, setFilter] = useState<FilterKind>('전체');
  const [query, setQuery] = useState('');
  const [showPast, setShowPast] = useState(false);

  const allEvents = useMemo<DayEvent[]>(() => {
    const sheetEvents: DayEvent[] = [
      ...D.calIntv.map((e) => ({ ...e, kind: '면접' as const, source: 'sheet' as const })),
      ...D.calJoin.map((e) => ({ ...e, kind: '입사' as const, source: 'sheet' as const })),
      ...D.calLeave.map((e) => ({ ...e, kind: '퇴사' as const, source: 'sheet' as const })),
    ];

    // ★ Google Calendar 이벤트 (snapshot 경유) — 면접/입사/퇴사만 통합, 비공개는 서버에서 이미 필터됨
    const calEvents: DayEvent[] = liveCalendarEventsNormalized()
      .filter((e) => e.kind !== '기타')
      .map((e) => ({
        dt: e.dt,
        tm: e.tm,
        title: e.title,
        kind: e.kind as Kind,
        source: 'calendar' as const,
        htmlLink: e.htmlLink,
        location: e.location,
        attendees: e.attendees,
      }));

    const merged = [...sheetEvents, ...calEvents];
    const seen = new Set<string>();
    const deduped: DayEvent[] = [];
    for (const e of merged) {
      const key = `${e.kind}|${e.dt}|${e.tm}|${(e.title || '').trim().slice(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(e);
    }
    return deduped;
  }, [D.calIntv, D.calJoin, D.calLeave, live.calendarEvents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEvents
      .filter((e) => filter === '전체' || e.kind === filter)
      .filter((e) => showPast || e.dt >= today)
      .filter((e) => !q || e.title.toLowerCase().includes(q))
      .sort((a, b) => (a.dt + (a.tm === '종일' ? '' : a.tm)).localeCompare(b.dt + (b.tm === '종일' ? '' : b.tm)));
  }, [allEvents, filter, query, showPast, today]);

  const grouped = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    for (const e of filtered) {
      if (!map.has(e.dt)) map.set(e.dt, []);
      map.get(e.dt)!.push(e);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { 면접: 0, 입사: 0, 퇴사: 0 };
    allEvents.filter((e) => showPast || e.dt >= today).forEach((e) => (c[e.kind] += 1));
    return c;
  }, [allEvents, showPast, today]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 mr-1">필터:</span>
          <Pill active={filter === '전체'} onClick={() => setFilter('전체')}>전체 ({counts.면접 + counts.입사 + counts.퇴사})</Pill>
          <Pill active={filter === '면접'} onClick={() => setFilter('면접')} tone="blue">면접 ({counts.면접})</Pill>
          <Pill active={filter === '입사'} onClick={() => setFilter('입사')} tone="yellow">입사 ({counts.입사})</Pill>
          <Pill active={filter === '퇴사'} onClick={() => setFilter('퇴사')} tone="pink">퇴사 ({counts.퇴사})</Pill>
          <span className="mx-1 h-4 w-px bg-bg-line" />
          <Pill active={showPast} onClick={() => setShowPast((v) => !v)}>지난 일정 포함</Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-bg-deep/60 border border-bg-line focus:border-accent-purple focus:outline-none w-48"
          />
        </div>
      </div>

      <div className="card p-2">
        {grouped.length === 0 ? (
          <div className="text-sm text-slate-400 py-12 text-center">표시할 일정이 없습니다.</div>
        ) : (
          <div className="divide-y divide-bg-line">
            {grouped.map(([dt, events]) => (
              <DateGroup key={dt} dt={dt} events={events} today={today} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DateGroup({ dt, events, today }: { dt: string; events: DayEvent[]; today: string }) {
  const d = new Date(dt + 'T00:00:00');
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const isToday = dt === today;
  const isPast = dt < today;
  const dowTone = d.getDay() === 0 ? 'text-accent-red' : d.getDay() === 6 ? 'text-accent-blue' : 'text-slate-400';

  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 p-3 hover:bg-bg-hover/20">
      <div className={`text-sm ${isPast ? 'opacity-50' : ''}`}>
        <div className="font-mono font-semibold text-slate-200">{dt.slice(5).replace('-', '/')}</div>
        <div className={`text-xs ${dowTone}`}>{dow}요일</div>
        {isToday && <div className="mt-1 chip bg-accent-purple/20 text-accent-purple text-[10px]">오늘</div>}
      </div>
      <div className="space-y-1.5">
        {events.map((e, i) => (
          <EventRow key={i} event={e} />
        ))}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: DayEvent }) {
  const tone =
    event.kind === '면접'
      ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30'
      : event.kind === '입사'
      ? 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30'
      : 'bg-accent-pink/15 text-accent-pink border-accent-pink/30';
  const content = (
    <>
      <span className="chip text-[10px] font-medium shrink-0">{event.kind}</span>
      <span className="font-mono text-xs text-slate-300 w-14 shrink-0">{event.tm || '종일'}</span>
      <span className={`text-sm flex-1 truncate ${event.done ? 'line-through' : 'text-slate-100'}`}>
        {event.title}
        {event.location && (
          <span className="ml-2 text-[11px] text-slate-400">📍 {event.location}</span>
        )}
      </span>
      {event.source === 'calendar' && (
        <span className="chip text-[10px] bg-bg-deep/60 text-slate-400 shrink-0" title="Google Calendar">📅</span>
      )}
      {event.done && <span className="text-[10px] text-slate-500 shrink-0">✓ 완료</span>}
    </>
  );

  if (event.htmlLink) {
    return (
      <a
        href={event.htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 p-2 rounded-lg border ${tone} ${event.done ? 'opacity-60' : ''} hover:brightness-125`}
      >
        {content}
      </a>
    );
  }

  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg border ${tone} ${event.done ? 'opacity-60' : ''}`}>
      {content}
    </div>
  );
}

function Pill({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: 'blue' | 'green' | 'pink' | 'yellow';
  children: React.ReactNode;
}) {
  const activeBg =
    tone === 'blue'
      ? 'bg-accent-blue text-white border-accent-blue'
      : tone === 'green'
      ? 'bg-accent-green text-white border-accent-green'
      : tone === 'yellow'
      ? 'bg-accent-yellow text-bg-deep border-accent-yellow'
      : tone === 'pink'
      ? 'bg-accent-pink text-white border-accent-pink'
      : 'bg-accent-purple text-white border-accent-purple';
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
        active ? activeBg : 'bg-bg-card/40 text-slate-300 border-bg-line hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}
