// Live data store: subscribes to sync push events from Electron, exposes via React hook.
// Falls back to static D when not yet synced.

import { useSyncExternalStore } from 'react';
import { D as staticD } from '../data/initialData';
import { api } from '../lib/api';
import { rowsToObjects, type SheetMappings, type TabKind, type TabMappingEntry } from '../lib/sheetMapping';
import { IS_VIEWER, SNAPSHOT_URL } from '../lib/mode';
import { isSnapshot, type Snapshot } from '../lib/snapshot';

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

export async function initLiveSync() {
  if (initialized) return;
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
  });

  api.sync.onTick(() => setState({ lastTickAt: Date.now() }));

  api.sync.onError((payload: { spreadsheetId: string; error: string }) => {
    setState({ lastError: `${payload.spreadsheetId.slice(0, 8)}…: ${payload.error}` });
  });

  // Try to start syncing (will no-op if not authed yet)
  await api.sync.startAll();
  await refreshPollStatus();
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
