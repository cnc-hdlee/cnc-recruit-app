import { useEffect, useMemo, useRef, useState } from 'react';
import { liveByKindOrScan, liveCalendarEventsNormalized, useLiveData } from '../store/liveData';
import { api } from '../lib/api';
import { parseInterviewTitle } from './CalendarPage';
import {
  TEMPLATES,
  type CommsStageId,
  type CommsLogEntry,
  renderTemplate,
  findMissingVars,
  isBlockedCandidate,
  locationGuideFor,
  preQuestionUrlFor,
  gmailComposeUrl,
  appendLog,
  loadLog,
  hasRecentlySent,
  batchLookupEmails,
  loadEmailCache,
  saveEmailCache,
  diagnoseCandidate,
  lookupCandidateEmail,
  type DiagResult,
} from '../lib/candidateComms';

interface Candidate {
  name: string;
  dept: string;
  job: string;
  note: string;
  email: string;
  interviewAt: string;
  interviewIso?: string; // YYYY-MM-DDTHH:MM
  location: string;
  source: 'sheet' | 'calendar' | 'merged';
  resultStatus: string; // 시트의 결과/단계 컬럼 — 합격/불합격/CPI 등 분류용
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function pickFromRow(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    for (const key of Object.keys(row)) {
      if (key.replace(/\s+/g, '').includes(k.replace(/\s+/g, ''))) {
        return (row[key] || '').trim();
      }
    }
  }
  return '';
}

function parseInterviewDt(note: string): { dt: string; tm: string } | null {
  const m = (note || '').match(/(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return {
    dt: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`,
    tm: `${m[4].padStart(2, '0')}:${m[5]}`,
  };
}

function formatInterviewAt(dt: string, tm: string): string {
  const d = new Date(`${dt}T${tm}:00`);
  if (Number.isNaN(d.getTime())) return '';
  const [, mo, da] = dt.split('-');
  const h = parseInt(tm.split(':')[0], 10);
  const mi = tm.split(':')[1];
  return `${+mo}월 ${+da}일(${DAY_NAMES[d.getDay()]}) ${h}시 ${mi}분`;
}

function todayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 후보자의 현재 단계를 시트/캘린더 데이터로 분류
type Stage = 'interview_pending' | 'cpi' | 'rejected' | 'unknown';

// 과거 자료 컷오프 — 면접일이 N일 이전이면 unknown 처리해서 UI/매칭 모두 제외
const PAST_CUTOFF_DAYS = 30;

function classifyStage(c: Candidate): Stage {
  // 면접일 정보가 없거나 너무 과거면 unknown (UI/매칭 양쪽에서 제외)
  const cutoffMs = Date.now() - PAST_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  if (c.interviewIso) {
    const t = new Date(c.interviewIso).getTime();
    if (!Number.isNaN(t) && t < cutoffMs) return 'unknown';
  }

  const text = `${c.resultStatus} ${c.note}`.toLowerCase();
  if (/불합격|탈락|드랍|drop|reject/i.test(text)) return 'rejected';
  if (/1차\s*합격|1차\s*통과|cpi|인성검사/i.test(text)) return 'cpi';
  if (c.interviewIso) {
    const t = new Date(c.interviewIso).getTime();
    if (!Number.isNaN(t) && t >= todayMs()) return 'interview_pending';
  }
  return 'unknown';
}

export function CandidateCommsPage() {
  const live = useLiveData();
  void live;
  const [log, setLog] = useState<CommsLogEntry[]>([]);
  const [modalCandidate, setModalCandidate] = useState<Candidate | null>(null);
  const [modalStage, setModalStage] = useState<CommsStageId | null>(null);
  const [overrideVars, setOverrideVars] = useState<Record<string, string>>({});
  const [overrideTo, setOverrideTo] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  // Gmail 자동 매칭 — 이름→이메일 map
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [matchStatus, setMatchStatus] = useState<{
    running: boolean;
    progress: { done: number; total: number; current: string };
    lastResult: { resolved: number; notFound: number; cached: number; fetched: number; notFoundDetail: { name: string; reason: string }[] } | null;
  }>({ running: false, progress: { done: 0, total: 0, current: '' }, lastResult: null });
  const [showDiag, setShowDiag] = useState(false);
  const [diagModal, setDiagModal] = useState<{ name: string; running: boolean; result: DiagResult | null } | null>(null);
  const [systemStatus, setSystemStatus] = useState<{
    ipcReady: boolean;
    ocrReady: boolean;
    checked: boolean;
  }>({ ipcReady: false, ocrReady: false, checked: false });
  const [forceReload, setForceReload] = useState(0);
  const lastMatchedNames = useRef<string>('');
  void forceReload;

  // 페이지 진입 시 시스템 상태 즉시 확인 — IPC + OCR 사용 가능 여부
  useEffect(() => {
    const ipcReady = !!api?.google?.extractAttachmentText;
    setSystemStatus({ ipcReady, ocrReady: ipcReady, checked: true });
  }, []);

  async function runDiagnose(name: string) {
    setDiagModal({ name, running: true, result: null });
    const result = await diagnoseCandidate(name);
    setDiagModal({ name, running: false, result });
  }

  useEffect(() => {
    loadLog().then(setLog);
    loadEmailCache().then((cache) => {
      const map: Record<string, string> = {};
      for (const [name, entry] of Object.entries(cache)) {
        if (entry.email) map[name] = entry.email;
      }
      setEmailMap(map);
    });
  }, []);

  // ─────────────────────────────────────────────────────────
  // 후보자 raw — 시트 + 캘린더 통합, 이름 기준 머지.
  // ⚠ emailMap 의존 안 함 — emailMap 변경이 candidates 재계산 트리거하면
  //   useEffect 무한 cancel 발생 (매칭이 영원히 끝나지 않음)
  // ─────────────────────────────────────────────────────────
  const { candidatesRaw, sources } = useMemo(() => {
    const sheetRows = liveByKindOrScan('office_interview');
    const sheetCands: Candidate[] = [];
    for (const row of sheetRows) {
      const name = pickFromRow(row, ['성명', '이름']);
      if (!name) continue;
      const note = pickFromRow(row, ['비고', 'note']);
      const parsed = parseInterviewDt(note);
      sheetCands.push({
        name,
        dept: pickFromRow(row, ['지원부서', '부서']),
        job: pickFromRow(row, ['지원구분', '직무']),
        note,
        email: pickFromRow(row, ['이메일', '메일', 'email', 'e-mail']),
        interviewAt: parsed ? formatInterviewAt(parsed.dt, parsed.tm) : '',
        interviewIso: parsed ? `${parsed.dt}T${parsed.tm}:00` : undefined,
        location: pickFromRow(row, ['장소', 'location', '면접장소']) || '씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로 5길 39)',
        source: 'sheet',
        resultStatus: pickFromRow(row, ['결과', '단계', '전형', '상태', 'stage']),
      });
    }

    const calEvents = liveCalendarEventsNormalized().filter((e) => e.kind === '면접');
    const calCands: Candidate[] = [];
    for (const ev of calEvents) {
      const p = parseInterviewTitle(ev.title);
      if (!p.candidate) continue;
      if (!/^[가-힣]{2,4}$/.test(p.candidate) && !/^[A-Za-z]{2,}/.test(p.candidate)) continue;
      const interviewAt = ev.dt && ev.tm !== '종일' ? formatInterviewAt(ev.dt, ev.tm) : '';
      calCands.push({
        name: p.candidate,
        dept: p.team,
        job: '',
        note: ev.title,
        email: '',
        interviewAt,
        interviewIso: ev.dt && ev.tm !== '종일' ? `${ev.dt}T${ev.tm}:00` : undefined,
        location: ev.location || '씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로 5길 39)',
        source: 'calendar',
        resultStatus: '',
      });
    }

    const byName = new Map<string, Candidate>();
    let mergedCount = 0;
    for (const s of sheetCands) byName.set(s.name, { ...s });
    for (const c of calCands) {
      const ex = byName.get(c.name);
      if (ex) {
        if (!ex.interviewAt && c.interviewAt) ex.interviewAt = c.interviewAt;
        if (!ex.interviewIso && c.interviewIso) ex.interviewIso = c.interviewIso;
        if (!ex.dept && c.dept) ex.dept = c.dept;
        ex.source = 'merged';
        mergedCount++;
      } else {
        byName.set(c.name, c);
      }
    }

    const list = Array.from(byName.values()).sort((a, b) =>
      (a.interviewIso || '').localeCompare(b.interviewIso || '')
    );
    return {
      candidatesRaw: list,
      sources: { sheet: sheetCands.length, calendar: calCands.length, merged: mergedCount, total: list.length },
    };
  }, [live.snapshots, live.calendarEvents]);

  // 표시용 candidates — emailMap 적용. emailMap 변경되어도 useEffect는 재트리거 안 됨.
  const candidates = useMemo(() => {
    return candidatesRaw.map((c) => ({
      ...c,
      email: c.email || emailMap[c.name] || '',
    }));
  }, [candidatesRaw, emailMap]);

  // 페이지 마운트 시 백그라운드 자동 매칭 — 3초 간격으로 천천히, quota 안전.
  // ⚠ candidatesRaw에만 의존 — emailMap 변경이 cleanup 트리거하지 않게.
  // 매칭 대상: 면접 대상자 (1차 면접 안내 / CPI / 불합격)만 — quota 절약
  useEffect(() => {
    loadEmailCache().then((cache) => {
      const missing = candidatesRaw
        .filter((c) => {
          if (c.email) return false;
          if (cache[c.name]?.email) return false;
          if (c.source !== 'sheet' && c.source !== 'merged') return false;
          // 면접 대상자만 — classifyStage가 interview_pending/cpi/rejected 인 사람
          const stage = classifyStage(c);
          return stage === 'interview_pending' || stage === 'cpi' || stage === 'rejected';
        })
        .map((c) => c.name);
      if (missing.length === 0) return;
      const key = missing.sort().join('|');
      if (key === lastMatchedNames.current) return;
      lastMatchedNames.current = key;

      (async () => {
        setMatchStatus((s) => ({ ...s, running: true, progress: { done: 0, total: missing.length, current: '' } }));
        const result = await batchLookupEmails(missing, (done, total, current) => {
          setMatchStatus((s) => ({ ...s, progress: { done, total, current } }));
          // 진행 중에도 매칭된 이메일은 즉시 UI에 반영
          loadEmailCache().then((c2) => {
            const map: Record<string, string> = {};
            for (const [n, e] of Object.entries(c2)) {
              if (e.email) map[n] = e.email;
            }
            setEmailMap(map);
          });
        });
        setEmailMap((prev) => ({ ...prev, ...result.resolved }));
        setMatchStatus({
          running: false,
          progress: { done: result.fetched, total: result.fetched, current: '' },
          lastResult: {
            resolved: Object.keys(result.resolved).length,
            notFound: result.notFound.length,
            cached: result.cached,
            fetched: result.fetched,
            notFoundDetail: result.notFound,
          },
        });
      })();
    });
  }, [candidatesRaw]);

  async function startManualMatch() {
    // 백그라운드 매칭이 이미 도는데 사용자가 강제로 다시 트리거하고 싶을 때
    lastMatchedNames.current = '';
    setEmailMap((prev) => prev); // 트리거
  }

  // [재매칭] 버튼 — 캐시 무시하고 전체 재조회
  async function reMatchAll() {
    const cache = await loadEmailCache();
    // 캐시 전체 비우기 (단, source='manual'은 보존 — 사용자가 수동 입력한 것)
    const preserved: typeof cache = {};
    for (const [k, v] of Object.entries(cache)) {
      if (v.source === 'manual') preserved[k] = v;
    }
    await saveEmailCache(preserved);
    setEmailMap(() => {
      const m: Record<string, string> = {};
      for (const [k, v] of Object.entries(preserved)) if (v.email) m[k] = v.email;
      return m;
    });
    lastMatchedNames.current = '';
  }

  // 단계별 후보자 분류 (차단 키워드 자동 제외)
  const grouped = useMemo(() => {
    const buckets: Record<Stage, Candidate[]> = {
      interview_pending: [],
      cpi: [],
      rejected: [],
      unknown: [],
    };
    for (const c of candidates) {
      const block = isBlockedCandidate({ name: c.name, dept: c.dept, note: c.note });
      if (block.blocked) continue;
      const stage = classifyStage(c);
      buckets[stage].push(c);
    }
    return buckets;
  }, [candidates]);

  // ─────────────────────────────────────────────────────────
  // 발송 핸들러
  // ─────────────────────────────────────────────────────────
  function buildVariables(stage: CommsStageId, cand: Candidate): Record<string, string> {
    return {
      name: cand.name,
      position: cand.job || cand.dept || '지원',
      department: cand.dept,
      jobDuty: cand.job,
      interviewAt: cand.interviewAt,
      location: cand.location,
      locationGuide: locationGuideFor(cand.location),
      preQuestionUrl: preQuestionUrlFor(cand.job),
      ...overrideVars,
    };
  }

  async function sendNow(stage: CommsStageId, cand: Candidate, vars: Record<string, string>, to: string) {
    const tpl = TEMPLATES[stage];
    const { subject, body } = renderTemplate(tpl, vars);
    const missing = findMissingVars(subject + '\n' + body);
    if (missing.length > 0) {
      const ok = window.confirm(`아직 비어있는 항목이 있습니다: ${missing.join(', ')}\n그대로 Gmail 발송 창을 엽니까?`);
      if (!ok) return;
    }
    if (stage === 'offer') {
      const ok2 = window.confirm(
        `[처우협의 최종 확인]\n수신: ${to}\n이름: ${cand.name}\n연봉: ${vars.annualSalary}원\n입사일: ${vars.startDate}\n\nGmail 발송 창을 엽니까?`
      );
      if (!ok2) return;
    }
    window.open(gmailComposeUrl({ to, subject, body }), '_blank');
    await appendLog({
      stage,
      name: cand.name,
      to,
      subject,
      variables: { ...vars, to },
      bodySnippet: body.slice(0, 200),
    });
    setLog(await loadLog());
    setModalCandidate(null);
    setModalStage(null);
    setOverrideVars({});
    setOverrideTo('');
  }

  async function openModal(stage: CommsStageId, cand: Candidate) {
    setModalStage(stage);
    setModalCandidate(cand);
    setOverrideVars({});
    setOverrideTo(cand.email);
    // 백그라운드 매칭이 도는 중이면 이메일이 곧 채워질 거고,
    // 아직 매칭 차례 안 된 후보자면 그 1명만 즉시 매칭해서 새치기
    if (!cand.email) {
      const result = await lookupCandidateEmail(cand.name);
      if (result.email) {
        setOverrideTo(result.email);
        setEmailMap((prev) => ({ ...prev, [cand.name]: result.email! }));
        const cache = await loadEmailCache();
        cache[cand.name] = { email: result.email, at: Date.now(), source: 'gmail', diag: result.reason };
        await saveEmailCache(cache);
      }
    }
  }

  // 최근 24시간 발송
  const sentToday = useMemo(() => {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    return log.filter((e) => e.at > last24h).length;
  }, [log]);

  // ─────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 text-slate-900">
      {/* ★ 시스템 상태 — 페이지 맨 위 큰 배너 */}
      <div className={`card p-4 border-2 ${systemStatus.ipcReady ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
        <div className="flex items-center gap-3">
          <div className="text-3xl">
            {!systemStatus.checked ? '⏳' : systemStatus.ipcReady ? '✅' : '❌'}
          </div>
          <div className="flex-1">
            <div className="text-base font-bold text-slate-900">
              {!systemStatus.checked
                ? '시스템 확인 중...'
                : systemStatus.ipcReady
                ? 'OCR 사용 가능 — 이미지 PDF 이력서도 읽을 수 있습니다'
                : '❌ 앱이 옛 코드로 돌고 있습니다 — 완전 종료 후 재실행 필요'}
            </div>
            <div className="text-sm text-slate-700 mt-1">
              {systemStatus.ipcReady ? (
                <span>
                  <span className="text-slate-700">
                    시트 후보자 <strong>{candidates.filter(c => c.source !== 'calendar').length}</strong>명 ·
                    이메일 등록 <strong className="text-green-700">{candidates.filter(c => c.email).length}</strong>명 ·
                    미등록 <strong className="text-red-700">{candidates.filter(c => !c.email && c.source !== 'calendar').length}</strong>명
                  </span>
                  <br />
                  {matchStatus.running ? (
                    <span className="text-blue-700 font-medium">
                      🔍 백그라운드 매칭 진행 중: {matchStatus.progress.done}/{matchStatus.progress.total}
                      {matchStatus.progress.current && ` (${matchStatus.progress.current})`}
                    </span>
                  ) : matchStatus.lastResult ? (
                    <span>
                      <strong className="text-green-700">{matchStatus.lastResult.resolved}명 성공</strong>
                      {matchStatus.lastResult.notFound > 0 && (
                        <span className="text-red-700 ml-2">{matchStatus.lastResult.notFound}명 실패</span>
                      )}
                      <span className="text-slate-500 ml-2">(캐시 {matchStatus.lastResult.cached}, 신규 {matchStatus.lastResult.fetched})</span>
                    </span>
                  ) : (
                    <span className="text-amber-700">⏸ 매칭 시작 대기 중 — [↻ 매칭 다시 시작] 눌러주세요</span>
                  )}
                </span>
              ) : (
                <span className="text-red-700">
                  작업관리자 (Ctrl+Shift+Esc) → "Electron" 모두 종료 → LAUNCH.vbs 다시 실행
                </span>
              )}
            </div>
          </div>
          {systemStatus.ipcReady && (
            <button
              onClick={async () => {
                // 캐시 진짜로 비우기 (manual 입력은 보존)
                const cache = await loadEmailCache();
                const preserved: typeof cache = {};
                for (const [k, v] of Object.entries(cache)) {
                  if (v.source === 'manual') preserved[k] = v;
                }
                await saveEmailCache(preserved);
                setEmailMap({});
                lastMatchedNames.current = '';
                setMatchStatus((s) => ({ ...s, lastResult: null }));
                setForceReload((n) => n + 1);
              }}
              disabled={matchStatus.running}
              className="px-3 py-2 rounded bg-accent-purple text-white text-sm font-semibold hover:bg-accent-purple/90 disabled:opacity-40"
            >
              ↻ 매칭 다시 시작
            </button>
          )}
        </div>
      </div>

      {/* 상단 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="1차 면접 안내 대상" value={grouped.interview_pending.length} color="text-accent-purple" />
        <Stat label="CPI 안내 대상" value={grouped.cpi.length} color="text-accent-blue" />
        <Stat label="불합격 안내 대상" value={grouped.rejected.length} color="text-accent-red" />
        <Stat label="오늘 발송" value={sentToday} color="text-accent-green" />
      </div>

      {/* 출처 카운트 + Gmail 자동 매칭 상태 */}
      <div className="card p-3 space-y-2">
        <div className="text-sm text-slate-700 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">📍 후보자 출처</span>
          <span>시트 <span className="font-mono font-semibold">{sources.sheet}</span></span>
          <span>·</span>
          <span>캘린더 <span className="font-mono font-semibold">{sources.calendar}</span></span>
          <span>·</span>
          <span>이름 매칭 <span className="font-mono font-semibold">{sources.merged}</span></span>
          <span>·</span>
          <span>통합 <span className="font-mono font-semibold text-accent-purple">{sources.total}</span></span>
          {sources.total === 0 && (
            <span className="ml-auto text-accent-red font-semibold">
              ⚠ 시트 매핑 또는 캘린더 동기화를 확인해주세요
            </span>
          )}
        </div>
        <div className="text-sm text-slate-700 flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-bg-line">
          <span className="font-semibold">📧 Gmail 자동 이메일 매칭</span>
          {matchStatus.running ? (
            <span className="text-accent-blue font-medium">
              🔍 검색 중 {matchStatus.progress.done}/{matchStatus.progress.total}
              {matchStatus.progress.current && <span className="text-slate-600 ml-1">({matchStatus.progress.current})</span>}
            </span>
          ) : matchStatus.lastResult ? (
            <span>
              <span className="text-accent-green font-semibold">✓ {matchStatus.lastResult.resolved}명 자동 추출</span>
              {matchStatus.lastResult.notFound > 0 && (
                <span className="text-accent-yellow font-medium ml-2">⚠ {matchStatus.lastResult.notFound}명 미발견</span>
              )}
              <span className="text-slate-500 text-xs ml-2">
                (캐시 {matchStatus.lastResult.cached} · 신규 검색 {matchStatus.lastResult.fetched})
              </span>
            </span>
          ) : (
            <span className="text-slate-500 text-xs">자동 매칭 대기 중</span>
          )}
          {matchStatus.lastResult && matchStatus.lastResult.notFound > 0 && (
            <button
              onClick={() => setShowDiag((v) => !v)}
              className="px-2 py-1 rounded bg-accent-yellow/20 text-slate-900 text-xs font-semibold hover:bg-accent-yellow/30"
            >
              {showDiag ? '진단 숨기기' : '미발견 사유 보기'}
            </button>
          )}
          <button
            onClick={() => {
              const first = candidates.find((c) => !c.email);
              if (!first) {
                alert('진단할 미등록 후보자가 없어요. 모두 이메일 매칭됨.');
                return;
              }
              runDiagnose(first.name);
            }}
            className="px-3 py-1 rounded bg-accent-blue/20 text-slate-900 text-xs font-semibold hover:bg-accent-blue/30"
          >
            🔬 1명 진단 (정확히 어디서 막히는지)
          </button>
          <button
            onClick={reMatchAll}
            disabled={matchStatus.running}
            className="ml-auto px-3 py-1 rounded bg-slate-200 text-slate-900 text-xs font-semibold hover:bg-slate-300 disabled:opacity-40"
          >
            ↻ 전체 재매칭
          </button>
        </div>
        {showDiag && matchStatus.lastResult && matchStatus.lastResult.notFoundDetail.length > 0 && (
          <div className="pt-2 border-t border-bg-line">
            <div className="text-xs font-semibold text-slate-800 mb-1">📋 미발견 후보자별 사유</div>
            <div className="max-h-[200px] overflow-auto rounded border border-slate-300 bg-slate-50 text-xs">
              <table className="w-full">
                <tbody>
                  {matchStatus.lastResult.notFoundDetail.map((d) => (
                    <tr key={d.name} className="border-b border-slate-200 last:border-b-0">
                      <td className="px-2 py-1 font-semibold text-slate-900 whitespace-nowrap">{d.name}</td>
                      <td className="px-2 py-1 text-slate-700">{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 단계 1: 1차 면접 안내 */}
      <StageSection
        title="📩 1차 면접 안내"
        subtitle="서류합격 후 면접 일정이 잡힌 후보자에게 발송"
        accent="border-accent-purple/30 bg-accent-purple/5"
        candidates={grouped.interview_pending}
        log={log}
        stage="interview_1st"
        onSend={(c) => openModal('interview_1st', c)}
      />

      {/* 단계 2: CPI 안내 */}
      <StageSection
        title="🧠 CPI 인성검사 안내"
        subtitle="1차 면접 합격자에게 발송 (시트 결과/비고에 '1차 합격' 또는 'CPI')"
        accent="border-accent-blue/30 bg-accent-blue/5"
        candidates={grouped.cpi}
        log={log}
        stage="cpi_after_1st"
        onSend={(c) => openModal('cpi_after_1st', c)}
      />

      {/* 단계 3: 불합격 */}
      <StageSection
        title="🛑 불합격 안내"
        subtitle="시트 결과/비고에 '불합격' '탈락' 등이 있는 후보자"
        accent="border-accent-red/30 bg-accent-red/5"
        candidates={grouped.rejected}
        log={log}
        stage="reject"
        onSend={(c) => openModal('reject', c)}
      />

      {/* 단계 4: 처우협의 (잠금) */}
      <div className="card p-4 border-2 border-accent-yellow/50 bg-accent-yellow/10">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2 text-slate-900">
              🔒 처우협의 (수기 입력 전용)
            </h3>
            <div className="text-sm text-slate-700 mt-1">
              연봉·기본급 등 보안 정보 포함 — 자동 큐잉 X, 모든 숫자 수기 입력, 2단계 확인
            </div>
          </div>
          <button
            onClick={() => setOfferOpen((v) => !v)}
            className="px-3 py-1.5 rounded bg-accent-yellow text-slate-900 text-sm font-semibold hover:bg-accent-yellow/90"
          >
            {offerOpen ? '닫기' : '처우협의 작성 ▾'}
          </button>
        </div>
        {offerOpen && <OfferForm onSend={(vars, cand, to) => sendNow('offer', cand, vars, to)} />}
      </div>

      {/* 미분류 후보자 섹션은 사용자 요청으로 제거 — 오늘 이후 진행 중 후보자만 표시 */}

      {/* 발송 로그 */}
      <div className="card p-4">
        <h3 className="font-semibold mb-3 text-slate-900">📜 최근 발송 로그</h3>
        <div className="overflow-auto rounded-lg border border-bg-line max-h-[320px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr>
                {['시각', '단계', '이름', '수신', '제목'].map((h) => (
                  <th key={h} className="table-head text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.slice(0, 50).map((e) => (
                <tr key={e.id} className="hover:bg-bg-hover/30">
                  <td className="table-cell font-mono text-xs whitespace-nowrap text-slate-700">
                    {new Date(e.at).toLocaleString('ko-KR', { hour12: false })}
                  </td>
                  <td className="table-cell">
                    <span className="chip bg-accent-purple/15 text-accent-purple">{TEMPLATES[e.stage].label}</span>
                  </td>
                  <td className="table-cell font-medium text-slate-900">{e.name}</td>
                  <td className="table-cell text-xs text-slate-700 whitespace-nowrap">{e.to}</td>
                  <td className="table-cell text-xs max-w-[420px] truncate text-slate-700">{e.subject}</td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500 text-sm">
                    발송 기록 없음
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 진단 모달 */}
      {diagModal && (
        <DiagModal data={diagModal} onClose={() => setDiagModal(null)} />
      )}

      {/* 미리보기 모달 */}
      {modalCandidate && modalStage && (
        <PreviewModal
          candidate={modalCandidate}
          stage={modalStage}
          vars={buildVariables(modalStage, modalCandidate)}
          to={overrideTo}
          onToChange={setOverrideTo}
          onVarChange={(k, v) => setOverrideVars((p) => ({ ...p, [k]: v }))}
          onClose={() => {
            setModalCandidate(null);
            setModalStage(null);
            setOverrideVars({});
            setOverrideTo('');
          }}
          onSend={() => {
            const finalVars = buildVariables(modalStage, modalCandidate);
            sendNow(modalStage, modalCandidate, finalVars, overrideTo);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 단계별 섹션 (펼쳐진 카드 — 안에 후보자 리스트)
// ─────────────────────────────────────────────────────────────
function StageSection(props: {
  title: string;
  subtitle: string;
  accent: string;
  candidates: Candidate[];
  log: CommsLogEntry[];
  stage: CommsStageId;
  onSend: (c: Candidate) => void;
  dimmed?: boolean;
}) {
  return (
    <div className={`card p-4 border-2 ${props.accent} ${props.dimmed ? 'opacity-75' : ''}`}>
      <div className="mb-3">
        <h3 className="font-semibold text-base text-slate-900">{props.title} <span className="text-slate-600 text-sm font-normal">({props.candidates.length}명)</span></h3>
        <div className="text-sm text-slate-700 mt-0.5">{props.subtitle}</div>
      </div>
      {props.candidates.length === 0 ? (
        <div className="text-center py-6 text-sm text-slate-500">해당 단계 후보자 없음</div>
      ) : (
        <div className="overflow-auto rounded-lg border border-bg-line max-h-[320px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr>
                {['이름', '부서/직무', '면접 일시', '이메일', '출처', '액션'].map((h) => (
                  <th key={h} className="table-head text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.candidates.map((c, i) => {
                const alreadySent = c.email ? !!hasRecentlySent(props.log, props.stage, c.email, 30) : false;
                return (
                  <tr key={i} className="hover:bg-bg-hover/30">
                    <td className="table-cell font-semibold text-slate-900">{c.name}</td>
                    <td className="table-cell text-sm text-slate-800">
                      {c.dept || <span className="text-slate-400">-</span>}
                      {c.job ? ` / ${c.job}` : ''}
                    </td>
                    <td className="table-cell text-sm font-mono text-slate-900">
                      {c.interviewAt || <span className="text-slate-400 font-sans">-</span>}
                    </td>
                    <td className="table-cell text-sm">
                      {c.email ? (
                        <span className="text-slate-800">{c.email}</span>
                      ) : (
                        <span className="text-accent-red font-medium">Gmail 첨부에서 못 찾음</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <span
                        className={`chip text-[10px] ${
                          c.source === 'merged'
                            ? 'bg-accent-green/15 text-accent-green'
                            : c.source === 'sheet'
                            ? 'bg-accent-blue/15 text-accent-blue'
                            : 'bg-accent-purple/15 text-accent-purple'
                        }`}
                      >
                        {c.source === 'merged' ? '시트+캘' : c.source === 'sheet' ? '시트' : '캘린더'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <button
                        onClick={() => props.onSend(c)}
                        className={`px-3 py-1.5 rounded text-sm font-semibold ${
                          alreadySent
                            ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                            : 'bg-accent-purple text-white hover:bg-accent-purple/90'
                        }`}
                        title={alreadySent ? '최근 30일 내 발송 기록 있음' : '발송 미리보기 열기'}
                      >
                        {alreadySent ? '↻ 재발송' : '✉️ 메일 보내기'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 미리보기 모달
// ─────────────────────────────────────────────────────────────
function PreviewModal(props: {
  candidate: Candidate;
  stage: CommsStageId;
  vars: Record<string, string>;
  to: string;
  onToChange: (v: string) => void;
  onVarChange: (k: string, v: string) => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const tpl = TEMPLATES[props.stage];
  const merged = { ...props.vars };
  const { subject, body } = renderTemplate(tpl, merged);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={props.onClose}>
      <div className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bg-line flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-600">{tpl.label}</div>
            <div className="text-lg font-semibold">{props.candidate.name}님께 발송</div>
          </div>
          <button onClick={props.onClose} className="w-9 h-9 rounded grid place-items-center text-slate-600 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">수신자 이메일</label>
            <input
              value={props.to}
              onChange={(e) => props.onToChange(e.target.value)}
              placeholder="후보자 이메일 (시트에 없으면 직접 입력)"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm outline-none focus:border-accent-purple"
            />
          </div>
          {tpl.variables.filter((k) => k !== 'locationGuide' && k !== 'preQuestionUrl').map((k) => (
            <div key={k}>
              <label className="text-xs font-semibold text-slate-700">{k}</label>
              <input
                value={merged[k] || ''}
                onChange={(e) => props.onVarChange(k, e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm outline-none focus:border-accent-purple"
              />
            </div>
          ))}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1">📧 미리보기</div>
            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">
              <div className="font-semibold pb-2 mb-2 border-b border-slate-200 text-slate-900">{subject}</div>
              <pre className="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed">{body}</pre>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-bg-line flex items-center justify-end gap-2 bg-slate-50">
          <button onClick={props.onClose} className="px-4 py-2 rounded border border-slate-300 text-sm hover:bg-white text-slate-900">
            취소
          </button>
          <button
            onClick={props.onSend}
            disabled={!props.to}
            className="px-5 py-2 rounded bg-accent-purple text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-purple/90"
          >
            ✉️ Gmail 발송 창 열기
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 처우협의 수기 입력 폼
// ─────────────────────────────────────────────────────────────
function OfferForm(props: { onSend: (vars: Record<string, string>, cand: Candidate, to: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({
    department: '', jobDuty: '', startDate: '', careerType: '', jobLevel: '',
    annualSalary: '', baseSalary: '', overtimePay: '', overtimeHours: '38', monthlyTotal: '',
  });

  const fields: { key: string; label: string; placeholder?: string }[] = [
    { key: 'department', label: '부서', placeholder: '예: 전략구매팀' },
    { key: 'jobDuty', label: '직무', placeholder: '예: 부자재 구매' },
    { key: 'startDate', label: '입사일', placeholder: '26년 6월 1일 월요일' },
    { key: 'careerType', label: '인정 경력', placeholder: '신입 / 경력 N년' },
    { key: 'jobLevel', label: '직급', placeholder: '사원' },
    { key: 'annualSalary', label: '연봉(원)', placeholder: '38,588,088' },
    { key: 'baseSalary', label: '기본급(원)', placeholder: '2,526,601' },
    { key: 'overtimePay', label: '시간외수당(원)', placeholder: '689,073' },
    { key: 'overtimeHours', label: '시간외시간', placeholder: '38' },
    { key: 'monthlyTotal', label: '월급여 합계(원)', placeholder: '3,215,674' },
  ];

  const tpl = TEMPLATES.offer;
  const merged = { ...vars, name };
  const { subject, body } = renderTemplate(tpl, merged);
  const missing = findMissingVars(subject + '\n' + body);
  const canSend = !!name && !!email && missing.length === 0;

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-800">후보자 이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-800">수신 이메일</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="후보자 이메일" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </div>
        {fields.map((f) => (
          <div key={f.key}>
            <label className="text-xs font-semibold text-slate-800">{f.label}</label>
            <input
              value={vars[f.key]}
              onChange={(e) => setVars((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
            />
          </div>
        ))}
      </div>
      <div className="rounded border border-slate-300 bg-white p-3 text-sm">
        <div className="font-semibold pb-2 mb-2 border-b border-slate-200 text-slate-900">{subject}</div>
        <pre className="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed max-h-[300px] overflow-auto">{body}</pre>
      </div>
      {missing.length > 0 && (
        <div className="text-sm text-accent-red font-medium">⚠ 비어있는 항목: {missing.join(', ')}</div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          disabled={!canSend}
          onClick={() => {
            const candStub: Candidate = {
              name, email, dept: vars.department, job: vars.jobDuty,
              note: '', interviewAt: '', location: '', source: 'sheet', resultStatus: '',
            };
            props.onSend({ ...vars, name }, candStub, email);
          }}
          className="px-5 py-2 rounded bg-accent-yellow text-slate-900 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-yellow/90"
        >
          🔒 처우 안내 Gmail 발송 (2단계 확인)
        </button>
      </div>
    </div>
  );
}

function diagToPlainText(name: string, r: DiagResult | null): string {
  if (!r) return `진단 진행 중 (${name})`;
  const lines: string[] = [];
  lines.push(`=== PDF 매칭 진단: ${name} ===`);
  lines.push(`IPC 사용 가능: ${r.ipcAvailable ? '예' : '아니오 (main 안 돌고 있음)'}`);
  lines.push(`검색 쿼리: ${r.query}`);
  lines.push(`검색 결과: ${r.searchOk ? `${r.messages.length}건` : `실패 (${r.searchError})`}`);
  lines.push(`최종 이메일: ${r.finalEmail || `못 찾음 — ${r.finalReason}`}`);
  lines.push('');
  r.messages.forEach((m, i) => {
    lines.push(`--- 메일 #${i + 1} ---`);
    lines.push(`날짜: ${m.date}`);
    lines.push(`from: ${m.from}`);
    lines.push(`subject: ${m.subject}`);
    if (m.attachments.length === 0) {
      lines.push('첨부: 없음');
    } else {
      m.attachments.forEach((a, j) => {
        lines.push(`첨부 ${j + 1}: ${a.filename} (${Math.round(a.size / 1024)}KB, ${a.mimeType})`);
        if (a.excluded) lines.push('  → 제외 (PDF/DOCX 아니거나 비이력서 키워드)');
        else if (a.extractOk === false) lines.push(`  → 추출 실패: ${a.extractReason}`);
        else if (a.extractOk === true) {
          lines.push(`  → 텍스트 ${a.textChars}자 추출`);
          lines.push(`  → 외부 이메일 발견: ${(a.emailsFound || []).join(', ') || '(없음)'}`);
          if (a.pickedEmail) lines.push(`  → 채택: ${a.pickedEmail}`);
          if (a.textHead) lines.push(`  → 텍스트 앞부분: ${a.textHead.replace(/\s+/g, ' ').slice(0, 200)}`);
        }
      });
    }
    lines.push('');
  });
  return lines.join('\n');
}

function DiagModal({ data, onClose }: { data: { name: string; running: boolean; result: DiagResult | null }; onClose: () => void }) {
  const r = data.result;
  const [copied, setCopied] = useState(false);
  const plain = diagToPlainText(data.name, r);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bg-line flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-slate-600">PDF 매칭 진단</div>
            <div className="text-lg font-semibold">{data.name}</div>
          </div>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(plain);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                // fallback — textarea select
                const ta = document.createElement('textarea');
                ta.value = plain;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className="px-3 py-2 rounded bg-accent-purple text-white text-sm font-semibold hover:bg-accent-purple/90"
          >
            {copied ? '✅ 복사 완료' : '📋 진단 결과 전체 복사'}
          </button>
          <button onClick={onClose} className="w-9 h-9 rounded grid place-items-center text-slate-600 hover:bg-slate-100">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
          {data.running && <div className="text-slate-700">🔍 진단 중...</div>}
          {r && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <DiagRow label="IPC 사용 가능 (main 재시작 여부)" value={r.ipcAvailable ? '✅ 예' : '❌ 아니오 — 앱 완전 종료 후 재실행 필요'} bad={!r.ipcAvailable} />
                <DiagRow label="Gmail 검색 쿼리" value={r.query} />
                <DiagRow label="검색 결과" value={r.searchOk ? `✅ ${r.messages.length}건` : `❌ 실패: ${r.searchError}`} bad={!r.searchOk} />
                <DiagRow label="최종 추출 이메일" value={r.finalEmail || `❌ ${r.finalReason}`} good={!!r.finalEmail} bad={!r.finalEmail} />
              </div>
              {r.messages.length > 0 && (
                <div>
                  <div className="font-semibold mb-1">📧 검색된 메일 / 첨부 분석</div>
                  <div className="space-y-2">
                    {r.messages.map((m, i) => (
                      <div key={m.id} className="border border-slate-300 rounded p-2 bg-slate-50">
                        <div className="text-xs text-slate-700 mb-1">
                          #{i + 1} · {m.date.slice(0, 16)} · from: <span className="font-mono">{m.from}</span>
                        </div>
                        <div className="text-sm font-medium mb-2">{m.subject}</div>
                        {m.attachments.length === 0 ? (
                          <div className="text-xs text-slate-500">첨부 없음</div>
                        ) : (
                          <div className="space-y-1">
                            {m.attachments.map((a, j) => (
                              <div key={j} className={`text-xs p-2 rounded ${a.excluded ? 'bg-slate-100 text-slate-500' : a.pickedEmail ? 'bg-green-100' : 'bg-yellow-50'}`}>
                                <div className="font-mono">{a.filename} ({Math.round(a.size / 1024)}KB · {a.mimeType})</div>
                                {a.excluded && <div>⏭ 제외됨 (PDF/DOCX 아니거나 비이력서 키워드)</div>}
                                {!a.excluded && a.extractOk === false && (
                                  <div className="text-red-700">❌ 추출 실패: {a.extractReason}</div>
                                )}
                                {!a.excluded && a.extractOk === true && (
                                  <>
                                    <div>📄 텍스트 {a.textChars}자 추출됨</div>
                                    <div className="font-mono text-[10px] mt-1 max-h-[80px] overflow-auto bg-white p-1 rounded">{a.textHead}</div>
                                    <div className="mt-1">
                                      외부 이메일 {a.emailsFound?.length || 0}개 발견: <span className="font-mono">{(a.emailsFound || []).join(', ') || '(없음)'}</span>
                                    </div>
                                    {a.pickedEmail && <div className="text-green-700 font-semibold">✅ 채택: {a.pickedEmail}</div>}
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DiagRow({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="p-2 rounded border border-slate-200 bg-slate-50">
      <div className="text-xs text-slate-600">{label}</div>
      <div className={`text-sm font-medium ${good ? 'text-green-700' : bad ? 'text-red-700' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
