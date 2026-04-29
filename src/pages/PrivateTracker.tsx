// 🔒 PrivateTracker — maintainer-only 비공개 채용 트래커
//
// 이 페이지는 본체(Electron)에서만 노출되며 (IS_VIEWER일 땐 라우팅에서 제외),
// 데이터는 Electron의 cfg store에 'privateInterviews' 키로 저장된다.
// 팀원이 보는 뷰어 / Cloudflare snapshot에는 절대 포함되지 않음.
//
// 용도: 이나영 전무님(볼트엑스) 등 비공개 채용 후보자/진행상태를 본인만 추적.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { PrivateInterview } from '../types';

const STATUSES: PrivateInterview['status'][] = [
  '면접예정',
  '면접완료',
  '결과대기',
  '오퍼',
  '입사확정',
  '보류',
  '취소',
];

const SOURCE_PRESETS = ['볼트엑스 / 이나영 전무', '헤드헌터', '서치펌', '직접 컨택', '추천', '기타'];

const STORAGE_KEY = 'privateInterviews';

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  return `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtDateTime(iso: string): string {
  if (!iso) return '미정';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd} ${hh}:${mm}`;
}

function isoToInputValue(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

function inputValueToIso(v: string): string {
  if (!v) return '';
  return new Date(v).toISOString();
}

const STATUS_TONE: Record<PrivateInterview['status'], string> = {
  면접예정: 'bg-accent-blue/15 text-accent-blue border-accent-blue/30',
  면접완료: 'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
  결과대기: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',
  오퍼: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
  입사확정: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  보류: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  취소: 'bg-accent-red/10 text-accent-red border-accent-red/30',
};

export function PrivateTracker() {
  const [items, setItems] = useState<PrivateInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PrivateInterview | null>(null);
  const [filter, setFilter] = useState<'all' | PrivateInterview['status']>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      if (api?.cfg) {
        const r = await api.cfg.get<PrivateInterview[]>(STORAGE_KEY);
        if (r.ok && Array.isArray(r.data)) {
          setItems(r.data);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function persist(next: PrivateInterview[]) {
    setItems(next);
    if (api?.cfg) {
      await api.cfg.set(STORAGE_KEY, next);
    }
  }

  function startNew() {
    setEditing({
      id: '',
      candidate: '',
      department: '',
      position: '',
      scheduledAt: '',
      location: '',
      source: '볼트엑스 / 이나영 전무',
      status: '면접예정',
      notes: '',
      createdAt: '',
      updatedAt: '',
    });
  }

  async function save(draft: PrivateInterview) {
    const now = nowIso();
    if (draft.id) {
      const next = items.map((it) => (it.id === draft.id ? { ...draft, updatedAt: now } : it));
      await persist(next);
    } else {
      const created: PrivateInterview = {
        ...draft,
        id: genId(),
        createdAt: now,
        updatedAt: now,
      };
      await persist([created, ...items]);
    }
    setEditing(null);
  }

  async function remove(id: string) {
    if (!window.confirm('이 비공개 항목을 삭제할까요? 되돌릴 수 없습니다.')) return;
    await persist(items.filter((it) => it.id !== id));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((it) => filter === 'all' || it.status === filter)
      .filter(
        (it) =>
          !q ||
          it.candidate.toLowerCase().includes(q) ||
          it.department.toLowerCase().includes(q) ||
          it.position.toLowerCase().includes(q) ||
          it.source.toLowerCase().includes(q) ||
          it.notes.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        // scheduledAt 오름차순 (미정은 뒤로)
        if (!a.scheduledAt && !b.scheduledAt) return 0;
        if (!a.scheduledAt) return 1;
        if (!b.scheduledAt) return -1;
        return a.scheduledAt.localeCompare(b.scheduledAt);
      });
  }, [items, filter, query]);

  const counts = useMemo(() => {
    const c = { all: items.length } as Record<string, number>;
    for (const s of STATUSES) c[s] = items.filter((it) => it.status === s).length;
    return c;
  }, [items]);

  if (loading) {
    return <div className="card p-6 text-sm text-slate-400">로드 중...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 border border-accent-purple/30 bg-gradient-to-br from-accent-purple/5 to-transparent">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔒</span>
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-100">비공개 채용 트래커</div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              이 영역은 <b>본인만</b> 봅니다. Google Calendar에 등록되지 않으며 팀원 뷰어 / Cloudflare snapshot에도 노출되지 않습니다.<br />
              볼트엑스 이나영 전무님 등 비공개 채용 후보자/진행상태를 여기에 기록하세요.
            </p>
          </div>
          <button
            onClick={startNew}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-br from-accent-purple to-accent-blue hover:brightness-110 shadow-soft shrink-0"
          >
            + 새 항목
          </button>
        </div>
      </div>

      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 mr-1">필터:</span>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
            전체 ({counts.all})
          </FilterPill>
          {STATUSES.map((s) => (
            <FilterPill key={s} active={filter === s} onClick={() => setFilter(s)}>
              {s} ({counts[s] || 0})
            </FilterPill>
          ))}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="후보자 / 부서 / 직무 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-bg-deep/60 border border-bg-line focus:border-accent-purple focus:outline-none w-56"
          />
        </div>
      </div>

      <div className="card p-2">
        {filtered.length === 0 ? (
          <div className="text-sm text-slate-400 py-12 text-center">
            {items.length === 0 ? '등록된 비공개 항목이 없습니다. 우측 상단 [+ 새 항목]으로 추가하세요.' : '조건에 맞는 항목 없음'}
          </div>
        ) : (
          <div className="divide-y divide-bg-line">
            {filtered.map((it) => (
              <div key={it.id} className="grid grid-cols-[100px_1fr_120px_auto] gap-3 p-3 hover:bg-bg-hover/20 items-center">
                <div className="text-xs">
                  <div className="font-mono text-slate-200">{fmtDateTime(it.scheduledAt).split(' ')[0] || '미정'}</div>
                  <div className="text-slate-400">{fmtDateTime(it.scheduledAt).split(' ')[1] || ''}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-slate-100 font-medium truncate">
                    {it.candidate || <span className="text-slate-500">(후보자 미입력)</span>}
                    {it.department && <span className="ml-2 text-slate-400 font-normal">/ {it.department}</span>}
                    {it.position && <span className="ml-1 text-slate-500 font-normal">· {it.position}</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3 flex-wrap">
                    {it.source && <span>📋 {it.source}</span>}
                    {it.location && <span>📍 {it.location}</span>}
                    {it.notes && <span className="truncate">📝 {it.notes}</span>}
                  </div>
                </div>
                <div className="text-center">
                  <span className={`chip border ${STATUS_TONE[it.status]} text-[11px]`}>{it.status}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(it)}
                    className="px-2.5 py-1 rounded text-[11px] bg-bg-deep/60 border border-bg-line text-slate-300 hover:text-white hover:border-accent-purple/40"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => remove(it.id)}
                    className="px-2.5 py-1 rounded text-[11px] bg-bg-deep/60 border border-bg-line text-slate-400 hover:text-accent-red hover:border-accent-red/40"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditModal
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function EditModal({
  initial,
  onCancel,
  onSave,
}: {
  initial: PrivateInterview;
  onCancel: () => void;
  onSave: (next: PrivateInterview) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const isNew = !initial.id;

  function update<K extends keyof PrivateInterview>(k: K, v: PrivateInterview[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function submit() {
    if (!draft.candidate.trim()) {
      alert('후보자 이름은 필수입니다.');
      return;
    }
    onSave(draft);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl card p-6 border border-accent-purple/30 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔒</span>
            <h3 className="text-base font-semibold">{isNew ? '비공개 항목 추가' : '비공개 항목 수정'}</h3>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="space-y-3">
          <Field label="후보자 *">
            <input
              type="text"
              value={draft.candidate}
              onChange={(e) => update('candidate', e.target.value)}
              autoFocus
              className="input"
              placeholder="이름"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="소속/부서">
              <input
                type="text"
                value={draft.department}
                onChange={(e) => update('department', e.target.value)}
                className="input"
                placeholder="예: KPD1팀"
              />
            </Field>
            <Field label="직무/직책">
              <input
                type="text"
                value={draft.position}
                onChange={(e) => update('position', e.target.value)}
                className="input"
                placeholder="예: 본부장 / PM"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="일정">
              <input
                type="datetime-local"
                value={isoToInputValue(draft.scheduledAt)}
                onChange={(e) => update('scheduledAt', inputValueToIso(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="장소">
              <input
                type="text"
                value={draft.location}
                onChange={(e) => update('location', e.target.value)}
                className="input"
                placeholder="예: 위워크 4E"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="출처">
              <select
                value={draft.source}
                onChange={(e) => update('source', e.target.value)}
                className="input"
              >
                {SOURCE_PRESETS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="상태">
              <select
                value={draft.status}
                onChange={(e) => update('status', e.target.value as PrivateInterview['status'])}
                className="input"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="메모">
            <textarea
              value={draft.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={4}
              className="input resize-none"
              placeholder="진행 메모 / 면접관 / 처우 협의 / 결정 포인트 등"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm bg-bg-deep/60 border border-bg-line text-slate-300 hover:text-white"
          >
            취소
          </button>
          <button
            onClick={submit}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-br from-accent-purple to-accent-blue hover:brightness-110"
          >
            {isNew ? '추가' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] text-slate-400 mb-1">{label}</div>
      {children}
    </label>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
        active
          ? 'bg-accent-purple text-white border-accent-purple'
          : 'bg-bg-card/40 text-slate-300 border-bg-line hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}
