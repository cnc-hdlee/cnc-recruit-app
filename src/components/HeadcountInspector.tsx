import { useState } from 'react';
import { liveByKindWithSource } from '../store/liveData';
import { pickField } from '../lib/sheetMapping';
import {
  useHeadcountOverrides,
  setHeadcountOverride,
  resetHeadcountOverrides,
  getFieldValue,
  findMatchedHeader,
  type HeadcountOverrides,
} from '../store/columnOverrides';

const FIELD_DEFS = {
  to: ['정원(TO)', 'TO', '정원', '편성', '예정인원'],
  cur: ['현원합계', '현원', 'PO', '재직', '재직자', '재직인원', '현인원', '근무', '인원수', '충원수'],
  need: ['미충원', '충원필요', '필요충원', '결원', '부족', '공석', '필요인원'],
  req: ['채용요청', '요청'],
  inc: ['입사예정', '채용예정', '입사예정인원'],
} as const;

const FIELD_LABELS: Record<keyof typeof FIELD_DEFS, string> = {
  to: 'TO',
  cur: '현원',
  need: '미충원',
  req: '요청',
  inc: '입사예정',
};

const AGGREGATE_KEYS = ['합계', '소계', '총계', '전체', 'total', 'sum', '계'];
function isAggregateRow(row: Record<string, string>): boolean {
  const v = Object.values(row).map((x) => (x || '').toLowerCase());
  return v.some((cell) => AGGREGATE_KEYS.some((k) => cell === k.toLowerCase()));
}

function numOf(v: string): number {
  if (!v) return 0;
  const n = parseInt(v.replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

interface ExtractedRow {
  team: string;
  site: string;
  type: string;
  toRaw: string;
  curRaw: string;
  needRaw: string;
  reqRaw: string;
  incRaw: string;
  toN: number;
  curN: number;
  needN: number;
  reqN: number;
  incN: number;
}

export function HeadcountInspector() {
  const [open, setOpen] = useState(true); // default open while debugging
  const overrides = useHeadcountOverrides();
  const sources = liveByKindWithSource('office_headcount');

  if (sources.length === 0) {
    return (
      <div className="card border-accent-yellow/30 bg-accent-yellow/5 p-3 text-xs text-accent-yellow">
        ⚠ <code>인원현황</code> 카테고리에 매핑된 시트 탭이 없습니다. ⚙️ 설정에서 시트의 인원현황 탭을 매핑하세요.
      </div>
    );
  }

  let totalRows = 0;
  let totalTO = 0, totalCur = 0, totalNeed = 0, totalReq = 0, totalInc = 0;
  const byTab: {
    tabKey: string;
    sheetTitle: string;
    tabName: string;
    allHeaders: string[];
    rows: ExtractedRow[];
    aggregateSkipped: number;
    columnsUsed: Record<keyof HeadcountOverrides, string | undefined>;
    sums: { to: number; cur: number; need: number; req: number; inc: number };
  }[] = [];

  for (const src of sources) {
    if (src.rows.length === 0) continue;
    const sample = src.rows[0];
    const allHeaders = Object.keys(sample);

    const colTo = findMatchedHeader(allHeaders, overrides.to, [...FIELD_DEFS.to]);
    const colCur = findMatchedHeader(allHeaders, overrides.cur, [...FIELD_DEFS.cur]);
    const colNeed = findMatchedHeader(allHeaders, overrides.need, [...FIELD_DEFS.need]);
    const colReq = findMatchedHeader(allHeaders, overrides.req, [...FIELD_DEFS.req]);
    const colInc = findMatchedHeader(allHeaders, overrides.inc, [...FIELD_DEFS.inc]);

    let tTO = 0, tCur = 0, tNeed = 0, tReq = 0, tInc = 0;
    let aggregateSkipped = 0;
    const extracted: ExtractedRow[] = [];
    for (const row of src.rows) {
      if (isAggregateRow(row)) {
        aggregateSkipped++;
        continue;
      }
      const toRaw = getFieldValue(row, overrides.to, [...FIELD_DEFS.to]);
      const curRaw = getFieldValue(row, overrides.cur, [...FIELD_DEFS.cur]);
      const needRaw = getFieldValue(row, overrides.need, [...FIELD_DEFS.need]);
      const reqRaw = getFieldValue(row, overrides.req, [...FIELD_DEFS.req]);
      const incRaw = getFieldValue(row, overrides.inc, [...FIELD_DEFS.inc]);
      const toN = numOf(toRaw);
      const curN = numOf(curRaw);
      const needN = needRaw ? numOf(needRaw) : Math.max(0, toN - curN);
      const reqN = numOf(reqRaw);
      const incN = numOf(incRaw);
      tTO += toN;
      tCur += curN;
      tNeed += Math.max(0, needN);
      tReq += reqN;
      tInc += incN;
      extracted.push({
        team: pickField(row, ['팀', '부서']),
        site: pickField(row, ['사업장', '사이트']),
        type: pickField(row, ['구분', '직접/간접']),
        toRaw,
        curRaw,
        needRaw,
        reqRaw,
        incRaw,
        toN,
        curN,
        needN,
        reqN,
        incN,
      });
    }
    totalRows += extracted.length;
    totalTO += tTO;
    totalCur += tCur;
    totalNeed += tNeed;
    totalReq += tReq;
    totalInc += tInc;
    byTab.push({
      tabKey: `${src.entry.spreadsheetId}-${src.entry.tabName}`,
      sheetTitle: src.sheetTitle,
      tabName: src.entry.tabName,
      allHeaders,
      aggregateSkipped,
      rows: extracted,
      columnsUsed: { to: colTo, cur: colCur, need: colNeed, req: colReq, inc: colInc },
      sums: { to: tTO, cur: tCur, need: tNeed, req: tReq, inc: tInc },
    });
  }

  const allHeadersAcrossTabs = Array.from(new Set(byTab.flatMap((t) => t.allHeaders))).filter(Boolean);

  return (
    <div className="card p-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-sm hover:text-white">
        <span>{open ? '▼' : '▶'}</span>
        <span className="font-semibold">🔍 미충원 숫자 진단 + 컬럼 매핑</span>
        <span className="text-xs text-slate-400 ml-2">
          {byTab.length}개 탭 · {totalRows}행 · TO {totalTO} · 현원 {totalCur} · 미충원 {totalNeed}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Manual override panel */}
          <div className="rounded-lg border border-accent-purple/40 bg-accent-purple/5 p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="text-sm font-semibold text-accent-purple">⚙️ 컬럼 직접 지정 (즉시 적용)</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  자동 매칭이 틀렸으면 아래 드롭다운에서 시트의 정확한 컬럼명을 골라주세요. 선택 즉시 모든 페이지 숫자가 갱신됩니다.
                </p>
              </div>
              {Object.keys(overrides).length > 0 && (
                <button
                  className="text-xs text-slate-400 hover:text-accent-red"
                  onClick={() => resetHeadcountOverrides()}
                >
                  모두 초기화
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              {(['to', 'cur', 'need', 'req', 'inc'] as const).map((f) => {
                const matched = byTab[0]?.columnsUsed[f];
                const isOverride = !!overrides[f];
                return (
                  <div key={f}>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      {FIELD_LABELS[f]} {isOverride && <span className="text-accent-purple">●</span>}
                    </label>
                    <select
                      value={overrides[f] || ''}
                      onChange={(e) => setHeadcountOverride(f, e.target.value || undefined)}
                      className={`w-full bg-bg-deep border rounded px-2 py-1 text-xs ${
                        matched ? 'border-bg-line' : 'border-accent-red/50'
                      }`}
                    >
                      <option value="">자동 매칭{matched ? ` (→ "${matched}")` : ' — 못 찾음'}</option>
                      {allHeadersAcrossTabs.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-tab breakdown */}
          {byTab.map((t) => (
            <div key={t.tabKey} className="rounded-lg border border-bg-line bg-bg-deep/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-medium">
                    📊 {t.sheetTitle} <span className="text-slate-500">·</span> 탭 "{t.tabName}"
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {t.rows.length}행 · 합계 TO={t.sums.to}, 현원={t.sums.cur}, 미충원={t.sums.need}, 요청={t.sums.req}, 입사예정={t.sums.inc}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2 text-[11px] mb-2">
                <ColCheck label="TO" value={t.columnsUsed.to} />
                <ColCheck label="현원" value={t.columnsUsed.cur} />
                <ColCheck label="미충원" value={t.columnsUsed.need} />
                <ColCheck label="요청" value={t.columnsUsed.req} />
                <ColCheck label="입사예정" value={t.columnsUsed.inc} />
              </div>

              {t.aggregateSkipped > 0 && (
                <div className="text-[11px] text-accent-yellow mb-2">
                  ⚠ "합계/소계/전체" 행 {t.aggregateSkipped}개 자동 제외 (이중 합산 방지)
                </div>
              )}

              <details className="mb-2">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-white flex items-center gap-2">
                  <span>📋 시트의 전체 컬럼 헤더 보기 ({t.allHeaders.length}개)</span>
                  <CopyHeadersButton headers={t.allHeaders} sample={t.rows[0]} sheetTitle={t.sheetTitle} tabName={t.tabName} />
                </summary>
                <div className="mt-2 p-2 rounded bg-bg-deep/60 text-[11px] font-mono text-slate-300 leading-relaxed">
                  {t.allHeaders.map((h, i) => {
                    const matched =
                      h === t.columnsUsed.to ? '→ TO'
                      : h === t.columnsUsed.cur ? '→ 현원'
                      : h === t.columnsUsed.need ? '→ 미충원'
                      : h === t.columnsUsed.req ? '→ 요청'
                      : h === t.columnsUsed.inc ? '→ 입사예정'
                      : '';
                    return (
                      <div key={i} className={matched ? 'text-accent-green' : ''}>
                        [{i}] "{h || '(빈 헤더)'}" {matched}
                      </div>
                    );
                  })}
                </div>
              </details>

              <details>
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-white">행 단위 데이터 ({t.rows.length}행)</summary>
                <div className="overflow-auto max-h-72 mt-2 rounded border border-bg-line">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-bg-deep">
                      <tr>
                        {['사업장', '팀', '구분', 'TO', '현원', '미충원', '요청', '입사예정'].map((h) => (
                          <th key={h} className="px-2 py-1 text-left text-slate-400 border-b border-bg-line">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((r, i) => (
                        <tr key={i} className="hover:bg-bg-hover/30">
                          <td className="px-2 py-1 border-b border-bg-line/40">{r.site || '-'}</td>
                          <td className="px-2 py-1 border-b border-bg-line/40">{r.team || '-'}</td>
                          <td className="px-2 py-1 border-b border-bg-line/40">{r.type || '-'}</td>
                          <td className="px-2 py-1 font-mono text-right border-b border-bg-line/40" title={r.toRaw}>{r.toN}</td>
                          <td className="px-2 py-1 font-mono text-right border-b border-bg-line/40" title={r.curRaw}>{r.curN}</td>
                          <td className={`px-2 py-1 font-mono text-right border-b border-bg-line/40 ${r.needN > 0 ? 'text-accent-red' : ''}`} title={r.needRaw}>{r.needN}</td>
                          <td className="px-2 py-1 font-mono text-right border-b border-bg-line/40" title={r.reqRaw}>{r.reqN}</td>
                          <td className="px-2 py-1 font-mono text-right border-b border-bg-line/40" title={r.incRaw}>{r.incN}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyHeadersButton({
  headers,
  sample,
  sheetTitle,
  tabName,
}: {
  headers: string[];
  sample?: ExtractedRow;
  sheetTitle: string;
  tabName: string;
}) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const lines = [
      `시트: ${sheetTitle}`,
      `탭: ${tabName}`,
      `헤더 (${headers.length}개):`,
      headers.map((h, i) => `  [${i}] ${h || '(empty)'}`).join('\n'),
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select+copy via textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button
      onClick={onClick}
      className={`ml-auto chip ${copied ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30'}`}
    >
      {copied ? '✓ 복사됨' : '📋 클립보드에 복사'}
    </button>
  );
}

function ColCheck({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className={`p-1.5 rounded border ${value ? 'border-accent-green/40 bg-accent-green/5' : 'border-accent-red/40 bg-accent-red/5'}`}>
      <div className="text-slate-500">{label}</div>
      <div className={`font-mono truncate ${value ? 'text-accent-green' : 'text-accent-red'}`} title={value || '— 못 찾음'}>
        {value ? `→ "${value}"` : '— 못 찾음'}
      </div>
    </div>
  );
}
