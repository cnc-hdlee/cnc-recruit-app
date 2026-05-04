import { useMemo, useState } from 'react';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { getTodayStr } from '../store';

const CENTER_PATTERNS: { key: string; label: string; matches: RegExp }[] = [
  { key: 'suwon', label: '수원', matches: /수원\s*일자리/ },
  { key: 'anseong', label: '안성', matches: /안성\s*일자리/ },
  { key: 'osan', label: '오산', matches: /오산\s*일자리/ },
  { key: 'hwaseong', label: '화성', matches: /화성\s*일자리/ },
  { key: 'yongin', label: '용인', matches: /용인.*(일자리|박람회)/ },
  { key: 'fair', label: '박람회', matches: /박람회|채용\s*세미나/ },
  { key: 'etc', label: '기타', matches: /일자리|채용센터|고용센터/ },
];

const TONE: Record<string, { bar: string; chip: string; bg: string; ring: string }> = {
  suwon: { bar: 'bg-sky-500', chip: 'bg-sky-100 text-sky-800 border-sky-200', bg: 'bg-sky-50/60', ring: 'ring-sky-300' },
  anseong: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', bg: 'bg-emerald-50/60', ring: 'ring-emerald-300' },
  osan: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-900 border-amber-200', bg: 'bg-amber-50/60', ring: 'ring-amber-300' },
  hwaseong: { bar: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800 border-violet-200', bg: 'bg-violet-50/60', ring: 'ring-violet-300' },
  yongin: { bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800 border-rose-200', bg: 'bg-rose-50/60', ring: 'ring-rose-300' },
  fair: { bar: 'bg-indigo-500', chip: 'bg-indigo-100 text-indigo-800 border-indigo-200', bg: 'bg-indigo-50/60', ring: 'ring-indigo-300' },
  etc: { bar: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 border-slate-200', bg: 'bg-slate-50/60', ring: 'ring-slate-300' },
};

interface JobCenterEvent {
  id: string;
  dt: string;
  tm: string;
  title: string;
  centerKey: string;
  centerLabel: string;
  location: string;
  description: string;
  attendees: string[];
  htmlLink: string | null;
  conferenceUrl: string | null;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function classifyCenter(text: string): { key: string; label: string } | null {
  for (const c of CENTER_PATTERNS) {
    if (c.matches.test(text)) return { key: c.key, label: c.label };
  }
  return null;
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((da - db) / 86400000);
}

export function JobCenters() {
  const live = useLiveData();
  const today = getTodayStr();
  const [centerFilter, setCenterFilter] = useState<string>('전체');
  const [showPast, setShowPast] = useState(false);
  const [query, setQuery] = useState('');

  const allEvents = useMemo<JobCenterEvent[]>(() => {
    const out: JobCenterEvent[] = [];
    for (const e of liveCalendarEventsNormalized()) {
      const haystack = `${e.title} ${e.location} ${e.raw.description || ''}`;
      const center = classifyCenter(haystack);
      if (!center) continue;
      out.push({
        id: e.id,
        dt: e.dt,
        tm: e.tm,
        title: e.title,
        centerKey: center.key,
        centerLabel: center.label,
        location: e.location,
        description: (e.raw.description || '').replace(/<[^>]+>/g, ' ').slice(0, 240),
        attendees: e.attendees,
        htmlLink: e.htmlLink,
        conferenceUrl: e.raw.conferenceUrl ?? null,
      });
    }
    return out;
  }, [live.calendarEvents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEvents
      .filter((e) => showPast || e.dt >= today)
      .filter((e) => centerFilter === '전체' || e.centerKey === centerFilter)
      .filter((e) => {
        if (!q) return true;
        const hay = `${e.title} ${e.location} ${e.description}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) =>
        (a.dt + (a.tm === '종일' ? '00:00' : a.tm)).localeCompare(b.dt + (b.tm === '종일' ? '00:00' : b.tm))
      );
  }, [allEvents, centerFilter, showPast, today, query]);

  const counts = useMemo(() => {
    const upcoming = allEvents.filter((e) => e.dt >= today);
    const byCenter: Record<string, number> = {};
    for (const c of CENTER_PATTERNS) byCenter[c.key] = 0;
    for (const e of upcoming) byCenter[e.centerKey] = (byCenter[e.centerKey] || 0) + 1;
    return { total: upcoming.length, byCenter };
  }, [allEvents, today]);

  return (
    <div className="space-y-3">
      {/* 센터별 카드 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {CENTER_PATTERNS.map((c) => {
          const tone = TONE[c.key];
          const n = counts.byCenter[c.key] || 0;
          return (
            <button
              key={c.key}
              onClick={() => setCenterFilter((cur) => (cur === c.key ? '전체' : c.key))}
              className={`card p-2.5 relative overflow-hidden text-left ${tone.bg} ${
                centerFilter === c.key ? `ring-2 ${tone.ring}` : ''
              } hover:opacity-90 transition`}
            >
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${tone.bar}`} />
              <div className="ml-1.5 flex items-baseline justify-between">
                <span className="text-[11px] font-bold text-slate-700">{c.label}</span>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-xl font-black tabular-nums text-slate-800">{n}</span>
                  <span className="text-[9px] text-slate-500">건</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 필터 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={centerFilter === '전체'} onClick={() => setCenterFilter('전체')}>
            전체 ({counts.total})
          </Pill>
          <Pill active={showPast} onClick={() => setShowPast((v) => !v)}>
            지난 일정 포함
          </Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="센터/장소 검색..."
            className="ml-auto px-3 py-1.5 rounded-full text-sm bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none w-56 text-slate-700"
          />
          <span className="text-xs text-slate-700 font-semibold">{filtered.length}건</span>
        </div>
      </div>

      {/* 일정 리스트 */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-2 opacity-40">🏢</div>
          <div className="text-sm text-slate-400">표시할 일자리센터 일정이 없습니다.</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
          {filtered.map((e) => (
            <CenterRow key={e.id} event={e} today={today} />
          ))}
        </div>
      )}

      {/* 가이드 */}
      <div className="card p-3 bg-indigo-50/40 border-indigo-100 text-[11px] text-slate-600">
        💡 일자리센터/박람회 일정은 캘린더 제목·장소·설명에 "{`수원/안성/오산/화성/용인 일자리`}" 등 키워드가 들어간 이벤트를 자동 분류합니다.
        새 일정은 60초 안에 반영됩니다.
      </div>
    </div>
  );
}

function CenterRow({ event, today }: { event: JobCenterEvent; today: string }) {
  const tone = TONE[event.centerKey];
  const d = new Date(event.dt + 'T00:00:00');
  const dow = DOW[d.getDay()];
  const isToday = event.dt === today;
  const isPast = event.dt < today;
  const dDelta = diffDays(event.dt, today);
  const dayLabel =
    dDelta === 0 ? '오늘' : dDelta === 1 ? '내일' : dDelta > 0 ? `D-${dDelta}` : `D+${-dDelta}`;
  const inner = (
    <div
      className={`card p-3 hover:shadow-md transition-all ${isPast ? 'opacity-60' : ''} ${
        isToday ? `ring-2 ${tone.ring}` : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-1 self-stretch rounded ${tone.bar}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`chip border ${tone.chip} text-[10px] font-bold`}>{event.centerLabel}</span>
            <span className="text-sm font-bold text-slate-900">
              {d.getMonth() + 1}.{d.getDate()}({dow})
            </span>
            <span className="text-[10px] font-bold text-slate-500">{dayLabel}</span>
            <span className="font-mono font-extrabold text-blue-700">{event.tm}</span>
          </div>
          <div className="text-sm font-medium text-slate-800 truncate">{event.title}</div>
          {event.location && (
            <div className="text-[12px] text-slate-600 mt-0.5">📍 {event.location}</div>
          )}
          {event.description && (
            <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{event.description}</div>
          )}
          {(event.attendees.length > 0 || event.conferenceUrl) && (
            <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-3 flex-wrap">
              {event.attendees.length > 0 && <span>👥 {event.attendees.length}명</span>}
              {event.conferenceUrl && (
                <a
                  href={event.conferenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  📹 Meet
                </a>
              )}
            </div>
          )}
        </div>
      </div>
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
