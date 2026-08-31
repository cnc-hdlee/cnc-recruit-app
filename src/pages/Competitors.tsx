// 경쟁사 조직도 — 한국콜마 / 코스맥스.
//
// 조직도 이미지를 붙이지 않고 트리 데이터로 넣었기 때문에
// 검색 · 접기/펼치기 · 조직 수 집계가 된다. 두 회사 모두 같은 컴포넌트를 쓰므로 화면이 동일하다.

import { useMemo, useState } from 'react';
import { COMPETITORS, countOrg, getCompetitor, type CompetitorOrg, type OrgNode } from '../data/competitors';

// ─────────────────────────────────────────────────────────────
// 회사 1곳 조직도 (한국콜마 / 코스맥스 공용)
// ─────────────────────────────────────────────────────────────
export function CompetitorOrgPage({ companyId }: { companyId: string }) {
  const org = getCompetitor(companyId);
  if (!org) return <div className="card p-6 text-slate-900">조직도 데이터를 찾을 수 없습니다.</div>;
  return <OrgView org={org} />;
}

function OrgView({ org }: { org: CompetitorOrg }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => countOrg(org.tree), [org]);
  const q = query.trim();

  // 검색어가 있으면 매칭된 노드와 그 조상만 남긴다
  const tree = useMemo(() => (q ? filterTree(org.tree, q) : org.tree), [org, q]);

  const toggle = (path: string) => setCollapsed((p) => ({ ...p, [path]: !p[path] }));
  const expandAll = () => setCollapsed({});
  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    const walk = (nodes: OrgNode[], base: string) => {
      for (const n of nodes) {
        const path = base ? `${base}/${n.name}` : n.name;
        if (n.children?.length) {
          next[path] = true;
          walk(n.children, path);
        }
      }
    };
    walk(org.tree, '');
    setCollapsed(next);
  };

  return (
    <div className="space-y-3 text-slate-900">
      {/* 헤더 + 집계 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-black text-slate-900">{org.name}</span>
          <span className="text-sm font-bold text-slate-900">{org.asOf}</span>
        </div>
        {org.summary && <div className="mt-1 text-sm font-semibold text-slate-900">{org.summary}</div>}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="최상위 조직" value={counts.units} />
          <Stat label="본부·연구소·그룹" value={counts.groups} />
          <Stat label="팀" value={counts.teams} />
          <Stat label="전체 조직" value={counts.total} />
        </div>
        <div className="mt-2 text-xs text-slate-900">출처: {org.source}</div>
      </div>

      {/* 조직 개편 이력 */}
      {org.changes && org.changes.length > 0 && (
        <div className="card p-3">
          <div className="text-sm font-bold text-slate-900 mb-1">조직 개편</div>
          <ul className="space-y-0.5">
            {org.changes.map((c) => (
              <li key={c} className="text-sm text-slate-900">
                · {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 검색 + 컨트롤 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="조직명 검색 (예: 구매, 연구, 마케팅)"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-64"
          />
          {q && <span className="text-sm font-bold text-slate-900">{countOrg(tree).total}건 매칭</span>}
          <button
            onClick={expandAll}
            className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-900 hover:bg-slate-100"
          >
            모두 펼치기
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-900 hover:bg-slate-100"
          >
            모두 접기
          </button>
        </div>
      </div>

      {/* 트리 */}
      <div className="card p-3">
        <div className="max-h-[640px] overflow-y-auto pr-1 space-y-1.5">
          {tree.map((n) => (
            <TreeNode
              key={n.name}
              node={n}
              path={n.name}
              depth={0}
              query={q}
              collapsed={collapsed}
              onToggle={toggle}
            />
          ))}
          {tree.length === 0 && (
            <div className="text-center py-10 text-sm text-slate-900">검색 결과가 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-2">
      <div className="text-xs font-bold text-slate-900">{label}</div>
      <div className="text-2xl font-black tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function TreeNode({
  node,
  path,
  depth,
  query,
  collapsed,
  onToggle,
}: {
  node: OrgNode;
  path: string;
  depth: number;
  query: string;
  collapsed: Record<string, boolean>;
  onToggle: (path: string) => void;
}) {
  const hasChildren = !!node.children?.length;
  const isOpen = !collapsed[path];

  // depth별 톤 — 최상위는 진하게, 아래로 갈수록 옅게 (글씨는 항상 검정)
  const tone =
    depth === 0
      ? 'bg-slate-900 text-white border-slate-900'
      : depth === 1
        ? 'bg-indigo-50 border-indigo-200'
        : 'bg-white border-slate-200';

  return (
    <div className={depth === 0 ? '' : 'ml-4 border-l border-slate-200 pl-3'}>
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${tone}`}>
        {hasChildren ? (
          <button
            onClick={() => onToggle(path)}
            className={`w-5 h-5 shrink-0 rounded grid place-items-center text-xs font-black ${
              depth === 0 ? 'text-white hover:bg-white/20' : 'text-slate-900 hover:bg-slate-200'
            }`}
            aria-label={isOpen ? '접기' : '펼치기'}
          >
            {isOpen ? '−' : '+'}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <span className={`font-bold ${depth === 0 ? 'text-white text-base' : 'text-slate-900 text-sm'}`}>
          {highlight(node.name, query, depth === 0)}
        </span>
        {hasChildren && (
          <span
            className={`ml-auto text-xs font-bold ${depth === 0 ? 'text-slate-200' : 'text-slate-900'}`}
          >
            {node.children!.length}
          </span>
        )}
      </div>
      {node.note && (
        <div className={`text-xs text-slate-900 mt-0.5 ${depth === 0 ? 'ml-8' : 'ml-8'}`}>※ {node.note}</div>
      )}
      {hasChildren && isOpen && (
        <div className="mt-1 space-y-1">
          {node.children!.map((c) => (
            <TreeNode
              key={c.name}
              node={c}
              path={`${path}/${c.name}`}
              depth={depth + 1}
              query={query}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function highlight(text: string, q: string, onDark: boolean) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className={onDark ? 'bg-amber-300 text-slate-900 rounded px-0.5' : 'bg-amber-200 text-slate-900 rounded px-0.5'}>
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** 검색어에 걸리는 노드 + 그 조상만 남긴 트리 */
function filterTree(nodes: OrgNode[], q: string): OrgNode[] {
  const lower = q.toLowerCase();
  const out: OrgNode[] = [];
  for (const n of nodes) {
    const kids = n.children ? filterTree(n.children, q) : [];
    const hit = n.name.toLowerCase().includes(lower);
    if (hit || kids.length > 0) {
      out.push({ ...n, children: hit && n.children ? n.children : kids.length ? kids : undefined });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 경쟁사 개요 — 두 회사 나란히 비교
// ─────────────────────────────────────────────────────────────
export function CompetitorsOverview({ onOpen }: { onOpen?: (id: string) => void }) {
  return (
    <div className="space-y-3 text-slate-900">
      <div className="card p-3">
        <div className="text-sm font-bold text-slate-900">경쟁사 조직도</div>
        <div className="text-sm text-slate-900 mt-1">
          조직도 파일에서 뽑아 트리로 정리했습니다. 회사별 탭에서 조직명 검색과 펼침이 가능합니다.
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {COMPETITORS.map((org) => {
          const c = countOrg(org.tree);
          return (
            <button
              key={org.id}
              onClick={() => onOpen?.(org.id)}
              className="card p-4 text-left hover:border-indigo-300 transition"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-black text-slate-900">{org.name}</span>
                <span className="text-xs font-bold text-slate-900">{org.asOf}</span>
              </div>
              {org.summary && <div className="mt-1 text-sm text-slate-900">{org.summary}</div>}
              <div className="mt-3 grid grid-cols-4 gap-2">
                <Stat label="최상위" value={c.units} />
                <Stat label="본부·연구소" value={c.groups} />
                <Stat label="팀" value={c.teams} />
                <Stat label="전체" value={c.total} />
              </div>
              <div className="mt-2 text-xs font-bold text-indigo-700">조직도 보기 →</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
