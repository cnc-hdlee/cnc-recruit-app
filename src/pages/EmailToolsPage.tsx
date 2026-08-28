// 후보자 안내 메일 — 면접 캘린더 일정 기준 발송.
//
// 흐름: 사업장(퍼플카운티/용인) → 본부(생산/영업/연구소/크솔) → 단계 양식 선택
//       → 면접 캘린더에 잡힌 후보자 목록에서 상대 메일 주소만 넣고 [발송]
// 발송은 Gmail API 직접 발송(gmail.send). 사용자가 버튼을 누른 경우에만 나간다 — 자동 발송 경로 없음.
// 처우협의(offer)만 예외로 잠금 유지: 자동 prefill 금지 + 2단계 확인.
//
// 단계: 1차 면접 안내 → 1차 합격 → 처우협의 → 최종 입사 안내 (+불합격)
//       CPI 인성검사는 폐지(2026-08)되어 제거. 2차 면접은 아직 미구현.

import { useEffect, useMemo, useState } from 'react';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { isInterviewKind, parseInterviewTitle } from './CalendarPage';
import { api } from '../lib/api';
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
  STAGE_ORDER,
  STAGE_LABEL,
  type EmailTemplate,
  type TemplateStage,
  type SendLogEntry,
} from '../lib/emailTemplates';
import {
  loadSites,
  saveSites,
  loadHqs,
  saveHqs,
  loadHqOverrides,
  saveHqOverride,
  inferHq,
  inferSite,
  HQ_UNSET,
  type MailSite,
  type MailHq,
} from '../lib/mailPresets';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];

function whenLabel(dt: string, tm: string): string {
  if (!dt) return '';
  const [y, mo, d] = dt.split('-').map(Number);
  const date = new Date(y, (mo || 1) - 1, d || 1);
  const [h, mi] = (tm || '').split(':');
  const time = h ? ` ${Number(h)}시 ${mi || '00'}분` : '';
  return `${mo}월 ${d}일(${DAY[date.getDay()]})${time}`;
}

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

interface CalCandidate {
  key: string;
  name: string;
  team: string;
  dt: string;
  tm: string;
  when: string;
  siteId: string | null;
  hqId: string;
  location: string;
  email: string;
}

export function EmailToolsPage() {
  useLiveData(); // 캘린더 폴링 갱신에 재렌더

  const [sites, setSites] = useState<MailSite[]>([]);
  const [hqs, setHqs] = useState<MailHq[]>([]);
  const [hqOverrides, setHqOverrides] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [log, setLog] = useState<SendLogEntry[]>([]);

  const [siteId, setSiteId] = useState<string>('purple');
  const [hqId, setHqId] = useState<string>('all');
  const [stage, setStage] = useState<TemplateStage>('interview_1st');
  const [tplId, setTplId] = useState<string | null>(null);
  const [onlyUpcoming, setOnlyUpcoming] = useState(true);
  const [search, setSearch] = useState('');
  const [draftEmail, setDraftEmail] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const [editingTpl, setEditingTpl] = useState<EmailTemplate | null>(null);
  const [modal, setModal] = useState<{ template: EmailTemplate; candidate: CalCandidate } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    loadSites().then(setSites);
    loadHqs().then(setHqs);
    loadHqOverrides().then(setHqOverrides);
    loadTemplates().then(setTemplates);
    loadEmailCache().then(setEmailMap);
    loadSendLog().then(setLog);
  }, []);

  const site = sites.find((s) => s.id === siteId) || sites[0] || null;

  // ── 면접 캘린더 → 후보자 목록 (캘린더 페이지와 동일한 분류기/파서 사용)
  const allCandidates = useMemo<CalCandidate[]>(() => {
    if (hqs.length === 0) return [];
    const out = new Map<string, CalCandidate>();
    for (const e of liveCalendarEventsNormalized()) {
      if (!isInterviewKind(e.title, e.raw.colorId ?? null, e.raw.calendarId ?? null)) continue;
      const p = parseInterviewTitle(e.title);
      const name = (p.candidate || '').trim();
      if (!name || name.length > 5) continue;
      const tm = e.tm || p.time || '';
      const key = `${e.dt}|${tm}|${name}`;
      if (out.has(key)) continue; // 캘린더 사본 중복 제거
      const teamText = [p.team, p.room, e.location].filter(Boolean).join(' ');
      out.set(key, {
        key,
        name,
        team: p.team || '',
        dt: e.dt,
        tm,
        when: whenLabel(e.dt, tm),
        siteId: inferSite([p.site, e.location, e.title].filter(Boolean).join(' '), sites),
        hqId: hqOverrides[name] || inferHq(teamText, hqs),
        location: e.location || '',
        email: emailMap[name] || '',
      });
    }
    return [...out.values()].sort((a, b) => (a.dt + a.tm).localeCompare(b.dt + b.tm));
  }, [sites, hqs, hqOverrides, emailMap]);

  const today = todayStr();
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCandidates.filter((c) => {
      if (onlyUpcoming && c.dt < today) return false;
      // 사업장 — 일정에서 사업장을 못 읽은 건은 항상 보여준다(누락 방지)
      if (c.siteId && c.siteId !== siteId) return false;
      if (hqId !== 'all' && c.hqId !== hqId) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [allCandidates, onlyUpcoming, today, siteId, hqId, search]);

  // 본부 탭 카운트 (사업장·기간 필터까지 반영한 수)
  const hqCounts = useMemo(() => {
    const base = allCandidates.filter(
      (c) => (!onlyUpcoming || c.dt >= today) && (!c.siteId || c.siteId === siteId)
    );
    const m: Record<string, number> = { all: base.length };
    for (const c of base) m[c.hqId] = (m[c.hqId] || 0) + 1;
    return m;
  }, [allCandidates, onlyUpcoming, today, siteId]);

  // ── 양식: 사업장/본부 전용이 있으면 우선, 없으면 공통
  const stageTemplates = useMemo(() => {
    const fits = (t: EmailTemplate) =>
      (!t.siteId || t.siteId === siteId) && (!t.hqId || hqId === 'all' || t.hqId === hqId);
    return templates.filter((t) => t.stage === stage && fits(t));
  }, [templates, stage, siteId, hqId]);

  const currentTpl = useMemo(() => {
    if (stageTemplates.length === 0) return null;
    const picked = stageTemplates.find((t) => t.id === tplId);
    if (picked) return picked;
    // 전용 > 공통 순으로 자동 선택
    const score = (t: EmailTemplate) => (t.siteId ? 2 : 0) + (t.hqId ? 1 : 0);
    return [...stageTemplates].sort((a, b) => score(b) - score(a))[0];
  }, [stageTemplates, tplId]);

  const availableStages = useMemo(() => {
    const set = new Set(templates.map((t) => t.stage));
    return STAGE_ORDER.filter((s) => set.has(s));
  }, [templates]);

  // ── 변수 자동 채움
  function autoVars(c: CalCandidate, tpl: EmailTemplate): Record<string, string> {
    if (tpl.stage === 'offer') return { 이름: c.name }; // 처우협의는 숫자 자동 채움 금지
    const address = site?.address || c.location || '';
    return {
      이름: c.name,
      면접일시: c.when,
      면접장소: address,
      입사장소: address,
      근무지: site?.label || '',
      장소안내: site?.guide || '',
      사전질문지URL: 'https://forms.gle/Kss5nvQf78QNmWMa8',
      지원직무: c.team || '지원',
      부서: c.team || '',
      직무: c.team || '',
    };
  }

  async function refreshTemplates() {
    setTemplates(await loadTemplates());
  }

  // ── 발송 (Gmail API 직접 발송)
  async function send(
    c: CalCandidate,
    tpl: EmailTemplate,
    to: string,
    vars: Record<string, string>
  ): Promise<boolean> {
    const rendered = renderTemplate(tpl, vars);
    if (!api?.google?.sendGmail) {
      // Electron이 아닌 환경(모바일 뷰어 등) — Gmail 작성 창으로 폴백
      window.open(gmailComposeUrl({ to, subject: rendered.subject, body: rendered.body }), '_blank');
      return true;
    }
    setBusy(c.key);
    try {
      const r = await api.google.sendGmail({ to, subject: rendered.subject, body: rendered.body });
      if (!r.ok) {
        alert(`발송 실패: ${r.error || '알 수 없는 오류'}`);
        return false;
      }
      await appendSendLog({
        templateId: tpl.id,
        templateName: tpl.name,
        to,
        subject: rendered.subject,
        variables: vars,
      });
      setLog(await loadSendLog());
      await saveEmail(c.name, to);
      setEmailMap((p) => ({ ...p, [c.name]: to }));
      return true;
    } finally {
      setBusy(null);
    }
  }

  // 목록에서 바로 발송 — 비어있는 변수가 있거나 처우협의면 확인 창을 먼저 띄운다
  async function quickSend(c: CalCandidate) {
    if (!currentTpl) return;
    const to = (draftEmail[c.key] ?? c.email).trim();
    if (!to) {
      alert('상대 메일 주소를 먼저 입력해주세요.');
      return;
    }
    const vars = autoVars(c, currentTpl);
    const rendered = renderTemplate(currentTpl, vars);
    const missing = findMissingVars(`${rendered.subject}\n${rendered.body}`);
    if (currentTpl.stage === 'offer' || missing.length > 0) {
      setModal({ template: currentTpl, candidate: { ...c, email: to } });
      return;
    }
    const ok = window.confirm(
      `${c.name}님께 아래 메일을 발송합니다.\n\n수신: ${to}\n양식: ${currentTpl.name}\n제목: ${rendered.subject}`
    );
    if (!ok) return;
    if (await send(c, currentTpl, to, vars)) {
      setDraftEmail((p) => ({ ...p, [c.key]: to }));
    }
  }

  const hqLabel = (id: string) => hqs.find((h) => h.id === id)?.label || HQ_UNSET.label;

  return (
    <div className="space-y-3 text-slate-900">
      {/* ── 1) 사업장 · 본부 선택 ─────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-900">사업장</span>
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setSiteId(s.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                siteId === s.id
                  ? 'bg-accent-purple text-white border-accent-purple'
                  : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {s.label}
              {!s.address && <span className="ml-1 text-red-600">·주소 미입력</span>}
            </button>
          ))}
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1.5 rounded-lg text-sm border border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
          >
            ⚙ 설정
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-200">
          <span className="text-sm font-bold text-slate-900">본부</span>
          {[{ id: 'all', label: '전체' }, ...hqs, HQ_UNSET].map((h) => (
            <button
              key={h.id}
              onClick={() => setHqId(h.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                hqId === h.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {h.label}
              <span className="ml-1 text-xs">{hqCounts[h.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 2) 단계 양식 선택 ─────────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-900">양식</span>
          {availableStages.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStage(s);
                setTplId(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                stage === s
                  ? 'bg-accent-purple text-white border-accent-purple'
                  : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {s === 'offer' && '🔒 '}
              {STAGE_LABEL[s]}
            </button>
          ))}
          {stageTemplates.length > 1 && (
            <select
              value={currentTpl?.id || ''}
              onChange={(e) => setTplId(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {stageTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.siteId ? ` · ${sites.find((s) => s.id === t.siteId)?.label || t.siteId}` : ''}
                  {t.hqId ? ` · ${hqLabel(t.hqId)}` : ''}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-1">
            {currentTpl && (
              <>
                <button
                  onClick={() => setEditingTpl({ ...currentTpl })}
                  className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
                >
                  ✎ 수정
                </button>
                <button
                  onClick={() =>
                    setEditingTpl({
                      ...currentTpl,
                      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      name: `${currentTpl.name} (${site?.label || ''} 전용)`,
                      siteId,
                      hqId: hqId === 'all' ? null : hqId,
                      builtin: false,
                      modifiedAt: undefined,
                      createdAt: Date.now(),
                    })
                  }
                  className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
                >
                  ⧉ 사업장 전용으로 복제
                </button>
              </>
            )}
            <button
              onClick={() => setEditingTpl({ ...createBlankTemplate(), stage, siteId, hqId: hqId === 'all' ? null : hqId })}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
            >
              ＋ 새 양식
            </button>
          </div>
        </div>

        {currentTpl ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              {currentTpl.subject} <span className="text-slate-700">— 본문 보기</span>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-900 leading-relaxed bg-slate-50 border border-slate-300 rounded p-3 max-h-64 overflow-auto">
              {currentTpl.body}
            </pre>
          </details>
        ) : (
          <div className="mt-2 text-sm text-slate-900">
            이 사업장/본부에 맞는 양식이 없습니다. [＋ 새 양식]으로 추가하세요.
          </div>
        )}
      </div>

      {/* ── 3) 면접 캘린더 후보자 → 메일 주소만 넣고 발송 ──── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="text-sm font-bold text-slate-900">
            면접 캘린더 후보자 <span className="text-slate-900">{candidates.length}명</span>
          </h3>
          <label className="flex items-center gap-1 text-sm text-slate-900">
            <input type="checkbox" checked={onlyUpcoming} onChange={(e) => setOnlyUpcoming(e.target.checked)} />
            예정 일정만
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·소속 검색"
            className="ml-auto px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-56"
          />
        </div>

        <div className="overflow-auto rounded-lg border border-slate-300 max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100">
              <tr>
                {['면접일시', '이름', '소속', '본부', '상대 메일 주소', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-bold text-slate-900 border-b border-slate-300">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const to = draftEmail[c.key] ?? c.email;
                const sent = log.find((l) => l.variables?.['이름'] === c.name && l.templateId === currentTpl?.id);
                return (
                  <tr key={c.key} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-900 whitespace-nowrap">{c.when}</td>
                    <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">{c.name}</td>
                    <td className="px-3 py-2 text-slate-900">{c.team || '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <select
                        value={c.hqId}
                        onChange={async (e) => {
                          await saveHqOverride(c.name, e.target.value);
                          setHqOverrides((p) => ({ ...p, [c.name]: e.target.value }));
                        }}
                        className="px-1 py-0.5 border border-slate-300 rounded text-xs text-slate-900 bg-white"
                      >
                        {[...hqs, HQ_UNSET].map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={to}
                        onChange={(e) => setDraftEmail((p) => ({ ...p, [c.key]: e.target.value }))}
                        placeholder="candidate@example.com"
                        className="w-56 px-2 py-1 border border-slate-300 rounded text-sm text-slate-900"
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        onClick={() => quickSend(c)}
                        disabled={!currentTpl || busy === c.key}
                        className="px-3 py-1 rounded bg-accent-purple text-white text-xs font-bold disabled:opacity-40 hover:bg-accent-purple/90"
                      >
                        {busy === c.key ? '발송 중…' : '✉ 발송'}
                      </button>
                      <button
                        onClick={() => currentTpl && setModal({ template: currentTpl, candidate: { ...c, email: to } })}
                        disabled={!currentTpl}
                        className="ml-1 px-2 py-1 rounded border border-slate-300 bg-white text-xs text-slate-900 hover:bg-slate-100"
                      >
                        미리보기
                      </button>
                      {sent && <span className="ml-1 text-xs font-bold text-green-700">발송됨</span>}
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-sm text-slate-900">
                    조건에 맞는 면접 일정이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4) 발송 기록 (접힘) ───────────────────────────── */}
      <div className="card p-3">
        <button onClick={() => setShowLog((v) => !v)} className="text-sm font-bold text-slate-900">
          {showLog ? '▾' : '▸'} 발송 기록 {log.length}건
        </button>
        {showLog && (
          <div className="mt-2 overflow-auto rounded-lg border border-slate-300 max-h-64">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {['시각', '양식', '수신', '제목'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-bold text-slate-900 border-b border-slate-300">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 50).map((e) => (
                  <tr key={e.id} className="border-b border-slate-200">
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-900 whitespace-nowrap">
                      {new Date(e.at).toLocaleString('ko-KR', { hour12: false })}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-900">{e.templateName}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-900 whitespace-nowrap">{e.to}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-900 truncate max-w-[380px]">{e.subject}</td>
                  </tr>
                ))}
                {log.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-4 text-sm text-slate-900">
                      발송 기록 없음
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingTpl && (
        <TemplateEditor
          template={editingTpl}
          sites={sites}
          hqs={hqs}
          onClose={() => setEditingTpl(null)}
          onSave={async (t) => {
            t.variables = extractVariables(`${t.subject} ${t.body}`);
            await saveTemplate(t);
            await refreshTemplates();
            setStage(t.stage);
            setTplId(t.id);
            setEditingTpl(null);
          }}
          onDelete={async (id) => {
            if (!confirm('이 양식을 삭제할까요? (기본 양식은 초기값으로 되돌아갑니다)')) return;
            await deleteTemplate(id);
            await refreshTemplates();
            setTplId(null);
            setEditingTpl(null);
          }}
        />
      )}

      {modal && (
        <SendModal
          template={modal.template}
          candidate={modal.candidate}
          initialVars={autoVars(modal.candidate, modal.template)}
          onClose={() => setModal(null)}
          onSend={async (to, vars) => {
            const ok = await send(modal.candidate, modal.template, to, vars);
            if (ok) setModal(null);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          sites={sites}
          hqs={hqs}
          onClose={() => setShowSettings(false)}
          onSave={async (s, h) => {
            await saveSites(s);
            await saveHqs(h);
            setSites(s);
            setHqs(h);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 발송 모달 — 변수 채우기 + 미리보기 + 발송
// ─────────────────────────────────────────────────────────────
function SendModal({
  template,
  candidate,
  initialVars,
  onClose,
  onSend,
}: {
  template: EmailTemplate;
  candidate: CalCandidate;
  initialVars: Record<string, string>;
  onClose: () => void;
  onSend: (to: string, vars: Record<string, string>) => void;
}) {
  const [to, setTo] = useState(candidate.email);
  const [vars, setVars] = useState<Record<string, string>>(initialVars);
  const rendered = renderTemplate(template, vars);
  const missing = findMissingVars(`${rendered.subject}\n${rendered.body}`);
  const isOffer = template.stage === 'offer';

  function handleSend() {
    if (!to.trim()) return;
    if (missing.length > 0 && !confirm(`비어있는 항목이 있습니다: ${missing.join(', ')}\n그대로 발송할까요?`)) return;
    if (isOffer) {
      const ok = confirm(
        `[처우협의 최종 확인]\n수신: ${to}\n이름: ${candidate.name}\n연봉: ${vars['연봉'] || '(미입력)'}원\n입사일: ${
          vars['입사일'] || '(미입력)'
        }\n\n이대로 발송합니까?`
      );
      if (!ok) return;
    } else if (!confirm(`${candidate.name}님께 발송합니다.\n\n수신: ${to}\n제목: ${rendered.subject}`)) {
      return;
    }
    onSend(to.trim(), vars);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col ${
          isOffer ? 'border-4 border-amber-400' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-300 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              {isOffer ? '🔒 처우협의 — 모든 숫자 수기 입력 · 2단계 확인' : template.name}
            </div>
            <div className="text-lg font-bold text-slate-900">
              {candidate.name} · {candidate.when}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded text-slate-900 hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-900">상대 메일 주소</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="candidate@example.com"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
            />
          </div>
          {template.variables.map((k) => (
            <div key={k}>
              <label className="text-xs font-bold text-slate-900">{`{{${k}}}`}</label>
              <input
                value={vars[k] || ''}
                onChange={(e) => setVars((p) => ({ ...p, [k]: e.target.value }))}
                placeholder={isOffer ? '수기 입력' : ''}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
              />
            </div>
          ))}
          <div>
            <div className="text-xs font-bold text-slate-900 mb-1">미리보기</div>
            <div className="rounded border border-slate-300 bg-slate-50 p-3">
              <div className="font-bold pb-2 mb-2 border-b border-slate-300 text-slate-900">{rendered.subject}</div>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-900 leading-relaxed max-h-64 overflow-auto">
                {rendered.body}
              </pre>
            </div>
          </div>
          {missing.length > 0 && (
            <div className="text-sm font-bold text-red-700">비어있는 항목: {missing.join(', ')}</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-300 flex items-center justify-end gap-2 bg-slate-50">
          <button
            onClick={() => window.open(gmailComposeUrl({ to, subject: rendered.subject, body: rendered.body }), '_blank')}
            className="px-3 py-2 rounded border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
          >
            Gmail 창에서 열기
          </button>
          <button
            onClick={handleSend}
            disabled={!to.trim()}
            className={`px-5 py-2 rounded text-sm font-bold disabled:opacity-40 ${
              isOffer ? 'bg-amber-500 text-slate-900 hover:bg-amber-600' : 'bg-accent-purple text-white hover:bg-accent-purple/90'
            }`}
          >
            ✉ 바로 발송
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 양식 편집 — 사업장/본부 전용 지정 포함
// ─────────────────────────────────────────────────────────────
function TemplateEditor({
  template,
  sites,
  hqs,
  onSave,
  onDelete,
  onClose,
}: {
  template: EmailTemplate;
  sites: MailSite[];
  hqs: MailHq[];
  onSave: (t: EmailTemplate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [t, setT] = useState(template);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-300 flex items-center justify-between">
          <div className="text-lg font-bold text-slate-900">{t.builtin ? '기본 양식 수정' : '양식 편집'}</div>
          <button onClick={onClose} className="w-8 h-8 rounded text-slate-900 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-900">양식 이름</label>
            <input
              value={t.name}
              onChange={(e) => setT({ ...t, name: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-900">단계</label>
              <select
                value={t.stage}
                onChange={(e) => setT({ ...t, stage: e.target.value as TemplateStage })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white text-slate-900"
              >
                {STAGE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-900">사업장</label>
              <select
                value={t.siteId || ''}
                onChange={(e) => setT({ ...t, siteId: e.target.value || null })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white text-slate-900"
              >
                <option value="">전 사업장 공통</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} 전용
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-900">본부</label>
              <select
                value={t.hqId || ''}
                onChange={(e) => setT({ ...t, hqId: e.target.value || null })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white text-slate-900"
              >
                <option value="">전 본부 공통</option>
                {hqs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} 전용
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-900">메일 제목</label>
            <input
              value={t.subject}
              onChange={(e) => setT({ ...t, subject: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono text-slate-900"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-900">본문 (변수는 {`{{변수명}}`} 형태)</label>
            <textarea
              value={t.body}
              onChange={(e) => setT({ ...t, body: e.target.value })}
              rows={16}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono leading-relaxed text-slate-900"
            />
          </div>
          <div className="text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded p-2">
            자동 인식 변수: <span className="font-mono">{extractVariables(`${t.subject} ${t.body}`).join(', ') || '(없음)'}</span>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-300 flex items-center justify-end gap-2 bg-slate-50">
          {!t.builtin && (
            <button
              onClick={() => onDelete(t.id)}
              className="mr-auto px-3 py-2 rounded border border-red-400 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              삭제
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100">
            취소
          </button>
          <button
            onClick={() => onSave(t)}
            disabled={!t.name || !t.subject || !t.body}
            className="px-5 py-2 rounded bg-accent-purple text-white text-sm font-bold disabled:opacity-40 hover:bg-accent-purple/90"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 사업장 주소 / 본부 분류 키워드 설정
// ─────────────────────────────────────────────────────────────
function SettingsModal({
  sites,
  hqs,
  onSave,
  onClose,
}: {
  sites: MailSite[];
  hqs: MailHq[];
  onSave: (sites: MailSite[], hqs: MailHq[]) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<MailSite[]>(sites);
  const [h, setH] = useState<MailHq[]>(hqs);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-300 text-lg font-bold text-slate-900">사업장 · 본부 설정</div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          <div>
            <div className="text-sm font-bold text-slate-900 mb-2">사업장 (메일 본문의 장소/오시는 길)</div>
            {s.map((site, i) => (
              <div key={site.id} className="mb-3 border border-slate-300 rounded p-3">
                <div className="text-sm font-bold text-slate-900 mb-1">{site.label}</div>
                <input
                  value={site.address}
                  onChange={(e) => setS(s.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))}
                  placeholder="예) (주)씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로5길 39)"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
                />
                <textarea
                  value={site.guide}
                  onChange={(e) => setS(s.map((x, j) => (j === i ? { ...x, guide: e.target.value } : x)))}
                  rows={2}
                  placeholder="주소 뒤에 붙는 안내 문구 (예: 도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.)"
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
                />
              </div>
            ))}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 mb-2">본부 자동 분류 키워드 (쉼표 구분)</div>
            {h.map((hq, i) => (
              <div key={hq.id} className="flex items-center gap-2 mb-2">
                <span className="w-24 text-sm font-bold text-slate-900">{hq.label}</span>
                <input
                  value={hq.match.join(', ')}
                  onChange={(e) =>
                    setH(h.map((x, j) => (j === i ? { ...x, match: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) } : x)))
                  }
                  className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-300 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100">
            취소
          </button>
          <button onClick={() => onSave(s, h)} className="px-5 py-2 rounded bg-accent-purple text-white text-sm font-bold hover:bg-accent-purple/90">
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
