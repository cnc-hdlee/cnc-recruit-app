// 면접 인사이트 — 채용 funnel/지표 한눈에 보기.
// 데이터 소스:
//   - 시트 `office_interview` (면접 및 처우 현황): 비고 → stage 추론
//   - 시트 `field_pipeline` (생산직 면접 내용): 경로(channel), 비고에서 합격/노쇼/연락두절 등 추출
//   - 시트 `office_pipeline` (정규직 채용 현황): 채용요청일~입사예정일자 → time-to-hire
//   - 시트 `recruit_request` (부서별 TO): TO/현원/채용사유
//   - 캘린더 면접 cal: 사이트/시간대/회의실/현업 공유율
import { useMemo } from 'react';
import { useLiveData, liveByKindOrScan, liveCalendarEventsNormalized } from '../store/liveData';
import { SHARED_CAL } from '../lib/sharedCalendars';
import { OFFICE_JUNIOR, inferStageId } from '../lib/pipelines';
import { getTodayStr } from '../store';

// ----- 유틸 -----

function startOfWeekISO(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0=일
  const diff = (day === 0 ? -6 : 1 - day); // 월요일 기준
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a: string, b: string): number | null {
  const am = Date.parse(a);
  const bm = Date.parse(b);
  if (!Number.isFinite(am) || !Number.isFinite(bm)) return null;
  return Math.round((bm - am) / 86_400_000);
}

// 시트 행에서 컬럼명을 유연하게 찾는다 — 시트 헤더가 약간 달라도 매칭.
function pickCol(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    for (const [k, v] of Object.entries(row)) {
      if (k.replace(/\s+/g, '').includes(c.replace(/\s+/g, ''))) {
        return (v || '').trim();
      }
    }
  }
  return '';
}

// ----- KPI 카드 -----

function StatCard({
  title,
  value,
  sub,
  tone = 'slate',
}: {
  title: string;
  value: string;
  sub?: string;
  tone?: 'slate' | 'indigo' | 'emerald' | 'rose' | 'amber';
}) {
  const toneClass = {
    slate: 'border-slate-300 bg-slate-50',
    indigo: 'border-indigo-300 bg-indigo-50',
    emerald: 'border-emerald-300 bg-emerald-50',
    rose: 'border-rose-300 bg-rose-50',
    amber: 'border-amber-300 bg-amber-50',
  }[tone];
  return (
    <div className={`rounded-lg border ${toneClass} px-4 py-3`}>
      <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">{title}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1 leading-none">{value}</div>
      {sub && <div className="text-[11px] text-slate-600 mt-1">{sub}</div>}
    </div>
  );
}

function Bar({ label, count, max, hint }: { label: string; count: number; max: number; hint?: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 text-slate-700 truncate" title={label}>{label}</span>
      <div className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden relative">
        <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-semibold text-slate-700">
          {count}{hint ? ` · ${hint}` : ''}
        </span>
      </div>
    </div>
  );
}

// ----- 메인 -----

export function InterviewInsights() {
  const live = useLiveData();
  const today = getTodayStr();

  // 시트 데이터 — 시트 연동 안 되어 있으면 빈 배열
  const officeIntvRows = useMemo(() => (live.hasLive ? liveByKindOrScan('office_interview') : []), [live]);
  const fieldPipelineRows = useMemo(() => (live.hasLive ? liveByKindOrScan('field_pipeline') : []), [live]);
  const officePipelineRows = useMemo(() => (live.hasLive ? liveByKindOrScan('office_pipeline') : []), [live]);
  const recruitReqRows = useMemo(() => (live.hasLive ? liveByKindOrScan('recruit_request') : []), [live]);

  // 캘린더 면접 이벤트 (메인 면접 캘만)
  const interviewEvents = useMemo(() => {
    return liveCalendarEventsNormalized()
      .filter((e) => e.raw.calendarId === SHARED_CAL.interview)
      .filter((e) => e.raw.colorId === '3'); // 보라색
  }, [live.calendarEvents]);

  // === KPI 계산 ===
  const kpis = useMemo(() => {
    const todayD = new Date(today + 'T00:00:00+09:00');
    const weekStart = startOfWeekISO(todayD);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    // 이번 주 / 지난 주 면접 수
    const thisWeek = interviewEvents.filter((e) => {
      const t = Date.parse(e.dt + 'T00:00:00+09:00');
      return t >= weekStart.getTime() && t < weekEnd.getTime();
    }).length;
    const lastWeek = interviewEvents.filter((e) => {
      const t = Date.parse(e.dt + 'T00:00:00+09:00');
      return t >= prevWeekStart.getTime() && t < weekStart.getTime();
    }).length;
    const wkDelta = thisWeek - lastWeek;

    // TO 충원율 = sum(현재인원) / sum(TO)
    let toSum = 0, currentSum = 0;
    for (const r of recruitReqRows) {
      const to = parseInt(pickCol(r, ['직무TO', 'TO']), 10);
      const cur = parseInt(pickCol(r, ['현재인원', '현원']), 10);
      if (Number.isFinite(to) && to > 0) toSum += to;
      if (Number.isFinite(cur) && cur > 0) currentSum += cur;
    }
    const toFillPct = toSum > 0 ? Math.round((currentSum / toSum) * 100) : null;

    // 평균 time-to-hire (office_pipeline에서 채용요청일 ~ 입사예정일자 차이)
    const tthDays: number[] = [];
    for (const r of officePipelineRows) {
      const reqDt = pickCol(r, ['채용요청일']);
      const joinDt = pickCol(r, ['입사예정일자']);
      // 한국식 날짜 "26.04.27" 또는 "2026-04-27" 모두 처리
      const norm = (s: string): string | null => {
        if (!s) return null;
        const m1 = /^(\d{2,4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/.exec(s.trim());
        if (!m1) return null;
        let y = parseInt(m1[1], 10);
        if (y < 100) y += 2000;
        const mm = String(parseInt(m1[2], 10)).padStart(2, '0');
        const dd = String(parseInt(m1[3], 10)).padStart(2, '0');
        return `${y}-${mm}-${dd}`;
      };
      const reqN = norm(reqDt);
      const joinN = norm(joinDt);
      if (reqN && joinN) {
        const d = daysBetween(reqN, joinN);
        if (d !== null && d > 0 && d < 365) tthDays.push(d);
      }
    }
    const avgTth = tthDays.length > 0
      ? Math.round(tthDays.reduce((a, b) => a + b, 0) / tthDays.length)
      : null;

    // 노쇼·취소율 (현장직 비고)
    const FIELD_NEG = /노쇼|연락두절|입사취소|면접취소|면접포기|불참/;
    let fieldTotal = 0;
    let fieldNeg = 0;
    for (const r of fieldPipelineRows) {
      const note = pickCol(r, ['코멘트', '비고']);
      const nm = pickCol(r, ['이름', '성명']);
      if (!nm) continue;
      fieldTotal++;
      if (FIELD_NEG.test(note)) fieldNeg++;
    }
    const noShowPct = fieldTotal > 0 ? Math.round((fieldNeg / fieldTotal) * 100) : null;

    return { thisWeek, lastWeek, wkDelta, toFillPct, toSum, currentSum, avgTth, tthCount: tthDays.length, noShowPct, fieldTotal, fieldNeg };
  }, [interviewEvents, recruitReqRows, officePipelineRows, fieldPipelineRows, today]);

  // === 사무직 funnel ===
  const officeFunnel = useMemo(() => {
    const stages = OFFICE_JUNIOR.stages;
    const counts = new Map<string, number>();
    for (const s of stages) counts.set(s.id, 0);
    for (const r of officeIntvRows) {
      const note = pickCol(r, ['비고', '상태']);
      const nm = pickCol(r, ['성명', '이름']);
      if (!nm) continue;
      let stageId: string;
      // 비고에 YYYY-MM-DD 같은 datetime 패턴 들어가 있으면 면접 예정 단계로 간주
      if (/\d{4}-\d{1,2}-\d{1,2}|\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(note)) {
        stageId = 'intv_set';
      } else {
        stageId = inferStageId(OFFICE_JUNIOR, note);
      }
      counts.set(stageId, (counts.get(stageId) || 0) + 1);
    }
    return stages.map((s) => ({ id: s.id, label: s.label, count: counts.get(s.id) || 0, tone: s.tone }));
  }, [officeIntvRows]);

  // === 현장직 채널 분석 ===
  const fieldByChannel = useMemo(() => {
    const POS = /합격(?!\s*안내\s*완료)|입사|채용|선발/;
    const NEG = /불합격|노쇼|연락두절|입사취소|면접취소|면접포기|불참/;
    const m = new Map<string, { total: number; pos: number; neg: number }>();
    for (const r of fieldPipelineRows) {
      const channel = pickCol(r, ['경로', '채널', '출처']) || '미분류';
      const note = pickCol(r, ['코멘트', '비고']);
      const nm = pickCol(r, ['이름', '성명']);
      if (!nm) continue;
      // 경로 정규화 — 일자리센터 명칭 통일
      const norm = channel.replace(/일자리센터|일자리\s*센터|상설면접/g, '일자리센터').trim() || '미분류';
      const slot = m.get(norm) || { total: 0, pos: 0, neg: 0 };
      slot.total++;
      if (POS.test(note) && !NEG.test(note)) slot.pos++;
      if (NEG.test(note)) slot.neg++;
      m.set(norm, slot);
    }
    return Array.from(m.entries())
      .map(([ch, v]) => ({ channel: ch, ...v, passRate: v.total > 0 ? Math.round((v.pos / v.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [fieldPipelineRows]);

  // === 부서별 충원 현황 ===
  const deptFill = useMemo(() => {
    const rows = recruitReqRows.map((r) => {
      const team = pickCol(r, ['팀', '부서']);
      const to = parseInt(pickCol(r, ['직무TO', 'TO']), 10) || 0;
      const cur = parseInt(pickCol(r, ['현재인원', '현원']), 10) || 0;
      const need = to - cur;
      const reason = pickCol(r, ['채용사유', '사유']);
      const job = pickCol(r, ['직무']);
      return { team, job, to, cur, need, reason };
    }).filter((r) => r.team && r.to > 0);
    // 미충원 인원 top
    const top = [...rows].sort((a, b) => b.need - a.need).slice(0, 8);
    // 채용사유 분포
    const reasonMap = new Map<string, number>();
    for (const r of rows) {
      const reason = (r.reason || '미분류').replace(/\s+/g, '');
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    }
    return {
      top,
      reasons: Array.from(reasonMap.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [recruitReqRows]);

  // === 면접 패턴 (사이트·시간대·회의실) ===
  const patterns = useMemo(() => {
    const siteMap = new Map<string, number>();
    const slotMap = new Map<string, number>(); // 오전/점심/오후/저녁
    const roomMap = new Map<string, number>();
    for (const e of interviewEvents) {
      const title = e.title || '';
      const loc = e.location || '';
      // 사이트 추출 — 슬래시 포맷 두 번째 토큰 또는 location/title 키워드
      let site = '미분류';
      for (const s of ['퍼플', '그린', '수원', '서울', '위워크', '판교', '강남', '방교']) {
        if (title.includes(s) || loc.includes(s)) { site = s; break; }
      }
      siteMap.set(site, (siteMap.get(site) || 0) + 1);
      // 시간대 — HH:MM에서 hour만
      const tm = e.tm || '';
      const hMatch = /^(\d{1,2})/.exec(tm);
      if (hMatch) {
        const h = parseInt(hMatch[1], 10);
        const slot = h < 12 ? '오전' : h === 12 ? '점심' : h < 17 ? '오후' : '저녁';
        slotMap.set(slot, (slotMap.get(slot) || 0) + 1);
      }
      // 회의실 — location 토큰
      if (loc) {
        const tokens = loc.split(/[,()]/).map((t) => t.trim()).filter(Boolean);
        for (const t of tokens) {
          if (/미팅룸|회의실|소회의|카페테리아|구내식당|회의|랩|레이/.test(t)) {
            roomMap.set(t, (roomMap.get(t) || 0) + 1);
            break;
          }
        }
      }
    }
    return {
      sites: Array.from(siteMap.entries()).sort((a, b) => b[1] - a[1]),
      slots: ['오전', '점심', '오후', '저녁'].map((s) => [s, slotMap.get(s) || 0] as [string, number]),
      rooms: Array.from(roomMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [interviewEvents]);

  // === 품질·정합성 ===
  const quality = useMemo(() => {
    const total = interviewEvents.length;
    // 현업 공유율: attendees 중 resource 제외한 사람이 1명 이상
    let shared = 0;
    let declined = 0;
    for (const e of interviewEvents) {
      const atts = (e.raw.attendees || []);
      const ppl = atts.filter((a) => typeof a.email === 'string' && !a.email.includes('resource.calendar.google.com'));
      if (ppl.length > 0) shared++;
      // resource declined 여부
      const res = atts.find((a) => typeof a.email === 'string' && a.email.includes('resource.calendar.google.com'));
      if (res && res.responseStatus === 'declined') declined++;
    }
    const sharePct = total > 0 ? Math.round((shared / total) * 100) : null;
    // 시트 vs 캘린더 정합성 — 시트에 datetime 있는데 캘린더에 후보자 이름 없는 경우
    let sheetWithDt = 0;
    let missingInCal = 0;
    for (const r of officeIntvRows) {
      const note = pickCol(r, ['비고', '상태']);
      const nm = pickCol(r, ['성명', '이름']);
      if (!nm) continue;
      const dtMatch = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(note);
      if (!dtMatch) continue;
      sheetWithDt++;
      const hit = interviewEvents.some((e) => e.title && e.title.includes(nm));
      if (!hit) missingInCal++;
    }
    return { total, shared, sharePct, declined, sheetWithDt, missingInCal };
  }, [interviewEvents, officeIntvRows]);

  const liveOk = live.hasLive;

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-lg px-4 py-3">
        <div className="text-lg font-bold text-slate-900 flex items-center gap-2">
          📊 면접 인사이트
        </div>
        <div className="text-xs text-slate-600 mt-0.5">
          {liveOk
            ? `시트 ${officeIntvRows.length + fieldPipelineRows.length + officePipelineRows.length + recruitReqRows.length}건 + 면접 캘린더 ${interviewEvents.length}건 기반`
            : '⚠ 시트 연동 대기 중 — 일부 지표 미계산'}
        </div>
      </div>

      {/* ===== Section 1: 핵심 KPI ===== */}
      <Section title="① 핵심 KPI" desc="이번 주 활동·충원 상태·평균 처리 시간·노쇼율">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            title="이번 주 면접"
            value={`${kpis.thisWeek}건`}
            sub={`지난 주 ${kpis.lastWeek}건 · ${kpis.wkDelta >= 0 ? '+' : ''}${kpis.wkDelta}`}
            tone="indigo"
          />
          <StatCard
            title="TO 충원율"
            value={kpis.toFillPct !== null ? `${kpis.toFillPct}%` : '—'}
            sub={kpis.toFillPct !== null ? `${kpis.currentSum} / ${kpis.toSum}명 충원` : '시트 연동 대기'}
            tone="emerald"
          />
          <StatCard
            title="평균 Time-to-Hire"
            value={kpis.avgTth !== null ? `${kpis.avgTth}일` : '—'}
            sub={kpis.tthCount > 0 ? `채용 품의 ${kpis.tthCount}건 기준` : '데이터 부족'}
            tone="amber"
          />
          <StatCard
            title="노쇼·이탈률 (현장직)"
            value={kpis.noShowPct !== null ? `${kpis.noShowPct}%` : '—'}
            sub={kpis.noShowPct !== null ? `${kpis.fieldNeg} / ${kpis.fieldTotal}건` : '시트 연동 대기'}
            tone="rose"
          />
        </div>
      </Section>

      {/* ===== Section 2: 사무직 funnel ===== */}
      <Section title="② 사무직 단계별 Funnel" desc="면접 및 처우 현황 시트의 비고를 단계로 매핑">
        <div className="max-h-[420px] overflow-y-auto pr-1 space-y-1.5">
          {officeFunnel.map((s) => {
            const max = Math.max(1, ...officeFunnel.map((x) => x.count));
            return <Bar key={s.id} label={s.label} count={s.count} max={max} />;
          })}
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          총 {officeIntvRows.length}명 active · 비고가 비어있거나 매칭 안 되는 행은 이력서검토로 분류됨
        </div>
      </Section>

      {/* ===== Section 3: 현장직 채널 분석 ===== */}
      <Section title="③ 현장직 채널별 분포 + 합격률" desc="생산직 면접 내용 시트의 경로·비고 기반">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="text-left px-2 py-1.5 font-semibold">경로</th>
                <th className="text-right px-2 py-1.5 font-semibold">전체</th>
                <th className="text-right px-2 py-1.5 font-semibold text-emerald-700">합격</th>
                <th className="text-right px-2 py-1.5 font-semibold text-rose-700">탈락·이탈</th>
                <th className="text-right px-2 py-1.5 font-semibold">합격률</th>
              </tr>
            </thead>
            <tbody>
              {fieldByChannel.map((c) => (
                <tr key={c.channel} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 text-slate-800">{c.channel}</td>
                  <td className="px-2 py-1.5 text-right">{c.total}</td>
                  <td className="px-2 py-1.5 text-right text-emerald-700 font-semibold">{c.pos}</td>
                  <td className="px-2 py-1.5 text-right text-rose-700">{c.neg}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{c.passRate}%</td>
                </tr>
              ))}
              {fieldByChannel.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-slate-400">데이터 없음</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ===== Section 4: 충원 현황 ===== */}
      <Section title="④ 부서별 충원 현황" desc="부서별 TO 시트 기반 — 미충원 인원 top 8 + 채용사유 분포">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-semibold text-slate-700 mb-1.5">미충원 인원 top 8</div>
            <div className="space-y-1">
              {deptFill.top.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs px-2 py-1 bg-slate-50 rounded border border-slate-200">
                  <span className="truncate">{r.team} · {r.job}</span>
                  <span className="ml-2 font-semibold text-rose-700">-{r.need}명</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-700 mb-1.5">채용사유 분포</div>
            <div className="space-y-1.5">
              {deptFill.reasons.map(([reason, count]) => {
                const max = Math.max(1, ...deptFill.reasons.map(([, c]) => c));
                return <Bar key={reason} label={reason} count={count} max={max} />;
              })}
            </div>
          </div>
        </div>
      </Section>

      {/* ===== Section 5: 면접 패턴 ===== */}
      <Section title="⑤ 면접 패턴" desc="사이트별·시간대별·회의실별 분포">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="text-[11px] font-semibold text-slate-700 mb-1.5">사이트</div>
            <div className="space-y-1.5">
              {patterns.sites.map(([site, count]) => {
                const max = Math.max(1, ...patterns.sites.map(([, c]) => c));
                return <Bar key={site} label={site} count={count} max={max} />;
              })}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-700 mb-1.5">시간대</div>
            <div className="space-y-1.5">
              {patterns.slots.map(([slot, count]) => {
                const max = Math.max(1, ...patterns.slots.map(([, c]) => c));
                return <Bar key={slot} label={slot} count={count} max={max} />;
              })}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-700 mb-1.5">회의실 (top 8)</div>
            <div className="space-y-1.5">
              {patterns.rooms.map(([room, count]) => {
                const max = Math.max(1, ...patterns.rooms.map(([, c]) => c));
                return <Bar key={room} label={room} count={count} max={max} />;
              })}
            </div>
          </div>
        </div>
      </Section>

      {/* ===== Section 6: 품질·정합성 ===== */}
      <Section title="⑥ 품질·정합성" desc="현업 공유 / 회의실 declined / 시트↔캘린더 정합성">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            title="현업 공유율"
            value={quality.sharePct !== null ? `${quality.sharePct}%` : '—'}
            sub={`${quality.shared} / ${quality.total}건 attendees 추가됨`}
            tone="emerald"
          />
          <StatCard
            title="회의실 declined"
            value={`${quality.declined}건`}
            sub={quality.declined > 0 ? '⚠ autoheal 점검 필요' : '이상 없음'}
            tone={quality.declined > 0 ? 'rose' : 'slate'}
          />
          <StatCard
            title="시트에 면접 datetime"
            value={`${quality.sheetWithDt}건`}
            sub="office_interview 비고 기준"
          />
          <StatCard
            title="시트엔 있는데 캘린더에 없음"
            value={`${quality.missingInCal}건`}
            sub={quality.missingInCal > 0 ? '⚠ 캘린더 자동 등록 누락 의심' : '이상 없음'}
            tone={quality.missingInCal > 0 ? 'amber' : 'slate'}
          />
        </div>
      </Section>

      <div className="text-[10px] text-slate-400 text-center pt-2">
        데이터 소스: office_interview · field_pipeline · office_pipeline · recruit_request 시트 + 면접 캘린더(c_d2a3...) | 60초 자동 갱신
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {desc && <span className="text-[11px] text-slate-500">{desc}</span>}
      </div>
      {children}
    </div>
  );
}
