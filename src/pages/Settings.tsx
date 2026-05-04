import { useEffect, useState, useCallback } from 'react';
import { api, type GoogleStatus } from '../lib/api';
import {
  TAB_KIND_LABELS,
  type TabKind,
  type SheetMappings,
  suggestKind,
} from '../lib/sheetMapping';
import { setMappings, useLiveData, refreshNow, exportSnapshotData } from '../store/liveData';
import { buildSnapshot, downloadSnapshot } from '../lib/snapshot';

interface SheetEntry {
  spreadsheetId: string;
  url: string;
  title?: string;
  tabs?: { title: string; sheetId: number }[];
  loading?: boolean;
  error?: string;
}

const KIND_OPTIONS: TabKind[] = [
  'office_headcount',
  'incoming',
  'recruit_request',
  'office_pipeline',
  'office_interview',
  'field_pipeline',
  'field_incoming',
  'weekly_log',
];

export function Settings() {
  const live = useLiveData();
  const [gStatus, setGStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [gClientId, setGClientId] = useState('');
  const [gClientSecret, setGClientSecret] = useState('');

  const [sheets, setSheets] = useState<SheetEntry[]>([]);
  const [newSheetUrl, setNewSheetUrl] = useState('');

  const [mappingsLocal, setMappingsLocal] = useState<SheetMappings>({});

  const refresh = useCallback(async () => {
    setError(null);
    const g = await api.google.status();
    if (g.ok) setGStatus(g.data!);

    const ids = await api.cfg.get<{ list?: SheetEntry[]; recruit?: string; headcount?: string; mail?: string }>('sheetIds');
    if (ids.ok && ids.data) {
      const list: SheetEntry[] = [];
      if (Array.isArray((ids.data as any).list)) list.push(...((ids.data as any).list as SheetEntry[]));
      const legacyKeys: ('recruit' | 'headcount' | 'mail')[] = ['recruit', 'headcount', 'mail'];
      for (const k of legacyKeys) {
        const v = (ids.data as any)[k];
        if (v && !list.find((s) => s.spreadsheetId === v)) list.push({ spreadsheetId: v, url: v });
      }
      setSheets(list);
    }

    const m = await api.cfg.get<SheetMappings>('sheetMappings');
    if (m.ok && m.data) setMappingsLocal(m.data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const flash = (msg: string) => {
    setInfo(msg);
    setTimeout(() => setInfo(null), 3000);
  };

  const handleSaveGoogleCreds = async () => {
    setBusy(true);
    const r = await api.google.setCreds({ clientId: gClientId.trim(), clientSecret: gClientSecret.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Failed');
    flash('Client 저장 완료. 이제 [Google 로그인]');
    setGClientId('');
    setGClientSecret('');
    refresh();
  };
  const handleGoogleLogin = async () => {
    setBusy(true);
    const r = await api.google.startAuth();
    setBusy(false);
    if (!r.ok) return setError(`인증 실패: ${r.error}`);
    flash('Google 인증 완료');
    refresh();
  };
  const addSheet = async () => {
    const id = extractSheetId(newSheetUrl);
    if (!id) return setError('올바른 시트 URL이 아닙니다');
    if (sheets.find((s) => s.spreadsheetId === id)) return setError('이미 추가된 시트');
    const next = [...sheets, { spreadsheetId: id, url: newSheetUrl, loading: true }];
    setSheets(next);
    setNewSheetUrl('');
    await loadSheetMeta(id);
    await persistSheets(next);
  };
  const removeSheet = async (id: string) => {
    const next = sheets.filter((s) => s.spreadsheetId !== id);
    setSheets(next);
    const cleanedMap: SheetMappings = {};
    (Object.keys(mappingsLocal) as TabKind[]).forEach((k) => {
      const arr = (mappingsLocal[k] || []).filter((e) => e.spreadsheetId !== id);
      if (arr.length) cleanedMap[k] = arr;
    });
    setMappingsLocal(cleanedMap);
    await setMappings(cleanedMap);
    await persistSheets(next);
    await api.sync.stop(id);
  };
  const persistSheets = async (list: SheetEntry[]) => {
    await api.cfg.set('sheetIds', { list: list.map(({ loading, error, ...rest }) => rest) });
  };
  const loadSheetMeta = async (id: string) => {
    const r = await api.google.listSheetTabs(id);
    setSheets((cur) =>
      cur.map((s) => {
        if (s.spreadsheetId !== id) return s;
        if (!r.ok) return { ...s, loading: false, error: r.error };
        return { ...s, loading: false, title: r.data!.title, tabs: r.data!.tabs, error: undefined };
      })
    );
    if (r.ok) await api.sync.start(id);
  };

  const autoMap = () => {
    const newMap: SheetMappings = { ...mappingsLocal };
    for (const sheet of sheets) {
      if (!sheet.tabs) continue;
      for (const tab of sheet.tabs) {
        const kind = suggestKind(tab.title);
        if (!kind) continue;
        const list = newMap[kind] || [];
        if (list.some((e) => e.spreadsheetId === sheet.spreadsheetId && e.tabName === tab.title)) continue;
        list.push({ spreadsheetId: sheet.spreadsheetId, tabName: tab.title, headerRow: 0 });
        newMap[kind] = list;
      }
    }
    setMappingsLocal(newMap);
    flash('탭 자동 매핑 완료. [매핑 저장]을 누르세요.');
  };

  const setKindForTab = (spreadsheetId: string, tabName: string, kind: TabKind | '') => {
    const next: SheetMappings = { ...mappingsLocal };
    for (const k of Object.keys(next) as TabKind[]) {
      next[k] = (next[k] || []).filter((e) => !(e.spreadsheetId === spreadsheetId && e.tabName === tabName));
      if (next[k]?.length === 0) delete next[k];
    }
    if (kind) {
      next[kind] = [...(next[kind] || []), { spreadsheetId, tabName, headerRow: 0 }];
    }
    setMappingsLocal(next);
  };

  const getKindForTab = (spreadsheetId: string, tabName: string): TabKind | '' => {
    for (const k of Object.keys(mappingsLocal) as TabKind[]) {
      if ((mappingsLocal[k] || []).some((e) => e.spreadsheetId === spreadsheetId && e.tabName === tabName)) return k;
    }
    return '';
  };

  const saveMappings = async () => {
    await setMappings(mappingsLocal);
    flash('매핑 저장 완료. 자동 동기화 시작.');
    await refreshNow();
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {error && <Banner kind="err" msg={error} onClose={() => setError(null)} />}
      {info && <Banner kind="ok" msg={info} />}

      {live.lastError && <Banner kind="warn" msg={`동기화 경고: ${live.lastError}`} />}

      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="text-2xl">🔑</span> Google 연동 (읽기 전용)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Sheets · Gmail · Calendar는 모두 <b className="text-accent-green">읽기 전용</b> 권한으로만 접근. 시트는 절대 앱이 수정하지 않습니다.
            </p>
          </div>
          <StatusPill ok={gStatus?.authed} label={gStatus?.authed ? gStatus.profile?.email || '연결됨' : '연결 안 됨'} />
        </div>

        {!gStatus?.hasClient && (
          <div className="space-y-2">
            <input value={gClientId} onChange={(e) => setGClientId(e.target.value)} placeholder="Client ID (xxx.apps.googleusercontent.com)" className="input w-full" />
            <input value={gClientSecret} onChange={(e) => setGClientSecret(e.target.value)} placeholder="Client Secret" type="password" className="input w-full" />
            <button className="btn btn-primary" disabled={busy || !gClientId || !gClientSecret} onClick={handleSaveGoogleCreds}>저장</button>
          </div>
        )}
        {gStatus?.hasClient && !gStatus.authed && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Client 설정됨. Google 계정으로 로그인하세요.</span>
            <button className="btn btn-primary ml-auto" disabled={busy} onClick={handleGoogleLogin}>{busy ? '인증 중...' : '🔐 Google 로그인'}</button>
            <button className="btn" disabled={busy} onClick={async () => { await api.google.clearCreds(); refresh(); }}>Client 재입력</button>
          </div>
        )}
        {gStatus?.authed && (
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1">
              <div className="text-slate-700">{gStatus.profile?.email}</div>
              <div className="text-xs text-slate-500">읽기 전용 — Sheets · Drive(메타) · Gmail · Calendar</div>
            </div>
            <button className="btn" onClick={async () => { await api.google.signOut(); refresh(); }}>로그아웃</button>
            <button className="btn" onClick={async () => { await api.google.clearCreds(); refresh(); }}>Client 재설정</button>
          </div>
        )}
      </section>

      {gStatus?.authed && (
        <section className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="text-2xl">📊</span> Google Sheets — 라이브 동기화
            </h2>
            <div className="flex items-center gap-2">
              <SyncIndicator />
              <button className="btn" onClick={() => refreshNow()}>🔄 즉시 새로고침</button>
            </div>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            여러 시트를 추가하고, 각 시트의 탭을 앱 카테고리에 매핑하세요. 변경사항은 자동 감지되어 ~10초 내 반영됩니다.
          </p>

          <div className="flex gap-2 mb-4">
            <input value={newSheetUrl} onChange={(e) => setNewSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="input flex-1" />
            <button className="btn btn-primary" onClick={addSheet} disabled={!newSheetUrl}>+ 시트 추가</button>
          </div>

          {sheets.length === 0 && <div className="text-center py-8 text-slate-500 text-sm">아직 추가된 시트가 없습니다</div>}

          <div className="space-y-3">
            {sheets.map((s) => (
              <div key={s.spreadsheetId} className="rounded-xl border border-bg-line overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-deep/50">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.title || s.spreadsheetId}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{s.spreadsheetId}</div>
                  </div>
                  {s.loading && <span className="text-xs text-slate-400">불러오는 중...</span>}
                  {s.error && <span className="text-xs text-accent-red">⚠ {s.error}</span>}
                  <button className="btn text-xs" onClick={() => loadSheetMeta(s.spreadsheetId)}>새로고침</button>
                  <button className="btn text-xs text-accent-red" onClick={() => removeSheet(s.spreadsheetId)}>삭제</button>
                </div>
                {s.tabs && (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="table-head text-left">탭 이름</th>
                          <th className="table-head text-left">앱 카테고리 매핑</th>
                          <th className="table-head text-left">자동 추천</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.tabs.map((tab) => {
                          const cur = getKindForTab(s.spreadsheetId, tab.title);
                          const sug = suggestKind(tab.title);
                          return (
                            <tr key={tab.sheetId} className="hover:bg-bg-hover/30">
                              <td className="table-cell font-medium">{tab.title}</td>
                              <td className="table-cell">
                                <select
                                  value={cur}
                                  onChange={(e) => setKindForTab(s.spreadsheetId, tab.title, e.target.value as TabKind | '')}
                                  className="bg-bg-deep border border-bg-line rounded px-2 py-1 text-xs"
                                >
                                  <option value="">— 사용 안 함 —</option>
                                  {KIND_OPTIONS.map((k) => (
                                    <option key={k} value={k}>{TAB_KIND_LABELS[k]}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="table-cell text-xs">
                                {sug ? (
                                  <button
                                    className="text-accent-purple hover:underline"
                                    onClick={() => setKindForTab(s.spreadsheetId, tab.title, sug)}
                                  >
                                    {TAB_KIND_LABELS[sug]} 적용
                                  </button>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>

          {sheets.some((s) => s.tabs) && (
            <div className="mt-4 flex items-center gap-2">
              <button className="btn" onClick={autoMap}>✨ 모든 탭 자동 매핑</button>
              <button className="btn btn-primary ml-auto" onClick={saveMappings}>매핑 저장 + 동기화 시작</button>
            </div>
          )}
        </section>
      )}

      {gStatus?.authed && (
        <GithubDeploySection
          live={live}
          gStatus={gStatus}
          flash={flash}
          setError={setError}
        />
      )}

    </div>
  );
}

function GithubDeploySection({
  live,
  gStatus,
  flash,
  setError,
}: {
  live: ReturnType<typeof useLiveData>;
  gStatus: GoogleStatus | null;
  flash: (msg: string) => void;
  setError: (msg: string | null) => void;
}) {
  const [secrets, setSecrets] = useState<{
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    sheetsConfig: { sheetIds: string[]; mappings: Record<string, unknown> };
  } | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);

  const loadSecrets = async () => {
    const r = await api.google.revealSecrets();
    if (!r.ok) return setError(r.error || '시크릿 조회 실패');
    setSecrets(r.data!);
    setShowSecrets(true);
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${label} 복사됨`);
    } catch {
      flash('복사 실패 — 수동으로 선택해서 복사하세요');
    }
  };

  return (
    <section className="card p-5 border-accent-blue/30 bg-gradient-to-br from-accent-blue/8 via-transparent to-accent-purple/8">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-2xl">🌐</span> 팀 배포 — 24/7 자동 동기화
            <span className="chip bg-accent-green/20 text-accent-green text-[10px]">서버 무관</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            GitHub Actions가 5분마다 본인 OAuth로 시트를 읽어서 정적 사이트 갱신. 본인 PC가 꺼져있어도 팀원이 항상 최신 데이터 봅니다.
          </p>
        </div>
        <span className="chip bg-accent-purple/15 text-accent-purple">완전 자동</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-2 mb-4">
        <Step n={1} label="GitHub repo 만들기" desc="github.com에서 비공개 repo 1개 생성. 이 폴더 코드 push." />
        <Step n={2} label="아래 시크릿 4개 복사" desc="repo > Settings > Secrets and variables > Actions" />
        <Step n={3} label="Pages 활성화 + URL 공유" desc="Settings > Pages > Source: gh-pages 브랜치" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          className="btn btn-primary"
          disabled={!live.hasLive}
          onClick={loadSecrets}
        >
          🔑 GitHub Secrets 4개 한 번에 추출
        </button>
        <button
          className="btn"
          disabled={!live.hasLive}
          onClick={() => {
            const data = exportSnapshotData();
            const snap = buildSnapshot({
              sheets: data.sheets,
              mappings: data.mappings,
              exportedBy: gStatus?.profile?.email,
            });
            downloadSnapshot(snap);
            flash('snapshot.json 다운로드 완료 (수동 배포용)');
          }}
        >
          📤 snapshot.json 수동 다운로드
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {live.hasLive ? '시트 연결됨 ✓' : '시트 연결 후 사용 가능'}
        </span>
      </div>

      {showSecrets && secrets && (
        <div className="mt-3 space-y-2 p-4 rounded-xl border border-accent-yellow/40 bg-accent-yellow/5">
          <div className="text-xs text-accent-yellow flex items-center gap-1.5 font-medium">
            ⚠ 한 번만 보이는 민감 정보 — 4개 모두 GitHub repo의 [Secrets and variables → Actions]에 추가
          </div>
          <SecretRow name="GOOGLE_CLIENT_ID" value={secrets.clientId} copy={copy} />
          <SecretRow name="GOOGLE_CLIENT_SECRET" value={secrets.clientSecret} copy={copy} masked />
          <SecretRow name="GOOGLE_REFRESH_TOKEN" value={secrets.refreshToken} copy={copy} masked />
          <SecretRow
            name="SHEETS_CONFIG"
            value={JSON.stringify(secrets.sheetsConfig)}
            copy={copy}
            multiline
          />
          <button className="text-xs text-slate-400 hover:text-white" onClick={() => setShowSecrets(false)}>
            ✕ 숨기기
          </button>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-accent-blue hover:underline font-medium">
          📘 풀 셋업 가이드 (5분, 펼쳐 보기)
        </summary>
        <div className="mt-3 ml-2 space-y-3 text-[12.5px] text-slate-600 leading-relaxed">
          <div>
            <div className="font-medium text-slate-800 mb-1">1) GitHub repo 만들기</div>
            <ol className="ml-4 space-y-0.5 list-decimal text-slate-400">
              <li><a href="https://github.com/new" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">github.com/new</a> → repo 이름 자유롭게 (예: <code>cnc-recruit</code>) → Private 권장 → Create</li>
              <li>이 프로젝트 폴더에서 <code>git init && git remote add origin [repo-url]</code> 후 <code>git push -u origin main</code></li>
            </ol>
          </div>
          <div>
            <div className="font-medium text-slate-800 mb-1">2) Secrets 4개 등록</div>
            <ol className="ml-4 space-y-0.5 list-decimal text-slate-400">
              <li>위 [🔑 한 번에 추출] 클릭 → 각각의 [복사] 버튼으로 복사</li>
              <li>repo → Settings → Secrets and variables → Actions → New repository secret</li>
              <li>아래 4개 이름 그대로 등록: <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_REFRESH_TOKEN</code>, <code>SHEETS_CONFIG</code></li>
            </ol>
          </div>
          <div>
            <div className="font-medium text-slate-800 mb-1">3) Workflows 자동 실행</div>
            <ol className="ml-4 space-y-0.5 list-decimal text-slate-400">
              <li>Push만 해도 <code>.github/workflows/deploy.yml</code>이 실행됨 → viewer 빌드 + gh-pages 배포</li>
              <li><code>sync.yml</code>은 5분마다 자동 실행 → snapshot.json 갱신</li>
              <li>Actions 탭에서 진행 상황 확인 가능 (첫 실행은 [Run workflow] 수동 트리거 추천)</li>
            </ol>
          </div>
          <div>
            <div className="font-medium text-slate-800 mb-1">4) GitHub Pages 활성화</div>
            <ol className="ml-4 space-y-0.5 list-decimal text-slate-400">
              <li>repo → Settings → Pages → Source: <b>Deploy from a branch</b></li>
              <li>Branch: <code>gh-pages</code> · Folder: <code>/ (root)</code> → Save</li>
              <li>1-2분 기다리면 URL 표시됨 (<code>https://[ID].github.io/[repo]/</code>) → 팀에 공유</li>
            </ol>
          </div>
          <div className="px-3 py-2 rounded-lg border border-accent-green/30 bg-accent-green/5 text-[12px]">
            ✓ 셋업 완료 후엔 본인 PC와 무관하게 5분마다 자동 갱신됩니다. 본 앱(Electron)은 본인이 시트 매핑 변경 / 직접 편집할 때만 사용.
          </div>
        </div>
      </details>
    </section>
  );
}

function Step({ n, label, desc }: { n: number; label: string; desc: string }) {
  return (
    <div className="rounded-xl border border-bg-line bg-bg-deep/40 p-3 flex gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-accent-purple/20 text-accent-purple text-sm font-bold grid place-items-center">
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-slate-800">{label}</div>
        <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function SecretRow({
  name,
  value,
  copy,
  masked,
  multiline,
}: {
  name: string;
  value: string | null;
  copy: (text: string, label: string) => void;
  masked?: boolean;
  multiline?: boolean;
}) {
  const [revealed, setRevealed] = useState(!masked);
  const display = !value ? '(비어있음 — 본체에 데이터가 아직 없어요)' : revealed ? value : '••••••••••••••••••••••';
  return (
    <div className="rounded-lg border border-bg-line bg-bg-deep/60 p-2">
      <div className="flex items-center gap-2 mb-1">
        <code className="text-[11px] text-accent-purple font-medium">{name}</code>
        <div className="ml-auto flex items-center gap-1">
          {masked && (
            <button
              onClick={() => setRevealed((v) => !v)}
              className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded border border-bg-line"
            >
              {revealed ? '숨김' : '보기'}
            </button>
          )}
          <button
            disabled={!value}
            onClick={() => value && copy(value, name)}
            className="text-[10px] text-accent-blue hover:underline px-1.5 py-0.5 rounded border border-accent-blue/30 disabled:opacity-30"
          >
            복사
          </button>
        </div>
      </div>
      <div
        className={`font-mono text-[11px] text-slate-600 break-all ${
          multiline ? 'whitespace-pre-wrap max-h-24 overflow-y-auto' : 'truncate'
        }`}
      >
        {display}
      </div>
    </div>
  );
}

function Banner({ kind, msg, onClose }: { kind: 'err' | 'ok' | 'warn'; msg: string; onClose?: () => void }) {
  const cls =
    kind === 'err'
      ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
      : kind === 'warn'
      ? 'border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow'
      : 'border-accent-green/40 bg-accent-green/10 text-accent-green';
  const ico = kind === 'err' ? '⚠' : kind === 'warn' ? '⚠' : '✓';
  return (
    <div className={`card p-3 text-sm ${cls} flex items-center gap-2`}>
      <span>{ico}</span>
      <span className="flex-1">{msg}</span>
      {onClose && <button onClick={onClose} className="text-slate-400 hover:text-white text-xs">닫기</button>}
    </div>
  );
}

function StatusPill({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span className={`chip ${ok ? 'bg-accent-green/15 text-accent-green' : 'bg-slate-500/15 text-slate-400'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-accent-green animate-pulse' : 'bg-slate-500'}`} />
      {label}
    </span>
  );
}

function SyncIndicator() {
  const live = useLiveData();
  const ago = live.lastTickAt ? Math.round((Date.now() - live.lastTickAt) / 1000) : null;
  return (
    <span className="text-xs text-slate-400">
      {live.hasLive ? <span className="text-accent-green">● 라이브</span> : <span className="text-slate-500">● 대기</span>}
      {ago != null && <span className="ml-1.5">{ago < 60 ? `${ago}초 전` : `${Math.round(ago / 60)}분 전`}</span>}
    </span>
  );
}

function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return '';
}
