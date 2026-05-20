// 면접 인사이트 v2 — 사용자가 명시한 5개 지표 중심.
// 사용자 요구 (2026-05-20): 채널별 서류 취합 루트 / 전형별 서류 합격률 / 면접 합격률 / 이탈률 / 탈락률
//
// 데이터 소스:
//   - 시트 `office_interview` (면접 및 처우 현황): 사무직 비고 → stage 매핑
//   - 시트 `field_pipeline` (생산직): 경로 + 면접일자 + 비고
//   - 시트 `office_pipeline` (정규직 채용 현황): 직급별 채용 품의 상태 → 전형별 합격률
//
// 정의:
//   - 서류 합격률 = 면접일자 있는 행 / 전체 (현장직만; 사무직은 시트가 이미 서류 통과 후)
//   - 면접 합격률 = 합격 단계 도달 / (합격 + 불합격) — 결과 결정된 케이스만
//   - 이탈률 = (노쇼·연락두절·면접포기·입사취소) / 전체
//   - 탈락률 = 불합격 / 전체
//   - 전형별 합격률 = office_pipeline 직급별 "입사안내 완료" / 전체 채용 품의
import { useMemo } from 'react';
import { useLiveData, liveByKindOrScan } from '../store/liveData';
import { OFFICE_JUNIOR, inferStageId } from '../lib/pipelines';

// ===== 유틸 =====

function pickCol(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    for (const [k, v] of Object.entries(row)) {
      if (k.replace(/\s+/g, '').includes(c.replace(/\s+/g, ''))) return (v || '').trim();
    }
  }
  return '';
}

function pct(n: number, d: number, fallback = '—'): string {
  if (d <= 0) return fallback;
  return `${Math.round((n / d) * 100)}%`;
}

// ===== 패턴 =====

const DROP_REGEX = /노쇼|연락\s*두절|연락두절|면접\s*포기|면접포기|입사\s*취소|입사취소|입사\s*포기|면접\s*취소|면접취소|면접\s*불참|불참|당일\s*노쇼/;
const REJECT_REGEX = /불합격|탈락/;
const POST_PASS_OFFICE = /CPI|처우|품의|결재|입사\s*안내|레퍼런스|레퍼런스\s*체크|^합격|\s합격(?!\s*안내\s*완료)/;
const POST_PENDING = /1차\s*면접\s*결과\s*대기|2차\s*면접\s*결과\s*대기|면접\s*결과\s*대기/;
const SCHEDULED = /(\d{4})-(\d{1,2})-(\d{1,2})|1차\s*면접\s*대기|면접\s*예정/;
const FIELD_PASS = /합격(?!\s*안내\s*완료)|입사\s*가능|입사\s*확정/;

// ===== 컴퓨트 =====

interface OfficeStats {
  total: number;
  scheduled: number;
  postPending: number;
  postPassed: number;
  rejected: number;
  dropped: number;
  other: number;
}

function computeOfficeStats(rows: Record<string, string>[]): OfficeStats {
  const s: OfficeStats = { total: 0, scheduled: 0, postPending: 0, postPassed: 0, rejected: 0, dropped: 0, other: 0 };
  for (const r of rows) {
    const nm = pickCol(r, ['성명', '이름']);
    if (!nm) continue;
    s.total++;
    const note = pickCol(r, ['비고', '상태']);
    if (DROP_REGEX.test(note)) { s.dropped++; continue; }
    if (REJECT_REGEX.test(note)) { s.rejected++; continue; }
    if (POST_PASS_OFFICE.test(note)) { s.postPassed++; continue; }
    if (POST_PENDING.test(note)) { s.postPending++; continue; }
    if (SCHEDULED.test(note)) { s.scheduled++; continue; }
    s.other++;
  }
  return s;
}

interface FieldStats {
  total: number;
  interviewed: number;
  passed: number;
  rejected: number;
  dropped: number;
}

function computeFieldStats(rows: Record<string, string>[]): FieldStats {
  const s: FieldStats = { total: 0, interviewed: 0, passed: 0, rejected: 0, dropped: 0 };
  for (const r of rows) {
    const nm = pickCol(r, ['이름', '성명']);
    if (!nm) continue;
    s.total++;
    if (pickCol(r, ['면접일자', '면접일'])) s.interviewed++;
    const note = pickCol(r, ['코멘트', '비고']);
    if (DROP_REGEX.test(note)) s.dropped++;
    else if (REJECT_REGEX.test(note)) s.rejected++;
    else if (FIELD_PASS.test(note)) s.passed++;
  }
  return s;
}

interface ChannelRow {
  channel: string;
  total: number;
  interviewed: number;
  passed: number;
  rejected: number;
  dropped: number;
}

function computeFieldByChannel(rows: Record<string, string>[]): ChannelRow[] {
  const m = new Map<string, ChannelRow>();
  for (const r of rows) {
    const nm = pickCol(r, ['이름', '성명']);
    if (!nm) continue;
    const rawCh = pickCol(r, ['경로', '채널', '출처']) || '미분류';
    let ch = rawCh.replace(/시\s*상설면접/g, '일자리센터').trim();
    if (/^오산$/.test(ch)) ch = '오산일자리센터';
    if (/^안성$/.test(ch)) ch = '안성일자리센터';
    if (/^수원$/.test(ch)) ch = '수원일자리센터';
    if (/^화성/.test(ch)) ch = '화성일자리센터';
    if (/^동탄/.test(ch)) ch = '동탄일자리센터';
    if (/^용인/.test(ch)) ch = '용인일자리센터';
    if (/일자리\s*박람회/.test(ch)) ch = '일자리박람회';
    const itvDt = pickCol(r, ['면접일자', '면접일']);
    const note = pickCol(r, ['코멘트', '비고']);
    const slot = m.get(ch) || { channel: ch, total: 0, interviewed: 0, passed: 0, rejected: 0, dropped: 0 };
    slot.total++;
    if (itvDt) slot.interviewed++;
    if (DROP_REGEX.test(note)) slot.dropped++;
    else if (REJECT_REGEX.test(note)) slot.rejected++;
    else if (FIELD_PASS.test(note)) slot.passed++;
    m.set(ch, slot);
  }
  return Array.from(m.values()).sort((a, b) => b.total - a.total);
}

interface RankRow {
  rank: string;
  total: number;
  hired: number;
  inProgress: number;
}

// 직급(rank) → 상위 카테고리로 정규화 (사원·주임·대리·과장·차장·부장·팀장·임원·연구원)
function normalizeRank(raw: string): string {
  const t = raw.replace(/\s+/g, '');
  if (!t) return '미분류';
  if (/(임원|이사|상무|전무|대표)/.test(t)) return '임원';
  if (/(팀장|파트장)/.test(t)) return '팀장급';
  if (/(차장|부장)/.test(t)) return '차장·부장';
  if (/(과장)/.test(t)) return '과장';
  if (/(대리)/.test(t)) return '대리';
  if (/(주임)/.test(t)) return '주임';
  if (/(사원)/.test(t)) return '사원';
  if (/(연구원|선임|책임)/.test(t)) return '연구원';
  return '기타';
}

function computeRankConversion(rows: Record<string, string>[]): RankRow[] {
  const m = new Map<string, RankRow>();
  for (const r of rows) {
    const rankRaw = pickCol(r, ['직급', '레벨']);
    if (!rankRaw) continue;
    const rank = normalizeRank(rankRaw);
    const status = pickCol(r, ['상태']);
    const hiredName = pickCol(r, ['입사예정자']);
    const slot = m.get(rank) || { rank, total: 0, hired: 0, inProgress: 0 };
    slot.total++;
    if (/입사안내\s*완료|입사\s*완료/.test(status) || (hiredName && !/결재중|결재\s*중/.test(status))) {
      slot.hired++;
    } else {
      slot.inProgress++;
    }
    m.set(rank, slot);
  }
  // 직급 순서 정렬
  const order = ['사원', '주임', '대리', '과장', '차장·부장', '팀장급', '연구원', '임원', '기타', '미분류'];
  return Array.from(m.values()).sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank));
}

function reasonBreakdown(rows: Record<string, string>[], colHints: string[]): Record<string, number> {
  const out: Record<string, number> = {
    '불합격': 0,
    '노쇼·당일불참': 0,
    '연락두절': 0,
    '면접포기': 0,
    '입사취소': 0,
    '면접취소': 0,
  };
  for (const r of rows) {
    const nm = pickCol(r, ['이름', '성명']);
    if (!nm) continue;
    const note = pickCol(r, colHints);
    if (/불합격|탈락/.test(note)) out['불합격']++;
    if (/노쇼|당일\s*노쇼|당일\s*불참/.test(note) || (/불참/.test(note) && !/면접\s*불참/.test(note))) out['노쇼·당일불참']++;
    if (/연락\s*두절|연락두절/.test(note)) out['연락두절']++;
    if (/면접\s*포기|면접포기/.test(note)) out['면접포기']++;
    if (/입사\s*취소|입사취소|입사\s*포기/.test(note)) out['입사취소']++;
    if (/면접\s*취소|면접취소/.test(note)) out['면접취소']++;
  }
  return out;
}

// ===== UI =====

function KpiCard({
  label, value, sub, tone = 'slate', icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'slate' | 'indigo' | 'emerald' | 'rose' | 'amber';
  icon?: string;
}) {
  const map = {
    slate: 'from-slate-50 to-slate-100 border-slate-200 text-slate-900',
    indigo: 'from-indigo-50 to-violet-50 border-indigo-200 text-indigo-900',
    emerald: 'from-emerald-50 to-teal-50 border-emerald-200 text-emerald-900',
    rose: 'from-rose-50 to-pink-50 border-rose-200 text-rose-900',
    amber: 'from-amber-50 to-orange-50 border-amber-200 text-amber-900',
  }[tone];
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${map} px-4 py-3.5 shadow-sm`}>
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-base">{icon}</span>}
        <span className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <div className="text-3xl font-extrabold mt-1.5 leading-none">{value}</div>
      {sub && <div className="text-[11px] mt-1.5 opacity-75">{sub}</div>}
    </div>
  );
}

// 깔때기 모양 funnel — 각 단계의 폭이 인원에 비례.
// 옆에 통과율 + 이탈/탈락 인원 표시.
function FunnelRow({
  label, count, prevCount, maxCount, dropped, rejected, isFirst,
}: {
  label: string;
  count: number;
  prevCount: number | null;
  maxCount: number;
  dropped?: number;
  rejected?: number;
  isFirst?: boolean;
}) {
  const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const conversion = prevCount !== null && prevCount > 0 ? Math.round((count / prevCount) * 100) : null;
  return (
    <div className="grid grid-cols-[120px_1fr_80px] items-center gap-2 text-xs">
      <div className="text-right text-slate-700 truncate" title={label}>{label}</div>
      <div className="relative h-8 flex items-center">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-md flex items-center px-2 text-white text-[11px] font-bold shadow-sm transition-all"
          style={{ width: `${Math.max(widthPct, 2)}%` }}
        >
          {count}명
        </div>
        {(dropped !== undefined && dropped > 0) || (rejected !== undefined && rejected > 0) ? (
          <div className="ml-1.5 flex items-center gap-1 text-[10px]">
            {rejected !== undefined && rejected > 0 && (
              <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">⛔ {rejected}</span>
            )}
            {dropped !== undefined && dropped > 0 && (
              <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">🚪 {dropped}</span>
            )}
          </div>
        ) : null}
      </div>
      <div className="text-right">
        {isFirst ? (
          <span className="text-slate-400 text-[10px]">시작</span>
        ) : conversion !== null ? (
          <span className={`text-[11px] font-bold ${conversion >= 80 ? 'text-emerald-700' : conversion >= 50 ? 'text-amber-700' : 'text-rose-700'}`}>
            {conversion}%
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, desc, children, accent }: { title: string; desc?: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-baseline gap-2 mb-3 pb-2 border-b border-slate-100">
        <h3 className={`text-sm font-bold ${accent || 'text-slate-900'}`}>{title}</h3>
        {desc && <span className="text-[11px] text-slate-500">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

// ===== 메인 =====

export function InterviewInsights() {
  const live = useLiveData();
  const officeIntvRows = useMemo(() => (live.hasLive ? liveByKindOrScan('office_interview') : []), [live]);
  const fieldPipelineRows = useMemo(() => (live.hasLive ? liveByKindOrScan('field_pipeline') : []), [live]);
  const officePipelineRows = useMemo(() => (live.hasLive ? liveByKindOrScan('office_pipeline') : []), [live]);

  const office = useMemo(() => computeOfficeStats(officeIntvRows), [officeIntvRows]);
  const field = useMemo(() => computeFieldStats(fieldPipelineRows), [fieldPipelineRows]);
  const byChannel = useMemo(() => computeFieldByChannel(fieldPipelineRows), [fieldPipelineRows]);
  const byRank = useMemo(() => computeRankConversion(officePipelineRows), [officePipelineRows]);

  // 사무직 funnel — 누적 도달 인원으로 (현재 stage + 이후 단계 모두 합산)
  const officeFunnel = useMemo(() => {
    const stages = OFFICE_JUNIOR.stages;
    const counts = new Map<string, number>();
    for (const s of stages) counts.set(s.id, 0);
    let dropped = 0;
    let rejected = 0;
    for (const r of officeIntvRows) {
      const nm = pickCol(r, ['성명', '이름']);
      if (!nm) continue;
      const note = pickCol(r, ['비고', '상태']);
      if (DROP_REGEX.test(note)) { dropped++; continue; }
      if (REJECT_REGEX.test(note)) { rejected++; continue; }
      let stageId: string;
      if (SCHEDULED.test(note)) stageId = 'intv_set';
      else stageId = inferStageId(OFFICE_JUNIOR, note);
      counts.set(stageId, (counts.get(stageId) || 0) + 1);
    }
    // 진행 흐름 순서
    const order = ['resume_review', 'biz_review', 'pre_q', 'intv_set', 'intv_1', 'cpi', 'comp', 'apr_draft', 'apr_done', 'onboard'];
    // 누적: 단계까지 도달한 사람 = 현재 그 단계 카운트 + 이후 단계 카운트들
    const cumulative: { id: string; label: string; reached: number }[] = [];
    let acc = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      acc += counts.get(order[i]) || 0;
      const def = OFFICE_JUNIOR.stages.find((x) => x.id === order[i]);
      cumulative.unshift({ id: order[i], label: def?.label || order[i], reached: acc });
    }
    return { cumulative, dropped, rejected };
  }, [officeIntvRows]);

  // KPI 계산
  const kpi = useMemo(() => {
    const docInterviewed = field.interviewed;
    const docTotal = field.total;
    const totalPassed = office.postPassed + field.passed;
    const totalRejected = office.rejected + field.rejected;
    const decided = totalPassed + totalRejected;
    const totalDropped = office.dropped + field.dropped;
    const totalAll = office.total + field.total;
    return {
      docPassRate: docTotal > 0 ? docInterviewed / docTotal : null,
      docInterviewed, docTotal,
      interviewPassRate: decided > 0 ? totalPassed / decided : null,
      totalPassed, totalRejected, decided,
      dropRate: totalAll > 0 ? totalDropped / totalAll : null,
      totalDropped, totalAll,
      rejectRate: totalAll > 0 ? totalRejected / totalAll : null,
    };
  }, [office, field]);

  const reasons = useMemo(() => ({
    office: reasonBreakdown(officeIntvRows, ['비고', '상태']),
    field: reasonBreakdown(fieldPipelineRows, ['코멘트', '비고']),
  }), [officeIntvRows, fieldPipelineRows]);

  const reasonMax = useMemo(() => {
    return Math.max(1, ...Object.keys(reasons.office).map((k) => (reasons.office[k] || 0) + (reasons.field[k] || 0)));
  }, [reasons]);

  const liveOk = live.hasLive;
  const totalAll = office.total + field.total;

  return (
    <div className="space-y-4">
      {/* Hero header */}
      <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 rounded-xl px-5 py-4 text-white shadow-md">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-xl font-bold flex items-center gap-2">📊 면접 인사이트</div>
            <div className="text-xs text-indigo-100 mt-0.5">
              {liveOk
                ? `사무직 ${office.total}명 · 현장직 ${field.total}명 · 채용 품의 ${officePipelineRows.length}건 분석`
                : '⚠ 시트 연동 대기 중'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-indigo-200">총 active 후보자</div>
            <div className="text-2xl font-extrabold">{totalAll}명</div>
          </div>
        </div>
      </div>

      {/* ① 핵심 KPI 4-카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon="📥"
          label="서류 합격률"
          value={kpi.docPassRate !== null ? pct(kpi.docInterviewed, kpi.docTotal) : '—'}
          sub={kpi.docPassRate !== null
            ? `현장직 ${kpi.docInterviewed} / ${kpi.docTotal}명 면접 도달`
            : '사무직 ATS 미연동'}
          tone="indigo"
        />
        <KpiCard
          icon="🎯"
          label="면접 합격률"
          value={kpi.interviewPassRate !== null ? pct(kpi.totalPassed, kpi.decided) : '—'}
          sub={`합격 ${kpi.totalPassed} / 결과결정 ${kpi.decided}건`}
          tone="emerald"
        />
        <KpiCard
          icon="🚪"
          label="이탈률"
          value={kpi.dropRate !== null ? pct(kpi.totalDropped, kpi.totalAll) : '—'}
          sub={`본인 사유 ${kpi.totalDropped} / 전체 ${kpi.totalAll}`}
          tone="amber"
        />
        <KpiCard
          icon="⛔"
          label="탈락률"
          value={kpi.rejectRate !== null ? pct(kpi.totalRejected, kpi.totalAll) : '—'}
          sub={`불합격 ${kpi.totalRejected} / 전체 ${kpi.totalAll}`}
          tone="rose"
        />
      </div>

      {/* 2-column grid: funnel + channel */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* ② 사무직 단계별 funnel */}
        <Section title="② 사무직 채용 Funnel" desc="단계까지 도달한 누적 인원 + 단계간 통과율" accent="text-indigo-900">
          {officeFunnel.cumulative.length > 0 && officeFunnel.cumulative[0].reached > 0 ? (
            <div className="space-y-1.5">
              {officeFunnel.cumulative.map((s, i) => (
                <FunnelRow
                  key={s.id}
                  label={s.label}
                  count={s.reached}
                  prevCount={i > 0 ? officeFunnel.cumulative[i - 1].reached : null}
                  maxCount={officeFunnel.cumulative[0].reached}
                  isFirst={i === 0}
                />
              ))}
              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-around text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded font-bold">⛔ 탈락 {officeFunnel.rejected}명</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">🚪 이탈 {officeFunnel.dropped}명</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs">사무직 시트 데이터 없음</div>
          )}
        </Section>

        {/* ③ 채널별 서류 취합 루트 */}
        <Section title="③ 채널별 서류 취합 루트" desc="현장직 채널별 분포 + 단계별 통과율" accent="text-emerald-900">
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="text-left px-2 py-1.5 font-bold">채널</th>
                  <th className="text-right px-1 py-1.5">서류</th>
                  <th className="text-right px-1 py-1.5">면접</th>
                  <th className="text-right px-1 py-1.5">서류%</th>
                  <th className="text-right px-1 py-1.5 text-emerald-700">✓</th>
                  <th className="text-right px-1 py-1.5 text-rose-700">⛔</th>
                  <th className="text-right px-1 py-1.5 text-amber-700">🚪</th>
                  <th className="text-right px-2 py-1.5">면접%</th>
                </tr>
              </thead>
              <tbody>
                {byChannel.slice(0, 12).map((c) => {
                  const decided = c.passed + c.rejected;
                  return (
                    <tr key={c.channel} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1.5 text-slate-800 truncate max-w-[110px]" title={c.channel}>{c.channel}</td>
                      <td className="px-1 py-1.5 text-right text-slate-700">{c.total}</td>
                      <td className="px-1 py-1.5 text-right text-indigo-700">{c.interviewed}</td>
                      <td className="px-1 py-1.5 text-right font-semibold">{pct(c.interviewed, c.total)}</td>
                      <td className="px-1 py-1.5 text-right text-emerald-700 font-semibold">{c.passed}</td>
                      <td className="px-1 py-1.5 text-right text-rose-700">{c.rejected}</td>
                      <td className="px-1 py-1.5 text-right text-amber-700">{c.dropped}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{decided > 0 ? pct(c.passed, decided) : '—'}</td>
                    </tr>
                  );
                })}
                {byChannel.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-400">현장직 시트 데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            ✓ 합격 · ⛔ 불합격(탈락) · 🚪 노쇼·이탈 · 서류% = 면접/서류 · 면접% = 합격/(합격+불합격)
          </div>
        </Section>
      </div>

      {/* ④ 전형별(직급별) 합격률 */}
      <Section title="④ 전형별 합격률 (직급 단위)" desc="정규직 채용 현황 — 직급별 채용 품의 → 입사 전환율" accent="text-violet-900">
        {byRank.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="text-left px-2 py-1.5 font-bold">전형 (직급)</th>
                  <th className="text-right px-2 py-1.5">채용 품의</th>
                  <th className="text-right px-2 py-1.5 text-emerald-700">입사 완료</th>
                  <th className="text-right px-2 py-1.5">진행중</th>
                  <th className="text-left px-2 py-1.5 w-1/3">전환율</th>
                </tr>
              </thead>
              <tbody>
                {byRank.map((r) => {
                  const rate = r.total > 0 ? (r.hired / r.total) : 0;
                  const widthPct = rate * 100;
                  return (
                    <tr key={r.rank} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-semibold text-slate-800">{r.rank}</td>
                      <td className="px-2 py-1.5 text-right">{r.total}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-700 font-semibold">{r.hired}</td>
                      <td className="px-2 py-1.5 text-right text-slate-500">{r.inProgress}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-3 bg-slate-100 rounded-sm overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${widthPct}%` }} />
                          </div>
                          <span className="text-[11px] font-bold text-emerald-700 w-9 text-right">{pct(r.hired, r.total)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-slate-400 text-xs">정규직 채용 현황 시트 데이터 없음</div>
        )}
        <div className="mt-2 text-[10px] text-slate-500">
          ※ 전형별 = office_pipeline 시트의 직급 column 기준. 입사 완료 = 상태에 "입사안내 완료" 표기 또는 입사예정자 이름 + 결재중 아닌 경우.
        </div>
      </Section>

      {/* ⑤ 탈락·이탈 사유 분석 */}
      <Section title="⑤ 탈락·이탈 사유 분석" desc="사무직 vs 현장직 사유별 카운트 비교" accent="text-rose-900">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-2 py-1.5 font-bold">사유</th>
                <th className="text-right px-2 py-1.5">사무직</th>
                <th className="text-right px-2 py-1.5">현장직</th>
                <th className="text-right px-2 py-1.5">합계</th>
                <th className="text-left px-2 py-1.5 w-1/3">분포</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(reasons.office).map((reason) => {
                const o = reasons.office[reason] || 0;
                const f = reasons.field[reason] || 0;
                const sum = o + f;
                const isReject = reason === '불합격';
                const colorClass = isReject ? 'text-rose-700' : 'text-amber-700';
                const widthPct = (sum / reasonMax) * 100;
                return (
                  <tr key={reason} className="border-t border-slate-100">
                    <td className={`px-2 py-1.5 font-semibold ${colorClass}`}>
                      {isReject ? '⛔ ' : '🚪 '}{reason}
                    </td>
                    <td className="px-2 py-1.5 text-right">{o}</td>
                    <td className="px-2 py-1.5 text-right">{f}</td>
                    <td className="px-2 py-1.5 text-right font-bold">{sum}</td>
                    <td className="px-2 py-1.5">
                      <div className="h-3 bg-slate-100 rounded-sm overflow-hidden">
                        <div className={isReject ? 'bg-rose-500 h-full' : 'bg-amber-500 h-full'} style={{ width: `${widthPct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-slate-500">
          ※ ⛔ 탈락 = 회사 사유로 불합격 / 🚪 이탈 = 본인 사유 (노쇼·연락두절·면접포기·입사취소 등)
        </div>
      </Section>

      <div className="text-[10px] text-slate-400 text-center pt-2">
        데이터 소스: 시트 office_interview · field_pipeline · office_pipeline | 60초 자동 갱신
      </div>
    </div>
  );
}
