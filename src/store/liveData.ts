// Live data store: subscribes to sync push events from Electron, exposes via React hook.
// Falls back to static D when not yet synced.

import { useSyncExternalStore } from 'react';
import { D as staticD } from '../data/initialData';
import { api } from '../lib/api';
import { rowsToObjects, suggestKind, type SheetMappings, type TabKind, type TabMappingEntry } from '../lib/sheetMapping';
import { IS_VIEWER, SNAPSHOT_URL } from '../lib/mode';
import { isSnapshot, type Snapshot, type SnapshotCalendarEvent } from '../lib/snapshot';
import { READ_CALENDAR_IDS, SHARED_CAL, isInterviewCalendar } from '../lib/sharedCalendars';

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

// 시트별 오류를 따로 들고 있다가, 그 시트가 다시 성공하면 지운다.
// (예전엔 에러가 뜨면 8초 뒤 무조건 자동 clear → 폴링마다 떴다 사라져 배지가 깜빡였다. 2026-08)
const sheetErrors = new Map<string, string>();
function setSheetError(spreadsheetId: string, error: string | null) {
  if (error) sheetErrors.set(spreadsheetId, error);
  else sheetErrors.delete(spreadsheetId);
  const first = sheetErrors.values().next();
  setState({ lastError: first.done ? null : first.value });
}

let initialized = false;
let calendarPollHandle: ReturnType<typeof setInterval> | null = null;
let calendarFocusHandlersAttached = false;
// 캘린더 폴링 — 15초 (실시간에 가깝게). focus/visibility 시에도 즉시 fire.
const CALENDAR_POLL_MS = 15_000;

// Viewer mode: polling cadence for re-fetching the live snapshot from the maintainer.
let viewerPollHandle: ReturnType<typeof setInterval> | null = null;
let viewerFocusAttached = false;
const VIEWER_POLL_MS = 30_000;

async function fetchViewerSnapshot() {
  try {
    const r = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!r.ok) {
      setState({ lastError: `스냅샷을 불러올 수 없어요 (${r.status})` });
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
}

function setupViewerAutoSync() {
  if (!IS_VIEWER) return;
  if (typeof window === 'undefined') return;
  if (viewerPollHandle) clearInterval(viewerPollHandle);
  viewerPollHandle = setInterval(() => {
    void fetchViewerSnapshot();
  }, VIEWER_POLL_MS);
  if (!viewerFocusAttached) {
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchViewerSnapshot();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    viewerFocusAttached = true;
  }
}

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
  console.info(`[calendar-poll] interval armed (${CALENDAR_POLL_MS / 1000}s)`);

  if (!calendarFocusHandlersAttached) {
    // 앱 활성화 시 캘린더 + 모든 시트 동시 refresh — polling 60초 기다리지 않음
    const refreshAll = () => {
      void refreshCalendarFromGoogle();
      void refreshNow();
      // foreground polling 간격(8초)로 전환
      try { void api?.sync?.foreground(true); } catch { /* ignore */ }
    };
    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshAll();
      } else {
        try { void api?.sync?.foreground(false); } catch { /* ignore */ }
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
  // No Electron, no OAuth, no Slack — just polled read against the maintainer's bridge.
  if (IS_VIEWER) {
    await fetchViewerSnapshot();
    setupViewerAutoSync();
    return;
  }

  if (!api?.sync) return;

  // Load saved mappings
  const m = await api.cfg.get<SheetMappings>('sheetMappings');
  if (m.ok && m.data) setState({ mappings: m.data });

  // Subscribe to push events
  api.sync.onUpdate((payload: { spreadsheetId: string; title: string; modifiedTime: string; tabs: Record<string, string[][]> }) => {
    const snapshots = { ...state.snapshots, [payload.spreadsheetId]: { title: payload.title, modifiedTime: payload.modifiedTime, tabs: payload.tabs } };
    setState({ snapshots, lastTickAt: Date.now(), hasLive: true });
    setSheetError(payload.spreadsheetId, null);
    // Auto-map any unmapped tabs (non-destructive: only fills in absent kinds)
    void autoFillMappings(payload.spreadsheetId, Object.keys(payload.tabs));
  });

  api.sync.onTick((payload: { spreadsheetId: string }) => {
    setState({ lastTickAt: Date.now() });
    if (payload?.spreadsheetId) setSheetError(payload.spreadsheetId, null);
  });

  api.sync.onError((payload: { spreadsheetId: string; error: string }) => {
    setSheetError(payload.spreadsheetId, `${payload.spreadsheetId.slice(0, 8)}…: ${payload.error}`);
  });

  // 메인 프로세스가 재시도에 성공하면 해당 시트 오류 표시를 즉시 내린다
  api.sync.onRecovered?.((payload: { spreadsheetId: string }) => {
    setSheetError(payload.spreadsheetId, null);
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
          if (!r.ok || !r.data) return { calId, items: [] };
          return { calId, items: r.data };
        } catch {
          return { calId, items: [] };
        }
      })
    );
    // ID 기준 dedup — "먼저 온 사본이 전부 이김"이 아니라 필드별로 병합한다.
    //
    // 왜: 같은 면접이 (1) primary 초대 사본 (2) 공유 면접 캘린더 원본 두 벌로 들어온다.
    //   · 제목은 primary 사본에만 있다 (공유 캘린더를 reader로 읽으면 private → 빈 제목).
    //   · 반대로 colorId(보라 '3')와 "어느 캘린더 소속인지"는 공유 캘린더 사본에만 있다.
    //   예전 로직은 primary 사본이 통째로 이겨서 calendarId='primary', colorId=null이 되고,
    //   그 결과 "면접 캘린더 + 보라색이면 무조건 면접" 신뢰 룰이 발동을 못 했다.
    //   → 제목 파싱에만 의존하게 되어 "16:00 / 그린 / 조성현 (PM) / 포장2팀" 같은 실제 면접이
    //     분류 실패로 카드에서 통째로 사라졌다. (2026-08-20 누락 신고 원인 #2)
    //
    // 병합 규칙: 제목/설명/장소/참석자 = 내용이 있는 사본 우선(=primary),
    //           calendarId/colorId = 면접·입사·퇴사 공유 캘린더 사본 우선.
    const byId = new Map<string, { calId: string; e: typeof results[number]['items'][number] }[]>();
    for (const { calId, items } of results) {
      for (const e of items) {
        if (!e.id) continue;
        const arr = byId.get(e.id);
        if (arr) arr.push({ calId, e });
        else byId.set(e.id, [{ calId, e }]);
      }
    }
    const merged: { calId: string; e: typeof results[number]['items'][number] }[] = [];
    for (const copies of byId.values()) {
      // 내용(제목)이 있는 사본을 본문으로 — READ 순서상 primary가 앞이므로 자연히 primary 우선
      const base = copies.find((c) => (c.e.summary || '').trim()) || copies[0];
      // 소속 캘린더는 공유 캘린더 사본이 있으면 그쪽을 채택 (primary는 초대 사본일 뿐)
      const shared = copies.find((c) => c.calId !== 'primary');
      const calId = shared ? shared.calId : base.calId;
      const colorId = (shared && shared.e.colorId) || base.e.colorId || null;
      // 제목·설명·장소는 base, 없으면 다른 사본에서라도 보강
      const pick = (get: (x: typeof base.e) => string | null | undefined) =>
        (get(base.e) || '').trim() || copies.map((c) => (get(c.e) || '').trim()).find(Boolean) || '';
      merged.push({
        calId,
        e: {
          ...base.e,
          colorId,
          summary: pick((x) => x.summary),
          description: pick((x) => x.description),
          location: pick((x) => x.location),
          attendees: base.e.attendees?.length
            ? base.e.attendees
            : copies.map((c) => c.e.attendees).find((a) => a && a.length) || base.e.attendees,
        },
      });
    }
    // 비공개 채용은 클라이언트 단에서도 한 번 더 필터 (이중 안전망)
    const filtered = merged.filter(
      ({ e }) => !isConfidentialClient(e.summary || '', e.description || '', e.location || '')
    );
    const events: SnapshotCalendarEvent[] = filtered.map(({ calId, e }) => ({
      id: e.id,
      calendarId: calId,
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
      // 첨부(이력서)는 후보자 이름을 복구하는 근거라 반드시 들고 온다
      attachments: (e.attachments || []).map((a) => ({
        title: a.title || '',
        fileId: a.fileId ?? null,
        mimeType: a.mimeType,
        fileUrl: a.fileUrl,
      })),
      conferenceUrl: e.conferenceUrl,
      status: e.status || 'confirmed',
      updated: null,
      creator: e.creator || null,
      organizer: e.organizer || null,
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

// 창 포커스마다 전 시트를 통째로 다시 읽으면 Sheets 할당량(분당 60건)을 금방 태운다.
// 사용자가 [즉시 동기화]를 누른 경우(force)만 무조건 실행하고, 자동 호출은 60초로 제한한다.
const REFRESH_MIN_GAP_MS = 60_000;
let lastRefreshAllAt = 0;

export async function refreshNow(force = false) {
  if (!force && Date.now() - lastRefreshAllAt < REFRESH_MIN_GAP_MS) return;
  lastRefreshAllAt = Date.now();
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
        setState({ snapshots: { ...state.snapshots, [id]: snap }, hasLive: true, lastTickAt: Date.now() });
        setSheetError(id, null);
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

// 면접/입사/퇴사 분류 — CalendarPage의 isInterviewKind와 동일 로직 유지 (대시보드·인사이트 카운트 일치).
// 사용자 명시 (2026-05-20): 대시보드 "이번 달 면접 수"는 면접 캘린더 페이지 카드에 뜨는 사람과 동일해야 함.
function classifyEventKind(summary: string, colorId: string | null, calendarId: string | null = null): NormalizedCalEvent['kind'] {
  // 면접 취소/포기/보류는 면접에서 제외 — CalendarPage isInterviewKind 룰과 일치
  if (/면접포기|면접\s*취소|\(취소\)|취소됨|\(보류\)|면접\s*보류/i.test(summary)) {
    return '기타';
  }
  // 면접 캘린더(SHARED_CAL.interview) + colorId='3'(보라) 명시 등록 = 무조건 면접
  // (장성민 같은 직무명만 쓴 케이스 — 제목에 "면접" 단어 없어도 통과)
  if (calendarId === SHARED_CAL.interview && colorId === '3') return '면접';
  // 면접 전용 공유 캘린더(interviewAlt/Mgr/X)에 있는 이벤트는 색/제목과 무관하게 면접
  if (isInterviewCalendar(calendarId)) return '면접';
  // 입사 (colorId=5 노란색 또는 제목에 입사)
  if (colorId === '5' || /입사/.test(summary)) return '입사';
  if (/퇴사|퇴직/.test(summary)) return '퇴사';
  // 일반 회의/미팅은 제외 (단, "면접" 단어 함께면 통과)
  if (/(회의(?!실)|미팅(?!룸)|meeting|\bsync\b|1on1|1:1)/i.test(summary) && !/면접|interview/i.test(summary)) {
    return '기타';
  }
  // "HH:MM /" 슬래시 포맷 또는 "면접" 키워드
  const s = (summary || '').toLowerCase();
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
      kind: classifyEventKind(e.summary, e.colorId, e.calendarId),
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

// Viewer mode (모바일/PWA) 자동 폴링 — 본체에서 받아오는 snapshot을 30초마다 갱신
if (typeof window !== 'undefined' && IS_VIEWER) {
  setTimeout(() => {
    setupViewerAutoSync();
  }, 500);
}
