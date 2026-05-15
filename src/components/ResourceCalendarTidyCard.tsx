import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { GCalListEntry } from '../lib/api';

// 회의실/차량 리소스 캘린더의 라벨/색/표시 상태를 일괄 정리하는 1회성 카드.
// 본인 view의 calendarList entry만 수정 (캘린더 자체는 안 건드림 → 다른 사용자 영향 없음).
//
// 분류 규칙: summary 문자열 기반 자동 매칭
//   - "(자동차)" 또는 "차량" 포함 → 차량 그룹 (Graphite)
//   - "회의실/미팅룸/대회의/소회의/식당/카페" 포함 → 회의실 그룹, 사이트는 prefix("퍼플"/"그린"/"수원")로 분류
//
// 색깔: 면접(grape=3) / 입사(banana=5) 와 안 겹치게 선택
//   - 퍼플 회의실 = Lavender (1)
//   - 그린 회의실 = Sage (2)
//   - 수원 회의실 = Peacock (7)
//   - 차량 = Graphite (8)

type Plan = {
  id: string;
  kind: 'room' | 'car';
  site: 'purple' | 'green' | 'suwon' | 'unknown';
  before: string;
  after: string;
  colorId: string;
  selected: boolean;
};

const SITE_LABEL: Record<Plan['site'], string> = {
  purple: '퍼플',
  green: '그린',
  suwon: '수원',
  unknown: '기타',
};

const SITE_COLOR: Record<Plan['site'], string> = {
  purple: '1', // Lavender
  green: '2',  // Sage
  suwon: '7',  // Peacock
  unknown: '1',
};

function classify(entry: GCalListEntry): Plan | null {
  const s = entry.summary || '';
  // 본인이 만든 캘린더(면접/입사/퇴사)는 건드리지 않음 — group.calendar.google.com 도메인 X
  if (!entry.id.includes('resource.calendar.google.com')) return null;

  const isCar = /자동차|차량/.test(s);
  const isRoom = /회의실|미팅룸|대회의|소회의|구내식당|식당|카페|로비|라운지|VIP/.test(s);
  if (!isCar && !isRoom) return null;

  const site: Plan['site'] = /퍼플/.test(s)
    ? 'purple'
    : /그린/.test(s)
    ? 'green'
    : /수원/.test(s)
    ? 'suwon'
    : 'unknown';

  if (isCar) {
    // "(자동차)-퍼플차량_7139_모닝" → "7139 모닝"
    const tail = s.replace(/^\(자동차\)-?/, '').replace(/^퍼플차량_?/, '');
    const after = `🚗 차량 · ${SITE_LABEL[site]} · ${tail.replace(/_/g, ' ').trim()}`;
    return {
      id: entry.id,
      kind: 'car',
      site,
      before: s,
      after,
      colorId: '8',
      selected: false,
    };
  }

  // 회의실: "퍼플-6층-퍼플_대회의실 (30)" → "대회의실 (30)"
  let room = s
    .replace(/^퍼플-?\d*층?-?퍼플_?/, '')
    .replace(/^그린-?\d*층?-?그린_?/, '')
    .replace(/^그린-\d+-그린_?/, '')
    .replace(/^수원-?\d+층?-?수원_?/, '')
    .replace(/^수원-\d+-수원_?/, '')
    .replace(/_/g, ' ')
    .trim();
  if (!room) room = s;
  const after = `🏢 회의실 · ${SITE_LABEL[site]} · ${room}`;
  return {
    id: entry.id,
    kind: 'room',
    site,
    before: s,
    after,
    colorId: SITE_COLOR[site],
    selected: false,
  };
}

export function ResourceCalendarTidyCard() {
  const [entries, setEntries] = useState<GCalListEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: number; fail: number; details: string[] } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.google.listCalendarsFull();
      if (!r.ok || !r.data) {
        setError(r.error || '캘린더 목록을 불러오지 못했습니다.');
        return;
      }
      setEntries(r.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const plans = useMemo<Plan[]>(() => {
    if (!entries) return [];
    return entries
      .map(classify)
      .filter((p): p is Plan => p !== null)
      // 라벨 알파벳 정렬 — UI에서도 정리된 순서로 미리 보기
      .sort((a, b) => a.after.localeCompare(b.after, 'ko'));
  }, [entries]);

  const toChange = plans.filter((p) => p.before !== p.after);

  const handleApply = async () => {
    if (!plans.length) return;
    const msg =
      `리소스 캘린더 정리\n\n` +
      `대상: ${plans.length}개 (라벨/색/숨김 적용)\n` +
      `※ 본인 view만 변경 (다른 사용자 영향 없음)\n` +
      `※ 활성화 전이라 사이드바에서 숨김(selected=false) 처리\n\n` +
      `진행할까요?`;
    if (!confirm(msg)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const details: string[] = [];
    let ok = 0;
    let fail = 0;
    for (const p of plans) {
      try {
        const r = await api.google.patchCalendarListEntry(p.id, {
          summaryOverride: p.after,
          colorId: p.colorId,
          selected: p.selected,
        });
        if (r.ok) ok++;
        else {
          fail++;
          details.push(`${p.before} — ${r.error || 'unknown'}`);
        }
      } catch (err: unknown) {
        fail++;
        details.push(`${p.before} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setResult({ ok, fail, details });
    setBusy(false);
    await load();
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-2xl">🧹</span> 리소스 캘린더 라벨 정리
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            구글 캘린더 사이드바 "다른 캘린더"에 흩어진 회의실·차량 캘린더를 같은 라벨 prefix로 묶고
            사이트별 색깔로 통일합니다. 본인 view만 변경 — 다른 사용자에게는 영향 없음.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || busy}
          className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? '불러오는 중...' : '🔄 다시 조회'}
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          {error}
        </div>
      )}

      {plans.length === 0 ? (
        <div className="text-sm text-slate-400 py-4 text-center">
          {entries === null ? '...' : '정리할 리소스 캘린더가 없습니다.'}
        </div>
      ) : (
        <>
          <div className="text-xs text-slate-500 mb-2">
            대상 {plans.length}개 · 변경 예정 {toChange.length}개 · 이미 정리됨 {plans.length - toChange.length}개
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">현재 라벨</th>
                  <th className="text-left px-3 py-2 font-semibold">→ 변경 후</th>
                  <th className="text-left px-3 py-2 font-semibold w-20">색</th>
                  <th className="text-left px-3 py-2 font-semibold w-16">표시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => (
                  <tr key={p.id} className={p.before === p.after ? 'opacity-40' : ''}>
                    <td className="px-3 py-1.5 text-slate-500">{p.before}</td>
                    <td className="px-3 py-1.5 font-semibold text-slate-800">{p.after}</td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {p.colorId === '1' ? 'Lavender' :
                       p.colorId === '2' ? 'Sage' :
                       p.colorId === '7' ? 'Peacock' :
                       p.colorId === '8' ? 'Graphite' : p.colorId}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {p.selected ? '✓ 보임' : '— 숨김'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleApply}
              disabled={busy || plans.length === 0}
              className="px-4 py-2 rounded-md text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? '적용 중...' : `위 ${plans.length}개 일괄 적용`}
            </button>
            <span className="text-[11px] text-slate-400">
              면접 잡을 때 사용하려면 구글 캘린더 사이드바에서 체크박스를 켜 보이게 하세요.
            </span>
          </div>

          {result && (
            <div className="mt-3 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
              <div className="font-bold">완료: 성공 {result.ok}건 · 실패 {result.fail}건</div>
              {result.details.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-rose-700">
                  {result.details.map((d, i) => <li key={i}>• {d}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
