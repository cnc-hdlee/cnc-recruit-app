// Continuous polling store for Gmail · Calendar · Slack.
// Independent from the sheet sync (which lives in liveData.ts).
// Goal: keep a fresh snapshot of all integration data for the auto-linker.

import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import { IS_VIEWER } from '../lib/mode';
import type { GmailMsg, GCalEvent, SlackMessage, SlackChannel } from '../lib/api';

export interface IntegrationState {
  gmail: GmailMsg[];
  calendar: GCalEvent[];
  slack: (SlackMessage & { channelId: string; userName: string })[];
  lastGmailAt: number | null;
  lastCalendarAt: number | null;
  lastSlackAt: number | null;
  errors: { source: string; msg: string }[];
  loading: { gmail: boolean; calendar: boolean; slack: boolean };
}

let state: IntegrationState = {
  gmail: [],
  calendar: [],
  slack: [],
  lastGmailAt: null,
  lastCalendarAt: null,
  lastSlackAt: null,
  errors: [],
  loading: { gmail: false, calendar: false, slack: false },
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
let timers: { gmail?: ReturnType<typeof setInterval>; calendar?: ReturnType<typeof setInterval>; slack?: ReturnType<typeof setInterval> } = {};

const POLL_GMAIL_MS = 60_000;
const POLL_CAL_MS = 90_000;
const POLL_SLACK_MS = 45_000;

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

const SLACK_PRIORITY_KEYWORDS = ['team_people-culture', 'team_talent-acquisition', '캔디드', '코공고', 'people', 'talent', '채용', '인사'];
const SLACK_PRIORITY_DM_NAMES = ['허필중', '임세현'];

async function pollSlack() {
  if (!api?.slack) return;
  setState({ loading: { ...state.loading, slack: true } });
  try {
    const chs = await api.slack.listChannels();
    if (!chs.ok || !chs.data) {
      pushError('slack', chs.error || 'channel list failed');
      setState({ loading: { ...state.loading, slack: false } });
      return;
    }
    const all: SlackChannel[] = chs.data;
    const priorityChannels = all.filter((c) =>
      !c.isIM && SLACK_PRIORITY_KEYWORDS.some((kw) => (c.name || '').toLowerCase().includes(kw.toLowerCase()))
    );
    const priorityDMs = all.filter((c) => c.isIM && SLACK_PRIORITY_DM_NAMES.some((n) => (c.user || '').includes(n)));
    const ids = [...priorityChannels.slice(0, 8), ...priorityDMs.slice(0, 4)].map((c) => c.id);
    if (ids.length === 0) {
      setState({ slack: [], lastSlackAt: Date.now(), loading: { ...state.loading, slack: false } });
      return;
    }
    const r = await api.slack.readMultiple(ids, 50);
    if (r.ok && r.data) {
      setState({ slack: r.data, lastSlackAt: Date.now(), loading: { ...state.loading, slack: false } });
    } else if (!r.ok) {
      pushError('slack', r.error || 'read failed');
      setState({ loading: { ...state.loading, slack: false } });
    }
  } catch (e: any) {
    pushError('slack', e?.message || String(e));
    setState({ loading: { ...state.loading, slack: false } });
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
  pollSlack();

  // Schedule recurring polls
  timers.gmail = setInterval(pollGmail, POLL_GMAIL_MS);
  timers.calendar = setInterval(pollCalendar, POLL_CAL_MS);
  timers.slack = setInterval(pollSlack, POLL_SLACK_MS);
}

export function refreshIntegrations() {
  pollGmail();
  pollCalendar();
  pollSlack();
}

export function useIntegrations() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
