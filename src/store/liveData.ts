// Live data store: subscribes to sync push events from Electron, exposes via React hook.
// Falls back to static D when not yet synced.

import { useSyncExternalStore } from 'react';
import { D as staticD } from '../data/initialData';
import { api } from '../lib/api';
import { rowsToObjects, suggestKind, type SheetMappings, type TabKind, type TabMappingEntry } from '../lib/sheetMapping';
import { IS_VIEWER, SNAPSHOT_URL } from '../lib/mode';
import { isSnapshot, type Snapshot, type SnapshotCalendarEvent } from '../lib/snapshot';
import { READ_CALENDAR_IDS } from '../lib/sharedCalendars';

interface SheetSnapshot {
  title: string;
  modifiedTime: string;
  tabs: Record<string, string[][]>;
}

interface PollState {
  spreadsheetId: string;
  polling: boolean;
  lastModified: string | null;
  hasCache: boolean;
}

interface LiveState {
  // raw snapshots keyed by spreadsheetId
  snapshots: Record<string, SheetSnapshot>;
  // configured mappings: kind -> [{spreadsheetId, tabName, headerRow}]
  mappings: SheetMappings;
  // calendar events from snapshot (viewer mode) — empty in maintainer mode for now
  calendarEvents: SnapshotCalendarEvent[];
  calendarFetchedAt: string | null;
  // last error
  lastError: string | null;
  // last sync tick wall-clock
  lastTickAt: number | null;
  // is at least one sheet loaded?
  hasLive: boolean;
  // pollers reported by main process
  pollStatus: PollState[];
}

let state: LiveState = {
  snapshots: {},
  mappings: {},
  calendarEvents: [],
  calendarFetchedAt: null,
  lastError: null,
  lastTickAt: null,
  hasLive: false,
  pollStatus: [],
};

const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getSnapshot = () => state;
const emit = () => listeners.forEach((l) => l());

function setState(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  emit();
}

let initialized = false;
let calendarPollHandle: ReturnType<typeof setInterval> | null = null;
let calendarFocusHandlersAttached = false;
const CALENDAR_POLL_MS = 60_000;

function setupCalendarAutoSync() {
  if (IS_VIEWER) return;
  if (typeof window === 'undefined') return;
  // 항상 재설정 — HMR 후에도 살아나게
  if (calendarPollHandle) clearInterval(calendarPollHandle);
  calendarPollHandle = setInterval(() => {
    void refreshCalendarFromGoogle().then(() => {
      // eslint-disable-next-line no-console
      console.debug('[calendar-poll] refreshed at', new Date().toLocaleTimeString());
    });
  }, CALENDAR_POLL_MS);
  // eslint-disable-next-line no-console
  console.info('[calendar-poll] interval armed (60s)');

  if (!calendarFocusHandlersAttached) {
    window.addEventListener('focus', () => {
      void refreshCalendarFromGoogle();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void refreshCalendarFromGoogle();
      }
    });
    calendarFocusHandlersAttached = true;
  }
}

export async function initLiveSync() {
  // Always (re-)setup calendar auto-sync, even on HMR repeat-calls
  setupCalendarAutoSync();
  if (initialized) {
    // 재진입(HMR) 시 즉시 한 번 더 fetch — 사용자가 새 이벤트 추가했을 가능성
    void refreshCalendarFromGoogle();
    return;
  }
  initialized = true;

  // Viewer mode: load snapshot.json from same-origin (or VITE_SNAPSHOT_URL).
  // No Electron, no OAuth, no Slack — just static read.
  if (IS_VIEWER) {
    try {
      const r = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
      if (!r.ok) {
        setState({ lastError: `스냅샷을 불러올 수 없어요 (${r.status}). 관리자에게 문의하세요.` });
        return;
      }
      const data = (await r.json()) as Snapshot;
      if (!isSnapshot(data)) {
        setState({ lastError: '스냅샷 형식이 올바르지 않습니다.' });
        return;
      }
      setState({
        snapshots: data.sheets,
        mappings: data.mappings,
        calendarEvents: data.calendar?.events || [],
        calendarFetchedAt: data.calendar?.fetchedAt || null,
        lastTickAt: new Date(data.exportedAt).getTime(),
        hasLive: Object.keys(data.sheets).length > 0,
        lastError: null,
      });
    } catch (e: any) {
      setState({ lastError: `스냅샷 로드 실패: ${e?.message || e}` });
    }
    return;
  }

  if (!api?.sync) return;

  // Load saved mappings
  const m = await api.cfg.get<SheetMappings>('sheetMappings');
  if (m.ok && m.data) setState({ mappings: m.data });

  // Subscribe to push events
  api.sync.onUpdate((payload: { spreadsheetId: string; title: string; modifiedTime: string; tabs: Record<string, string[][]> }) => {
    const snapshots = { ...state.snapshots, [payload.spreadsheetId]: { title: payload.title, modifiedTime: payload.modifiedTime, tabs: payload.tabs } };
    setState({ snapshots, lastTickAt: Date.now(), hasLive: true, lastError: null });
    // Auto-map any unmapped tabs (non-destructive: only fills in absent kinds)
    void autoFillMappings(payload.spreadsheetId, Object.keys(payload.tabs));
  });

  api.sync.onTick(() => setState({ lastTickAt: Date.now() }));

  api.sync.onError((payload: { spreadsheetId: string; error: string }) => {
    setState({ lastError: `${payload.spreadsheetId.slice(0, 8)}…: ${payload.error}` });
  });

  // Try to start syncing (will no-op if not authed yet)
  await api.sync.startAll();
  await refreshPollStatus();

  // ★ 캘린더 직접 fetch — 즉시 최신 일정 표시 (이후는 setupCalendarAutoSync가 60초마다)
  await refreshCalendarFromGoogle();
}

// 시트의 새 탭이 들어오면 매핑이 비어있는 kind에 한해 자동 추천을 적용한다.
// - 이미 사용자가 매핑한 탭은 건드리지 않음
// - 사용자가 의도적으로 "사용 안 함"으로 둔 탭도 건드리지 않음 (그 kind에 다른 탭이 매핑돼 있으면 skip)
async function autoFillMappings(spreadsheetId: string, tabNames: string[]) {
  if (IS_VIEWER || !api?.cfg) return;
  let nextMap: SheetMappings | null = null;
  for (const tabName of tabNames) {
    const kind = suggestKind(tabName);
    if (!kind) continue;
    const cur = (nextMap || state.mappings)[kind] || [];
    // 같은 (sheet,tab) 이미 매핑됐으면 skip
    if (cur.some((e) => e.spreadsheetId === spreadsheetId && e.tabName === tabName)) continue;
    // 동일 kind에 다른 sheet/tab이 이미 사용자 매핑돼 있으면 skip (겹치는 자동 매핑 방지)
    if (cur.length > 0) continue;
    nextMap = { ...(nextMap || state.mappings), [kind]: [...cur, { spreadsheetId, tabName, headerRow: 0 }] };
  }
  if (!nextMap) return;
  setState({ mappings: nextMap });
  try {
    await api.cfg.set('sheetMappings', nextMap);
  } catch {
    // non-fatal
  }
}

const CONFIDENTIAL_PATTERNS_CLIENT = [
  /볼트엑스/i,
  /이나영/,
  /서치펌|서치 ?폼|서치 ?펌/i,
  /비공개\s*(채용|면접|이력|후보)/,
  /\bC&D\b/i,
  /헤드헌팅|헤드 ?헌터/i,
];

function isConfidentialClient(summary: string, description: string, location: string): boolean {
  const haystack = `${summary} ${description} ${location}`;
  return CONFIDENTIAL_PATTERNS_CLIENT.some((re) => re.test(haystack));
}

export async function refreshCalendarFromGoogle() {
  if (IS_VIEWER) return; // viewer는 snapshot에서만 읽음
  if (!api?.google) return;
  try {
    const now = Date.now();
    const timeMin = new Date(now - 30 * 86400e3).toISOString();
    const timeMax = new Date(now + 90 * 86400e3).toISOString();
    // primary + 팀 공유 캘린더(면접/입사×2/퇴사) 병렬 fetch
    const results = await Promise.all(
      READ_CALENDAR_IDS.map(async (calId) => {
        try {
          const r = await api.google.listCalendar(timeMin, timeMax, calId);
          if (!r.ok || !r.data) return [];
          return r.data;
        } catch {
          return [];
        }
      })
    );
    // ID 기준 dedup — 같은 이벤트가 두 캘린더에 동시에 잡힐 일은 거의 없지만 안전망
    const seen = new Set<string>();
    const merged: typeof results[number] = [];
    for (const list of results) {
      for (const e of list) {
        if (!e.id || seen.has(e.id)) continue;
        seen.add(e.id);
        merged.push(e);
      }
    }
    // 비공개 채용은 클라이언트 단에서도 한 번 더 필터 (이중 안전망)
    const filtered = merged.filter(
      (e) => !isConfidentialClient(e.summary || '', e.description || '', e.location || '')
    );
    const events: SnapshotCalendarEvent[] = filtered.map((e) => ({
      id: e.id,
      summary: e.summary || '',
      description: e.description || '',
      location: e.location || '',
      colorId: e.colorId,
      allDay: e.allDay,
      start: e.start || null,
      end: e.end || null,
      timeZone: e.timeZone,
      htmlLink: e.htmlLink || null,
      attendees: (e.attendees || []).map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
        organizer: a.organizer,
        self: a.self,
      })),
      conferenceUrl: e.conferenceUrl,
      status: e.status || 'confirmed',
      updated: null,
    }));
    setState({ calendarEvents: events, calendarFetchedAt: new Date().toISOString() });
  } catch {
    // non-fatal
  }
}

// In maintainer mode, return current state as a portable snapshot for export.
export function exportSnapshotData(): { sheets: typeof state.snapshots; mappings: SheetMappings } {
  return { sheets: state.snapshots, mappings: state.mappings };
}

async function refreshPollStatus() {
  if (IS_VIEWER) return;
  if (!api?.sync) return;
  const r = await api.sync.status();
  if (r.ok && r.data) setState({ pollStatus: r.data });
}

export function useLiveData() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export async function setMappings(m: SheetMappings) {
  setState({ mappings: m });
  if (IS_VIEWER || !api?.cfg) return;
  await api.cfg.set('sheetMappings', m);
}

export async function refreshNow() {
  if (IS_VIEWER) {
    // re-fetch snapshot
    initialized = false;
    return initLiveSync();
  }
  if (!api?.sync) return;

  // First, kick the engine to (re-)start pollers from current config — handles legacy/mixed shapes.
  await api.sync.startAll();
  await refreshPollStatus();

  // Then immediately fetch from every known sheet (mappings + configured sheet list).
  const idsFromMappings = Object.values(state.mappings)
    .flat()
    .map((m) => m?.spreadsheetId)
    .filter(Boolean) as string[];
  const idsFromPollers = state.pollStatus.map((p) => p.spreadsheetId);
  const unique = Array.from(new Set([...idsFromMappings, ...idsFromPollers]));
  if (unique.length === 0) {
    setState({ lastError: '추가된 시트가 없습니다. 시트 URL을 먼저 추가하세요.' });
    return;
  }

  let anySuccess = false;
  for (const id of unique) {
    try {
      const r = await api.sync.fetchOnce(id);
      if (r.ok && r.data) {
        const snap: SheetSnapshot = { title: r.data.title, modifiedTime: r.data.modifiedTime, tabs: r.data.tabs };
        setState({ snapshots: { ...state.snapshots, [id]: snap }, hasLive: true, lastTickAt: Date.now(), lastError: null });
        anySuccess = true;
      } else if (!r.ok) {
        setState({ lastError: r.error || 'fetch failed' });
      }
    } catch (e: any) {
      setState({ lastError: e?.message || String(e) });
    }
  }
  if (anySuccess) await refreshPollStatus();
}

export { refreshPollStatus };

// ---------- Selectors ----------

function getMappingTabs(kind: TabKind): { entry: TabMappingEntry; rows: string[][] }[] {
  const entries = state.mappings[kind] || [];
  const out: { entry: TabMappingEntry; rows: string[][] }[] = [];
  for (const e of entries) {
    const snap = state.snapshots[e.spreadsheetId];
    if (!snap) continue;
    const rows = snap.tabs[e.tabName];
    if (rows) out.push({ entry: e, rows });
  }
  return out;
}

export function getMappingTabsPublic(kind: TabKind) {
  return getMappingTabs(kind);
}

export function liveByKindWithSource(kind: TabKind): { entry: TabMappingEntry; rows: Record<string, string>[]; sheetTitle: string }[] {
  return getMappingTabs(kind).map(({ entry, rows }) => {
    const snap = state.snapshots[entry.spreadsheetId];
    return {
      entry,
      rows: rowsToObjects(rows, entry.headerRow),
      sheetTitle: snap?.title || entry.spreadsheetId,
    };
  });
}

export function liveOfficeHeadcount(): Record<string, string>[] {
  const tabs = getMappingTabs('office_headcount');
  const merged: Record<string, string>[] = [];
  for (const { entry, rows } of tabs) {
    merged.push(...rowsToObjects(rows, entry.headerRow));
  }
  return merged;
}

export function liveByKind(kind: TabKind): Record<string, string>[] {
  const tabs = getMappingTabs(kind);
  const merged: Record<string, string>[] = [];
  for (const { entry, rows } of tabs) {
    merged.push(...rowsToObjects(rows, entry.headerRow));
  }
  return merged;
}

// 매핑이 없거나 비어있을 때 모든 스냅샷에서 suggestKind 패턴으로 탭을 찾아 데이터 반환.
// 사용자가 "입사예정자 시트 추가했는데 안 보임" 같은 상황을 자가 치유.
export function liveByKindOrScan(kind: TabKind): Record<string, string>[] {
  const mapped = liveByKind(kind);
  if (mapped.length > 0) return mapped;
  const merged: Record<string, string>[] = [];
  for (const snap of Object.values(state.snapshots)) {
    for (const [tabName, rows] of Object.entries(snap.tabs)) {
      if (suggestKind(tabName) !== kind) continue;
      merged.push(...rowsToObjects(rows, 0));
    }
  }
  return merged;
}

// Returns the live snapshot or null if not yet loaded.
export function liveSnapshotFor(spreadsheetId: string) {
  return state.snapshots[spreadsheetId] || null;
}

export function hasLive() {
  return state.hasLive;
}

export function staticFallback() {
  return staticD;
}

// ---------- Calendar event helpers ----------

export interface NormalizedCalEvent {
  id: string;
  dt: string; // YYYY-MM-DD
  tm: string; // HH:MM or '종일'
  title: string;
  kind: '면접' | '입사' | '퇴사' | '기타';
  location: string;
  attendees: string[];
  htmlLink: string | null;
  raw: SnapshotCalendarEvent;
}

function classifyEventKind(summary: string, colorId: string | null): NormalizedCalEvent['kind'] {
  const s = (summary || '').toLowerCase();
  // colorId=5 (banana 노란색) = 입사 컨벤션
  if (colorId === '5' || /입사/.test(summary)) return '입사';
  if (/퇴사|퇴직/.test(summary)) return '퇴사';
  if (/면접|interview/i.test(s) || /\d{1,2}:\d{2}\s*\//.test(summary)) return '면접';
  return '기타';
}

function isoToDateTime(iso: string | null): { dt: string; tm: string; allDay: boolean } {
  if (!iso) return { dt: '', tm: '종일', allDay: true };
  // YYYY-MM-DD (all-day)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { dt: iso, tm: '종일', allDay: true };
  // ISO datetime — Google Calendar always sends "...+09:00" for KST events.
  // Parse the offset directly so we display the wall-clock time the user saw in Calendar,
  // regardless of which timezone the machine is set to.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?$/.exec(iso);
  if (m) {
    return { dt: `${m[1]}-${m[2]}-${m[3]}`, tm: `${m[4]}:${m[5]}`, allDay: false };
  }
  // Fallback — let JS interpret in machine local time (KST for the user)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dt: '', tm: '종일', allDay: true };
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return { dt: `${yy}-${mm}-${dd}`, tm: `${hh}:${mi}`, allDay: false };
}

export function liveCalendarEventsNormalized(): NormalizedCalEvent[] {
  return state.calendarEvents.map((e) => {
    const { dt, tm } = isoToDateTime(e.start);
    return {
      id: e.id,
      dt,
      tm,
      title: e.summary,
      kind: classifyEventKind(e.summary, e.colorId),
      location: e.location,
      attendees: (e.attendees || []).map((a) => a.email).filter((x): x is string => !!x),
      htmlLink: e.htmlLink,
      raw: e,
    };
  }).filter((e) => e.dt);
}

export function liveCalendarRaw(): SnapshotCalendarEvent[] {
  return state.calendarEvents;
}

// 모듈 로드 시점에 무조건 polling 자동 시작 — HMR이 initLiveSync를 다시 안 부르더라도 작동
if (typeof window !== 'undefined' && !IS_VIEWER) {
  // Electron preload가 window.electronAPI 주입할 시간을 잠깐 주고 시작
  setTimeout(() => {
    setupCalendarAutoSync();
    void refreshCalendarFromGoogle();
  }, 500);
}
