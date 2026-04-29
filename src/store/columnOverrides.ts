import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';

// User-specified column header names that override auto-detection.
// Global (applies to all matching tabs); can be extended to per-tab later.
export interface HeadcountOverrides {
  to?: string;
  cur?: string;
  need?: string;
  req?: string;
  inc?: string;
}

interface State {
  headcount: HeadcountOverrides;
  loaded: boolean;
}

let state: State = { headcount: {}, loaded: false };
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getSnapshot = () => state;
const emit = () => listeners.forEach((l) => l());

export async function loadOverrides() {
  if (state.loaded) return;
  if (!api?.cfg) return;
  const r = await api.cfg.get<HeadcountOverrides>('headcountColumnOverrides');
  if (r.ok && r.data) state = { headcount: r.data, loaded: true };
  else state = { ...state, loaded: true };
  emit();
}

export async function setHeadcountOverride(field: keyof HeadcountOverrides, header: string | undefined) {
  const next: HeadcountOverrides = { ...state.headcount };
  if (header) next[field] = header;
  else delete next[field];
  state = { ...state, headcount: next };
  emit();
  await api.cfg.set('headcountColumnOverrides', next);
}

export async function resetHeadcountOverrides() {
  state = { ...state, headcount: {} };
  emit();
  await api.cfg.set('headcountColumnOverrides', {});
}

export function useHeadcountOverrides(): HeadcountOverrides {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.headcount;
}

// Pure helper: pick value using override first, then keyword fallback.
export function getFieldValue(
  row: Record<string, string>,
  override: string | undefined,
  candidates: string[]
): string {
  if (override && override in row) return row[override] || '';
  for (const c of candidates) {
    for (const key of Object.keys(row)) {
      if (key.replace(/\s+/g, '').includes(c.replace(/\s+/g, ''))) {
        return row[key] || '';
      }
    }
  }
  return '';
}

export function findMatchedHeader(headers: string[], override: string | undefined, candidates: string[]): string | undefined {
  if (override && headers.includes(override)) return override;
  for (const c of candidates) {
    for (const h of headers) {
      if (h.replace(/\s+/g, '').includes(c.replace(/\s+/g, ''))) return h;
    }
  }
  return undefined;
}
