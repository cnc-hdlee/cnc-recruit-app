import { useState } from 'react';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { api } from '../lib/api';
import type { GmailMsg } from '../lib/api';

interface SheetHit {
  spreadsheetTitle: string;
  tabName: string;
  fields: Record<string, string>;
}

interface CalHit {
  id: string;
  dt: string;
  tm: string;
  title: string;
  location: string;
  htmlLink: string | null;
  attendees: string[];
}

interface ResultBundle {
  sheetHits: SheetHit[];
  calHits: CalHit[];
  gmailHits: GmailMsg[];
  loading: boolean;
  error: string | null;
}

const EMPTY: ResultBundle = {
  sheetHits: [],
  calHits: [],
  gmailHits: [],
  loading: false,
  error: null,
};

export function CandidateLookup() {
  const live = useLiveData();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [bundle, setBundle] = useState<ResultBundle>(EMPTY);

  const runSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setSubmitted(q);
    setBundle({ ...EMPTY, loading: true });

    // 1. Sheet hits — scan all snapshots
    const sheetHits: SheetHit[] = [];
    for (const [, snap] of Object.entries(live.snapshots || {})) {
      const title = snap.title || '';
      for (const [tabName, rows] of Object.entries(snap.tabs || {})) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        // 헤더 추정: 첫 비어있지 않은 행
        let headerIdx = 0;
        for (let i = 0; i < Math.min(rows.length, 6); i++) {
          if ((rows[i] || []).some((c) => String(c || '').trim().length > 1)) {
            headerIdx = i;
            break;
          }
        }
        const headers = (rows[headerIdx] || []).map((h) => String(h || '').trim());
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i] || [];
          // 후보자 이름은 보통 한글 2-4자 — exact match가 우선이지만 includes도 허용
          const found = row.some((cell) => {
            const v = String(cell || '').trim();
            if (!v) return false;
            return v === q || (q.length >= 2 && v.includes(q));
          });
          if (!found) continue;
          const obj: Record<string, string> = {};
          for (let c = 0; c < headers.length; c++) {
            const k = headers[c] || `col${c}`;
            const v = row[c] != null ? String(row[c]).trim() : '';
            if (v) obj[k] = v;
          }
          sheetHits.push({ spreadsheetTitle: title, tabName, fields: obj });
          if (sheetHits.length >= 30) break;
        }
        if (sheetHits.length >= 30) break;
      }
      if (sheetHits.length >= 30) break;
    }

    // 2. Calendar hits
    const calHits: CalHit[] = liveCalendarEventsNormalized()
      .filter((e) => {
        const hay = `${e.title} ${e.location} ${e.raw.description || ''}`;
        return hay.includes(q);
      })
      .slice(0, 50)
      .map((e) => ({
        id: e.id,
        dt: e.dt,
        tm: e.tm,
        title: e.title,
        location: e.location,
        htmlLink: e.htmlLink,
        attendees: e.attendees,
      }));

    // 3. Gmail hits
    let gmailHits: GmailMsg[] = [];
    try {
      const r = await api?.google?.listGmail(q, 20);
      if (r?.ok && r.data) gmailHits = r.data;
    } catch {
      // ignore
    }

    setBundle({ sheetHits, calHits, gmailHits, loading: false, error: null });
  };

  return (
    <div className="space-y-3">
      {/* 검색 입력 */}
      <div className="card p-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(query);
            }}
            placeholder="후보자명/사번/직무 입력 후 Enter — 시트·캘린더·Gmail 통합 검색"
            className="flex-1 px-4 py-2 rounded-lg text-base bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none text-slate-800"
            autoFocus
          />
          <button
            onClick={() => runSearch(query)}
            disabled={!query.trim() || bundle.loading}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {bundle.loading ? '검색 중...' : '검색'}
          </button>
        </div>
        {submitted && !bundle.loading && (
          <div className="mt-2 text-[11px] text-slate-500">
            "{submitted}" 검색 결과 — 시트 {bundle.sheetHits.length}건 · 캘린더 {bundle.calHits.length}건 · 메일{' '}
            {bundle.gmailHits.length}건
          </div>
        )}
      </div>

      {!submitted ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3 opacity-50">👤</div>
          <div className="text-sm text-slate-500 mb-1">후보자명을 입력하면</div>
          <div className="text-[11px] text-slate-400">
            정규직DB · 도급직DB · 입사예정 · 채용 진행 시트 + Google Calendar 면접 + Gmail 메일을 한 번에 모아 보여줍니다.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ResultSection title="📋 시트 (인사·채용 DB)" count={bundle.sheetHits.length}>
            {bundle.sheetHits.length === 0 ? (
              <Empty msg="매칭되는 시트 행이 없습니다." />
            ) : (
              <div className="space-y-2">
                {bundle.sheetHits.map((h, i) => (
                  <SheetCard key={i} hit={h} />
                ))}
              </div>
            )}
          </ResultSection>

          <ResultSection title="📅 Google Calendar" count={bundle.calHits.length}>
            {bundle.calHits.length === 0 ? (
              <Empty msg="매칭되는 캘린더 일정이 없습니다." />
            ) : (
              <div className="space-y-2">
                {bundle.calHits.map((c) => (
                  <CalCard key={c.id} hit={c} />
                ))}
              </div>
            )}
          </ResultSection>

          <ResultSection title="✉️ Gmail" count={bundle.gmailHits.length}>
            {bundle.gmailHits.length === 0 ? (
              <Empty msg="매칭되는 메일이 없습니다." />
            ) : (
              <div className="space-y-2">
                {bundle.gmailHits.map((m) => (
                  <GmailCard key={m.id} msg={m} />
                ))}
              </div>
            )}
          </ResultSection>
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
        <span className="text-sm font-bold text-slate-800">{title}</span>
        <span className="chip bg-slate-100 text-slate-700 text-[10px]">{count}</span>
      </div>
      <div className="max-h-[480px] overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-center text-[11px] text-slate-400 py-4">{msg}</div>;
}

function SheetCard({ hit }: { hit: SheetHit }) {
  const entries = Object.entries(hit.fields).slice(0, 8);
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/50">
      <div className="text-[10px] text-slate-500 mb-1.5 font-mono">
        {hit.spreadsheetTitle} → <span className="text-indigo-600 font-bold">{hit.tabName}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
        {entries.map(([k, v]) => (
          <div key={k} className="truncate" title={`${k}: ${v}`}>
            <span className="text-slate-500">{k}:</span> <span className="font-medium text-slate-800">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalCard({ hit }: { hit: CalHit }) {
  const inner = (
    <div className="rounded-lg border border-blue-200 p-2.5 bg-blue-50/40 hover:bg-blue-50/70 transition">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-mono font-extrabold text-blue-700 text-sm">{hit.dt} {hit.tm}</span>
      </div>
      <div className="text-[12px] font-medium text-slate-800 truncate">{hit.title}</div>
      {hit.location && <div className="text-[11px] text-slate-600 mt-0.5">📍 {hit.location}</div>}
      {hit.attendees.length > 0 && (
        <div className="text-[10px] text-slate-500 mt-0.5">👥 {hit.attendees.slice(0, 3).join(', ')}{hit.attendees.length > 3 ? `…(+${hit.attendees.length - 3})` : ''}</div>
      )}
    </div>
  );
  if (hit.htmlLink) {
    return (
      <a href={hit.htmlLink} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

function GmailCard({ msg }: { msg: GmailMsg }) {
  const url = `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <div className="rounded-lg border border-rose-200 p-2.5 bg-rose-50/40 hover:bg-rose-50/70 transition">
        <div className="text-[10px] text-slate-500 mb-0.5 truncate">
          {new Date(msg.date).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {msg.from}
        </div>
        <div className="text-[12px] font-bold text-slate-800 truncate">{msg.subject}</div>
        <div className="text-[11px] text-slate-600 line-clamp-2 mt-0.5">{msg.snippet}</div>
      </div>
    </a>
  );
}

