// 부서별 업무 편제표.
//
// 원본(PPT·PDF)은 부서마다 형식이 제각각이지만, 앱 안에서는 전부 같은 화면으로 보인다.
// 파트 → 업무 → 담당자 순서로 읽히고, 공석은 어디서나 같은 방식으로 눈에 띈다.

import { useMemo, useState } from 'react';
import { ORG_CHARTS, countChart, getOrgChart, type ChartGroup, type DeptChart } from '../data/orgCharts';

export function OrgChartPage({ deptId }: { deptId: string }) {
  const chart = getOrgChart(deptId);
  if (!chart) return <div className="card p-6 text-slate-900">편제표를 찾을 수 없습니다.</div>;
  return <ChartView chart={chart} />;
}

function ChartView({ chart }: { chart: DeptChart }) {
  const [query, setQuery] = useState('');
  const counts = useMemo(() => countChart(chart), [chart]);
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!q) return chart.groups;
    return chart.groups
      .map((g) => ({
        ...g,
        members: g.members.filter(
          (m) =>
            m.person.toLowerCase().includes(q) ||
            m.role.toLowerCase().includes(q) ||
            (m.grade || '').toLowerCase().includes(q)
        ),
      }))
      .filter(
        (g) =>
          g.members.length > 0 ||
          g.name.toLowerCase().includes(q) ||
          (g.duties || []).some((d) => d.toLowerCase().includes(q))
      );
  }, [chart, q]);

  return (
    <div className="space-y-3 text-slate-900">
      {/* 머리 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-black text-slate-900">{chart.dept}</span>
          {chart.hq && <span className="text-sm font-bold text-slate-900">{chart.hq}</span>}
          {chart.lead && (
            <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-xs font-bold">{chart.lead}</span>
          )}
          <span className="ml-auto text-sm font-bold text-slate-900">{chart.asOf} 기준</span>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="재직" value={counts.filled} />
          <Stat label="공석 · 채용예정" value={counts.vacant} tone={counts.vacant > 0 ? 'warn' : 'plain'} />
          <Stat label="편제 자리" value={counts.total} />
          <Stat label="파트" value={chart.groups.length} />
        </div>
        <div className="mt-2 text-xs text-slate-900">출처: {chart.source}</div>
      </div>

      {/* 검색 */}
      <div className="card p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 · 업무 · 파트 검색"
          className="w-full md:w-72 px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900"
        />
      </div>

      {/* 조직 트리 — 원본 조직도처럼 팀장에서 파트로 갈라져 내려간다 */}
      <div className="card p-4 overflow-x-auto">
        {groups.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-900">검색 결과가 없습니다.</div>
        ) : (
          <div className="min-w-[560px]">
            {/* 루트 */}
            <div className="flex justify-center">
              <div className="px-4 py-2 rounded-lg bg-slate-900 text-white text-center">
                <div className="text-sm font-black">{chart.dept}</div>
                {chart.lead && <div className="text-xs">{chart.lead}</div>}
              </div>
            </div>
            {/* 루트 → 가지 */}
            <div className="h-5 w-px bg-slate-400 mx-auto" />

            <div className="space-y-0">
              {groups.map((g, i) => (
                <TreeBranch key={g.name} group={g} last={i === groups.length - 1} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 외주 업체 */}
      {chart.vendors && chart.vendors.length > 0 && (
        <div className="card p-3">
          <div className="text-sm font-bold text-slate-900 mb-2">외주 전용 업체</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-bold text-slate-900 bg-slate-100 border-b border-slate-300">
                    담당 공정
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-slate-900 bg-slate-100 border-b border-slate-300">
                    업체
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-slate-900 bg-slate-100 border-b border-slate-300">
                    사이트
                  </th>
                </tr>
              </thead>
              <tbody>
                {chart.vendors.map((v) => (
                  <tr key={v.name} className="border-b border-slate-200">
                    <td className="px-3 py-2 text-slate-900">{v.category || '-'}</td>
                    <td className="px-3 py-2 font-bold text-slate-900">{v.name}</td>
                    <td className="px-3 py-2 text-slate-900">{v.site || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 특이사항 */}
      {chart.notes && chart.notes.length > 0 && (
        <div className="card p-3">
          <div className="text-sm font-bold text-slate-900 mb-1">특이사항</div>
          <ul className="space-y-0.5">
            {chart.notes.map((n) => (
              <li key={n} className="text-sm text-slate-900">
                · {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * 트리 한 가지 — 왼쪽 세로줄에서 파트 상자가 뻗어 나오고,
 * 그 아래로 담당자가 한 명씩 달린다. 원본 조직도의 읽는 순서를 그대로 따른다.
 */
function TreeBranch({ group, last }: { group: ChartGroup; last: boolean }) {
  const vacant = group.members.filter((m) => m.vacant || !m.person).length;
  return (
    <div className="relative pl-8">
      {/* 세로 줄기 — 마지막 가지는 파트 상자까지만 */}
      <div
        className={`absolute left-0 w-px bg-slate-400 ${last ? 'top-0 h-6' : 'top-0 bottom-0'}`}
        aria-hidden
      />
      {/* 줄기 → 파트 가로줄 */}
      <div className="absolute left-0 top-6 h-px w-8 bg-slate-400" aria-hidden />

      <div className="py-2">
        {/* 파트 헤더 */}
        <div className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50">
          <span className="text-sm font-black text-slate-900">{group.name}</span>
          {group.headcount != null && (
            <span className="px-1.5 py-0.5 rounded bg-white border border-indigo-200 text-[11px] font-bold text-slate-900">
              편제 {group.headcount}
            </span>
          )}
          {vacant > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 text-[11px] font-bold text-slate-900">
              공석 {vacant}
            </span>
          )}
        </div>

        {/* 업무 */}
        {group.duties && group.duties.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 ml-3">
            {group.duties.map((d) => (
              <span
                key={d}
                className="px-2 py-0.5 rounded bg-white border border-slate-300 text-[11px] font-semibold text-slate-900"
              >
                {d}
              </span>
            ))}
          </div>
        )}

        {/* 담당자 — 파트 아래로 한 단 더 들어간다 */}
        <div className="relative mt-1.5 ml-3 pl-6">
          <div className="absolute left-0 top-0 bottom-3 w-px bg-slate-300" aria-hidden />
          <div className="flex flex-wrap gap-1.5">
            {group.members.map((m, i) => {
              const isVacant = m.vacant || !m.person;
              return (
                <div
                  key={`${m.role}-${m.person}-${i}`}
                  className={`relative px-2.5 py-1 rounded-md text-sm ${
                    isVacant
                      ? 'bg-rose-50 border border-dashed border-rose-400'
                      : 'bg-white border border-slate-300'
                  }`}
                >
                  <span className="font-bold text-slate-900">
                    {isVacant ? '공석' : m.person}
                  </span>
                  {m.grade && <span className="ml-1 text-xs text-slate-900">{m.grade}</span>}
                  {m.role && m.role !== group.name && (
                    <span className="ml-1.5 text-[11px] text-slate-900 border-l border-slate-300 pl-1.5">
                      {m.role}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: number; tone?: 'plain' | 'warn' }) {
  return (
    <div className={`rounded-lg border p-2 ${tone === 'warn' ? 'border-rose-300 bg-rose-50' : 'border-slate-300 bg-white'}`}>
      <div className="text-xs font-bold text-slate-900">{label}</div>
      <div className="text-2xl font-black tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

/** 부모 탭 — 수집된 부서 목록 */
export function OrgChartsOverview({ onOpen }: { onOpen?: (id: string) => void }) {
  return (
    <div className="space-y-3 text-slate-900">
      <div className="card p-3">
        <div className="text-sm font-bold text-slate-900">부서별 업무 편제표</div>
        <div className="text-sm text-slate-900 mt-1">
          부서에서 받은 편제표·조직도를 형식에 상관없이 같은 화면으로 정리해 둡니다. 새 편제표를 주시면 계속 추가합니다.
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {ORG_CHARTS.map((c) => {
          const n = countChart(c);
          return (
            <button key={c.id} onClick={() => onOpen?.(c.id)} className="card p-4 text-left hover:border-indigo-300 transition">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-black text-slate-900">{c.dept}</span>
                <span className="text-xs font-bold text-slate-900">{c.asOf} 기준</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="재직" value={n.filled} />
                <Stat label="공석" value={n.vacant} tone={n.vacant > 0 ? 'warn' : 'plain'} />
                <Stat label="파트" value={c.groups.length} />
              </div>
              <div className="mt-2 text-xs font-bold text-indigo-700">편제표 보기 →</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
