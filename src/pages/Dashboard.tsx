import { useMemo, useState } from 'react';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { gmailSearchUrl } from '../lib/gmail';
import { api } from '../lib/api';
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

function startOfMonth(ymd: string): string {
  return ymd.slice(0, 7) + '-01';
}

function endOfMonth(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00');
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

// 면접 타이틀 파서 — "HH:MM / 사이트 / 후보자 / 팀(직무)" 표준 + 변형 대응
function parseTitle(title: string): { time?: string; site?: string; team?: string } {
  if (!title) return {};
  const t = title.trim();
  const parts = t.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  let time: string | undefined, site: string | undefined, team: string | undefined;
  const SITES = ['퍼플', '그린', '수원', '위워크', '온라인', '방교'];
  const TEAMS_HINT = /팀|연구소|본부|실$|센터/;
  for (const p of parts) {
    if (!time) {
      const tm = p.match(/(\d{1,2}:\d{2})/);
      if (tm) { time = tm[1]; continue; }
    }
    if (!site && SITES.some((s) => p.startsWith(s))) {
      site = SITES.find((s) => p.startsWith(s));
      continue;
    }
    if (!team && TEAMS_HINT.test(p)) {
      team = p;
      continue;
    }
  }
  // team이 못 잡혔으면 마지막 파트
  if (!team && parts.length >= 3) team = parts[parts.length - 1];
  return { time, site, team };
}

function shortTeam(team: string): string {
  let s = (team || '').trim();
  // 직무 괄호 제거 — "영업관리팀 (PM)" → "영업관리팀"
  s = s.replace(/\([^)]*\)/g, '').trim();
  // 후행 메모 제거 — "생산/포장2팀 PM 면접 1명" → "생산/포장2팀"
  s = s.replace(/\s*(PM|면접|\d+명).*$/i, '').trim();
  // 너무 긴 건 자름
  if (s.length > 10) s = s.slice(0, 10) + '…';
  return s || '미분류';
}

function timeSlot(tm: string): '오전' | '오후' | '저녁' | '종일' {
  if (!tm || tm === '종일') return '종일';
  const h = parseInt(tm.split(':')[0], 10);
  if (Number.isNaN(h)) return '종일';
  if (h < 12) return '오전';
  if (h < 18) return '오후';
  return '저녁';
}

// 슬래시 포맷 면접 제목에서 후보자 이름 추출 — "10:00 / 퍼플 / 박연수 / 품질관리1팀" → "박연수"
function parseCandidateName(title: string): string {
  if (!title) return '';
  const parts = title.split('/').map((s) => s.trim()).filter(Boolean);
  // 시간·사이트·팀 제외하고 한글 2-4자 이름 토큰 찾기
  for (const p of parts) {
    if (/\d{1,2}:\d{2}/.test(p)) continue;
    if (/팀|연구소|본부|실$|센터/.test(p)) continue;
    if (/^(퍼플|그린|수원|위워크|온라인|방교|서울|판교|강남)/.test(p)) continue;
    const m = p.match(/([가-힣]{2,4})/);
    if (m) return m[1];
  }
  // "○○팀 면접 - 이름" 패턴
  const m2 = title.match(/면접\s*[-—–]\s*([가-힣]{2,4})/);
  if (m2) return m2[1];
  return '';
}

// 이벤트 summary에서 인원수 추출 — "입사 2명: 황영애·김민진" → 2
// 자동 생성된 입사/퇴사 통합 이벤트는 N명을 summary에 명시함.
// 패턴 없으면 1 (이벤트 1개 = 사람 1명 기본).
function peopleInSummary(summary: string): number {
  if (!summary) return 1;
  const m = summary.match(/(\d{1,3})\s*명/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  }
  return 1;
}

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

  const interviews = useMemo(() => allEvents.filter((e) => e.kind === '면접'), [allEvents]);

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

  // 면접 인사이트 — 이번 주 (오늘 ~ +6) + 이번 달
  const insights = useMemo(() => {
    const weekStart = today;
    const weekEnd = ymdAdd(today, 6);
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const weekIntv = interviews.filter((e) => e.dt >= weekStart && e.dt <= weekEnd);
    const monthIntv = interviews.filter((e) => e.dt >= monthStart && e.dt <= monthEnd);
    const todayIntv = interviews.filter((e) => e.dt === today);

    // 부서별 (이번 주)
    const teamMap = new Map<string, number>();
    for (const e of weekIntv) {
      const team = shortTeam(parseTitle(e.title).team || '');
      teamMap.set(team, (teamMap.get(team) || 0) + 1);
    }
    const teamTop = Array.from(teamMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // 사이트별 (이번 주)
    const siteMap = new Map<string, number>();
    for (const e of weekIntv) {
      const site = parseTitle(e.title).site || '미분류';
      siteMap.set(site, (siteMap.get(site) || 0) + 1);
    }
    const siteAll = Array.from(siteMap.entries()).sort((a, b) => b[1] - a[1]);

    // 시간대별 (이번 주)
    const slotMap = new Map<string, number>();
    for (const e of weekIntv) {
      const slot = timeSlot(e.tm);
      slotMap.set(slot, (slotMap.get(slot) || 0) + 1);
    }

    // 면접 → 입사 전환 (이번 달 입사 사람 수 — N명 통합 이벤트 펼침)
    const monthJoin = allEvents
      .filter((e) => e.kind === '입사' && e.dt >= monthStart && e.dt <= monthEnd)
      .reduce((sum, e) => sum + peopleInSummary(e.title), 0);

    return {
      todayCount: todayIntv.length,
      weekCount: weekIntv.length,
      monthCount: monthIntv.length,
      monthIntv, // 익스포트용 (이번 달 면접 시트 생성 시 사용)
      monthJoin,
      teamTop,
      siteAll,
      slotMap,
      weekMax: Math.max(1, ...Array.from(teamMap.values()), ...Array.from(siteMap.values())),
    };
  }, [interviews, allEvents, today]);

  const high = D.missingAlerts.filter((a) => a.priority === 'high');
  const medium = D.missingAlerts.filter((a) => a.priority === 'medium');

  const consistency = useMemo(() => {
    const calIntvNoAtt = allEvents.filter(
      (e) => e.source === 'calendar' && e.kind === '면접' && (!e.attendees || e.attendees.length === 0) && e.dt >= today
    );
    const calJoinKeys = new Set(allEvents.filter((e) => e.source === 'calendar' && e.kind === '입사').map((e) => e.dt));
    const sheetOnlyJoinList = D.calJoin.filter((e) => e.dt >= today && !calJoinKeys.has(e.dt));
    return { calIntvNoAtt: calIntvNoAtt.length, sheetOnlyJoin: sheetOnlyJoinList.length };
  }, [allEvents, D.calJoin, today]);

  const recentMail = D.teamMail.slice(0, 5);

  return (
    <div className="space-y-3">
      <HeroSummary today={today} insights={insights} live={live} />

      <InsightStrip insights={insights} onNavigate={onNavigate} />

      <SevenDayTimeline next7={next7} today={today} onNavigate={onNavigate} />

      <div className="grid lg:grid-cols-2 gap-3">
        <TodayScheduleCard events={todayEvents} onNavigate={onNavigate} />
        <UpcomingList events={upcoming} today={today} onNavigate={onNavigate} />
      </div>

      <BottomStrip
        high={high}
        medium={medium}
        missAttendees={consistency.calIntvNoAtt}
        missJoin={consistency.sheetOnlyJoin}
        recentMail={recentMail}
        onNavigate={onNavigate}
      />
    </div>
  );
}

// ─────────────────────── HERO ───────────────────────

function HeroSummary({
  today,
  insights,
  live,
}: {
  today: string;
  insights: { todayCount: number; weekCount: number; monthCount: number; monthIntv: UnifiedEvent[]; monthJoin: number };
  live: ReturnType<typeof useLiveData>;
}) {
  const [exporting, setExporting] = useState(false);
  const handleExportMonth = async () => {
    if (exporting) return;
    if (insights.monthIntv.length === 0) {
      alert('이번 달 면접 이벤트가 없습니다.');
      return;
    }
    setExporting(true);
    try {
      const headers = ['날짜', '요일', '시간', '후보자', '팀', '사이트', '회의실/장소', '제목', '캘린더 링크'];
      const rows = [...insights.monthIntv]
        .sort((a, b) => (a.dt + a.tm).localeCompare(b.dt + b.tm))
        .map((e) => {
          const p = parseTitle(e.title);
          const candidate = parseCandidateName(e.title);
          return [
            e.dt,
            dowOf(e.dt),
            e.tm,
            candidate,
            p.team ? shortTeam(p.team) : '',
            p.site || '',
            e.location || '',
            e.title,
            e.htmlLink || '',
          ];
        });
      const yyMm = today.slice(0, 7);
      const title = `[CNC] ${yyMm} 면접 명단 (${insights.monthCount}건, 생성: ${today})`;
      const r = await api.google.createSheet(title, headers, rows);
      if (!r.ok) {
        alert(`시트 생성 실패: ${(r as { error?: string }).error || '알 수 없는 오류'}\n\n` +
          '⚠ 첫 사용 시 구글 재로그인 필요 (drive.file 권한 추가됨).\n설정 → Google 로그아웃 후 재로그인 부탁드립니다.');
        return;
      }
      window.open(r.data.url, '_blank');
    } catch (e) {
      alert(`오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };
  const d = new Date(today + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DOW[d.getDay()];
  const dowTone = dow === '일' ? 'text-rose-300' : dow === '토' ? 'text-blue-300' : 'text-indigo-200';

  return (
    <div
      className="relative overflow-hidden rounded-2xl text-white shadow-lg"
      style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)' }}
    >
      <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-indigo-300/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-10 left-1/3 w-40 h-40 rounded-full bg-fuchsia-400/10 blur-3xl pointer-events-none" />
      <div className="relative px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-indigo-200/80 font-bold">TODAY</span>
            <span
              className="text-3xl font-black leading-none tracking-[-0.03em]"
              style={{ background: 'linear-gradient(180deg, #fff, #c7d2fe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
            >
              {month}.{day}
            </span>
            <span className={`text-base font-bold ${dowTone}`}>({dow})</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-indigo-200/70">
            {live.hasLive ? (
              <span className="text-emerald-300 font-semibold">📊 라이브</span>
            ) : (
              <span className="text-amber-300 font-semibold">📦 스냅샷</span>
            )}
            {live.lastTickAt && <span>· {Math.round((Date.now() - live.lastTickAt) / 1000)}s 전</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <BigStat label="오늘 면접" value={insights.todayCount} accent="blue" emphasis />
          <BigStat label="이번 주 면접" value={insights.weekCount} accent="indigo" />
          <BigStat
            label="이번 달 면접"
            value={insights.monthCount}
            accent="violet"
            hint={exporting ? '시트 생성 중…' : '클릭 → 새 구글 시트로 내보내기'}
            onClick={handleExportMonth}
          />
          <BigStat label="이번 달 입사" value={insights.monthJoin} accent="amber" />
        </div>
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  accent,
  emphasis,
  onClick,
  hint,
}: {
  label: string;
  value: number;
  accent: 'blue' | 'indigo' | 'violet' | 'amber';
  emphasis?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  const tone = {
    blue: { bar: 'bg-blue-300', num: 'text-white' },
    indigo: { bar: 'bg-indigo-300', num: 'text-indigo-100' },
    violet: { bar: 'bg-violet-300', num: 'text-violet-100' },
    amber: { bar: 'bg-amber-300', num: 'text-amber-100' },
  }[accent];
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      title={hint}
      className={`relative overflow-hidden rounded-xl px-4 py-3 transition ${
        emphasis ? 'bg-white/15 border border-white/25' : 'bg-white/8 border border-white/15'
      } backdrop-blur ${clickable ? 'cursor-pointer hover:bg-white/25 hover:border-white/40 ring-1 ring-transparent hover:ring-white/30' : ''}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${tone.bar}`} />
      <div className={`text-4xl font-black ${tone.num} tabular-nums leading-none mb-1.5`}>{value}</div>
      <div className="text-[11px] text-indigo-100 font-semibold uppercase tracking-wider flex items-center gap-1">
        {label}
        {clickable && <span className="text-[9px] opacity-70">📊</span>}
      </div>
      {clickable && hint && (
        <div className="text-[9px] text-indigo-200/70 mt-0.5 truncate">{hint}</div>
      )}
    </div>
  );
}

// ─────────────────────── 인사이트 ───────────────────────

function InsightStrip({
  insights,
  onNavigate,
}: {
  insights: {
    teamTop: [string, number][];
    siteAll: [string, number][];
    slotMap: Map<string, number>;
    weekMax: number;
    weekCount: number;
  };
  onNavigate: (p: PageId) => void;
}) {
  const slotItems: { label: string; key: string; tone: string }[] = [
    { label: '오전', key: '오전', tone: 'bg-amber-400' },
    { label: '오후', key: '오후', tone: 'bg-blue-400' },
    { label: '저녁', key: '저녁', tone: 'bg-violet-400' },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <InsightCard
        title="🏢 부서별 면접"
        subtitle="이번 주"
        action={() => onNavigate('calendar')}
        empty={insights.teamTop.length === 0}
      >
        {insights.teamTop.map(([team, count]) => (
          <BarRow key={team} label={team} value={count} max={insights.weekMax} tone="indigo" />
        ))}
      </InsightCard>
      <InsightCard
        title="📍 사이트별 면접"
        subtitle="이번 주"
        action={() => onNavigate('rooms')}
        empty={insights.siteAll.length === 0}
      >
        {insights.siteAll.map(([site, count]) => (
          <BarRow key={site} label={site} value={count} max={insights.weekMax} tone="emerald" />
        ))}
      </InsightCard>
      <InsightCard
        title="🕒 시간대별 면접"
        subtitle="이번 주"
        empty={insights.weekCount === 0}
      >
        {slotItems.map((s) => {
          const v = insights.slotMap.get(s.key) || 0;
          return <BarRow key={s.key} label={s.label} value={v} max={insights.weekMax} tone="violet" />;
        })}
      </InsightCard>
    </div>
  );
}

function InsightCard({
  title,
  subtitle,
  action,
  children,
  empty,
}: {
  title: string;
  subtitle: string;
  action?: () => void;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className="font-bold text-sm text-slate-800">{title}</h3>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">{subtitle}</span>
        </div>
        {action && (
          <button className="text-[11px] text-indigo-600 hover:underline" onClick={action}>
            상세 →
          </button>
        )}
      </div>
      {empty ? (
        <div className="py-4 text-center text-[11px] text-slate-300">데이터 없음</div>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'indigo' | 'emerald' | 'violet';
}) {
  const widthPct = Math.max(2, Math.round((value / Math.max(1, max)) * 100));
  const barBg = { indigo: 'bg-indigo-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500' }[tone];
  const trackBg = { indigo: 'bg-indigo-50', emerald: 'bg-emerald-50', violet: 'bg-violet-50' }[tone];
  return (
    <div className="grid grid-cols-[72px_1fr_28px] items-center gap-2">
      <div className="text-[11px] text-slate-700 font-semibold truncate">{label}</div>
      <div className={`h-4 rounded-full ${trackBg} overflow-hidden`}>
        <div
          className={`h-full ${barBg} rounded-full transition-all`}
          style={{ width: value > 0 ? `${widthPct}%` : 0 }}
        />
      </div>
      <div className="text-[12px] font-black text-slate-800 tabular-nums text-right">{value}</div>
    </div>
  );
}

// ─────────────────────── 7일 트렌드 ───────────────────────

function SevenDayTimeline({
  next7,
  today,
  onNavigate,
}: {
  next7: { dt: string; events: UnifiedEvent[] }[];
  today: string;
  onNavigate: (p: PageId) => void;
}) {
  const maxIntv = Math.max(1, ...next7.map((d) => d.events.filter((e) => e.kind === '면접').length));
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-bold text-sm text-slate-800">📅 다음 7일 면접 트렌드</h3>
          <span className="text-[11px] text-slate-400">일별 건수</span>
        </div>
        <button className="text-[11px] text-indigo-600 hover:underline" onClick={() => onNavigate('calendar')}>
          캘린더 →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {next7.map(({ dt, events }) => {
          const d = new Date(dt + 'T00:00:00');
          const dow = DOW[d.getDay()];
          const isToday = dt === today;
          const dowTone = d.getDay() === 0 ? 'text-rose-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-500';
          const intv = events.filter((e) => e.kind === '면접').length;
          // 입사/퇴사는 N명 통합 이벤트 패턴 흔함 — summary에서 사람 수 합산
          const join = events
            .filter((e) => e.kind === '입사')
            .reduce((sum, e) => sum + peopleInSummary(e.title), 0);
          const leave = events
            .filter((e) => e.kind === '퇴사')
            .reduce((sum, e) => sum + peopleInSummary(e.title), 0);
          const heightPct = intv > 0 ? Math.max(15, Math.round((intv / maxIntv) * 100)) : 0;
          return (
            <div
              key={dt}
              className={`rounded-xl border ${
                isToday ? 'bg-indigo-50/60 border-indigo-300 shadow-sm' : 'bg-slate-50/70 border-slate-100'
              } p-2.5 flex flex-col`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className={`text-lg font-black leading-none ${isToday ? 'text-indigo-700' : 'text-slate-800'}`}>
                  {d.getDate()}
                </span>
                <span className={`text-[10px] font-bold ${dowTone}`}>{isToday ? '오늘' : dow}</span>
              </div>
              {/* 면접 bar */}
              <div className="flex-1 flex items-end h-12 mb-1">
                {intv > 0 ? (
                  <div
                    className="w-full bg-gradient-to-t from-indigo-500 to-blue-400 rounded-md flex items-end justify-center text-white text-[11px] font-black pb-0.5"
                    style={{ height: `${heightPct}%` }}
                  >
                    {intv}
                  </div>
                ) : (
                  <div className="w-full text-center text-[10px] text-slate-300">-</div>
                )}
              </div>
              {/* 입사·퇴사 미니 */}
              <div className="flex items-center justify-center gap-1 text-[9px]">
                {join > 0 && (
                  <span className="px-1 rounded bg-amber-100 text-amber-700 font-bold">입{join}</span>
                )}
                {leave > 0 && (
                  <span className="px-1 rounded bg-pink-100 text-pink-700 font-bold">퇴{leave}</span>
                )}
                {join === 0 && leave === 0 && <span className="text-slate-300">·</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────── 오늘 일정 ───────────────────────

function TodayScheduleCard({ events, onNavigate }: { events: UnifiedEvent[]; onNavigate: (p: PageId) => void }) {
  const intvCount = events.filter((e) => e.kind === '면접').length;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
        <h3 className="font-bold text-sm text-slate-800 flex items-baseline gap-2">
          🗓️ 오늘 일정
          <span className="text-[11px] font-normal text-slate-400">
            {events.length}건 {intvCount > 0 && <span className="text-blue-600 font-bold">· 면접 {intvCount}</span>}
          </span>
        </h3>
        <button className="text-[11px] text-indigo-600 hover:underline" onClick={() => onNavigate('calendar')}>
          전체 →
        </button>
      </div>
      {events.length === 0 ? (
        <div className="py-10 text-center">
          <div className="text-3xl mb-2 opacity-30">🌤️</div>
          <div className="text-[11px] text-slate-400">오늘 예정 없음</div>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {events.map((e, i) => (
            <CompactEventRow key={i} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── 다가오는 일정 ───────────────────────

function UpcomingList({ events, today, onNavigate }: { events: UnifiedEvent[]; today: string; onNavigate: (p: PageId) => void }) {
  const byDate = new Map<string, UnifiedEvent[]>();
  events.forEach((e) => {
    if (!byDate.has(e.dt)) byDate.set(e.dt, []);
    byDate.get(e.dt)!.push(e);
  });
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
        <h3 className="font-bold text-sm text-slate-800 flex items-baseline gap-2">
          🔜 다가오는 7일
          <span className="text-[11px] font-normal text-slate-400">{events.length}건</span>
        </h3>
        <button className="text-[11px] text-indigo-600 hover:underline" onClick={() => onNavigate('calendar')}>
          전체 →
        </button>
      </div>
      {events.length === 0 ? (
        <div className="py-10 text-center text-[11px] text-slate-400">예정 없음</div>
      ) : (
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {Array.from(byDate.entries()).map(([dt, evs]) => {
            const d = diffDays(dt, today);
            return (
              <div key={dt} className="grid grid-cols-[58px_1fr] gap-3">
                <div className="text-right border-r border-slate-100 pr-2 pt-0.5">
                  <div className="font-mono text-sm font-black text-slate-800 leading-none">
                    {dt.slice(5).replace('-', '/')}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{dowOf(dt)}</div>
                  <div className="mt-1 inline-block px-1.5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold">
                    D-{d}
                  </div>
                </div>
                <div className="space-y-1">
                  {evs.map((e, i) => (
                    <CompactEventRow key={i} event={e} />
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

function CompactEventRow({ event }: { event: UnifiedEvent }) {
  const tone = {
    면접: { chip: 'bg-blue-100 text-blue-700', text: 'text-blue-700', border: 'border-blue-100', bg: 'bg-blue-50/40' },
    입사: { chip: 'bg-amber-100 text-amber-700', text: 'text-amber-700', border: 'border-amber-100', bg: 'bg-amber-50/40' },
    퇴사: { chip: 'bg-pink-100 text-pink-700', text: 'text-pink-700', border: 'border-pink-100', bg: 'bg-pink-50/40' },
  }[event.kind];
  const inner = (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${tone.border} ${tone.bg} hover:shadow-sm transition-shadow`}>
      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tone.chip}`}>{event.kind}</span>
      <span className={`font-mono text-[12px] font-bold ${tone.text} w-11 tabular-nums shrink-0`}>{event.tm}</span>
      <span className={`text-[12px] text-slate-700 flex-1 truncate ${event.done ? 'line-through opacity-60' : ''}`}>
        {event.title}
      </span>
      {event.attendees && event.attendees.length > 0 && (
        <span className="text-[10px] text-slate-500 shrink-0">👥{event.attendees.length}</span>
      )}
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

// ─────────────────────── 알림 + 메일 (접힘) ───────────────────────

function BottomStrip({
  high,
  medium,
  missAttendees,
  missJoin,
  recentMail,
  onNavigate,
}: {
  high: MissingAlert[];
  medium: MissingAlert[];
  missAttendees: number;
  missJoin: number;
  recentMail: { dt: string; type: string; subj: string; from: string; to: string }[];
  onNavigate: (p: PageId) => void;
}) {
  const [open, setOpen] = useState(high.length > 0 || missAttendees > 0 || missJoin > 0);
  const alertCount = high.length + medium.length + missAttendees + missJoin;
  return (
    <div className="card p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">{alertCount > 0 ? '⚠️' : '✅'}</span>
          <h3 className="font-bold text-sm text-slate-800">알림 · 메일</h3>
          <span className="text-[11px] text-slate-500">
            {alertCount > 0 ? `${alertCount}건 알림` : '이슈 없음'} · 최근 메일 {recentMail.length}건
          </span>
        </div>
        <span className={`text-slate-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-2">
            {high.length > 0 && (
              <AlertList title="🚨 긴급" alerts={high} accent="rose" />
            )}
            {(missAttendees > 0 || missJoin > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-900 space-y-1">
                {missAttendees > 0 && (
                  <button
                    onClick={() => onNavigate('calendar')}
                    className="block w-full text-left hover:underline"
                  >
                    👥 attendees 누락 면접 <b>{missAttendees}건</b> — 캘린더에서 확인 →
                  </button>
                )}
                {missJoin > 0 && (
                  <button
                    onClick={() => onNavigate('incoming')}
                    className="block w-full text-left hover:underline"
                  >
                    ⚠️ 캘린더 미등록 입사 <b>{missJoin}건</b> — 입사 페이지 확인 →
                  </button>
                )}
              </div>
            )}
            {medium.length > 0 && <AlertList title="📋 진행" alerts={medium} accent="amber" />}
            {alertCount === 0 && (
              <div className="text-[11px] text-slate-400 text-center py-4">알림 없음</div>
            )}
          </div>
          <RecentMail mail={recentMail} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

function AlertList({ title, alerts, accent }: { title: string; alerts: MissingAlert[]; accent: 'rose' | 'amber' }) {
  const tone = accent === 'rose' ? 'text-rose-700' : 'text-amber-700';
  return (
    <div>
      <h4 className={`font-bold text-[12px] mb-1.5 ${tone}`}>
        {title} <span className="text-[10px] font-normal text-slate-400">({alerts.length})</span>
      </h4>
      <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
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

function RecentMail({
  mail,
  onNavigate,
}: {
  mail: { dt: string; type: string; subj: string; from: string; to: string }[];
  onNavigate: (p: PageId) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="font-bold text-[12px] text-slate-800">✉️ 최근 메일</h4>
        <button className="text-[10px] text-indigo-600 hover:underline" onClick={() => onNavigate('mail')}>
          전체 →
        </button>
      </div>
      <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
        {mail.length === 0 && <div className="text-[11px] text-slate-400 py-3 text-center">최근 메일 없음</div>}
        {mail.map((m, i) => (
          <a
            key={i}
            href={gmailSearchUrl({ subject: m.subj })}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-1.5 rounded-md bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 transition-all"
          >
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
              <span>{m.dt}</span>
              <span className="px-1 rounded bg-violet-100 text-violet-700 text-[9px] font-bold">{m.type}</span>
            </div>
            <div className="text-[12px] font-semibold text-slate-800 truncate">{m.subj}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
