import { useMemo, useState } from 'react';
import { useLiveData, liveByKind } from '../store/liveData';

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
    const purple: Record<string, string>[] = [];
    const green: Record<string, string>[] = [];
    const rest: Record<string, string>[] = [];
    for (const row of filled) {
      const b = row['본부'] || '';
      if (b.includes('퍼플')) purple.push(row);
      else if (b.includes('그린')) green.push(row);
      else rest.push(row);
    }
    return [...purple, ...green, ...rest];
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

  if (!live.hasLive) {
    return (
      <div className="card p-8 text-sm text-slate-400 text-center">
        ⚠ 라이브 시트 연결이 필요합니다. ⚙️ 설정 / 연동에서 ★전사인원현황 탭을 매핑하세요.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 mr-1">본부:</span>
          <Pill active={bonbuFilter === '전체'} onClick={() => setBonbuFilter('전체')}>전체</Pill>
          {bonbuList.map((b) => (
            <Pill key={b} active={bonbuFilter === b} onClick={() => setBonbuFilter(b)} highlight={b.includes('퍼플') || b.includes('그린')}>
              {b}
            </Pill>
          ))}
          <span className="mx-1 h-4 w-px bg-bg-line" />
          <Pill active={shortOnly} onClick={() => setShortOnly((v) => !v)} tone="red">
            미충원만
          </Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="팀/직무 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-bg-deep/60 border border-bg-line focus:border-accent-purple focus:outline-none w-48"
          />
          <span className="text-xs text-slate-500">{rows.length}건</span>
        </div>
      </div>

      <div className="card p-3">
        <div className="overflow-auto rounded-lg border border-bg-line max-h-[calc(100vh-220px)]">
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 bg-bg-card/95 backdrop-blur z-10">
              <tr>
                {columns.map((h) => {
                  const isRate = h.includes('충원율') || h.includes('비율') || h === '율';
                  const isNeed = h.includes('미충원');
                  return (
                    <th
                      key={h}
                      className={`px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide whitespace-nowrap border-b border-bg-line ${
                        isNeed ? 'text-accent-red' : 'text-slate-400'
                      } ${isRate ? 'w-[64px]' : ''}`}
                    >
                      {h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-bg-hover/30 border-b border-bg-line/40">
                  {columns.map((h) => {
                    const v = row[h] ?? '';
                    const isNumeric = v !== '' && /^-?\d+(\.\d+)?$/.test(v);
                    const isNeed = h.includes('미충원');
                    const isRate = h.includes('충원율') || h.includes('비율') || h === '율';
                    const isShort = isNeed && isNumeric && parseFloat(v) > 0;
                    let display: string = v || '-';
                    let rateTone = '';
                    if (isRate && isNumeric) {
                      const n = parseFloat(v);
                      const pct = Math.abs(n) <= 1 ? n * 100 : n;
                      display = `${Math.round(pct)}%`;
                      rateTone =
                        pct >= 100 ? 'text-accent-green' :
                        pct >= 90 ? 'text-accent-cyan' :
                        pct >= 70 ? 'text-accent-yellow' :
                        'text-accent-red';
                    }
                    const padding = isRate ? 'px-1.5 py-1.5' : 'px-2 py-1.5';
                    return (
                      <td
                        key={h}
                        className={`${padding} whitespace-nowrap ${
                          isNumeric ? 'font-mono tabular-nums text-right' : ''
                        } ${isShort ? 'text-accent-red font-semibold' : ''} ${
                          isNeed && !isShort && isNumeric ? 'text-slate-400' : ''
                        } ${rateTone} ${isRate ? 'text-[12px]' : ''}`}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const AGGREGATE_KEYS = ['합계', '소계', '총계', '전체', 'total', 'sum', '계'];
function isAggregateRow(row: Record<string, string>): boolean {
  const v = Object.values(row).map((x) => (x || '').toLowerCase());
  return v.some((cell) => AGGREGATE_KEYS.some((k) => cell === k.toLowerCase()));
}

function hasAnyValue(row: Record<string, string>): boolean {
  return Object.values(row).some((v) => (v || '').trim() !== '');
}

function Pill({
  active,
  onClick,
  tone,
  highlight,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: 'red';
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const activeBg =
    tone === 'red'
      ? 'bg-accent-red text-white border-accent-red'
      : 'bg-accent-purple text-white border-accent-purple';
  const idle = highlight
    ? 'bg-accent-purple/10 text-slate-200 border-accent-purple/30 hover:bg-bg-hover'
    : 'bg-bg-card/40 text-slate-300 border-bg-line hover:bg-bg-hover';
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border transition-colors ${active ? activeBg : idle}`}
    >
      {children}
    </button>
  );
}
