import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { api } from '../lib/api';
import type { GmailMsg, GmailAttachmentInfo } from '../lib/api';

// 후보자 이름 + 첨부 인포로부터 "이력서로 추정되는" 1개 첨부 추출 — CalendarPage 1~4순위 로직 단순화 버전.
// 메모리 [면접 카드 첨부는 이력서만 — 사전질문지/평가표 절대 금지] 정책 준수.
function pickResumeAttachment(infos: GmailAttachmentInfo[], candidateName: string): GmailAttachmentInfo | null {
  if (!infos || infos.length === 0) return null;
  const candidateNorm = (candidateName || '').replace(/[\s_\-.()\[\]·ㆍ／（）［］、,，]+/g, '');
  if (candidateNorm.length < 2) {
    // 이름 매칭 못함 — 메일 안에 EXCLUDE 아닌 doc 1개면 그것을 채택, 아니면 null
    const docs = infos.filter(isDocFile).filter((a) => !EXCLUDE_RESUME.test(a.filename));
    return docs.length === 1 ? docs[0] : null;
  }
  const norm = (s: string) => s.replace(/[\s_\-.()\[\]·ㆍ／（）［］、,，]+/g, '');
  const filesWithName = infos.filter((a) => isDocFile(a) && norm(a.filename || '').includes(candidateNorm));
  // 1순위: 이름 + RESUME 키워드 + EXCLUDE 없음
  const exact = filesWithName.find((a) => RESUME_KEY.test(a.filename) && !EXCLUDE_RESUME.test(a.filename));
  if (exact) return exact;
  // 2순위: 이름 + EXCLUDE 없음
  const looseButSafe = filesWithName.find((a) => !EXCLUDE_RESUME.test(a.filename));
  if (looseButSafe) return looseButSafe;
  // 3순위: 메일에 doc 1개고 EXCLUDE 아님
  const allDocs = infos.filter((a) => isDocFile(a) && !EXCLUDE_RESUME.test(a.filename));
  if (allDocs.length === 1) return allDocs[0];
  return null;
}
const RESUME_KEY = /이력서|이력|resume|cv|portfolio|포트폴리오|자기소개서|자소서|지원서|입사지원|서류전형/i;
const EXCLUDE_RESUME = /사전질문|질문지|평가표|평가서|평가지|면접평가|자기평가|인성검사|적성검사|체크리스트|온보딩|입사안내|일정공유|프로세스|가이드/i;
function isDocFile(a: GmailAttachmentInfo): boolean {
  if (a.mimeType?.startsWith('image/')) return false;
  return /\.(pdf|hwp|hwpx|doc|docx|zip)$/i.test(a.filename || '');
}

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
                  <GmailCard key={m.id} msg={m} candidateName={submitted} />
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

// 펼침 가능한 Gmail 카드 — 클릭하면 후보자 이력서 PDF를 앱 내 iframe으로 inline 표시.
// 메모리: 새 창 안 띄움, 사용자 요청 "이력서 내용 자체가 펼쳐져서 보였으면 좋겠어. 새로운 창을 띄어주지는 말고"
function GmailCard({ msg, candidateName }: { msg: GmailMsg; candidateName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const resumePick = useMemo(
    () => pickResumeAttachment(msg.attachmentInfos || [], candidateName),
    [msg.attachmentInfos, candidateName],
  );

  // 펼침 + 첨부 있음 → base64 fetch → Blob URL 생성. 펼침 해제 또는 unmount 시 URL revoke.
  useEffect(() => {
    if (!expanded || !resumePick) return;
    if (blobUrl) return; // 이미 로드됨
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const r = await api.google.fetchAttachmentBase64(msg.id, resumePick.filename, resumePick.attachmentId);
        if (cancelled) return;
        if (!r.ok || !r.data) {
          setError(r.error || '첨부를 불러올 수 없습니다.');
          return;
        }
        // base64 → Blob 변환: 브라우저 내장 디코더에 위임 (fetch data URL).
        // atob 동기 루프는 큰 PDF에서 메인 스레드를 막아 UI freeze 유발 → fetch는 비동기 + 내부적으로 worker pool 사용.
        const mimeType = r.data.mimeType || 'application/pdf';
        const res = await fetch(`data:${mimeType};base64,${r.data.base64}`);
        if (cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        if (!cancelled) setBlobUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, resumePick, msg.id, blobUrl]);

  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`;
  const isPdf = resumePick?.mimeType === 'application/pdf' || /\.pdf$/i.test(resumePick?.filename || '');

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-2.5 hover:bg-rose-50/70 transition rounded-lg"
      >
        <div className="text-[10px] text-slate-500 mb-0.5 truncate">
          {new Date(msg.date).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {msg.from}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-bold text-slate-900 truncate flex-1">{msg.subject}</span>
          {resumePick && (
            <span className="chip bg-rose-100 text-rose-700 text-[10px] font-bold whitespace-nowrap">📄 이력서</span>
          )}
          <span className="text-[10px] text-slate-500 whitespace-nowrap">{expanded ? '▲ 접기' : '▼ 펼치기'}</span>
        </div>
        <div className="text-[11px] text-slate-700 line-clamp-2 mt-0.5">{msg.snippet}</div>
      </button>

      {expanded && (
        <div className="border-t border-rose-200 p-2.5 space-y-2">
          {!resumePick ? (
            <div className="text-[11px] text-slate-700 py-2">
              이력서로 추정되는 첨부가 없습니다.{' '}
              <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-bold hover:underline">
                Gmail에서 열기 ↗
              </a>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[11px] text-slate-700">
                <span className="font-bold text-slate-900 truncate flex-1" title={resumePick.filename}>
                  📎 {resumePick.filename}
                </span>
                <span className="text-slate-500">{Math.round((resumePick.size || 0) / 1024)} KB</span>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void (async () => {
                      const r = await api.google.openAttachment(msg.id, resumePick.filename, resumePick.attachmentId);
                      if (!r.ok) alert(`OS 뷰어 열기 실패: ${r.error || '알 수 없는 오류'}`);
                    })();
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                  title="OS 기본 PDF 뷰어로 열기 (별도 창)"
                >
                  ↗ OS 뷰어
                </button>
              </div>
              {loading && <div className="text-[11px] text-slate-500 py-4 text-center">불러오는 중...</div>}
              {error && <div className="text-[11px] text-rose-700 py-2">{error}</div>}
              {blobUrl && isPdf && (
                <iframe
                  src={blobUrl}
                  title={resumePick.filename}
                  className="w-full h-[600px] rounded border border-slate-300 bg-white"
                />
              )}
              {blobUrl && !isPdf && (
                <div className="text-[11px] text-slate-700 py-2">
                  PDF가 아닌 첨부({resumePick.mimeType || '알 수 없음'})는 앱 내 인라인 표시 불가 — 위 ↗ OS 뷰어 버튼을 사용하세요.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

