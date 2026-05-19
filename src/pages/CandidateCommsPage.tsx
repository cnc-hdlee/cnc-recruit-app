import { useEffect, useMemo, useState } from 'react';
import { liveByKindOrScan } from '../store/liveData';
import { useData } from '../store';
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
} from '../lib/candidateComms';

interface CandidateRow {
  name: string;
  dept: string;
  job: string;
  note: string;
  email: string;
  interviewAt: string;
  location: string;
}

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

function parseInterviewDt(note: string): { display: string; dt: string; tm: string } | null {
  // "2026-05-22 14:00 / 1차 면접" 류 패턴
  const m = note.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})[^\d]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi);
  if (Number.isNaN(date.getTime())) return null;
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const display = `${+mo}월 ${+d}일(${dayNames[date.getDay()]}) ${+h}시 ${mi}분`;
  return { display, dt: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, tm: `${h.padStart(2, '0')}:${mi}` };
}

function todayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function CandidateCommsPage() {
  const D = useData();
  void D; // 향후 정합성 점검에 활용
  const [log, setLog] = useState<CommsLogEntry[]>([]);
  const [selectedStage, setSelectedStage] = useState<CommsStageId | null>(null);
  const [pickedCandidate, setPickedCandidate] = useState<CandidateRow | null>(null);
  const [overrideVars, setOverrideVars] = useState<Record<string, string>>({});
  const [offerOpen, setOfferOpen] = useState(false);

  useEffect(() => {
    loadLog().then(setLog);
  }, []);

  // ─────────────────────────────────────────────────────────
  // 후보자 추출 (사무직 면접 시트)
  // ─────────────────────────────────────────────────────────
  const candidates = useMemo<CandidateRow[]>(() => {
    const rows = liveByKindOrScan('office_interview');
    return rows
      .map((row): CandidateRow | null => {
        const name = pickFromRow(row, ['성명', '이름']);
        const dept = pickFromRow(row, ['지원부서', '부서']);
        const job = pickFromRow(row, ['지원구분', '직무']);
        const note = pickFromRow(row, ['비고', 'note']);
        const email = pickFromRow(row, ['이메일', '메일', 'email', 'e-mail']);
        const location = pickFromRow(row, ['장소', 'location', '면접장소']);
        if (!name) return null;
        const parsedDt = parseInterviewDt(note);
        return {
          name,
          dept,
          job,
          note,
          email,
          interviewAt: parsedDt?.display || '',
          location: location || '씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로 5길 39)',
        };
      })
      .filter((r): r is CandidateRow => r !== null);
  }, []);

  // 1차 면접 안내 자동 큐 — 미래 면접 + 차단 키워드 없는 사람 + 이미 안 보낸 사람
  const interviewQueue = useMemo(() => {
    const cutoff = todayMs();
    return candidates.filter((c) => {
      if (!c.interviewAt) return false;
      const dt = parseInterviewDt(c.note);
      if (!dt) return false;
      const d = new Date(`${dt.dt}T${dt.tm}:00`);
      if (Number.isNaN(d.getTime()) || d.getTime() < cutoff) return false;
      const block = isBlockedCandidate({ name: c.name, dept: c.dept, note: c.note });
      if (block.blocked) return false;
      // 이미 안내 발송한 사람은 제외 (이메일 있을 때만 판별 가능)
      if (c.email && hasRecentlySent(log, 'interview_1st', c.email, 30)) return false;
      return true;
    });
  }, [candidates, log]);

  // 통계
  const stats = useMemo(() => {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    return {
      queue: interviewQueue.length,
      sentToday: log.filter((e) => e.at > last24h).length,
      sentTotal: log.length,
    };
  }, [interviewQueue, log]);

  // ─────────────────────────────────────────────────────────
  // 발송 핸들러
  // ─────────────────────────────────────────────────────────
  function buildVariables(stage: CommsStageId, cand: CandidateRow): Record<string, string> {
    const base: Record<string, string> = {
      name: cand.name,
      position: cand.job || cand.dept || '지원',
      department: cand.dept,
      jobDuty: cand.job,
      interviewAt: cand.interviewAt,
      location: cand.location,
      locationGuide: locationGuideFor(cand.location),
      preQuestionUrl: preQuestionUrlFor(cand.job),
    };
    void stage;
    return { ...base, ...overrideVars };
  }

  async function send(stage: CommsStageId, cand: CandidateRow, customVars?: Record<string, string>) {
    const tpl = TEMPLATES[stage];
    const vars = customVars || buildVariables(stage, cand);
    const { subject, body } = renderTemplate(tpl, vars);
    const missing = findMissingVars(subject + '\n' + body);
    if (missing.length > 0) {
      const proceed = window.confirm(
        `다음 변수가 비어있습니다: ${missing.join(', ')}\n그대로 발송 창을 열까요?`
      );
      if (!proceed) return;
    }
    const to = vars.to || cand.email || '';
    if (!to) {
      const manual = window.prompt(`수신자 이메일이 시트에 없습니다.\n${cand.name}님 메일 주소를 입력해주세요.`);
      if (!manual) return;
      vars.to = manual;
    }
    const finalTo = vars.to || to;

    // 처우협의는 2단계 확인
    if (stage === 'offer') {
      const ok2 = window.confirm(
        `[처우협의 최종 확인]\n수신자: ${finalTo}\n이름: ${cand.name}\n연봉: ${vars.annualSalary}원\n입사일: ${vars.startDate}\n\nGmail 발송 창을 엽니까?`
      );
      if (!ok2) return;
    }

    const url = gmailComposeUrl({ to: finalTo, subject, body });
    window.open(url, '_blank');

    await appendLog({
      stage,
      name: cand.name,
      to: finalTo,
      subject,
      variables: vars,
      bodySnippet: body.slice(0, 200),
    });
    setLog(await loadLog());
    setSelectedStage(null);
    setPickedCandidate(null);
    setOverrideVars({});
  }

  // ─────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="1차 안내 대기 (자동 큐)" value={stats.queue} color="text-accent-purple" />
        <Stat label="오늘 발송" value={stats.sentToday} color="text-accent-blue" />
        <Stat label="전체 발송 (최근 500)" value={stats.sentTotal} color="text-accent-green" />
        <Stat label="처우협의 (수기·잠금)" value={'🔒'} color="text-accent-yellow" />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">📨 자동 발송 단계 (HITL 1-클릭)</h3>
          <div className="text-[11px] text-slate-500">
            ⓘ Gmail 발송 창이 외부 브라우저에 열리고, 마지막 [보내기]는 본인이 클릭합니다.
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {(['interview_1st', 'cpi_after_1st', 'reject'] as CommsStageId[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSelectedStage(s);
                setPickedCandidate(null);
                setOverrideVars({});
              }}
              className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                selectedStage === s
                  ? 'bg-accent-purple text-white border-accent-purple'
                  : 'border-bg-line hover:bg-bg-hover'
              }`}
            >
              {TEMPLATES[s].label}
            </button>
          ))}
        </div>

        {/* 1차 안내 자동 큐 */}
        {selectedStage === null && (
          <div>
            <div className="text-xs text-slate-400 mb-2">
              미래 면접 일정이 잡힌 후보자 ({interviewQueue.length}명) — 30일 내 중복 발송 자동 차단
            </div>
            <div className="overflow-auto rounded-lg border border-bg-line max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr>
                    {['이름', '부서/직무', '면접 일시', '이메일', '액션'].map((h) => (
                      <th key={h} className="table-head text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {interviewQueue.map((c, i) => (
                    <tr key={i} className="hover:bg-bg-hover/30">
                      <td className="table-cell font-medium">{c.name}</td>
                      <td className="table-cell text-xs">
                        {c.dept}
                        {c.job ? ` / ${c.job}` : ''}
                      </td>
                      <td className="table-cell text-xs font-mono">{c.interviewAt}</td>
                      <td className="table-cell text-xs text-slate-400">{c.email || '미등록'}</td>
                      <td className="table-cell">
                        <button
                          onClick={() => {
                            setSelectedStage('interview_1st');
                            setPickedCandidate(c);
                          }}
                          className="px-2 py-1 rounded bg-accent-purple/15 text-accent-purple text-xs hover:bg-accent-purple/25"
                        >
                          미리보기 →
                        </button>
                      </td>
                    </tr>
                  ))}
                  {interviewQueue.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-500 text-sm">
                        대기 중인 후보자 없음
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 단계 선택 후: 후보자 picker + preview */}
        {selectedStage !== null && (
          <div className="space-y-3">
            {!pickedCandidate ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => setSelectedStage(null)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    ← 뒤로
                  </button>
                  <div className="text-sm font-medium">{TEMPLATES[selectedStage].label} — 후보자 선택</div>
                </div>
                <div className="overflow-auto rounded-lg border border-bg-line max-h-[420px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr>
                        {['이름', '부서/직무', '비고'].map((h) => (
                          <th key={h} className="table-head text-left">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c, i) => {
                        const blocked = isBlockedCandidate({ name: c.name, dept: c.dept, note: c.note });
                        return (
                          <tr
                            key={i}
                            className={`hover:bg-bg-hover/30 cursor-pointer ${blocked.blocked ? 'opacity-40' : ''}`}
                            onClick={() => {
                              if (blocked.blocked) {
                                alert(`이 후보자는 자동 큐 차단 대상입니다: ${blocked.reason}`);
                                return;
                              }
                              setPickedCandidate(c);
                            }}
                          >
                            <td className="table-cell font-medium">{c.name}</td>
                            <td className="table-cell text-xs">
                              {c.dept}
                              {c.job ? ` / ${c.job}` : ''}
                            </td>
                            <td className="table-cell text-xs text-slate-400 max-w-[400px] truncate">{c.note}</td>
                          </tr>
                        );
                      })}
                      {candidates.length === 0 && (
                        <tr>
                          <td colSpan={3} className="text-center py-8 text-slate-500 text-sm">
                            후보자 없음 (시트 office_interview 매핑 확인)
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <PreviewPane
                stage={selectedStage}
                candidate={pickedCandidate}
                vars={buildVariables(selectedStage, pickedCandidate)}
                onVarChange={(k, v) => setOverrideVars((prev) => ({ ...prev, [k]: v }))}
                onSend={() => send(selectedStage, pickedCandidate)}
                onCancel={() => {
                  setPickedCandidate(null);
                  setOverrideVars({});
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* 처우협의 잠금 섹션 */}
      <div className="card p-4 border-2 border-accent-yellow/40 bg-accent-yellow/5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2">
            🔒 처우협의 (수기 입력 전용 · 자동 큐잉 금지)
          </h3>
          <button
            onClick={() => setOfferOpen((v) => !v)}
            className="px-3 py-1 rounded bg-accent-yellow/15 text-accent-yellow text-xs hover:bg-accent-yellow/25"
          >
            {offerOpen ? '닫기' : '처우협의 작성 ▾'}
          </button>
        </div>
        <div className="text-xs text-slate-400 leading-relaxed">
          연봉·기본급 등 보안 정보가 포함된 메일입니다. <strong>모든 숫자는 수기 입력</strong>이며 시트에서 자동 채우지 않습니다.
          발송 전 2단계 확인 모달이 표시됩니다.
        </div>
        {offerOpen && (
          <OfferForm
            onSend={(vars, cand) => send('offer', cand, vars)}
            onClose={() => setOfferOpen(false)}
          />
        )}
      </div>

      {/* 최근 발송 로그 */}
      <div className="card p-4">
        <h3 className="font-semibold mb-3">📜 최근 발송 로그</h3>
        <div className="overflow-auto rounded-lg border border-bg-line max-h-[320px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr>
                {['시각', '단계', '이름', '수신', '제목'].map((h) => (
                  <th key={h} className="table-head text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.slice(0, 50).map((e) => (
                <tr key={e.id} className="hover:bg-bg-hover/30">
                  <td className="table-cell font-mono text-xs whitespace-nowrap">
                    {new Date(e.at).toLocaleString('ko-KR', { hour12: false })}
                  </td>
                  <td className="table-cell">
                    <span className="chip bg-accent-purple/15 text-accent-purple">{TEMPLATES[e.stage].label}</span>
                  </td>
                  <td className="table-cell font-medium">{e.name}</td>
                  <td className="table-cell text-xs text-slate-400 whitespace-nowrap">{e.to}</td>
                  <td className="table-cell text-xs max-w-[420px] truncate">{e.subject}</td>
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 미리보기 패널
// ─────────────────────────────────────────────────────────────
function PreviewPane(props: {
  stage: CommsStageId;
  candidate: CandidateRow;
  vars: Record<string, string>;
  onVarChange: (k: string, v: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const tpl = TEMPLATES[props.stage];
  const [to, setTo] = useState(props.candidate.email);
  const merged = { ...props.vars, to };
  const { subject, body } = renderTemplate(tpl, merged);
  const missing = findMissingVars(subject + '\n' + body);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={props.onCancel} className="text-xs text-slate-400 hover:text-white">
          ← 뒤로
        </button>
        <div className="text-sm font-medium">{tpl.label} — 미리보기</div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div>
            <div className="text-[10px] text-slate-400 mb-1">수신자 이메일</div>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="후보자 이메일"
              className="w-full px-3 py-2 bg-bg-deep/60 border border-bg-line rounded text-sm outline-none focus:border-accent-purple"
            />
          </div>
          {tpl.variables.map((k) => (
            <div key={k}>
              <div className="text-[10px] text-slate-400 mb-1">{k}</div>
              <input
                value={merged[k] || ''}
                onChange={(e) => props.onVarChange(k, e.target.value)}
                className="w-full px-3 py-2 bg-bg-deep/60 border border-bg-line rounded text-sm outline-none focus:border-accent-purple"
              />
            </div>
          ))}
        </div>
        <div>
          <div className="rounded border border-bg-line bg-bg-deep/40 p-3 text-xs">
            <div className="font-semibold mb-2 pb-1 border-b border-bg-line">{subject}</div>
            <pre className="whitespace-pre-wrap font-sans text-slate-200 leading-relaxed">{body}</pre>
          </div>
          {missing.length > 0 && (
            <div className="mt-2 text-[11px] text-accent-yellow">
              ⚠ 비어있는 변수: {missing.join(', ')}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={props.onCancel}
          className="px-3 py-1.5 rounded border border-bg-line text-xs hover:bg-bg-hover"
        >
          취소
        </button>
        <button
          onClick={() => {
            // pass `to` 변수를 onSend에 반영하려면 vars override가 이미 됐어야 함
            props.onVarChange('to', to);
            props.onSend();
          }}
          disabled={!to}
          className="px-4 py-1.5 rounded bg-accent-purple text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-purple/90"
        >
          ✉️ Gmail 발송 창 열기
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 처우협의 수기 입력 폼
// ─────────────────────────────────────────────────────────────
function OfferForm(props: { onSend: (vars: Record<string, string>, cand: CandidateRow) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({
    department: '',
    jobDuty: '',
    startDate: '',
    careerType: '',
    jobLevel: '',
    annualSalary: '',
    baseSalary: '',
    overtimePay: '',
    overtimeHours: '38',
    monthlyTotal: '',
  });

  const fields: { key: string; label: string; placeholder?: string }[] = [
    { key: 'department', label: '부서', placeholder: '예: 전략구매팀' },
    { key: 'jobDuty', label: '직무', placeholder: '예: 부자재 구매' },
    { key: 'startDate', label: '입사일', placeholder: '예: 26년 6월 1일 월요일' },
    { key: 'careerType', label: '인정 경력', placeholder: '신입 / 경력 N년' },
    { key: 'jobLevel', label: '직급', placeholder: '사원 / 주임 / 대리 ...' },
    { key: 'annualSalary', label: '연봉(원)', placeholder: '38,588,088' },
    { key: 'baseSalary', label: '기본급(원)', placeholder: '2,526,601' },
    { key: 'overtimePay', label: '시간외수당(원)', placeholder: '689,073' },
    { key: 'overtimeHours', label: '시간외시간(시간)', placeholder: '38' },
    { key: 'monthlyTotal', label: '월급여 합계(원)', placeholder: '3,215,674' },
  ];

  const tpl = TEMPLATES.offer;
  const merged = { ...vars, name };
  const { subject, body } = renderTemplate(tpl, merged);
  const missing = findMissingVars(subject + '\n' + body);
  const canSend = !!name && !!email && missing.length === 0;

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-slate-400 mb-1">후보자 이름</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-bg-deep/60 border border-bg-line rounded text-sm"
          />
        </div>
        <div>
          <div className="text-[10px] text-slate-400 mb-1">수신 이메일</div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="후보자 이메일"
            className="w-full px-3 py-2 bg-bg-deep/60 border border-bg-line rounded text-sm"
          />
        </div>
        {fields.map((f) => (
          <div key={f.key}>
            <div className="text-[10px] text-slate-400 mb-1">{f.label}</div>
            <input
              value={vars[f.key]}
              onChange={(e) => setVars((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full px-3 py-2 bg-bg-deep/60 border border-bg-line rounded text-sm font-mono"
            />
          </div>
        ))}
      </div>
      <div className="rounded border border-accent-yellow/40 bg-bg-deep/40 p-3 text-xs">
        <div className="font-semibold mb-2 pb-1 border-b border-bg-line">{subject}</div>
        <pre className="whitespace-pre-wrap font-sans text-slate-200 leading-relaxed max-h-[300px] overflow-auto">
          {body}
        </pre>
      </div>
      {missing.length > 0 && (
        <div className="text-[11px] text-accent-yellow">⚠ 비어있는 항목: {missing.join(', ')}</div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button onClick={props.onClose} className="px-3 py-1.5 rounded border border-bg-line text-xs hover:bg-bg-hover">
          취소
        </button>
        <button
          disabled={!canSend}
          onClick={() => {
            const candStub: CandidateRow = {
              name,
              email,
              dept: vars.department,
              job: vars.jobDuty,
              note: '',
              interviewAt: '',
              location: '',
            };
            props.onSend({ ...vars, name, to: email }, candStub);
            props.onClose();
          }}
          className="px-4 py-1.5 rounded bg-accent-yellow text-bg-deep font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-yellow/90"
        >
          🔒 처우 안내 Gmail 발송 (2단계 확인)
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="card p-4">
      <div className="stat-lbl">{label}</div>
      <div className={`stat-num mt-1 ${color}`}>{value}</div>
    </div>
  );
}
