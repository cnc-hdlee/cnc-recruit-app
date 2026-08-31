// 면접 캘린더 정리 — 중복 이벤트 제거 + 제목 규격 통일.
//
// 표준 제목: [상태] HH:MM / 사이트 / 이름 / 부서팀(직무)
//   · 상태는 [취소] [포기] [불참] [보류] 4종만, 항상 맨 앞
//   · 시간은 이벤트 실제 시작 시각을 따른다 (제목의 시간이 어긋난 건 실제 시각으로 교정)
//   · 직무는 부서팀 뒤 괄호 — 캘린더에 이미 정착된 표기(225건 대 1건)를 따랐다
//
// 대상은 TA팀 메인 면접 캘린더 하나뿐이다. 다른 면접 캘린더는 읽기 전용이라 건드리지 않는다.
// 무엇을 지우고 무엇을 바꾸는지 전부 미리 보여준 뒤, 사용자가 누를 때만 실행한다.

import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { liveCalendarRaw, refreshCalendarFromGoogle } from '../store/liveData';
import { SHARED_CAL } from '../lib/sharedCalendars';

const SITES = ['퍼플', '그린', '수원', '오산', '위워크', '서울', '온라인'];

const STATUS_RULES: { re: RegExp; tag: string }[] = [
  { re: /[(（]?\s*면접\s*취소\s*[)）]?|[(（]\s*취소\s*[)）]|취소됨/, tag: '취소' },
  { re: /면접\s*포기|[(（]\s*포기\s*[)）]/, tag: '포기' },
  { re: /[(（]\s*불참\s*[)）]|노쇼|no\s?show|미참석/i, tag: '불참' },
  { re: /[(（]\s*보류\s*[)）]|면접\s*보류/, tag: '보류' },
];

interface RawEvent {
  id: string;
  summary?: string | null;
  description?: string | null;
  start?: string | null;
  calendarId?: string | null;
  updated?: string | null;
}

function hhmm(iso: string | null | undefined): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? `${m[1]}:${m[2]}` : '';
}

/** 제목을 표준형으로. 필요한 값을 못 채우면 null (자동 교정하지 않고 사람이 본다) */
export function normalizeTitle(summary: string, startIso: string | null | undefined, description?: string | null): string | null {
  const raw = (summary || '').trim();
  if (!raw) return null;

  let status = '';
  let body = raw;
  for (const r of STATUS_RULES) {
    if (r.re.test(body)) {
      status = r.tag;
      body = body.replace(r.re, ' ');
      break;
    }
  }
  body = body.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim();

  const parts = body.split('/').map((s) => s.trim()).filter(Boolean);
  let site = '';
  let name = '';
  let team = '';
  let job = '';

  for (const p of parts) {
    if (/^\d{1,2}:\d{2}$/.test(p)) continue; // 시간은 이벤트 시작 시각을 쓴다
    if (!site) {
      const hit = SITES.find((s) => p.includes(s));
      if (hit && p.replace(hit, '').trim().length <= 6) {
        site = hit;
        continue;
      }
    }
    const bare = p.replace(/[(（][^)）]*[)）]/g, '').trim();
    if (!team && /(팀|실|센터|연구소|부문)$/.test(bare)) {
      team = bare;
      const jm = p.match(/[(（]([^)）]+)[)）]/);
      if (jm) job = job || jm[1].trim();
      continue;
    }
    if (!name) {
      const nm = p.match(/^([가-힣]{2,4})\s*(?:[(（]([^)）]*)[)）])?\s*(?:_(.+))?$/);
      if (nm) {
        name = nm[1];
        job = job || (nm[2] || nm[3] || '').trim();
        continue;
      }
      const en = p.match(/^([A-Za-z][A-Za-z.\-]{1,})$/);
      if (en) {
        name = en[1];
        continue;
      }
    }
  }

  // 앱이 만든 이벤트는 설명에 후보자/팀이 적혀 있다 — 제목에서 못 읽으면 여기서 보강
  const d = description || '';
  if (!name) {
    const m = d.match(/후보자\s*:\s*([가-힣]{2,4})/);
    if (m) name = m[1];
  }
  if (!team) {
    const m = d.match(/팀\s*:\s*([^\n(（]+)/);
    if (m) team = m[1].trim();
  }
  if (!job) {
    const m = d.match(/후보자\s*:\s*[가-힣]{2,4}\s*[(（]([^)）]+)[)）]/);
    if (m) job = m[1].trim();
  }

  const time = hhmm(startIso);
  if (!time || !site || !name || !team) return null;

  const jobPart = job ? `(${job.replace(/\s+/g, ' ').trim()})` : '';
  return `${status ? `[${status}] ` : ''}${time} / ${site} / ${name} / ${team}${jobPart}`;
}

export function InterviewTitleTidy() {
  const [busy, setBusy] = useState<'dup' | 'title' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const events = useMemo<RawEvent[]>(
    () =>
      (liveCalendarRaw() as unknown as RawEvent[]).filter(
        (e) => e.calendarId === SHARED_CAL.interview && (e.summary || '').trim()
      ),
    // liveCalendarRaw는 폴링 때마다 새 배열이라 open 토글마다 다시 계산해도 충분하다
    [open, done]
  );

  // ── 중복: 같은 (시작시각 + 제목) — 가장 먼저 만든 1건만 남긴다
  const dupGroups = useMemo(() => {
    const map = new Map<string, RawEvent[]>();
    for (const e of events) {
      const key = `${e.start}|${(e.summary || '').trim()}`;
      const arr = map.get(key);
      if (arr) arr.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => {
        // 스냅샷에는 생성시각이 없어 updated + id 로 안정 정렬한다 (매번 같은 1건이 남도록)
        const sorted = [...list].sort(
          (a, b) => String(a.updated || '').localeCompare(String(b.updated || '')) || a.id.localeCompare(b.id)
        );
        return { key, title: (sorted[0].summary || '').trim(), keep: sorted[0], remove: sorted.slice(1) };
      })
      .sort((a, b) => b.remove.length - a.remove.length);
  }, [events]);

  const dupCount = dupGroups.reduce((n, g) => n + g.remove.length, 0);

  // ── 제목 규격
  const titleFixes = useMemo(() => {
    const dupIds = new Set(dupGroups.flatMap((g) => g.remove.map((e) => e.id)));
    const out: { id: string; from: string; to: string }[] = [];
    for (const e of events) {
      if (dupIds.has(e.id)) continue; // 어차피 지울 건 손대지 않는다
      const cur = (e.summary || '').trim();
      const next = normalizeTitle(cur, e.start, e.description);
      if (next && next !== cur) out.push({ id: e.id, from: cur, to: next });
    }
    return out;
  }, [events, dupGroups]);

  async function runDedup() {
    if (dupCount === 0) return;
    if (!window.confirm(`중복 ${dupCount}건을 삭제합니다.\n각 그룹에서 가장 먼저 만들어진 1건은 남깁니다.\n계속할까요?`)) return;
    setBusy('dup');
    let ok = 0;
    let fail = 0;
    for (const g of dupGroups) {
      for (const e of g.remove) {
        try {
          const r = await api.google.deleteCalEvent(SHARED_CAL.interview, e.id, 'none');
          if (r.ok) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }
    }
    await refreshCalendarFromGoogle();
    setBusy(null);
    setDone(`중복 ${ok}건 삭제${fail ? ` · 실패 ${fail}건` : ''}`);
  }

  async function runTitles() {
    if (titleFixes.length === 0) return;
    if (!window.confirm(`제목 ${titleFixes.length}건을 표준 규격으로 바꿉니다.\n계속할까요?`)) return;
    setBusy('title');
    let ok = 0;
    let fail = 0;
    for (const f of titleFixes) {
      try {
        const r = await api.google.updateCalEvent(SHARED_CAL.interview, f.id, { summary: f.to }, 'none');
        if (r.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    await refreshCalendarFromGoogle();
    setBusy(null);
    setDone(`제목 ${ok}건 정리${fail ? ` · 실패 ${fail}건` : ''}`);
  }

  const total = dupCount + titleFixes.length;

  return (
    <div className="card p-3 text-slate-900">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        <span className="text-sm font-bold text-slate-900">🧹 면접 캘린더 정리</span>
        {total > 0 ? (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-xs font-bold text-slate-900">
            정리할 것 {total}건
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-xs font-bold text-slate-900">
            깨끗함
          </span>
        )}
        {done && <span className="text-xs font-bold text-emerald-700">{done}</span>}
        <span className="ml-auto text-xs text-slate-900">{open ? '▾ 접기' : '▸ 펼치기'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-slate-900">
            표준 제목 — <span className="font-mono font-bold">[상태] HH:MM / 사이트 / 이름 / 부서팀(직무)</span>
            <br />
            상태는 <b>[취소] [포기] [불참] [보류]</b> 4종만 쓰고 항상 맨 앞에 붙입니다. 시간은 이벤트 실제 시작 시각을 따릅니다.
          </div>

          {/* 중복 */}
          <div className="rounded-lg border border-slate-300 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">중복 이벤트 {dupCount}건</span>
              <button
                onClick={runDedup}
                disabled={dupCount === 0 || busy !== null}
                className="ml-auto px-3 py-1 rounded bg-rose-600 text-white text-xs font-bold disabled:opacity-40"
              >
                {busy === 'dup' ? '삭제 중…' : '중복 삭제'}
              </button>
            </div>
            {dupGroups.length > 0 ? (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {dupGroups.map((g) => (
                  <div key={g.key} className="text-xs text-slate-900">
                    <b>{g.remove.length}건 삭제</b> (1건 유지) · {g.title}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-900">중복 없음</div>
            )}
          </div>

          {/* 제목 규격 */}
          <div className="rounded-lg border border-slate-300 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">제목 규격 위반 {titleFixes.length}건</span>
              <button
                onClick={runTitles}
                disabled={titleFixes.length === 0 || busy !== null}
                className="ml-auto px-3 py-1 rounded bg-accent-purple text-white text-xs font-bold disabled:opacity-40"
              >
                {busy === 'title' ? '수정 중…' : '제목 통일'}
              </button>
            </div>
            {titleFixes.length > 0 ? (
              <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                {titleFixes.map((f) => (
                  <div key={f.id} className="text-xs">
                    <div className="text-slate-900 line-through opacity-70">{f.from}</div>
                    <div className="text-slate-900 font-bold">{f.to}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-900">모두 규격에 맞습니다</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
