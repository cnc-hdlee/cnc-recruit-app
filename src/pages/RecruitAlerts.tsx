// 채용 알림 — 두 가지 핵심 알림을 한 페이지에 모음
//   1) 미충원 노화 트래커: 채용요청 시트에서 며칠째 안 채워진 자리 자동 추출
//   2) 면접 결과 미입력: 면접일 지났는데 결과/평가 컬럼 비어있는 후보자

import { useMemo, useState } from 'react';
import { useLiveData, liveByKindOrScan } from '../store/liveData';
import { getTodayStr } from '../store';
import { parseSheetDate, field, diffDays, fmtDateLabel } from '../lib/sheetParse';

// ---------- 1) 미충원 노화 트래커 ----------

interface OpenRequest {
  bonbu: string;
  team: string;
  job: string;
  rank: string;
  career: string;
  requestDate: string; // ISO
  daysOpen: number;
  status: string;
  noteRaw: string;
  link: string | null;
}

const CLOSED_PATTERNS = [
  /충원\s*완료/, /채용\s*완료/, /입사\s*완료/, /완료/,
  /채용\s*취소/, /취소/, /보류/, /HOLD/i, /드랍/, /드롭/,
];

function isClosed(status: string, note: string): boolean {
  const hay = `${status} ${note}`;
  return CLOSED_PATTERNS.some((p) => p.test(hay));
}

function parseOpenRequests(rows: Record<string, string>[], today: string): OpenRequest[] {
  const out: OpenRequest[] = [];
  for (const r of rows) {
    const job = field(r, ['직무', '포지션', '모집포지션']).trim();
    const team = field(r, ['팀명', '팀']).trim();
    if (!job && !team) continue;
    const reqRaw = field(r, ['요청일', '접수일', '품의일자', '의뢰일', '품의일', '등록일']).trim();
    const requestDate = parseSheetDate(reqRaw);
    if (!requestDate) continue;
    const status = field(r, ['상태', '진행상태', '진행', '결재상태']).trim();
    const noteRaw = field(r, ['비고', '메모']).trim();
    if (isClosed(status, noteRaw)) continue;
    const days = diffDays(today, requestDate);
    if (days < 0) continue; // future-dated 요청은 skip
    const linkMatch = noteRaw.match(/(https?:\/\/\S+)/);
    out.push({
      bonbu: field(r, ['본부명', '본부']).trim(),
      team,
      job,
      rank: field(r, ['직급']).trim(),
      career: field(r, ['신입/경력', '신입경력', '경력']).trim(),
      requestDate,
      daysOpen: days,
      status,
      noteRaw,
      link: linkMatch ? linkMatch[1] : null,
    });
  }
  return out.sort((a, b) => b.daysOpen - a.daysOpen);
}

function ageBucket(d: number): { key: 'fresh' | 'attention' | 'overdue' | 'critical'; label: string; tone: string } {
  if (d <= 14) return { key: 'fresh', label: '14일 이내', tone: 'emerald' };
  if (d <= 30) return { key: 'attention', label: '15~30일', tone: 'sky' };
  if (d <= 60) return { key: 'overdue', label: '31~60일', tone: 'amber' };
  return { key: 'critical', label: '60일+ 장기', tone: 'rose' };
}

// ---------- 2) 면접 결과 미입력 ----------

interface PendingInterviewResult {
  candidate: string;
  job: string;
  team: string;
  rank: string;
  intvDate: string; // ISO
  daysSince: number;
  stage: string;
  noteRaw: string;
}

function parsePendingResults(rows: Record<string, string>[], today: string): PendingInterviewResult[] {
  const out: PendingInterviewResult[] = [];
  for (const r of rows) {
    const candidate = field(r, ['후보자', '성명', '이름', '지원자']).trim();
    if (!candidate) continue;
    const dateRaw = field(r, ['면접일자', '면접일', '면접 일자', '일자', '진행일']).trim();
    const intvDate = parseSheetDate(dateRaw);
    if (!intvDate) continue;
    const days = diffDays(today, intvDate);
    if (days <= 0) continue; // 미래/오늘 면접은 skip — 결과 입력 시간 필요
    // 결과/평가/판정 컬럼 비어 있나?
    const result = field(r, ['결과', '평가', '판정', '면접결과', '평가결과', '합격여부']).trim();
    if (result) continue;
    out.push({
      candidate,
      job: field(r, ['직무', '포지션']).trim(),
      team: field(r, ['팀명', '팀', '본부']).trim(),
      rank: field(r, ['직급']).trim(),
      intvDate,
      daysSince: days,
      stage: field(r, ['단계', '진행단계', '면접단계', '차수']).trim(),
      noteRaw: field(r, ['비고', '메모']).trim(),
    });
  }
  return out.sort((a, b) => b.daysSince - a.daysSince);
}

// ---------- 페이지 ----------

export function RecruitAlerts() {
  const live = useLiveData();
  const today = getTodayStr();
  const [bucketFilter, setBucketFilter] = useState<'전체' | 'overdue+'>('전체');
  const [query, setQuery] = useState('');

  const openRequests = useMemo(() => {
    if (!live.hasLive) return [];
    return parseOpenRequests(liveByKindOrScan('recruit_request'), today);
  }, [live, today]);

  const pendingResults = useMemo(() => {
    if (!live.hasLive) return [];
    // office_interview + field_pipeline 둘 다 결과 입력 누락 검사
    const a = parsePendingResults(liveByKindOrScan('office_interview'), today);
    const b = parsePendingResults(liveByKindOrScan('field_pipeline'), today);
    return [...a, ...b].sort((x, y) => y.daysSince - x.daysSince);
  }, [live, today]);

  const buckets = useMemo(() => {
    const acc = { fresh: 0, attention: 0, overdue: 0, critical: 0 };
    for (const r of openRequests) acc[ageBucket(r.daysOpen).key] += 1;
    return acc;
  }, [openRequests]);

  const filteredOpen = useMemo(() => {
    const q = query.trim().toLowerCase();
    return openRequests.filter((r) => {
      if (bucketFilter === 'overdue+' && r.daysOpen <= 30) return false;
      if (q) {
        const hay = `${r.bonbu} ${r.team} ${r.job} ${r.rank}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [openRequests, bucketFilter, query]);

  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pendingResults;
    return pendingResults.filter((p) =>
      `${p.candidate} ${p.job} ${p.team}`.toLowerCase().includes(q)
    );
  }, [pendingResults, query]);

  if (!live.hasLive) {
    return (
      <div className="card p-8 text-sm text-slate-700 text-center">
        ⚠ 라이브 시트 연결이 필요합니다. ⚙️ 설정 / 연동에서 채용요청·면접 시트를 매핑하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 헤더 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <SummaryCard label="📋 미충원 총" count={openRequests.length} tone="indigo" />
        <SummaryCard label="14일 이내" count={buckets.fresh} tone="emerald" />
        <SummaryCard label="15~30일" count={buckets.attention} tone="sky" />
        <SummaryCard label="31~60일" count={buckets.overdue} tone="amber" />
        <SummaryCard label="60일+ 장기" count={buckets.critical} tone="rose" emphasis />
        <SummaryCard label="🎯 결과 미입력" count={pendingResults.length} tone="violet" emphasis={pendingResults.length > 0} />
      </div>

      {/* 필터 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-700 font-bold mr-1">미충원 필터:</span>
          <Pill active={bucketFilter === '전체'} onClick={() => setBucketFilter('전체')}>전체 ({openRequests.length})</Pill>
          <Pill active={bucketFilter === 'overdue+'} onClick={() => setBucketFilter('overdue+')} tone="amber">
            ⚠ 30일 초과 ({buckets.overdue + buckets.critical})
          </Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="팀/직무/이름 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none w-44 text-slate-800"
          />
        </div>
      </div>

      {/* 미충원 노화 트래커 */}
      <Section title="📋 미충원 노화 — 채용요청 후 며칠째 미충원" count={filteredOpen.length} tone="indigo">
        {filteredOpen.length === 0 ? (
          <Empty msg="조건에 맞는 미충원 요청이 없습니다." />
        ) : (
          <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto pr-1">
            {filteredOpen.map((r, i) => (
              <OpenRequestRow key={`${r.team}-${r.job}-${i}`} req={r} />
            ))}
          </div>
        )}
      </Section>

      {/* 면접 결과 미입력 */}
      <Section
        title="🎯 면접 결과 미입력 — 면접 끝났는데 시트에 결과 비어있음"
        count={filteredPending.length}
        tone="violet"
      >
        {filteredPending.length === 0 ? (
          <Empty msg="결과 입력이 누락된 면접이 없습니다. 👍" />
        ) : (
          <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto pr-1">
            {filteredPending.map((p, i) => (
              <PendingResultRow key={`${p.candidate}-${i}`} item={p} today={today} />
            ))}
          </div>
        )}
      </Section>

      {/* 가이드 */}
      <div className="card p-3 bg-slate-50/60 border-slate-200 text-[11px] text-slate-600 leading-relaxed">
        💡 <b>미충원 노화</b>는 채용요청 시트(<code>recruit_request</code> kind)에서 <b>요청일/접수일/품의일자</b> 컬럼과
        <b>충원완료/취소/보류</b> 키워드로 자동 추출됩니다. <br />
        💡 <b>면접 결과 미입력</b>은 면접 시트(<code>office_interview</code>·<code>field_pipeline</code>)에서
        면접일 ≤ 어제이면서 <b>결과/평가/판정</b> 컬럼이 비어있는 행을 표시합니다. <br />
        시트에 해당 컬럼이 없으면 알림이 안 뜨니, 컬럼명에 위 키워드 포함하기.
      </div>
    </div>
  );
}

function OpenRequestRow({ req }: { req: OpenRequest }) {
  const b = ageBucket(req.daysOpen);
  const palette = TONE[b.tone as keyof typeof TONE];
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60">
      <div className={`w-1 self-stretch rounded ${palette.bar}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {req.bonbu && <span className="text-[11px] text-slate-500">{req.bonbu}</span>}
          <span className="text-sm font-bold text-slate-900">{req.team || '팀 미정'}</span>
          {req.job && (
            <>
              <span className="text-slate-300">/</span>
              <span className="text-sm text-indigo-700 font-semibold">{req.job}</span>
            </>
          )}
          {req.rank && <span className="chip bg-slate-100 text-slate-700 text-[10px]">{req.rank}</span>}
          {req.career && <span className="chip bg-slate-100 text-slate-700 text-[10px]">{req.career}</span>}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          요청일 <span className="font-semibold text-slate-700">{req.requestDate}</span>
          {req.status && <span className="ml-2">· {req.status}</span>}
          {req.link && (
            <a
              href={req.link}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-blue-600 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              ↗ 결재 링크
            </a>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0 gap-0.5">
        <div className={`text-2xl font-black tabular-nums ${palette.num}`}>D+{req.daysOpen}</div>
        <span className={`chip border text-[10px] font-bold ${palette.chip}`}>{b.label}</span>
      </div>
    </div>
  );
}

function PendingResultRow({ item, today }: { item: PendingInterviewResult; today: string }) {
  const tone = item.daysSince > 5 ? 'rose' : item.daysSince > 2 ? 'amber' : 'sky';
  const palette = TONE[tone];
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60">
      <div className={`w-1 self-stretch rounded ${palette.bar}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-900">{item.candidate}</span>
          {item.team && <span className="text-[11px] text-slate-500">{item.team}</span>}
          {item.job && (
            <>
              <span className="text-slate-300">/</span>
              <span className="text-sm text-violet-700 font-semibold">{item.job}</span>
            </>
          )}
          {item.stage && <span className="chip bg-violet-100 text-violet-800 text-[10px]">{item.stage}</span>}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          면접일 <span className="font-semibold text-slate-700">{fmtDateLabel(item.intvDate, today)}</span>
          {item.noteRaw && <span className="ml-2 truncate max-w-md inline-block align-bottom">· {item.noteRaw.slice(0, 80)}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0 gap-0.5">
        <div className={`text-2xl font-black tabular-nums ${palette.num}`}>D+{item.daysSince}</div>
        <span className={`chip border text-[10px] font-bold ${palette.chip}`}>결과 미입력</span>
      </div>
    </div>
  );
}

const TONE: Record<'emerald' | 'sky' | 'amber' | 'rose' | 'indigo' | 'violet', { bar: string; chip: string; num: string; bg: string }> = {
  emerald: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', num: 'text-emerald-700', bg: 'bg-emerald-50' },
  sky: { bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800 border-sky-200', num: 'text-sky-700', bg: 'bg-sky-50' },
  amber: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-900 border-amber-200', num: 'text-amber-700', bg: 'bg-amber-50' },
  rose: { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-800 border-rose-200', num: 'text-rose-700', bg: 'bg-rose-50' },
  indigo: { bar: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-800 border-indigo-200', num: 'text-indigo-700', bg: 'bg-indigo-50' },
  violet: { bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-800 border-violet-200', num: 'text-violet-700', bg: 'bg-violet-50' },
};

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: keyof typeof TONE;
  children: React.ReactNode;
}) {
  const palette = TONE[tone];
  return (
    <div className="card overflow-hidden">
      <div className={`px-4 py-2 flex items-center gap-2 border-b border-slate-200 ${palette.bg}`}>
        <span className="text-sm font-bold text-slate-800">{title}</span>
        <span className={`chip border ${palette.chip} text-[10px]`}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="px-4 py-8 text-center text-[12px] text-slate-400">{msg}</div>;
}

function SummaryCard({
  label,
  count,
  tone,
  emphasis,
}: {
  label: string;
  count: number;
  tone: keyof typeof TONE;
  emphasis?: boolean;
}) {
  const palette = TONE[tone];
  return (
    <div
      className={`card p-2.5 relative overflow-hidden ${palette.bg} ${
        emphasis && count > 0 ? `ring-2 ring-offset-1 ${palette.bar.replace('bg-', 'ring-')}` : ''
      }`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${palette.bar}`} />
      <div className="flex items-baseline justify-between ml-1.5">
        <span className={`text-[10px] uppercase tracking-[0.16em] font-bold ${palette.num}`}>
          {label}
        </span>
        <div className="flex items-baseline gap-0.5">
          <span className={`text-2xl font-black tabular-nums ${palette.num}`}>{count}</span>
          <span className="text-[10px] text-slate-500">건</span>
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
  tone?: 'amber';
  children: React.ReactNode;
}) {
  let activeBg = 'bg-indigo-600 text-white border-indigo-600';
  let idle = 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50';
  if (tone === 'amber') {
    activeBg = 'bg-amber-600 text-white border-amber-600';
    idle = 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100';
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

// 사이드바 뱃지 카운트 (60일+ 장기 미충원 + 결과 미입력 합계) — 외부에서 호출.
export function recruitAlertsBadgeCount(): number {
  // 이 함수는 import해서 Sidebar가 호출. liveByKindOrScan은 hook 밖에서 안전하게 호출 가능.
  const today = getTodayStr();
  const reqs = parseOpenRequests(liveByKindOrScan('recruit_request'), today);
  const a = parsePendingResults(liveByKindOrScan('office_interview'), today);
  const b = parsePendingResults(liveByKindOrScan('field_pipeline'), today);
  const overdue30 = reqs.filter((r) => r.daysOpen > 30).length;
  return overdue30 + a.length + b.length;
}
