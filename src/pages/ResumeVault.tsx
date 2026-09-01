// 이력서 보관함 — 지원자 이력서를 앱에 드래그앤드랍해 계속 쌓는다.
//
// 목적(사용자): "이력서 데이터만" 축적 + 재지원 여부 확인 + 팀·직무 단위 세분화 관리.
//   · 원본은 로컬(userData/resumes)에 저장하고 구글 드라이브(앱 전용 폴더)에 자동 백업한다.
//   · 분류 체계는 팀 → 직무 → 후보자 3단. 왼쪽 트리에서 팀/직무를 고르면 목록이 좁혀진다.
//   · 같은 파일(내용 해시 동일)은 중복 저장하지 않는다. 같은 사람의 다른 이력서는 재지원 이력으로 남긴다.
//   · 파일을 놓는 즉시 "이 사람 예전에 지원한 적 있음"을 배너로 알려준다.
// Gmail 자동 수집·캘린더 매칭·시트 미러는 의도적으로 넣지 않았다 (요청 범위 밖).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { ResumeEntry } from '../lib/api';
import { IS_VIEWER } from '../lib/mode';
import { DEFAULT_TEAM_ATTENDEES } from '../lib/interviewAttendees';

const UNCLASSIFIED = '미분류';

// ── 파일명 파서 ─────────────────────────────────────────────────────────────
// 실제 들어오는 파일명 예시
//   이력서(생산운영팀_충전계획 - 김가연).pdf
//   지원자 이력서_황상현(전략구매_자재개발팀).pdf
//   지원자 이력서 조은주 경력(전략구매_자재개발팀).pdf
const NOISE_WORDS =
  /(지원자|이력서|경력기술서|자기소개서|자소서|포트폴리오|입사지원서|첨부|최종본?|사본|복사본|resume|cv|copy|final|ver\d*|v\d+)/gi;
// 이름으로 오인하기 쉬운 직무·부서 성격의 접미사.
// ※ '남/여' 한 글자는 넣지 않는다 — 장광남·김영남처럼 이름이 남으로 끝나는 경우를 이름이 아니라고
//   잘라버렸던 버그가 있었다.
const NOT_NAME =
  /(팀|본부|실|센터|파트|그룹|담당|계획|개발|관리|생산|운영|구매|기획|디자인|영업|품질|연구|지원|공정|물류|안전|시설|회계|재무|인사|총무|마케팅|해외|국내|신입|경력|정규직|도급직|남자|여자)$/;
// 직무 칸에 들어가면 안 되는 토큰 (구분값이지 직무가 아님)
const NOT_JOB = /^(신입|경력|정규직|도급직|계약직|남자|여자|남|여|첨부|최종|사본|지원|입사|\d+)$/;

const splitTokens = (s: string) =>
  s
    .split(/[_/,·()（）[\]{}<>|\-–—\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

export function parseResumeFileName(filename: string): {
  candidate: string;
  team: string;
  job: string;
} {
  const base = (filename || '').replace(/\.[^.]+$/, '');
  // 괄호 안 내용은 대개 "부서_직무" — 따로 뽑아 둔다
  const paren = [...base.matchAll(/[(（[]([^)）\]]+)[)）\]]/g)].map((m) => m[1]).join(' ');
  const flat = `${base} ${paren}`.replace(NOISE_WORDS, ' ');

  // ① 팀 — 팀/본부/실/센터/Lab 로 끝나는 토큰
  const teamM = flat.match(/([가-힣A-Za-z0-9&]{2,}(?:팀|본부|실|센터|Lab)|연구소)/);
  const team = teamM ? teamM[1] : '';

  // ② 후보자 이름
  //    · 대시(-) 뒤 토큰 우선 — "…_충전계획 - 김가연" 패턴
  //    · 그 외에는 한글 2~4자 토큰 중 부서/직무성 접미사가 없는 것. 3자 > 2자 > 4자 순으로 선호.
  let candidate = '';
  const dash =
    base.match(/[-–—]\s*([가-힣]{2,4})\s*[)\]]?\s*$/) || base.match(/[-–—]\s*([가-힣]{2,4})/);
  if (dash && !NOT_NAME.test(dash[1])) candidate = dash[1];
  if (!candidate) {
    const tokens = splitTokens(flat)
      .filter((t) => /^[가-힣]{2,4}$/.test(t))
      .filter((t) => !NOT_NAME.test(t) && t !== team);
    const rank = (t: string) => (t.length === 3 ? 0 : t.length === 2 ? 1 : 2);
    tokens.sort((a, b) => rank(a) - rank(b));
    candidate = tokens[0] || '';
  }

  // ③ 직무 — 괄호 안을 먼저 보고, 없으면 파일명 전체에서 팀·이름을 뺀 나머지 토큰
  const pickJob = (src: string) =>
    splitTokens(src.replace(NOISE_WORDS, ' ')).find(
      (t) => t !== team && t !== candidate && t.length >= 2 && !NOT_JOB.test(t)
    ) || '';
  const job = (paren ? pickJob(paren) : '') || pickJob(flat);

  return { candidate, team, job: job === team || job === candidate ? '' : job };
}

// 파일 → base64 (큰 파일에서 스택이 터지지 않도록 청크 단위로 변환)
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const PREVIEWABLE = /^(application\/pdf|image\/)/;

interface DropReport {
  added: ResumeEntry[];
  duplicates: string[];
  failed: string[];
  reapply: { name: string; prev: ResumeEntry[] }[];
}

type SortKey = 'recent' | 'name' | 'most';

export function ResumeVault() {
  const [entries, setEntries] = useState<ResumeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [report, setReport] = useState<DropReport | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [onlyReapply, setOnlyReapply] = useState(false);
  const [selTeam, setSelTeam] = useState<string | null>(null);
  const [selJob, setSelJob] = useState<string | null>(null);
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ team: '', job: '' });
  const [driveUrl, setDriveUrl] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (IS_VIEWER || !api?.resumes) {
      setLoading(false);
      return;
    }
    try {
      const r = await api.resumes.list();
      if (r.ok && r.data) setEntries(r.data);
      else setErr(r.error || '목록을 읽지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!IS_VIEWER && api?.resumes) {
      void api.resumes.driveFolder().then((r) => {
        if (r.ok && r.data?.url) setDriveUrl(r.data.url);
      });
    }
  }, [refresh]);

  // 팀/직무 입력 자동완성 후보 — 앱이 아는 팀 + 보관함에 이미 쓰인 값
  const suggestTeams = useMemo(() => {
    const s = new Set<string>(Object.keys(DEFAULT_TEAM_ATTENDEES));
    entries.forEach((e) => e.team && s.add(e.team));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [entries]);
  const suggestJobs = useMemo(() => {
    const s = new Set<string>();
    entries.forEach((e) => e.job && s.add(e.job));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  // ── 드랍 처리 ─────────────────────────────────────────────────────────────
  const ingest = useCallback(
    async (files: File[]) => {
      if (!files.length || !api?.resumes) return;
      setBusy(`${files.length}개 저장 중…`);
      const before = entries;
      const rep: DropReport = { added: [], duplicates: [], failed: [], reapply: [] };
      for (const f of files) {
        try {
          const base64 = await fileToBase64(f);
          const meta = parseResumeFileName(f.name);
          // 트리에서 팀/직무를 고른 상태로 떨어뜨리면 그 분류를 기본값으로 물려준다
          if (!meta.team && selTeam && selTeam !== UNCLASSIFIED) meta.team = selTeam;
          if (!meta.job && selJob && selJob !== UNCLASSIFIED) meta.job = selJob;
          const r = await api.resumes.save({ filename: f.name, base64, meta });
          if (!r.ok || !r.data) {
            rep.failed.push(`${f.name} — ${r.error || '저장 실패'}`);
            continue;
          }
          if (r.data.duplicate) rep.duplicates.push(f.name);
          else rep.added.push(r.data.entry);
        } catch (e) {
          rep.failed.push(`${f.name} — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // 재지원 판정 — 방금 넣은 사람이 이전에도 이력서를 낸 적 있는지
      for (const a of rep.added) {
        if (!a.candidate) continue;
        const prev = before.filter((e) => e.candidate === a.candidate);
        if (prev.length) rep.reapply.push({ name: a.candidate, prev });
      }
      setReport(rep);
      setBusy(null);
      await refresh();
      // 드라이브 백업은 백그라운드 — 실패해도 로컬 저장은 이미 끝났다
      void api.resumes.backup().then(() => refresh());
    },
    [entries, refresh, selTeam, selJob]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) void ingest(files);
  };

  // ── 팀 → 직무 분류 트리 ───────────────────────────────────────────────────
  const tree = useMemo(() => {
    const byTeam = new Map<string, Map<string, number>>();
    for (const e of entries) {
      const t = e.team?.trim() || UNCLASSIFIED;
      const j = e.job?.trim() || UNCLASSIFIED;
      const jobs = byTeam.get(t) || new Map<string, number>();
      jobs.set(j, (jobs.get(j) || 0) + 1);
      byTeam.set(t, jobs);
    }
    return [...byTeam.entries()]
      .map(([team, jobs]) => ({
        team,
        total: [...jobs.values()].reduce((a, b) => a + b, 0),
        jobs: [...jobs.entries()]
          .map(([job, count]) => ({ job, count }))
          .sort((a, b) => b.count - a.count || a.job.localeCompare(b.job)),
      }))
      .sort((a, b) => {
        if (a.team === UNCLASSIFIED) return 1;
        if (b.team === UNCLASSIFIED) return -1;
        return b.total - a.total || a.team.localeCompare(b.team);
      });
  }, [entries]);

  // ── 그룹핑 (선택된 팀/직무 안에서 후보자 기준) ────────────────────────────
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (selTeam) {
        const t = e.team?.trim() || UNCLASSIFIED;
        if (t !== selTeam) return false;
      }
      if (selJob) {
        const j = e.job?.trim() || UNCLASSIFIED;
        if (j !== selJob) return false;
      }
      return true;
    });
  }, [entries, selTeam, selJob]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<string, ResumeEntry[]>();
    for (const e of filtered) {
      const key = e.candidate?.trim() || `(이름 미상) ${e.filename}`;
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    }
    let list = [...map.entries()].map(([name, items]) => {
      const sorted = [...items].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      // 재지원 판정은 필터와 무관하게 "전체 보관함 기준" — 다른 팀에 낸 이력도 재지원이다
      const allOfPerson = entries.filter((e) => (e.candidate?.trim() || '') === name);
      const teams = [...new Set(allOfPerson.map((i) => i.team).filter(Boolean))];
      return {
        name,
        items: sorted,
        teams: [...new Set(sorted.map((i) => i.team).filter(Boolean))],
        jobs: [...new Set(sorted.map((i) => i.job).filter(Boolean))],
        latest: sorted[0]?.addedAt || '',
        totalOfPerson: allOfPerson.length || sorted.length,
        reapply: (allOfPerson.length || sorted.length) > 1,
        crossTeam: teams.length > 1,
      };
    });
    if (onlyReapply) list = list.filter((g) => g.reapply);
    if (needle) {
      list = list.filter((g) =>
        `${g.name} ${g.teams.join(' ')} ${g.jobs.join(' ')} ${g.items
          .map((i) => `${i.filename} ${i.note} ${i.channel} ${i.tags.join(' ')}`)
          .join(' ')}`
          .toLowerCase()
          .includes(needle)
      );
    }
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'most')
        return b.totalOfPerson - a.totalOfPerson || b.latest.localeCompare(a.latest);
      return b.latest.localeCompare(a.latest);
    });
    return list;
  }, [filtered, entries, q, sort, onlyReapply]);

  const stats = useMemo(() => {
    const people = new Set(entries.map((e) => e.candidate || e.filename)).size;
    const reNames = new Set(
      entries
        .filter((e) => e.candidate)
        .filter((e) => entries.filter((x) => x.candidate === e.candidate).length > 1)
        .map((e) => e.candidate)
    );
    return {
      files: entries.length,
      people,
      reapply: reNames.size,
      teams: new Set(entries.map((e) => e.team?.trim()).filter(Boolean)).size,
      backedUp: entries.filter((e) => e.driveFileId).length,
      unclassified: entries.filter((e) => !e.team?.trim() || !e.job?.trim()).length,
      unknownName: entries.filter((e) => !e.candidate).length,
    };
  }, [entries]);

  const applyBulk = async () => {
    if (!picked.size) return;
    const patch: Partial<ResumeEntry> = {};
    if (bulk.team.trim()) patch.team = bulk.team.trim();
    if (bulk.job.trim()) patch.job = bulk.job.trim();
    if (!Object.keys(patch).length) return;
    setBusy(`${picked.size}건 분류 적용 중…`);
    for (const id of picked) await api.resumes.update(id, patch);
    setPicked(new Set());
    setBulk({ team: '', job: '' });
    setBusy(null);
    void refresh();
  };

  if (IS_VIEWER) {
    return (
      <div className="card p-10 text-center text-slate-600">
        이력서 보관함은 원본 파일을 다루기 때문에 <b>데스크톱 본체 앱</b>에서만 사용할 수 있습니다.
      </div>
    );
  }

  return (
    <div
      className="space-y-4 relative"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* 드래그 오버레이 */}
      {dragging && (
        <div className="fixed inset-0 z-50 bg-[#0b001f]/45 backdrop-blur-sm grid place-items-center pointer-events-none">
          <div className="bg-white rounded-3xl px-10 py-8 shadow-2xl border-2 border-dashed border-violet-400 text-center">
            <div className="text-4xl mb-2">📥</div>
            <div className="text-lg font-bold text-slate-900">여기에 놓으면 보관함에 저장됩니다</div>
            <div className="text-[12px] text-slate-500 mt-1">
              {selTeam && selTeam !== UNCLASSIFIED
                ? `분류: ${selTeam}${selJob && selJob !== UNCLASSIFIED ? ' · ' + selJob : ''} 로 지정됩니다`
                : 'PDF · DOCX · HWP · 이미지 · 여러 개 한 번에 가능'}
            </div>
          </div>
        </div>
      )}

      {/* 상단 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <Stat label="보관 이력서" value={`${stats.files}`} unit="건" tone="text-slate-900" />
        <Stat label="후보자" value={`${stats.people}`} unit="명" tone="text-indigo-700" />
        <Stat label="재지원자" value={`${stats.reapply}`} unit="명" tone="text-amber-600" />
        <Stat label="분류된 팀" value={`${stats.teams}`} unit="개" tone="text-violet-700" />
        <Stat
          label="드라이브 백업"
          value={`${stats.backedUp}/${stats.files}`}
          unit=""
          tone="text-emerald-600"
        />
      </div>

      {/* 드랍존 */}
      <div
        className="card p-5 text-center border-2 border-dashed cursor-pointer transition-colors hover:bg-[#faf7ff]"
        style={{ borderColor: 'var(--cc-p7)' }}
        onClick={() => fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files || [])];
            if (files.length) void ingest(files);
            e.target.value = '';
          }}
        />
        <div className="text-2xl mb-1">🗂️</div>
        <div className="text-sm font-semibold text-slate-900">
          이력서 파일을 이 화면 아무 데나 끌어다 놓으세요
        </div>
        <div className="text-[12px] text-slate-500 mt-1">
          파일명에서 이름·팀·직무를 자동으로 읽습니다 · 왼쪽 트리에서 팀/직무를 선택한 채로 놓으면 그
          분류로 저장됩니다 · 같은 파일은 두 번 저장되지 않습니다
        </div>
        {busy && <div className="mt-2 text-[12px] font-semibold text-violet-700">{busy}</div>}
      </div>

      {/* 드랍 결과 리포트 */}
      {report && (
        <div className="card p-4 space-y-2" style={{ borderColor: 'var(--cc-p7)' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900">저장 결과</span>
            <div className="flex-1" />
            <button className="btn text-[11px]" onClick={() => setReport(null)}>
              닫기
            </button>
          </div>
          {report.added.length > 0 && (
            <div className="text-[12px] text-emerald-700">
              ✅ {report.added.length}건 저장 —{' '}
              {report.added
                .map(
                  (a) =>
                    `${a.candidate || a.filename}${a.team ? ` (${a.team}${a.job ? ' · ' + a.job : ''})` : ''}`
                )
                .join(', ')}
            </div>
          )}
          {report.duplicates.length > 0 && (
            <div className="text-[12px] text-slate-600">
              ⏭ 이미 있는 파일 {report.duplicates.length}건 건너뜀 — {report.duplicates.join(', ')}
            </div>
          )}
          {report.failed.length > 0 && (
            <div className="text-[12px] text-rose-600">⚠ 실패 — {report.failed.join(' / ')}</div>
          )}
          {report.reapply.length > 0 && (
            <div
              className="rounded-xl p-3"
              style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}
            >
              <div className="text-[13px] font-bold text-amber-800">🔁 재지원자 발견</div>
              {report.reapply.map((r) => (
                <div key={r.name} className="mt-1 text-[12px] text-slate-900">
                  <b>{r.name}</b> — 이전 지원 {r.prev.length}건 (
                  {r.prev
                    .map(
                      (p) =>
                        `${fmtDate(p.addedAt)}${p.team ? ' ' + p.team : ''}${p.job ? '/' + p.job : ''}`
                    )
                    .join(', ')}
                  )
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 본문 — 왼쪽 팀/직무 트리 + 오른쪽 목록 */}
      <div className="grid md:grid-cols-[228px_minmax(0,1fr)] gap-3">
        {/* 분류 트리 */}
        <aside className="card p-2 h-fit max-h-[calc(100dvh-330px)] overflow-y-auto">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
            팀 · 직무 분류
          </div>
          <button
            onClick={() => {
              setSelTeam(null);
              setSelJob(null);
            }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] font-semibold ${
              !selTeam ? 'bg-[#eee6ff] text-[#2a2640]' : 'text-slate-900 hover:bg-[#f8f0ff]'
            }`}
          >
            <span className="flex-1 text-left">전체</span>
            <span className="text-[11px] text-slate-500">{entries.length}</span>
          </button>
          <div className="mt-1 space-y-0.5">
            {tree.map((t) => {
              const isOpen = openTeams.has(t.team) || selTeam === t.team;
              const active = selTeam === t.team && !selJob;
              return (
                <div key={t.team}>
                  <button
                    onClick={() => {
                      setSelTeam(t.team);
                      setSelJob(null);
                      setOpenTeams((p) => {
                        const n = new Set(p);
                        if (n.has(t.team)) n.delete(t.team);
                        else n.add(t.team);
                        return n;
                      });
                    }}
                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[12px] ${
                      active
                        ? 'bg-[#eee6ff] text-[#2a2640] font-semibold'
                        : 'text-slate-900 hover:bg-[#f8f0ff]'
                    }`}
                  >
                    <span className="text-slate-400 w-2 text-[10px]">{isOpen ? '▾' : '▸'}</span>
                    <span
                      className={`flex-1 text-left truncate ${
                        t.team === UNCLASSIFIED ? 'text-slate-500 italic' : ''
                      }`}
                    >
                      {t.team}
                    </span>
                    <span className="text-[11px] text-slate-500">{t.total}</span>
                  </button>
                  {isOpen && (
                    <div className="ml-4 border-l border-[#e9e4f7] pl-1.5 space-y-0.5">
                      {t.jobs.map((j) => {
                        const jActive = selTeam === t.team && selJob === j.job;
                        return (
                          <button
                            key={j.job}
                            onClick={() => {
                              setSelTeam(t.team);
                              setSelJob(j.job);
                            }}
                            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] ${
                              jActive
                                ? 'bg-[#e0d7ff] text-[#2a2640] font-semibold'
                                : 'text-slate-700 hover:bg-[#f8f0ff]'
                            }`}
                          >
                            <span
                              className={`flex-1 text-left truncate ${
                                j.job === UNCLASSIFIED ? 'text-slate-400 italic' : ''
                              }`}
                            >
                              {j.job}
                            </span>
                            <span className="text-[10px] text-slate-400">{j.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {tree.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-slate-400">아직 분류가 없습니다</div>
            )}
          </div>
        </aside>

        {/* 오른쪽 — 검색/목록 */}
        <div className="space-y-2.5 min-w-0">
          <div className="card p-3 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름 · 파일명 · 메모 검색"
              className="flex-1 min-w-[160px] px-3 py-1.5 rounded-xl border border-[#dfd7f9] text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#a49dbe]"
            />
            <div className="flex rounded-xl overflow-hidden border border-[#dfd7f9]">
              {(
                [
                  ['recent', '최근순'],
                  ['name', '이름순'],
                  ['most', '지원 많은순'],
                ] as [SortKey, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`px-3 py-1.5 text-[12px] font-semibold ${
                    sort === k ? 'bg-[#2a2640] text-white' : 'bg-white text-slate-900 hover:bg-[#f8f0ff]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setOnlyReapply((v) => !v)}
              className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border ${
                onlyReapply
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-white border-[#dfd7f9] text-slate-500'
              }`}
            >
              {onlyReapply ? '☑' : '☐'} 재지원자만
            </button>
            <button className="btn text-[12px]" onClick={() => void api.resumes.reveal()}>
              📁 폴더
            </button>
            {driveUrl && (
              <a className="btn text-[12px]" href={driveUrl} target="_blank" rel="noreferrer">
                ☁ 드라이브
              </a>
            )}
            <button
              className="btn text-[12px]"
              onClick={async () => {
                setBusy('드라이브 백업 중…');
                await api.resumes.backup();
                setBusy(null);
                void refresh();
              }}
            >
              ↻ 백업
            </button>
          </div>

          {/* 선택 경로 + 일괄 분류 */}
          {(selTeam || picked.size > 0) && (
            <div className="card p-3 flex flex-wrap items-center gap-2">
              {selTeam && (
                <span className="text-[12px] text-slate-900">
                  <b>{selTeam}</b>
                  {selJob ? ` › ${selJob}` : ''}{' '}
                  <span className="text-slate-500">({filtered.length}건)</span>
                  <button
                    className="ml-2 text-[11px] text-slate-500 underline"
                    onClick={() => {
                      setSelTeam(null);
                      setSelJob(null);
                    }}
                  >
                    필터 해제
                  </button>
                </span>
              )}
              {picked.size > 0 && (
                <>
                  <div className="flex-1" />
                  <span className="text-[12px] font-semibold text-violet-800">
                    {picked.size}건 선택됨 →
                  </span>
                  <input
                    list="rv-teams"
                    value={bulk.team}
                    onChange={(e) => setBulk({ ...bulk, team: e.target.value })}
                    placeholder="팀 지정"
                    className="w-[130px] px-2 py-1 rounded-lg border border-[#dfd7f9] text-[12px] text-slate-900"
                  />
                  <input
                    list="rv-jobs"
                    value={bulk.job}
                    onChange={(e) => setBulk({ ...bulk, job: e.target.value })}
                    placeholder="직무 지정"
                    className="w-[130px] px-2 py-1 rounded-lg border border-[#dfd7f9] text-[12px] text-slate-900"
                  />
                  <button className="btn btn-primary text-[12px]" onClick={applyBulk}>
                    적용
                  </button>
                  <button className="btn text-[12px]" onClick={() => setPicked(new Set())}>
                    선택 해제
                  </button>
                </>
              )}
            </div>
          )}

          {err && <div className="card p-3 text-[12px] text-rose-700">⚠ {err}</div>}

          <div className="space-y-2.5 max-h-[calc(100dvh-430px)] overflow-y-auto pr-1">
            {loading && (
              <div className="card p-8 text-center text-slate-500 text-sm">불러오는 중…</div>
            )}
            {!loading && groups.length === 0 && (
              <div className="card p-10 text-center text-slate-500 text-sm">
                {entries.length === 0
                  ? '아직 보관된 이력서가 없습니다. 파일을 끌어다 놓아 시작하세요.'
                  : '조건에 맞는 이력서가 없습니다.'}
              </div>
            )}
            {groups.map((g) => (
              <CandidateCard
                key={g.name}
                group={g}
                expanded={open.has(g.name)}
                picked={picked}
                onPick={(id, on) =>
                  setPicked((prev) => {
                    const n = new Set(prev);
                    if (on) n.add(id);
                    else n.delete(id);
                    return n;
                  })
                }
                onToggle={() =>
                  setOpen((prev) => {
                    const n = new Set(prev);
                    if (n.has(g.name)) n.delete(g.name);
                    else n.add(g.name);
                    return n;
                  })
                }
                onChanged={refresh}
              />
            ))}
          </div>

          {(stats.unclassified > 0 || stats.unknownName > 0) && (
            <div className="text-[11px] text-slate-500 px-1">
              ※ 팀/직무가 비어 있는 항목 {stats.unclassified}건
              {stats.unknownName > 0 && `, 이름을 못 읽은 항목 ${stats.unknownName}건`} — 카드를 펼쳐
              체크한 뒤 위에서 일괄 지정할 수 있습니다.
            </div>
          )}
        </div>
      </div>

      {/* 팀/직무 자동완성 목록 */}
      <datalist id="rv-teams">
        {suggestTeams.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="rv-jobs">
        {suggestJobs.map((j) => (
          <option key={j} value={j} />
        ))}
      </datalist>
    </div>
  );
}

// ── 조각 컴포넌트 ──────────────────────────────────────────────────────────

function Stat({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: string }) {
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 leading-tight truncate">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>
        {value}
        {unit && <span className="text-[12px] font-semibold ml-0.5 text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

interface Group {
  name: string;
  items: ResumeEntry[];
  teams: string[];
  jobs: string[];
  latest: string;
  totalOfPerson: number;
  reapply: boolean;
  crossTeam: boolean;
}

function CandidateCard({
  group,
  expanded,
  picked,
  onPick,
  onToggle,
  onChanged,
}: {
  group: Group;
  expanded: boolean;
  picked: Set<string>;
  onPick: (id: string, on: boolean) => void;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <section className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-[#faf7ff] transition-colors flex-wrap"
      >
        <span className="text-slate-400 text-[12px] w-3">{expanded ? '▾' : '▸'}</span>
        <span className="text-[15px] font-bold text-slate-900">{group.name}</span>
        {group.teams.map((t) => (
          <span key={t} className="chip bg-slate-100 text-slate-800">
            {t}
          </span>
        ))}
        {group.jobs.slice(0, 3).map((j) => (
          <span key={j} className="chip bg-violet-50 text-violet-800">
            {j}
          </span>
        ))}
        {group.reapply && (
          <span className="chip bg-amber-100 text-amber-800 font-bold">
            🔁 재지원 {group.totalOfPerson}회
          </span>
        )}
        {group.crossTeam && <span className="chip bg-rose-50 text-rose-700">타 부서 지원</span>}
        <div className="flex-1" />
        <span className="text-[11px] text-slate-500">최근 {fmtDate(group.latest)}</span>
        <span className="text-[11px] text-slate-400">{group.items.length}개 파일</span>
      </button>
      {expanded && (
        <div className="border-t px-3 py-2 space-y-2" style={{ borderColor: 'var(--cc-p8)' }}>
          {group.items.map((e) => (
            <ResumeRow
              key={e.id}
              entry={e}
              picked={picked.has(e.id)}
              onPick={onPick}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ResumeRow({
  entry,
  picked,
  onPick,
  onChanged,
}: {
  entry: ResumeEntry;
  picked: boolean;
  onPick: (id: string, on: boolean) => void;
  onChanged: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    candidate: entry.candidate,
    team: entry.team,
    job: entry.job,
    channel: entry.channel,
    appliedAt: entry.appliedAt,
    note: entry.note,
  });
  const [saving, setSaving] = useState(false);
  const canPreview = PREVIEWABLE.test(entry.mimeType);

  // 미리보기 — 로컬 파일을 base64로 받아 Blob URL로 iframe에 띄운다 (새 창 금지)
  useEffect(() => {
    let cancelled = false;
    if (preview && canPreview && !blobUrl) {
      (async () => {
        const r = await api.resumes.read(entry.id);
        if (!r.ok || !r.data || cancelled) return;
        const res = await fetch(`data:${r.data.mimeType};base64,${r.data.base64}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(url);
        else URL.revokeObjectURL(url);
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [preview, canPreview, blobUrl, entry.id]);

  useEffect(
    () => () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl]
  );

  const save = async () => {
    setSaving(true);
    await api.resumes.update(entry.id, draft);
    setSaving(false);
    setEditing(false);
    onChanged();
  };

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: 'var(--cc-p8)' }}>
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        <input
          type="checkbox"
          checked={picked}
          onChange={(e) => onPick(entry.id, e.target.checked)}
          className="w-3.5 h-3.5 accent-violet-600"
          title="선택해서 팀/직무 일괄 지정"
        />
        <span className="text-[12px]">{entry.mimeType === 'application/pdf' ? '📄' : '📎'}</span>
        <span
          className="text-[12px] font-semibold text-slate-900 truncate max-w-[300px]"
          title={entry.filename}
        >
          {entry.filename}
        </span>
        {entry.team ? (
          <span className="chip bg-slate-100 text-slate-800">{entry.team}</span>
        ) : (
          <span className="chip bg-rose-50 text-rose-600">팀 미지정</span>
        )}
        {entry.job ? (
          <span className="chip bg-violet-50 text-violet-800">{entry.job}</span>
        ) : (
          <span className="chip bg-slate-50 text-slate-400">직무 미지정</span>
        )}
        <span className="text-[11px] text-slate-500">{fmtDate(entry.addedAt)}</span>
        <span className="text-[11px] text-slate-400">{fmtBytes(entry.size)}</span>
        {entry.driveFileId ? (
          <span className="chip bg-emerald-50 text-emerald-700">☁ 백업됨</span>
        ) : (
          <span className="chip bg-slate-100 text-slate-500" title={entry.driveError || ''}>
            ☁ 백업 대기
          </span>
        )}
        <div className="flex-1" />
        {canPreview && (
          <button className="btn text-[11px]" onClick={() => setPreview((v) => !v)}>
            {preview ? '미리보기 닫기' : '미리보기'}
          </button>
        )}
        <button className="btn text-[11px]" onClick={() => void api.resumes.open(entry.id)}>
          열기
        </button>
        <button className="btn text-[11px]" onClick={() => setEditing((v) => !v)}>
          {editing ? '취소' : '정보 편집'}
        </button>
        <button
          className="btn text-[11px] text-rose-600"
          onClick={async () => {
            if (
              !confirm(`"${entry.filename}" 을(를) 보관함에서 삭제할까요? (로컬+드라이브 사본 모두 삭제)`)
            )
              return;
            await api.resumes.remove(entry.id);
            onChanged();
          }}
        >
          삭제
        </button>
      </div>

      {(entry.channel || entry.note || entry.appliedAt) && !editing && (
        <div className="px-3 pb-2 text-[11px] text-slate-600 flex flex-wrap gap-x-3">
          {entry.channel && <span>경로: {entry.channel}</span>}
          {entry.appliedAt && <span>지원일: {entry.appliedAt}</span>}
          {entry.note && <span>메모: {entry.note}</span>}
        </div>
      )}

      {editing && (
        <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-3 gap-2">
          {(
            [
              ['candidate', '이름', ''],
              ['team', '팀', 'rv-teams'],
              ['job', '직무', 'rv-jobs'],
              ['channel', '지원 경로', ''],
              ['appliedAt', '지원일', ''],
              ['note', '메모', ''],
            ] as [keyof typeof draft, string, string][]
          ).map(([k, label, list]) => (
            <label key={k} className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
              <input
                list={list || undefined}
                value={draft[k]}
                onChange={(ev) => setDraft({ ...draft, [k]: ev.target.value })}
                className="w-full mt-0.5 px-2 py-1 rounded-lg border border-[#dfd7f9] text-[12px] text-slate-900 outline-none focus:border-[#a49dbe]"
              />
            </label>
          ))}
          <div className="col-span-2 md:col-span-3 flex justify-end">
            <button className="btn btn-primary text-[12px]" onClick={save} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}

      {preview && canPreview && (
        <div className="px-3 pb-3">
          {blobUrl ? (
            <iframe
              src={blobUrl}
              title={entry.filename}
              className="w-full rounded-lg border"
              style={{ height: 620, borderColor: 'var(--cc-p8)' }}
            />
          ) : (
            <div className="text-[12px] text-slate-500 py-6 text-center">미리보기 준비 중…</div>
          )}
        </div>
      )}
    </div>
  );
}
