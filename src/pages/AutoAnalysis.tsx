import { useMemo, useState } from 'react';
import { useLiveData, liveByKind } from '../store/liveData';
import { useIntegrations, refreshIntegrations } from '../store/integrations';
import { pickField } from '../lib/sheetMapping';
import { buildDossiers, orphanMentions, type CandidateRecord, type CandidateDossier, type MentionRef } from '../lib/autoLink';

export function AutoAnalysis() {
  const live = useLiveData();
  const integ = useIntegrations();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'idle'>('all');

  const candidates: CandidateRecord[] = useMemo(() => {
    if (!live.hasLive) return [];
    const out: CandidateRecord[] = [];
    const seen = new Set<string>();
    const offices = [...liveByKind('office_pipeline'), ...liveByKind('office_interview'), ...liveByKind('incoming')];
    for (const row of offices) {
      const name = pickField(row, ['이름', '성명', '후보자', '지원자']).trim();
      if (!name || name.length < 2 || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        dept: pickField(row, ['부서', '팀', '본부명', '소속']).trim() || undefined,
        job: pickField(row, ['직무', '포지션', '직군']).trim() || undefined,
        rank: pickField(row, ['직급', '직책']).trim() || undefined,
        stage: pickField(row, ['단계', '상태', '진행', '결과']).trim() || undefined,
        source: '사무직',
      });
    }
    const fields = [...liveByKind('field_pipeline'), ...liveByKind('field_incoming')];
    for (const row of fields) {
      const name = pickField(row, ['이름', '성명', '지원자']).trim();
      if (!name || name.length < 2 || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        dept: pickField(row, ['팀', '부서', '사업장']).trim() || undefined,
        job: pickField(row, ['직무', '포지션']).trim() || undefined,
        stage: pickField(row, ['상태', '결과']).trim() || undefined,
        source: '현장직',
      });
    }
    return out;
  }, [live.hasLive, live.snapshots, live.mappings]);

  const dossiers = useMemo(
    () =>
      buildDossiers({
        candidates,
        gmail: integ.gmail,
        calendar: integ.calendar,
        slack: integ.slack,
      }),
    [candidates, integ.gmail, integ.calendar, integ.slack]
  );

  const orphans = useMemo(
    () => orphanMentions({ candidates, gmail: integ.gmail, calendar: integ.calendar }),
    [candidates, integ.gmail, integ.calendar]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dossiers
      .filter((d) => {
        if (filter === 'active' && (d.unread ?? 0) === 0) return false;
        if (filter === 'idle' && (d.unread ?? 0) > 0) return false;
        if (q && !`${d.name} ${d.dept || ''} ${d.job || ''} ${d.stage || ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const aT = Date.parse(a.lastActivity || '0') || 0;
        const bT = Date.parse(b.lastActivity || '0') || 0;
        return bT - aT;
      });
  }, [dossiers, query, filter]);

  const stats = useMemo(() => {
    const total = candidates.length;
    const active = dossiers.filter((d) => (d.unread ?? 0) > 0).length;
    const totalMentions = dossiers.reduce((s, d) => s + d.mentions.length, 0);
    return { total, active, totalMentions };
  }, [candidates, dossiers]);

  const lastSync = Math.min(
    integ.lastGmailAt || Infinity,
    integ.lastCalendarAt || Infinity,
    integ.lastSlackAt || Infinity
  );
  const lastSyncAgo = lastSync !== Infinity ? Math.round((Date.now() - lastSync) / 1000) : null;

  return (
    <div className="space-y-5">
      {/* 헤더 + 통계 */}
      <div className="card p-5 bg-gradient-to-br from-accent-purple/10 via-transparent to-accent-blue/10 border-accent-purple/30">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">🔗 자동 분석 — 후보자 통합 뷰</h2>
            <p className="text-xs text-slate-400 mt-1">
              시트의 후보자 이름을 자동 추출 후, Gmail · Calendar · Slack에서 해당 이름이 언급된 모든 항목을 자동으로 모아 보여드립니다.
            </p>
          </div>
          <button className="btn" onClick={refreshIntegrations}>
            🔄 즉시 새로고침
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="전체 후보자" value={stats.total} tone="purple" />
          <Stat label="최근 14일 활동" value={stats.active} tone="green" />
          <Stat label="전체 언급 수" value={stats.totalMentions} tone="blue" />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
          <SourceTag label="Gmail" count={integ.gmail.length} loading={integ.loading.gmail} ts={integ.lastGmailAt} />
          <SourceTag label="Calendar" count={integ.calendar.length} loading={integ.loading.calendar} ts={integ.lastCalendarAt} />
          <SourceTag label="Slack" count={integ.slack.length} loading={integ.loading.slack} ts={integ.lastSlackAt} />
          {lastSyncAgo !== null && <span className="ml-auto">통합 동기화 {lastSyncAgo}초 전</span>}
        </div>
      </div>

      {/* 필터 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')}>전체 ({stats.total})</Pill>
          <Pill active={filter === 'active'} onClick={() => setFilter('active')} tone="green">최근 활동 있음 ({stats.active})</Pill>
          <Pill active={filter === 'idle'} onClick={() => setFilter('idle')} tone="gray">조용한 후보 ({stats.total - stats.active})</Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·부서·직무 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-bg-deep/60 border border-bg-line focus:border-accent-purple focus:outline-none w-56"
          />
        </div>
      </div>

      {/* 후보자 카드 */}
      {!live.hasLive && (
        <div className="card border-accent-yellow/40 bg-accent-yellow/5 p-4 text-sm text-accent-yellow">
          ⚠ 시트 라이브 연동이 필요합니다. ⚙️ 설정에서 시트를 연결하세요.
        </div>
      )}
      {live.hasLive && candidates.length === 0 && (
        <div className="card p-8 text-sm text-slate-400 text-center">
          후보자 시트(채용 파이프라인 / 입사예정자)가 매핑되어 있지 않거나, 시트에 이름 컬럼이 없어요.
        </div>
      )}
      {filtered.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          {filtered.map((d) => (
            <DossierCard key={d.name} d={d} />
          ))}
        </div>
      )}

      {/* 미분류 멘션 */}
      {orphans.length > 0 && (
        <div className="card border-accent-yellow/40 bg-accent-yellow/5 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-accent-yellow flex items-center gap-2">⚠ 후보자에 매칭되지 않는 채용 관련 항목</h3>
            <span className="chip bg-accent-yellow/20 text-accent-yellow">{orphans.length}건</span>
          </div>
          <p className="text-[11px] text-slate-400 mb-2">
            "면접·입사·채용·CPI·결재" 같은 키워드가 있지만 시트의 후보자 이름과 매칭되지 않아요. 시트 누락 가능성이 있어요.
          </p>
          <div className="space-y-1 text-[12.5px]">
            {orphans.slice(0, 12).map((o, i) => (
              <div key={i} className="flex items-start gap-2 p-1.5 rounded hover:bg-bg-hover/30">
                <span className="text-[10px] mt-1 chip bg-bg-deep/60 text-slate-400">{o.source}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200 truncate">{o.title}</div>
                  <div className="text-[10px] text-slate-500">{(o.date || '').slice(0, 10)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 에러 */}
      {integ.errors.length > 0 && (
        <details className="card p-3 text-xs text-slate-500">
          <summary className="cursor-pointer">최근 동기화 에러 ({integ.errors.length})</summary>
          <ul className="mt-2 space-y-1">
            {integ.errors.slice(-5).map((e, i) => (
              <li key={i}>
                <span className="text-accent-red">[{e.source}]</span> {e.msg}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DossierCard({ d }: { d: CandidateDossier }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? d.mentions : d.mentions.slice(0, 4);
  const hasMentions = d.mentions.length > 0;
  const isHot = (d.unread ?? 0) > 0;

  return (
    <div className={`card p-4 ${isHot ? 'border-accent-green/40' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-100 truncate">{d.name}</h3>
            <span className="chip bg-accent-purple/15 text-accent-purple">{d.source}</span>
            {d.rank && <span className="chip bg-accent-yellow/15 text-accent-yellow">{d.rank}</span>}
            {isHot && <span className="chip bg-accent-green/20 text-accent-green">🔥 활동중 · {d.unread}</span>}
          </div>
          <div className="text-[11.5px] text-slate-400 mt-0.5">
            {d.dept || '부서?'}{d.job ? ` · ${d.job}` : ''}{d.stage ? ` · ${d.stage}` : ''}
          </div>
        </div>
        {d.lastActivity && (
          <div className="text-[10px] text-slate-500 shrink-0 ml-2 text-right">
            {fmtRelDate(d.lastActivity)}
          </div>
        )}
      </div>

      {!hasMentions && (
        <div className="text-[11px] text-slate-600 italic py-2">메일·캘린더·슬랙에서 언급 없음</div>
      )}

      {hasMentions && (
        <div className="space-y-1.5">
          {visible.map((m, i) => (
            <MentionRow key={i} m={m} />
          ))}
          {d.mentions.length > 4 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-accent-blue hover:underline"
            >
              {expanded ? '접기' : `+ ${d.mentions.length - 4}건 더 보기`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MentionRow({ m }: { m: MentionRef }) {
  const tone =
    m.source === 'gmail'
      ? 'border-accent-purple/30 bg-accent-purple/5'
      : m.source === 'calendar'
      ? 'border-accent-blue/30 bg-accent-blue/5'
      : 'border-accent-pink/30 bg-accent-pink/5';
  const icon = m.source === 'gmail' ? '✉️' : m.source === 'calendar' ? '📅' : '💬';
  const Outer: any = m.link ? 'a' : 'div';
  const linkProps = m.link ? { href: m.link, target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <Outer
      {...linkProps}
      className={`block p-2 rounded-lg border ${tone} ${m.link ? 'hover:bg-bg-hover/40 cursor-pointer' : ''} transition-colors`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] text-slate-100 truncate">{m.title}</div>
          {m.snippet && m.snippet !== m.title && (
            <div className="text-[10.5px] text-slate-500 line-clamp-2 mt-0.5">{m.snippet}</div>
          )}
          <div className="text-[10px] text-slate-500 mt-0.5">{fmtRelDate(m.date)}</div>
        </div>
      </div>
    </Outer>
  );
}

function fmtRelDate(d: string): string {
  if (!d) return '';
  const t = Date.parse(d);
  if (isNaN(t)) return d.slice(0, 10);
  const diffMs = Date.now() - t;
  const days = Math.round(diffMs / 86400_000);
  if (Math.abs(days) > 30) return new Date(t).toISOString().slice(0, 10);
  if (days === 0) return '오늘';
  if (days === 1) return '어제';
  if (days > 0) return `${days}일 전`;
  return `${-days}일 후`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'purple' | 'blue' | 'green' }) {
  const c = { purple: 'text-accent-purple', blue: 'text-accent-blue', green: 'text-accent-green' }[tone];
  return (
    <div className="rounded-xl border border-bg-line bg-bg-deep/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tracking-tight mt-0.5 ${c}`}>{value}</div>
    </div>
  );
}

function SourceTag({ label, count, loading, ts }: { label: string; count: number; loading: boolean; ts: number | null }) {
  const ago = ts ? Math.round((Date.now() - ts) / 1000) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-accent-yellow animate-pulse' : ts ? 'bg-accent-green' : 'bg-slate-600'}`} />
      <span>
        {label} {count}건
        {ago !== null && <span className="text-slate-600"> · {ago}초 전</span>}
      </span>
    </span>
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
  tone?: 'green' | 'gray';
  children: React.ReactNode;
}) {
  const activeBg =
    tone === 'green' ? 'bg-accent-green text-white border-accent-green'
    : tone === 'gray' ? 'bg-slate-500 text-white border-slate-500'
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
