// Continuous polling store for Gmail · Calendar.
// Independent from the sheet sync (which lives in liveData.ts).
// Goal: keep a fresh snapshot of all integration data for the auto-linker.

import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import { IS_VIEWER } from '../lib/mode';
import type { GmailMsg, GCalEvent } from '../lib/api';

export interface IntegrationState {
  gmail: GmailMsg[];
  calendar: GCalEvent[];
  lastGmailAt: number | null;
  lastCalendarAt: number | null;
  errors: { source: string; msg: string }[];
  loading: { gmail: boolean; calendar: boolean };
}

let state: IntegrationState = {
  gmail: [],
  calendar: [],
  lastGmailAt: null,
  lastCalendarAt: null,
  errors: [],
  loading: { gmail: false, calendar: false },
};

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;
const emit = () => listeners.forEach((l) => l());

function setState(patch: Partial<IntegrationState>) {
  state = { ...state, ...patch };
  emit();
}

function pushError(source: string, msg: string) {
  setState({ errors: [...state.errors.slice(-9), { source, msg }] });
}

let initialized = false;
let timers: { gmail?: ReturnType<typeof setInterval>; calendar?: ReturnType<typeof setInterval> } = {};

const POLL_GMAIL_MS = 60_000;
const POLL_CAL_MS = 90_000;

const GMAIL_QUERY = 'newer_than:30d -category:promotions';
const GMAIL_MAX = 80;
const CAL_DAYS_FORWARD = 60;
const CAL_DAYS_BACK = 14;

async function pollGmail() {
  if (!api?.google) return;
  setState({ loading: { ...state.loading, gmail: true } });
  try {
    const r = await api.google.listGmail(GMAIL_QUERY, GMAIL_MAX);
    if (r.ok && r.data) {
      setState({ gmail: r.data, lastGmailAt: Date.now(), loading: { ...state.loading, gmail: false } });
    } else if (!r.ok) {
      pushError('gmail', r.error || 'fetch failed');
      setState({ loading: { ...state.loading, gmail: false } });
    }
  } catch (e: any) {
    pushError('gmail', e?.message || String(e));
    setState({ loading: { ...state.loading, gmail: false } });
  }
}

async function pollCalendar() {
  if (!api?.google) return;
  setState({ loading: { ...state.loading, calendar: true } });
  try {
    const min = new Date(Date.now() - CAL_DAYS_BACK * 86400_000).toISOString();
    const max = new Date(Date.now() + CAL_DAYS_FORWARD * 86400_000).toISOString();
    const r = await api.google.listCalendar(min, max);
    if (r.ok && r.data) {
      setState({ calendar: r.data, lastCalendarAt: Date.now(), loading: { ...state.loading, calendar: false } });
    } else if (!r.ok) {
      pushError('calendar', r.error || 'fetch failed');
      setState({ loading: { ...state.loading, calendar: false } });
    }
  } catch (e: any) {
    pushError('calendar', e?.message || String(e));
    setState({ loading: { ...state.loading, calendar: false } });
  }
}

export async function initIntegrationsSync() {
  if (initialized) return;
  initialized = true;

  if (IS_VIEWER) return; // viewer mode reads only the sheet snapshot, not live integrations
  if (!api?.google) return;

  // Kick off initial pulls (parallel)
  pollGmail();
  pollCalendar();

  // Schedule recurring polls
  timers.gmail = setInterval(pollGmail, POLL_GMAIL_MS);
  timers.calendar = setInterval(pollCalendar, POLL_CAL_MS);

  // 보안: 기존에 저장돼 있던 Slack 토큰이 있으면 자동 폐기
  // (Slack 피드 기능 제거됨 — 토큰이 로컬에 남아 있을 이유 없음)
  try {
    const s = await api?.slack?.status();
    if (s?.ok && s.data?.hasToken) {
      await api.slack.signOut();
      // eslint-disable-next-line no-console
      console.info('[security] Slack 토큰 자동 폐기 (피드 기능 제거됨)');
    }
  } catch {
    // ignore
  }
}

export function refreshIntegrations() {
  pollGmail();
  pollCalendar();
}

export function useIntegrations() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
