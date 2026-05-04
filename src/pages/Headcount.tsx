import { useMemo, useState } from 'react';
import { useLiveData, liveByKind } from '../store/liveData';

type SiteTone = 'purple' | 'green' | 'amber' | 'gray';

interface SiteStyle {
  rowBg: string;
  rowHover: string;
  bonbuChip: string;
  leftBar: string;
  label: string;
}

const SITE_STYLE: Record<SiteTone, SiteStyle> = {
  purple: {
    rowBg: 'bg-purple-50/60',
    rowHover: 'hover:bg-purple-100/70',
    bonbuChip: 'bg-purple-100 text-purple-800 border-purple-200',
    leftBar: 'before:bg-purple-500',
    label: '퍼플',
  },
  green: {
    rowBg: 'bg-emerald-50/60',
    rowHover: 'hover:bg-emerald-100/70',
    bonbuChip: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    leftBar: 'before:bg-emerald-500',
    label: '그린',
  },
  amber: {
    rowBg: 'bg-amber-50/60',
    rowHover: 'hover:bg-amber-100/70',
    bonbuChip: 'bg-amber-100 text-amber-900 border-amber-300',
    leftBar: 'before:bg-amber-600',
    label: '3공장',
  },
  gray: {
    rowBg: 'bg-white',
    rowHover: 'hover:bg-slate-50',
    bonbuChip: 'bg-slate-100 text-slate-700 border-slate-200',
    leftBar: 'before:bg-slate-300',
    label: '기타',
  },
};

function classifySite(bonbu: string): SiteTone {
  if (!bonbu) return 'gray';
  if (bonbu.includes('퍼플')) return 'purple';
  if (bonbu.includes('그린')) return 'green';
  if (bonbu.includes('3공장') || bonbu.includes('방교') || bonbu.includes('제3') || bonbu.includes('3 공장')) {
    return 'amber';
  }
  return 'gray';
}

export function Headcount() {
  const live = useLiveData();
  const [bonbuFilter, setBonbuFilter] = useState<string>('전체');
  const [shortOnly, setShortOnly] = useState(false);
  const [query, setQuery] = useState('');

  const allRows = useMemo(() => {
    if (!live.hasLive) return [];
    const raw = liveByKind('office_headcount').filter((r) => !isAggregateRow(r) && hasAnyValue(r));
    let lastBonbu = '';
    const filled = raw.map((r) => {
      const b = (r['본부'] || '').trim();
      if (b) lastBonbu = b;
      return { ...r, 본부: lastBonbu };
    });
    // 정렬: 퍼플 → 그린 → 3공장(방교) → 그 외
    const buckets: Record<SiteTone, Record<string, string>[]> = {
      purple: [],
      green: [],
      amber: [],
      gray: [],
    };
    for (const row of filled) {
      buckets[classifySite(row['본부'] || '')].push(row);
    }
    return [...buckets.purple, ...buckets.green, ...buckets.amber, ...buckets.gray];
  }, [live]);

  const columns = useMemo(() => {
    if (allRows.length === 0) return [];
    return Object.keys(allRows[0]).filter((k) => !/^col\d+$/.test(k) && k.trim() !== '');
  }, [allRows]);

  const bonbuList = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach((r) => {
      const b = (r['본부'] || '').trim();
      if (b) set.add(b);
    });
    return Array.from(set);
  }, [allRows]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => {
      if (bonbuFilter !== '전체' && (r['본부'] || '').trim() !== bonbuFilter) return false;
      if (shortOnly) {
        const need = parseFloat(r['미충원'] || '0');
        if (!need || need <= 0) return false;
      }
      if (q) {
        const hay = Object.values(r).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, bonbuFilter, shortOnly, query]);

  // 사이트별 카운트
  const siteCounts = useMemo(() => {
    const c: Record<SiteTone, number> = { purple: 0, green: 0, amber: 0, gray: 0 };
    allRows.forEach((r) => c[classifySite(r['본부'] || '')]++);
    return c;
  }, [allRows]);

  // 미충원 합계
  const totalShort = useMemo(() => {
    return rows.reduce((sum, r) => {
      const n = parseFloat(r['미충원'] || '0');
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
  }, [rows]);

  if (!live.hasLive) {
    return (
      <div className="card p-8 text-sm text-slate-700 text-center">
        ⚠ 라이브 시트 연결이 필요합니다. ⚙️ 설정 / 연동에서 ★전사인원현황 탭을 매핑하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 사이트 요약 카드 */}
      <div className="grid grid-cols-4 gap-2">
        <SiteSummaryCard tone="purple" count={siteCounts.purple} />
        <SiteSummaryCard tone="green" count={siteCounts.green} />
        <SiteSummaryCard tone="amber" count={siteCounts.amber} />
        <SiteSummaryCard tone="gray" count={siteCounts.gray} customLabel="기타" />
      </div>

      {/* 필터 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-700 font-bold mr-1">본부:</span>
          <Pill active={bonbuFilter === '전체'} onClick={() => setBonbuFilter('전체')}>
            전체 ({allRows.length})
          </Pill>
          {bonbuList.map((b) => {
            const t = classifySite(b);
            return (
              <Pill
                key={b}
                active={bonbuFilter === b}
                onClick={() => setBonbuFilter(b)}
                tone={t}
              >
                {b}
              </Pill>
            );
          })}
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <Pill active={shortOnly} onClick={() => setShortOnly((v) => !v)} tone="red">
            미충원만
          </Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="팀/직무 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none w-44 text-slate-800"
          />
          <span className="text-xs text-slate-700 font-semibold">
            {rows.length}건{totalShort > 0 && <span className="text-red-600 ml-1.5">· 미충원 {totalShort}</span>}
          </span>
        </div>
      </div>

      {/* 표 */}
      <div className="card p-1.5">
        <div className="overflow-auto rounded-md border border-slate-200 max-h-[calc(100vh-180px)]">
          <table className="w-full text-[11px] border-collapse table-fixed">
            <colgroup>
              {columns.map((h) => (
                <col key={h} style={{ width: colWidth(h) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100">
                {columns.map((h) => {
                  const isNeed = h.includes('미충원');
                  const isRate = isRateCol(h);
                  return (
                    <th
                      key={h}
                      className={`px-1.5 py-1.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap border-b-2 border-slate-300 ${
                        isNeed
                          ? 'text-red-700 bg-red-50'
                          : isRate
                          ? 'text-indigo-700 bg-indigo-50'
                          : 'text-slate-700'
                      } ${alignClass(h)}`}
                    >
                      {h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const tone = classifySite(row['본부'] || '');
                const style = SITE_STYLE[tone];
                return (
                  <tr
                    key={i}
                    className={`${style.rowBg} ${style.rowHover} border-b border-slate-100 transition-colors h-[28px]`}
                  >
                    {columns.map((h, ci) => {
                      const v = row[h] ?? '';
                      const isNumeric = v !== '' && /^-?\d+(\.\d+)?$/.test(v);
                      const isNeed = h.includes('미충원');
                      const isRate = isRateCol(h);
                      const isShort = isNeed && isNumeric && parseFloat(v) > 0;
                      const isBonbu = h === '본부' || h === '사업장';
                      const isFirstCol = ci === 0;

                      let display: string = v || '-';
                      let rateTone = '';
                      if (isRate && isNumeric) {
                        const n = parseFloat(v);
                        const pct = Math.abs(n) <= 1 ? n * 100 : n;
                        display = `${Math.round(pct)}%`;
                        rateTone =
                          pct >= 100
                            ? 'text-emerald-700 bg-emerald-50'
                            : pct >= 90
                            ? 'text-cyan-700 bg-cyan-50'
                            : pct >= 70
                            ? 'text-amber-700 bg-amber-50'
                            : 'text-red-700 bg-red-50';
                      }

                      let cellCls = `px-1.5 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${alignClass(h)}`;
                      if (isFirstCol) {
                        cellCls += ` border-l-[3px] ${style.leftBar.replace('before:', 'border-')}`.replace('border-bg-', 'border-l-');
                      }
                      if (isNumeric) cellCls += ' font-mono tabular-nums';
                      if (isShort) {
                        cellCls += ' text-red-700 font-extrabold bg-red-100';
                      } else if (isNeed && isNumeric) {
                        cellCls += ' text-slate-400';
                      } else if (rateTone) {
                        cellCls += ` ${rateTone} font-bold`;
                      } else if (isBonbu) {
                        cellCls += ` font-semibold`;
                      } else {
                        cellCls += ' text-slate-800';
                      }

                      // 본부 셀 — 칩 표시
                      if (isBonbu && !isRate) {
                        return (
                          <td key={h} className={`px-1.5 py-0.5 ${alignClass(h)}`} title={display}>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${style.bonbuChip} max-w-full truncate`}
                            >
                              {display}
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td key={h} className={cellCls} title={display}>
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function colWidth(header: string): string {
  if (header === '본부' || header === '사업장') return '88px';
  if (header === '팀' || header === '팀명') return '108px';
  if (isRateCol(header)) return '46px';
  if (header === '미충원' || header === '결원') return '52px';
  if (
    header === '정원' ||
    header === '현원' ||
    header === '입사예정' ||
    header === '면접' ||
    header === '퇴사예정' ||
    header === '구분' ||
    header === '직급' ||
    header === '신규' ||
    header === '계'
  ) {
    return '50px';
  }
  if (header.includes('비고') || header === '메모' || header === '상세' || header === '특이사항') {
    return '160px';
  }
  // 기본: 짧게
  return '60px';
}

function isRateCol(h: string): boolean {
  return h.includes('충원율') || h.includes('비율') || h === '율' || h.endsWith('%');
}

function alignClass(header: string): string {
  if (
    header === '본부' ||
    header === '사업장' ||
    header === '팀' ||
    header === '팀명' ||
    header.includes('비고') ||
    header === '메모' ||
    header === '상세' ||
    header === '특이사항' ||
    header === '직급'
  ) {
    return 'text-left';
  }
  return 'text-center';
}

const AGGREGATE_KEYS = ['합계', '소계', '총계', '전체', 'total', 'sum', '계'];
function isAggregateRow(row: Record<string, string>): boolean {
  const v = Object.values(row).map((x) => (x || '').toLowerCase());
  return v.some((cell) => AGGREGATE_KEYS.some((k) => cell === k.toLowerCase()));
}

function hasAnyValue(row: Record<string, string>): boolean {
  return Object.values(row).some((v) => (v || '').trim() !== '');
}

function SiteSummaryCard({
  tone,
  count,
  customLabel,
}: {
  tone: SiteTone;
  count: number;
  customLabel?: string;
}) {
  const s = SITE_STYLE[tone];
  const numColor = {
    purple: 'text-purple-700',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    gray: 'text-slate-700',
  }[tone];
  return (
    <div className={`card p-2.5 relative overflow-hidden ${s.rowBg}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.leftBar.replace('before:', '')}`} />
      <div className="flex items-baseline justify-between ml-1.5">
        <span className={`text-[10px] uppercase tracking-[0.2em] font-bold ${numColor}`}>
          {customLabel || s.label}
        </span>
        <div className="flex items-baseline gap-0.5">
          <span className={`text-2xl font-black tabular-nums ${numColor}`}>{count}</span>
          <span className="text-[10px] text-slate-500">팀</span>
        </div>
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: 'red' | SiteTone;
  children: React.ReactNode;
}) {
  let activeBg = 'bg-indigo-600 text-white border-indigo-600';
  let idle = 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300';

  if (tone === 'red') {
    activeBg = 'bg-red-600 text-white border-red-600';
  } else if (tone === 'purple') {
    activeBg = 'bg-purple-600 text-white border-purple-600';
    idle = 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100';
  } else if (tone === 'green') {
    activeBg = 'bg-emerald-600 text-white border-emerald-600';
    idle = 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
  } else if (tone === 'amber') {
    activeBg = 'bg-amber-600 text-white border-amber-600';
    idle = 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100';
  }

  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
        active ? activeBg + ' shadow-sm' : idle
      }`}
    >
      {children}
    </button>
  );
}
