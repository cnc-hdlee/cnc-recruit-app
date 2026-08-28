import { useEffect, useState, useCallback } from 'react';
import { api, type GoogleStatus } from '../lib/api';
import {
  TAB_KIND_LABELS,
  type TabKind,
  type SheetMappings,
  suggestKind,
} from '../lib/sheetMapping';
import { setMappings, useLiveData, refreshNow } from '../store/liveData';
import { MobileAccessCard } from '../components/MobileAccessCard';
import { ResourceCalendarTidyCard } from '../components/ResourceCalendarTidyCard';

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
    flash('Google 인증 완료 — 시트 동기화 시작');
    // 로그인 직후 sync 엔진을 깨워 박혀있는 기본 시트들 즉시 가져오기 시작
    try { await refreshNow(true); } catch { /* ignore */ }
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
    await refreshNow(true);
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {error && <Banner kind="err" msg={error} onClose={() => setError(null)} />}
      {info && <Banner kind="ok" msg={info} />}

      {live.lastError && <Banner kind="warn" msg={`동기화 경고: ${live.lastError}`} />}

      <MobileAccessCard />

      {gStatus?.authed && <ResourceCalendarTidyCard />}

      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="text-2xl">🔑</span> Google 연동
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              <b className="text-accent-green">Sheets · Drive: 읽기 전용</b> (앱이 절대 수정 안 함) ·
              <b className="text-accent-green"> Gmail: 읽기 + 본인 발송용 send</b> ·
              <b className="text-accent-green"> Calendar: 읽기 + 쓰기</b> (면접/회의실 예약 자동화에 필요)
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
              <button className="btn" onClick={() => refreshNow(true)}>🔄 즉시 새로고침</button>
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
