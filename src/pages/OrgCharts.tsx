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
            <span
              className={
                'px-2 py-0.5 rounded-full text-xs font-bold ' +
                (chart.leadVacant ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white')
              }
            >
              {chart.lead}
            </span>
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

      {/* 조직 트리 — 원본 조직도와 같은 위→아래 구조 */}
      <div className="card p-5 overflow-x-auto">
        {groups.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-900">검색 결과가 없습니다.</div>
        ) : (
          <OrgTree chart={chart} groups={groups} />
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

// ─────────────────────────────────────────────────────────────
// 조직 트리 — 원본 조직도와 같은 위→아래 구조
//
//                    [ 부서 · 팀장 ]
//              ┌───────────┴───────────┐
//           [퍼플]                  [3공장]          ← site (있을 때만)
//        ┌─────┴─────┐                 │
//   [파트장:류성곤] [파트장:안은희]   [파트장:김지은]  ← part (있을 때만)
//     ┌──┴──┐
//  [부자재] [기기분석]                                 ← 업무 그룹
//   담당자   담당자
//
// 단계 수는 데이터가 정한다. site/part가 없는 편제표는 예전처럼 한 단만 그리고,
// 그룹 이름의 ' · '도 계속 단계로 쪼갠다(전략구매팀의 "원자재구매관리 · 구매").
// ─────────────────────────────────────────────────────────────

const SPLIT = ' · ';

/** 그룹 하나가 트리에서 놓일 자리 — [사업장, 파트, …그룹명] */
function pathOf(g: ChartGroup): string[] {
  return [g.site, g.part, ...g.name.split(SPLIT)].map((x) => (x || '').trim()).filter(Boolean);
}

interface TreeNode {
  title: string;
  children: TreeNode[];
  /** 잎 노드에만 붙는다 */
  group?: ChartGroup;
}

function buildTree(groups: ChartGroup[]): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const g of groups) {
    const path = pathOf(g);
    let level = roots;
    let node: TreeNode | undefined;
    for (const title of path) {
      node = level.find((n) => n.title === title);
      if (!node) {
        node = { title, children: [] };
        level.push(node);
      }
      level = node.children;
    }
    if (node) node.group = g;
  }
  return roots;
}

function countNode(node: TreeNode): { filled: number; vacant: number } {
  let filled = 0;
  let vacant = 0;
  const walk = (n: TreeNode) => {
    for (const m of n.group?.members || []) {
      if (m.vacant || !m.person) vacant++;
      else filled++;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return { filled, vacant };
}

function OrgTree({ chart, groups }: { chart: DeptChart; groups: ChartGroup[] }) {
  const roots = useMemo(() => buildTree(groups), [groups]);

  return (
    <div className="min-w-max mx-auto">
      {/* 루트 */}
      <div className="flex justify-center">
        <div
          className={
            'px-5 py-2.5 rounded-lg text-center shadow-sm ' +
            (chart.leadVacant
              ? 'bg-rose-50 border-2 border-dashed border-rose-500 text-slate-900'
              : 'bg-slate-900 text-white')
          }
        >
          <div className="text-base font-black">{chart.dept}</div>
          {chart.lead ? (
            <div className={'text-xs mt-0.5 ' + (chart.leadVacant ? 'font-bold text-rose-700' : '')}>{chart.lead}</div>
          ) : chart.headcount != null ? (
            <div className="text-xs mt-0.5">편제 {chart.headcount}명</div>
          ) : null}
        </div>
      </div>

      <div className="h-6 w-px bg-slate-400 mx-auto" aria-hidden />

      <div className="flex justify-center items-start gap-6">
        {roots.map((n, i) => (
          <Branch key={n.title} node={n} depth={0} siblings={roots.length} index={i} />
        ))}
      </div>
    </div>
  );
}

/** 단계별 상자 모양 — 위로 갈수록 진하게 */
const LEVEL_BOX = [
  'px-4 py-1.5 rounded-lg border-2 border-slate-900 bg-white text-sm font-black',
  'px-3 py-1 rounded-md border border-violet-400 bg-violet-50 text-sm font-bold',
  'px-3 py-1 rounded-md border border-indigo-400 bg-indigo-50 text-sm font-bold',
  'px-3 py-1 rounded-md border border-slate-300 bg-slate-50 text-sm font-bold',
];

function Branch({
  node,
  depth,
  siblings,
  index,
}: {
  node: TreeNode;
  depth: number;
  siblings: number;
  index: number;
}) {
  const { vacant } = countNode(node);
  const box = LEVEL_BOX[Math.min(depth, LEVEL_BOX.length - 1)];
  const g = node.group;

  return (
    <div className="relative pt-6 flex flex-col items-center min-w-[150px]">
      {/* 형제가 있으면 갈라지는 가로줄 — 양 끝은 안쪽 절반만 */}
      {siblings > 1 && (
        <>
          {index > 0 && <div className="absolute left-0 top-0 w-1/2 h-px bg-slate-400" aria-hidden />}
          {index < siblings - 1 && <div className="absolute right-0 top-0 w-1/2 h-px bg-slate-400" aria-hidden />}
        </>
      )}
      <div className="absolute left-1/2 top-0 h-6 w-px bg-slate-400" aria-hidden />

      {/* 이 단계 상자 */}
      <div className={`${box} text-slate-900 whitespace-nowrap`}>
        {node.title}
        {g?.headcount != null && <span className="ml-1 text-xs">({g.headcount})</span>}
        {vacant > 0 && <span className="ml-1 text-xs text-rose-700">공석 {vacant}</span>}
      </div>

      {/* 담당 업무 */}
      {g?.duties && g.duties.length > 0 && (
        <div className="mt-1.5 flex flex-col items-center gap-0.5">
          {g.duties.map((d) => (
            <span key={d} className="text-[11px] text-slate-900 whitespace-nowrap">
              {d}
            </span>
          ))}
        </div>
      )}

      {/* 담당자 */}
      {g && g.members.length > 0 && (
        <div className="mt-2 w-full flex flex-col items-stretch gap-1">
          {g.members.map((m, i) => {
            const isVacant = m.vacant || !m.person;
            return (
              <div
                key={`${m.person}-${i}`}
                className={`px-2 py-1 rounded text-center text-sm whitespace-nowrap ${
                  isVacant ? 'bg-rose-50 border border-dashed border-rose-400' : 'bg-orange-50 border border-orange-200'
                }`}
              >
                <span className="font-bold text-slate-900">{isVacant ? (m.grade || '공석') : m.person}</span>
                {!isVacant && m.grade && <span className="ml-1 text-xs text-slate-900">{m.grade}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* 아래 단계 */}
      {node.children.length > 0 && (
        <div className="flex items-start gap-4">
          {node.children.map((c, k) => (
            <Branch key={c.title} node={c} depth={depth + 1} siblings={node.children.length} index={k} />
          ))}
        </div>
      )}
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
