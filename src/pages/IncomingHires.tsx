import { useMemo, useState } from 'react';
import { useLiveData, liveByKindOrScan } from '../store/liveData';
import { getTodayStr } from '../store';
import { parseSheetDate, field, fmtDateLabel } from '../lib/sheetParse';

type SiteTone = 'purple' | 'green' | 'suwon' | 'gray';
type ApprovalStatus = 'approved' | 'pending' | 'unknown';

interface HireRow {
  date: string;
  bonbu: string;
  team: string;
  job: string;
  rank: string;
  career: string;
  name: string;
  gender: string;
  birthYear: string;
  site: string;
  jikgu: string;
  noteRaw: string;
  approval: ApprovalStatus;
  approvalLink: string | null;
}

const SITE_STYLE: Record<SiteTone, { chip: string; bar: string; label: string }> = {
  purple: { chip: 'bg-purple-100 text-purple-800 border-purple-200', bar: 'bg-purple-500', label: '퍼플' },
  green: { chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', bar: 'bg-emerald-500', label: '그린' },
  suwon: { chip: 'bg-sky-100 text-sky-800 border-sky-200', bar: 'bg-sky-500', label: '수원' },
  gray: { chip: 'bg-slate-100 text-slate-700 border-slate-200', bar: 'bg-slate-300', label: '기타' },
};

function classifySite(siteName: string): SiteTone {
  const s = (siteName || '').trim();
  if (!s) return 'gray';
  if (s.includes('퍼플')) return 'purple';
  if (s.includes('그린')) return 'green';
  if (s.includes('수원')) return 'suwon';
  return 'gray';
}

function classifyApproval(note: string): { status: ApprovalStatus; link: string | null } {
  const n = (note || '').trim();
  if (!n) return { status: 'unknown', link: null };
  if (n.includes('결재중')) return { status: 'pending', link: null };
  // 전자결재 - C&C GW (with or without inline URL)
  if (/전자결재/.test(n) || /C\s*&\s*C\s*GW/i.test(n)) {
    const m = n.match(/(https?:\/\/\S+)/);
    return { status: 'approved', link: m ? m[1] : null };
  }
  return { status: 'unknown', link: null };
}

function parseHireRows(rows: Record<string, string>[]): HireRow[] {
  const out: HireRow[] = [];
  for (const r of rows) {
    const name = field(r, ['성명', '이름']).trim();
    if (!name) continue;
    const dateRaw = field(r, ['입사예정일', '입사일', '입사 예정일', '예정일']).trim();
    const date = parseSheetDate(dateRaw);
    if (!date) continue;
    const noteRaw = field(r, ['비고(채용품의 링크)', '채용품의', '비고']).trim();
    const { status, link } = classifyApproval(noteRaw);
    out.push({
      date,
      bonbu: field(r, ['본부명', '본부']).trim(),
      team: field(r, ['팀명', '팀']).trim(),
      job: field(r, ['직무']).trim(),
      rank: field(r, ['직급']).trim(),
      career: field(r, ['신입/경력', '신입경력']).trim(),
      name,
      gender: field(r, ['성별']).trim(),
      birthYear: field(r, ['출생연도', '출생년도', '생년']).trim(),
      site: field(r, ['근무지']).trim(),
      jikgu: field(r, ['직/간접분류', '직간접분류', '직/간접구분', '직간접']).trim(),
      noteRaw,
      approval: status,
      approvalLink: link,
    });
  }
  return out;
}

export function IncomingHires() {
  const live = useLiveData();
  const today = getTodayStr();
  const [showPast, setShowPast] = useState(false);
  const [siteFilter, setSiteFilter] = useState<'전체' | SiteTone>('전체');
  const [approvalFilter, setApprovalFilter] = useState<'전체' | ApprovalStatus>('전체');
  const [query, setQuery] = useState('');

  const allRows = useMemo<HireRow[]>(() => {
    if (!live.hasLive) return [];
    return parseHireRows(liveByKindOrScan('incoming'));
  }, [live]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => {
      if (!showPast && r.date < today) return false;
      if (siteFilter !== '전체' && classifySite(r.site) !== siteFilter) return false;
      if (approvalFilter !== '전체' && r.approval !== approvalFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.bonbu} ${r.team} ${r.job} ${r.site} ${r.rank}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, showPast, siteFilter, approvalFilter, query, today]);

  const grouped = useMemo(() => {
    const map = new Map<string, HireRow[]>();
    for (const r of filtered) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const summary = useMemo(() => {
    const upcoming = allRows.filter((r) => r.date >= today);
    return {
      total: upcoming.length,
      approved: upcoming.filter((r) => r.approval === 'approved').length,
      pending: upcoming.filter((r) => r.approval === 'pending').length,
      unknown: upcoming.filter((r) => r.approval === 'unknown').length,
      bySite: {
        purple: upcoming.filter((r) => classifySite(r.site) === 'purple').length,
        green: upcoming.filter((r) => classifySite(r.site) === 'green').length,
        suwon: upcoming.filter((r) => classifySite(r.site) === 'suwon').length,
        gray: upcoming.filter((r) => classifySite(r.site) === 'gray').length,
      },
    };
  }, [allRows, today]);

  if (!live.hasLive) {
    return (
      <div className="card p-8 text-sm text-slate-700 text-center">
        ⚠ 라이브 시트 연결이 필요합니다. ⚙️ 설정 / 연동에서 입사예정(정규직)DB 탭을 매핑하세요.
      </div>
    );
  }

  if (allRows.length === 0) {
    return (
      <div className="card p-8 text-sm text-slate-700 text-center">
        매핑된 입사예정자 시트가 비어있거나, "입사예정자(사무직)" kind으로 매핑된 탭이 없습니다.
        <br />
        ⚙️ 설정 / 연동에서 <span className="font-semibold">입사예정(정규직)DB</span> 탭을 추가하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <SummaryCard label="다가오는 입사" count={summary.total} tone="indigo" />
        <SummaryCard label="결재 완료" count={summary.approved} tone="emerald" />
        <SummaryCard label="결재 진행중" count={summary.pending} tone="amber" />
        <SummaryCard label="퍼플" count={summary.bySite.purple} tone="purple" />
        <SummaryCard label="그린" count={summary.bySite.green} tone="green" />
      </div>

      {/* 필터 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-700 font-bold mr-1">근무지:</span>
          <Pill active={siteFilter === '전체'} onClick={() => setSiteFilter('전체')}>전체</Pill>
          <Pill active={siteFilter === 'purple'} onClick={() => setSiteFilter('purple')} tone="purple">퍼플</Pill>
          <Pill active={siteFilter === 'green'} onClick={() => setSiteFilter('green')} tone="green">그린</Pill>
          <Pill active={siteFilter === 'suwon'} onClick={() => setSiteFilter('suwon')} tone="sky">수원</Pill>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <span className="text-xs text-slate-700 font-bold mr-1">결재:</span>
          <Pill active={approvalFilter === '전체'} onClick={() => setApprovalFilter('전체')}>전체</Pill>
          <Pill active={approvalFilter === 'approved'} onClick={() => setApprovalFilter('approved')} tone="emerald">완료</Pill>
          <Pill active={approvalFilter === 'pending'} onClick={() => setApprovalFilter('pending')} tone="amber">결재중</Pill>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <Pill active={showPast} onClick={() => setShowPast((v) => !v)} tone="slate">지난 입사 포함</Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름/팀/직무 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none w-44 text-slate-800"
          />
          <span className="text-xs text-slate-700 font-semibold">{filtered.length}명</span>
        </div>
      </div>

      {/* 날짜별 그룹 */}
      {grouped.length === 0 ? (
        <div className="card p-8 text-sm text-slate-500 text-center">조건에 맞는 입사예정자가 없습니다.</div>
      ) : (
        <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
          {grouped.map(([date, rows]) => (
            <DateGroup key={date} date={date} rows={rows} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

function DateGroup({ date, rows, today }: { date: string; rows: HireRow[]; today: string }) {
  const isToday = date === today;
  const isPast = date < today;
  const hasPending = rows.some((r) => r.approval === 'pending');
  const dateLabel = fmtDateLabel(date, today);
  return (
    <div
      className={`card overflow-hidden ${
        isToday ? 'ring-2 ring-amber-400' : isPast ? 'opacity-60' : ''
      }`}
    >
      <div
        className={`px-4 py-2 flex items-center gap-2 border-b ${
          isToday
            ? 'bg-amber-50 border-amber-200'
            : hasPending
            ? 'bg-amber-50/30 border-slate-200'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        <span className="text-base">📅</span>
        <span className="text-sm font-bold text-slate-800">{dateLabel}</span>
        <span className="chip bg-indigo-100 text-indigo-800 text-[10px]">{rows.length}명</span>
        {hasPending && (
          <span className="chip bg-amber-200 text-amber-900 text-[10px]">⚠ 결재중 포함</span>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <HireRowCard key={`${r.name}-${i}`} row={r} />
        ))}
      </div>
    </div>
  );
}

function HireRowCard({ row }: { row: HireRow }) {
  const tone = classifySite(row.site);
  const siteStyle = SITE_STYLE[tone];
  const isPending = row.approval === 'pending';
  const isUnknown = row.approval === 'unknown';
  return (
    <div
      className={`px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 transition-colors ${
        isPending ? 'bg-amber-50/40' : ''
      }`}
    >
      <div className={`w-1 self-stretch rounded ${siteStyle.bar}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-900">{row.name}</span>
          {row.gender && <span className="text-[11px] text-slate-500">{row.gender}</span>}
          {row.birthYear && <span className="text-[11px] text-slate-500">{row.birthYear}년생</span>}
          <span className={`chip border ${siteStyle.chip} text-[10px]`}>{row.site || '근무지 미정'}</span>
          {row.jikgu && (
            <span className="chip bg-slate-100 text-slate-600 text-[10px]">{row.jikgu}</span>
          )}
        </div>
        <div className="text-[12px] text-slate-700 mt-0.5">
          <span className="font-semibold">{row.bonbu || '본부 미정'}</span>
          {row.team && <span className="text-slate-500"> · {row.team}</span>}
          {row.job && <span> / <span className="text-indigo-700 font-semibold">{row.job}</span></span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-1">
          {row.rank && <span className="chip bg-slate-100 text-slate-700 text-[10px]">{row.rank}</span>}
          {row.career && <span className="chip bg-slate-100 text-slate-700 text-[10px]">{row.career}</span>}
        </div>
        {isPending ? (
          <span className="chip bg-amber-200 text-amber-900 text-[10px] font-bold">⏳ 결재중</span>
        ) : isUnknown ? (
          <span className="chip bg-slate-200 text-slate-700 text-[10px]">상태 미상</span>
        ) : row.approvalLink ? (
          <a
            href={row.approvalLink}
            target="_blank"
            rel="noreferrer"
            className="chip bg-emerald-100 text-emerald-800 text-[10px] font-bold hover:bg-emerald-200"
          >
            ✓ 결재완료 ↗
          </a>
        ) : (
          <span className="chip bg-emerald-100 text-emerald-800 text-[10px] font-bold">✓ 결재완료</span>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'indigo' | 'emerald' | 'amber' | 'purple' | 'green';
}) {
  const palette = {
    indigo: { bg: 'bg-indigo-50', num: 'text-indigo-700', bar: 'bg-indigo-500' },
    emerald: { bg: 'bg-emerald-50', num: 'text-emerald-700', bar: 'bg-emerald-500' },
    amber: { bg: 'bg-amber-50', num: 'text-amber-700', bar: 'bg-amber-500' },
    purple: { bg: 'bg-purple-50', num: 'text-purple-700', bar: 'bg-purple-500' },
    green: { bg: 'bg-emerald-50', num: 'text-emerald-700', bar: 'bg-emerald-500' },
  }[tone];
  return (
    <div className={`card p-2.5 relative overflow-hidden ${palette.bg}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${palette.bar}`} />
      <div className="flex items-baseline justify-between ml-1.5">
        <span className={`text-[10px] uppercase tracking-[0.18em] font-bold ${palette.num}`}>
          {label}
        </span>
        <div className="flex items-baseline gap-0.5">
          <span className={`text-2xl font-black tabular-nums ${palette.num}`}>{count}</span>
          <span className="text-[10px] text-slate-500">명</span>
        </div>
      </div>
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
  tone?: 'purple' | 'green' | 'sky' | 'amber' | 'emerald' | 'slate';
  children: React.ReactNode;
}) {
  let activeBg = 'bg-indigo-600 text-white border-indigo-600';
  let idle = 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300';
  if (tone === 'purple') {
    activeBg = 'bg-purple-600 text-white border-purple-600';
    idle = 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100';
  } else if (tone === 'green') {
    activeBg = 'bg-emerald-600 text-white border-emerald-600';
    idle = 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
  } else if (tone === 'sky') {
    activeBg = 'bg-sky-600 text-white border-sky-600';
    idle = 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100';
  } else if (tone === 'amber') {
    activeBg = 'bg-amber-600 text-white border-amber-600';
    idle = 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100';
  } else if (tone === 'emerald') {
    activeBg = 'bg-emerald-600 text-white border-emerald-600';
    idle = 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
  } else if (tone === 'slate') {
    activeBg = 'bg-slate-700 text-white border-slate-700';
    idle = 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100';
  }
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
        active ? activeBg + ' shadow-sm' : idle
      }`}
    >
      {children}
    </button>
  );
}
