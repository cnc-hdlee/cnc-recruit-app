// Phase 1 — 양식 보관 + 후보자 안내 메일 발송.
// 향후 Phase 2: 부서장 동시 발송 + 캘린더 이벤트 자동 생성
// 향후 Phase 3: 회의실 자동 예약

import { useEffect, useMemo, useState } from 'react';
import { liveByKindOrScan, useLiveData } from '../store/liveData';
import {
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  createBlankTemplate,
  extractVariables,
  renderTemplate,
  findMissingVars,
  gmailComposeUrl,
  appendSendLog,
  loadSendLog,
  loadEmailCache,
  saveEmail,
  type EmailTemplate,
  type SendLogEntry,
} from '../lib/emailTemplates';

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

function parseInterviewDt(note: string): { display: string } | null {
  const m = (note || '').match(/(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const display = `${+mo}월 ${+d}일(${dayNames[date.getDay()]}) ${+h}시 ${mi}분`;
  return { display };
}

interface Candidate {
  name: string;
  dept: string;
  job: string;
  email: string;
  interviewAt: string;
  location: string;
  resultStatus: string;
}

export function EmailToolsPage() {
  const live = useLiveData();
  void live;
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [log, setLog] = useState<SendLogEntry[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string | null>(null);
  const [editingTpl, setEditingTpl] = useState<EmailTemplate | null>(null);
  const [sendModal, setSendModal] = useState<{ template: EmailTemplate; candidate: Candidate } | null>(null);

  useEffect(() => {
    loadTemplates().then((t) => {
      setTemplates(t);
      if (t.length > 0 && !selectedTpl) setSelectedTpl(t[0].id);
    });
    loadEmailCache().then(setEmailMap);
    loadSendLog().then(setLog);
  }, []);

  // 후보자 (시트 office_interview)
  const candidates = useMemo<Candidate[]>(() => {
    const rows = liveByKindOrScan('office_interview');
    return rows
      .map((row): Candidate | null => {
        const name = pickFromRow(row, ['성명', '이름']);
        if (!name) return null;
        const note = pickFromRow(row, ['비고', 'note']);
        const parsed = parseInterviewDt(note);
        return {
          name,
          dept: pickFromRow(row, ['지원부서', '부서']),
          job: pickFromRow(row, ['지원구분', '직무']),
          email: pickFromRow(row, ['이메일', '메일', 'email', 'e-mail']) || emailMap[name] || '',
          interviewAt: parsed?.display || '',
          location: pickFromRow(row, ['장소', 'location', '면접장소']) || '씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로 5길 39)',
          resultStatus: pickFromRow(row, ['결과', '단계', '전형', '상태']),
        };
      })
      .filter((c): c is Candidate => c !== null);
  }, [emailMap]);

  const currentTpl = templates.find((t) => t.id === selectedTpl) || null;

  async function refreshTemplates() {
    const t = await loadTemplates();
    setTemplates(t);
  }

  function handleAddTemplate() {
    setEditingTpl(createBlankTemplate());
  }

  function handleEditTemplate(tpl: EmailTemplate) {
    setEditingTpl({ ...tpl });
  }

  async function handleSaveTemplate(tpl: EmailTemplate) {
    // 변수 자동 추출
    const detected = extractVariables(tpl.subject + ' ' + tpl.body);
    tpl.variables = detected;
    await saveTemplate(tpl);
    await refreshTemplates();
    setSelectedTpl(tpl.id);
    setEditingTpl(null);
  }

  async function handleDeleteTemplate(id: string) {
    if (!confirm('이 양식을 삭제할까요? (빌트인 양식은 기본값으로 리셋됩니다)')) return;
    await deleteTemplate(id);
    await refreshTemplates();
    if (selectedTpl === id) setSelectedTpl(templates[0]?.id || null);
  }

  return (
    <div className="space-y-4 text-slate-900">
      <div className="card p-3 bg-blue-50 border-l-4 border-blue-400">
        <div className="text-sm text-slate-800">
          <strong>📨 후보자 안내 메일 — Phase 1</strong>
          <span className="ml-2 text-slate-600">
            양식 보관 · 후보자별 발송 · Gmail 발송 창은 외부 브라우저에서 열림 (최종 [보내기]는 직접 클릭)
          </span>
        </div>
        <div className="text-xs text-slate-600 mt-1">
          Phase 2 예정: 부서장 동시 발송 + 캘린더 면접 이벤트 자동 생성 · Phase 3 예정: 회의실 자동 예약
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* 좌: 양식 리스트 */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">📋 보관된 양식</h3>
            <button
              onClick={handleAddTemplate}
              className="px-2 py-1 rounded bg-accent-purple text-white text-xs font-semibold hover:bg-accent-purple/90"
            >
              + 새 양식
            </button>
          </div>
          <div className="space-y-1 max-h-[600px] overflow-auto">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTpl(t.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm border transition-colors ${
                  selectedTpl === t.id
                    ? 'bg-accent-purple/10 border-accent-purple text-slate-900'
                    : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-800'
                }`}
              >
                <div className="font-medium">
                  {t.recipient === 'manager' && <span className="mr-1">👔</span>}
                  {t.stage === 'offer' && <span className="mr-1">🔒</span>}
                  {t.name}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {t.builtin ? '빌트인' : '사용자'} · 변수 {t.variables.length}개
                  {t.modifiedAt && <span className="ml-1 text-amber-600">· 수정됨</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 우: 양식 상세 + 발송 */}
        <div className="space-y-3">
          {currentTpl ? (
            <>
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-900">{currentTpl.name}</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditTemplate(currentTpl)}
                      className="px-3 py-1 rounded border border-slate-300 text-xs hover:bg-slate-50"
                    >
                      ✎ 양식 수정
                    </button>
                    {!currentTpl.builtin && (
                      <button
                        onClick={() => handleDeleteTemplate(currentTpl.id)}
                        className="px-3 py-1 rounded border border-red-300 text-red-700 text-xs hover:bg-red-50"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
                <div className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">
                  <div className="font-semibold pb-2 mb-2 border-b border-slate-200 text-slate-900">
                    {currentTpl.subject}
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed max-h-[280px] overflow-auto">
                    {currentTpl.body}
                  </pre>
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  변수: {currentTpl.variables.map((v) => `{{${v}}}`).join(', ') || '없음'}
                </div>
              </div>

              {/* 후보자 선택 */}
              <CandidatePicker
                candidates={candidates}
                template={currentTpl}
                onPick={(c) => setSendModal({ template: currentTpl, candidate: c })}
              />
            </>
          ) : (
            <div className="card p-8 text-center text-slate-500">양식을 선택하거나 추가하세요</div>
          )}

          {/* 발송 로그 */}
          <div className="card p-4">
            <h3 className="font-semibold text-slate-900 mb-2">📜 최근 발송 로그</h3>
            <div className="overflow-auto rounded-lg border border-bg-line max-h-[240px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr>
                    {['시각', '양식', '수신', '제목'].map((h) => (
                      <th key={h} className="table-head text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.slice(0, 30).map((e) => (
                    <tr key={e.id} className="hover:bg-bg-hover/30">
                      <td className="table-cell font-mono text-xs whitespace-nowrap text-slate-700">
                        {new Date(e.at).toLocaleString('ko-KR', { hour12: false })}
                      </td>
                      <td className="table-cell text-xs text-slate-800">{e.templateName}</td>
                      <td className="table-cell text-xs text-slate-700 whitespace-nowrap">{e.to}</td>
                      <td className="table-cell text-xs max-w-[400px] truncate text-slate-700">{e.subject}</td>
                    </tr>
                  ))}
                  {log.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-slate-500 text-sm">발송 기록 없음</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {editingTpl && (
        <TemplateEditor
          template={editingTpl}
          onSave={handleSaveTemplate}
          onClose={() => setEditingTpl(null)}
        />
      )}

      {sendModal && (
        <SendModal
          template={sendModal.template}
          candidate={sendModal.candidate}
          onClose={() => setSendModal(null)}
          onSent={async (entry) => {
            await appendSendLog(entry);
            setLog(await loadSendLog());
            setSendModal(null);
          }}
          onEmailCache={async (name, email) => {
            await saveEmail(name, email);
            setEmailMap((prev) => ({ ...prev, [name]: email }));
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 후보자 선택 영역
// ─────────────────────────────────────────────────────────────
function CandidatePicker({
  candidates,
  template,
  onPick,
}: {
  candidates: Candidate[];
  template: EmailTemplate;
  onPick: (c: Candidate) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.toLowerCase();
    return candidates.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dept.toLowerCase().includes(q) || c.job.toLowerCase().includes(q)
    );
  }, [candidates, search]);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">📤 후보자 선택 → 발송</h3>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 이름·부서·직무 검색"
          className="px-3 py-1.5 border border-slate-300 rounded text-sm w-60"
        />
      </div>
      <div className="text-xs text-slate-600 mb-2">
        시트(office_interview) {candidates.length}명 · {template.recipient === 'manager' ? '⚠ 부서장용 양식 — 수신자 수동 입력 필요' : '후보자에게 발송'}
      </div>
      <div className="overflow-auto rounded-lg border border-bg-line max-h-[280px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr>
              {['이름', '부서/직무', '면접 일시', '이메일', '발송'].map((h) => (
                <th key={h} className="table-head text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr key={i} className="hover:bg-bg-hover/30">
                <td className="table-cell font-semibold text-slate-900">{c.name}</td>
                <td className="table-cell text-xs text-slate-800">
                  {c.dept}
                  {c.job ? ` / ${c.job}` : ''}
                </td>
                <td className="table-cell text-xs font-mono text-slate-900">{c.interviewAt || '-'}</td>
                <td className="table-cell text-xs">
                  {c.email ? (
                    <span className="text-slate-800">{c.email}</span>
                  ) : (
                    <span className="text-amber-700">발송 시 입력</span>
                  )}
                </td>
                <td className="table-cell">
                  <button
                    onClick={() => onPick(c)}
                    className="px-3 py-1 rounded bg-accent-purple text-white text-xs font-semibold hover:bg-accent-purple/90"
                  >
                    ✉️ 발송
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-6 text-slate-500 text-sm">
                  {candidates.length === 0 ? '시트 매핑을 확인하세요' : '검색 결과 없음'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 양식 에디터 모달
// ─────────────────────────────────────────────────────────────
function TemplateEditor({
  template,
  onSave,
  onClose,
}: {
  template: EmailTemplate;
  onSave: (t: EmailTemplate) => void;
  onClose: () => void;
}) {
  const [t, setT] = useState(template);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-bg-line flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-600">양식 {t.builtin ? '수정 (빌트인)' : '편집'}</div>
            <div className="text-lg font-semibold">{t.name}</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded grid place-items-center text-slate-600 hover:bg-slate-100">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">양식 이름</label>
            <input
              value={t.name}
              onChange={(e) => setT({ ...t, name: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700">수신자 분류</label>
              <select
                value={t.recipient}
                onChange={(e) => setT({ ...t, recipient: e.target.value as 'candidate' | 'manager' })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="candidate">후보자 (구직자)</option>
                <option value="manager">현업 부서장</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700">단계</label>
              <select
                value={t.stage}
                onChange={(e) => setT({ ...t, stage: e.target.value as EmailTemplate['stage'] })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="interview_1st">1차 면접 안내</option>
                <option value="cpi">CPI 안내</option>
                <option value="reject">불합격</option>
                <option value="offer">처우협의 (잠금)</option>
                <option value="custom">기타</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">메일 제목</label>
            <input
              value={t.subject}
              onChange={(e) => setT({ ...t, subject: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">메일 본문 (변수는 {`{{변수명}}`} 형태로)</label>
            <textarea
              value={t.body}
              onChange={(e) => setT({ ...t, body: e.target.value })}
              rows={16}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono leading-relaxed"
            />
          </div>
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
            자동 인식된 변수:{' '}
            <span className="font-mono">{extractVariables(t.subject + ' ' + t.body).join(', ') || '(없음)'}</span>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-bg-line flex items-center justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 text-sm hover:bg-white text-slate-900">
            취소
          </button>
          <button
            onClick={() => onSave(t)}
            disabled={!t.name || !t.subject || !t.body}
            className="px-5 py-2 rounded bg-accent-purple text-white text-sm font-semibold disabled:opacity-40 hover:bg-accent-purple/90"
          >
            💾 저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 발송 모달 — 후보자 정보로 변수 채움, 미리보기, Gmail 발송
// ─────────────────────────────────────────────────────────────
function SendModal({
  template,
  candidate,
  onClose,
  onSent,
  onEmailCache,
}: {
  template: EmailTemplate;
  candidate: Candidate;
  onClose: () => void;
  onSent: (entry: Omit<SendLogEntry, 'id' | 'at'>) => void;
  onEmailCache: (name: string, email: string) => void;
}) {
  const [to, setTo] = useState(candidate.email);
  const [vars, setVars] = useState<Record<string, string>>(() => {
    // 후보자 정보로 자동 prefill
    const auto: Record<string, string> = {
      '이름': candidate.name,
      '면접일시': candidate.interviewAt,
      '면접장소': candidate.location,
      '장소안내': candidate.location.includes('퍼플카운티')
        ? '\n도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.'
        : '',
      '사전질문지URL': 'https://forms.gle/Kss5nvQf78QNmWMa8',
      '지원직무': candidate.job || candidate.dept || '지원',
      '부서': candidate.dept,
      '직무': candidate.job,
    };
    // 처우협의는 자동 prefill 금지 (보안)
    if (template.stage === 'offer') {
      return { '이름': candidate.name };
    }
    return auto;
  });

  const rendered = renderTemplate(template, vars);
  const missing = findMissingVars(rendered.subject + '\n' + rendered.body);
  const isOffer = template.stage === 'offer';

  async function handleSend() {
    if (missing.length > 0) {
      const ok = window.confirm(`아직 비어있는 변수가 있습니다: ${missing.join(', ')}\n그대로 Gmail 발송 창을 열까요?`);
      if (!ok) return;
    }
    if (isOffer) {
      const ok2 = window.confirm(
        `[처우협의 최종 확인]\n수신: ${to}\n이름: ${candidate.name}\n연봉: ${vars['연봉'] || '(미입력)'}원\n입사일: ${vars['입사일'] || '(미입력)'}\n\nGmail 발송 창을 엽니까?`
      );
      if (!ok2) return;
    }
    window.open(gmailComposeUrl({ to, subject: rendered.subject, body: rendered.body }), '_blank');
    if (to && to !== candidate.email) {
      // 사용자가 새로 입력한 이메일 → 캐시
      onEmailCache(candidate.name, to);
    }
    onSent({
      templateId: template.id,
      templateName: template.name,
      to,
      subject: rendered.subject,
      variables: vars,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col ${
          isOffer ? 'border-4 border-amber-400' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-bg-line flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-600">
              {isOffer ? '🔒 처우협의 (모든 숫자 수기 입력 · 2단계 확인)' : template.name}
            </div>
            <div className="text-lg font-semibold">{candidate.name}님께 발송</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded grid place-items-center text-slate-600 hover:bg-slate-100">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">수신자 이메일</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="후보자 이메일"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            {!candidate.email && to && (
              <div className="text-[11px] text-green-700 mt-1">발송 시 이 이메일이 다음번 자동 채움용으로 저장됩니다</div>
            )}
          </div>
          {template.variables.map((k) => (
            <div key={k}>
              <label className="text-xs font-semibold text-slate-700">{`{{${k}}}`}</label>
              <input
                value={vars[k] || ''}
                onChange={(e) => setVars((p) => ({ ...p, [k]: e.target.value }))}
                placeholder={isOffer ? '수기 입력 필요' : ''}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
          ))}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1">📧 미리보기</div>
            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">
              <div className="font-semibold pb-2 mb-2 border-b border-slate-200 text-slate-900">{rendered.subject}</div>
              <pre className="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed max-h-[260px] overflow-auto">
                {rendered.body}
              </pre>
            </div>
          </div>
          {missing.length > 0 && (
            <div className="text-sm text-amber-700 font-medium">⚠ 비어있는 변수: {missing.join(', ')}</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-bg-line flex items-center justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 text-sm hover:bg-white text-slate-900">
            취소
          </button>
          <button
            onClick={handleSend}
            disabled={!to}
            className={`px-5 py-2 rounded text-sm font-semibold disabled:opacity-40 ${
              isOffer ? 'bg-amber-500 text-slate-900 hover:bg-amber-600' : 'bg-accent-purple text-white hover:bg-accent-purple/90'
            }`}
          >
            {isOffer ? '🔒 Gmail 발송 (2단계 확인)' : '✉️ Gmail 발송 창 열기'}
          </button>
        </div>
      </div>
    </div>
  );
}
