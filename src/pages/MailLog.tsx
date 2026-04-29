import { useMemo, useState } from 'react';
import { useData } from '../store';
import { gmailSearchUrl } from '../lib/gmail';

export function MailLog() {
  const D = useData();
  const [typeFilter, setTypeFilter] = useState<string>('전체');
  const [search, setSearch] = useState('');

  const types = useMemo(() => Array.from(new Set(D.teamMail.map((m) => m.type))), [D.teamMail]);

  const filtered = useMemo(() => {
    return D.teamMail.filter((m) => {
      if (typeFilter !== '전체' && m.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          m.subj.toLowerCase().includes(q) ||
          m.from.toLowerCase().includes(q) ||
          m.to.toLowerCase().includes(q) ||
          m.sum.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [D.teamMail, typeFilter, search]);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    D.teamMail.forEach((m) => {
      map[m.type] = (map[m.type] || 0) + 1;
    });
    return map;
  }, [D.teamMail]);

  const byFrom = useMemo(() => {
    const map: Record<string, number> = {};
    D.teamMail.forEach((m) => {
      map[m.from] = (map[m.from] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [D.teamMail]);

  const sentDept = D.deptNotify.filter((d) => d.st === '발송완료').length;
  const pendingDept = D.deptNotify.filter((d) => d.st !== '발송완료').length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="전체 메일" value={D.teamMail.length} color="text-accent-purple" />
        <Stat label="유형 수" value={types.length} color="text-accent-blue" />
        <Stat label="부서안내 발송완료" value={sentDept} color="text-accent-green" />
        <Stat label="부서안내 대기" value={pendingDept} color="text-accent-yellow" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="card p-4">
          <h3 className="font-semibold mb-3">📊 발신자 TOP</h3>
          <div className="space-y-1.5">
            {byFrom.slice(0, 8).map(([from, count]) => (
              <div key={from} className="flex items-center gap-2">
                <div className="w-20 text-xs text-slate-400 truncate">{from}</div>
                <div className="flex-1 h-2 bg-bg-deep rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-purple to-accent-blue"
                    style={{ width: `${(count / byFrom[0][1]) * 100}%` }}
                  />
                </div>
                <div className="w-8 text-right text-xs font-mono text-slate-300">{count}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4 lg:col-span-2">
          <h3 className="font-semibold mb-3">📋 부서안내 발송 현황</h3>
          <div className="overflow-auto rounded-lg border border-bg-line max-h-[260px]">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['이름', '입사일', '팀', '준비물', '상태', '비고'].map((h) => (
                    <th key={h} className="table-head text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {D.deptNotify.map((d, i) => (
                  <tr key={i} className="hover:bg-bg-hover/30">
                    <td className="table-cell font-medium">{d.nm}</td>
                    <td className="table-cell font-mono text-xs">{d.dt}</td>
                    <td className="table-cell text-xs">{d.team}</td>
                    <td className="table-cell text-xs text-slate-400">{d.items}</td>
                    <td className="table-cell">
                      <span
                        className={`chip ${
                          d.st === '발송완료'
                            ? 'bg-accent-green/15 text-accent-green'
                            : d.st === '발송예정'
                            ? 'bg-accent-blue/15 text-accent-blue'
                            : d.st === '발송필요'
                            ? 'bg-accent-yellow/15 text-accent-yellow'
                            : 'bg-accent-red/15 text-accent-red'
                        }`}
                      >
                        {d.st}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-slate-400 max-w-[260px] truncate">{d.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={() => setTypeFilter('전체')}
            className={`px-3 py-1 rounded-full text-xs border ${
              typeFilter === '전체' ? 'bg-accent-purple text-white border-accent-purple' : 'border-bg-line hover:bg-bg-hover'
            }`}
          >
            전체 ({D.teamMail.length})
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-full text-xs border ${
                typeFilter === t ? 'bg-accent-purple text-white border-accent-purple' : 'border-bg-line hover:bg-bg-hover'
              }`}
            >
              {t} ({byType[t]})
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 제목·발신자·요약 검색"
            className="ml-auto px-3 py-1.5 bg-bg-deep/60 border border-bg-line rounded-lg text-sm w-72 outline-none focus:border-accent-purple"
          />
        </div>

        <div className="overflow-auto rounded-lg border border-bg-line max-h-[60vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr>
                {['일자', '발신', '유형', '제목', '수신', '요약'].map((h) => (
                  <th key={h} className="table-head text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr
                  key={i}
                  className="hover:bg-bg-hover/30 cursor-pointer group"
                  onClick={() => window.open(gmailSearchUrl({ subject: m.subj }), '_blank')}
                  title="클릭: Gmail에서 이 메일 검색해 열기"
                >
                  <td className="table-cell font-mono text-xs whitespace-nowrap">{m.dt}</td>
                  <td className="table-cell whitespace-nowrap">{m.from}</td>
                  <td className="table-cell">
                    <span className="chip bg-accent-purple/15 text-accent-purple">{m.type}</span>
                  </td>
                  <td className="table-cell font-medium max-w-[320px] truncate group-hover:text-accent-purple">
                    {m.subj}
                    <span className="ml-1 text-[10px] text-slate-500 opacity-0 group-hover:opacity-100">↗ Gmail</span>
                  </td>
                  <td className="table-cell text-xs text-slate-400 whitespace-nowrap">{m.to}</td>
                  <td className="table-cell text-xs text-slate-400 max-w-[400px] truncate">{m.sum}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-500 text-sm">
                    검색 결과 없음
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

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card p-4">
      <div className="stat-lbl">{label}</div>
      <div className={`stat-num mt-1 ${color}`}>{value}</div>
    </div>
  );
}
