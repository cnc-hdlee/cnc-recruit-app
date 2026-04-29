// Typed wrapper around window.electronAPI exposed via preload.cjs

export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface GoogleProfile {
  email: string;
  name?: string;
  picture?: string;
}

export interface GoogleStatus {
  hasClient: boolean;
  authed: boolean;
  profile: GoogleProfile | null;
}

export interface SheetTab {
  title: string;
  sheetId: number;
}

export interface SheetMeta {
  title: string;
  tabs: SheetTab[];
}

export interface GmailMsg {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  labelIds: string[];
}

export interface GCalEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  htmlLink?: string;
  status: string;
  attendees: { email?: string; name?: string; responseStatus?: string }[];
}

export interface GCalListItem {
  id: string;
  summary: string;
  primary: boolean;
}

export interface SlackTeam {
  team: string;
  teamId: string;
  user: string;
  userId: string;
  url: string;
}

export interface SlackStatus {
  hasToken: boolean;
  team: SlackTeam | null;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  isIM?: boolean;
  topic: string;
  user?: string;
}

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  threadTs?: string;
  replyCount?: number;
  channel?: string;
  permalink?: string;
}

export interface SyncPayload {
  spreadsheetId: string;
  title: string;
  modifiedTime: string;
  tabs: Record<string, string[][]>;
}

export interface SyncTick {
  spreadsheetId: string;
  modifiedTime: string;
  changed: boolean;
}

export interface SyncError {
  spreadsheetId: string;
  error: string;
}

interface ElectronAPI {
  platform: string;
  version: string;
  google: {
    setCreds(c: { clientId: string; clientSecret: string }): Promise<Result<void>>;
    clearCreds(): Promise<Result<void>>;
    startAuth(): Promise<Result<GoogleProfile>>;
    status(): Promise<Result<GoogleStatus>>;
    signOut(): Promise<Result<void>>;
    revealSecrets(): Promise<Result<{
      clientId: string | null;
      clientSecret: string | null;
      refreshToken: string | null;
      sheetsConfig: { sheetIds: string[]; mappings: Record<string, unknown> };
    }>>;
    listSheetTabs(id: string): Promise<Result<SheetMeta>>;
    readSheet(id: string, range: string): Promise<Result<string[][]>>;
    // App is strictly read-only on Google Sheets — no write methods exposed.
    listGmail(q: string, max: number): Promise<Result<GmailMsg[]>>;
    listCalendar(min: string, max: string, id?: string): Promise<Result<GCalEvent[]>>;
    listCalendars(): Promise<Result<GCalListItem[]>>;
    // Calendar WRITE
    insertCalEvent(
      calendarId: string,
      body: {
        summary?: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string; timeZone?: string };
        end: { dateTime?: string; date?: string; timeZone?: string };
        attendees?: { email: string }[];
      }
    ): Promise<Result<{ id: string; htmlLink?: string }>>;
    updateCalEvent(
      calendarId: string,
      eventId: string,
      body: Record<string, unknown>,
      sendUpdates?: 'all' | 'externalOnly' | 'none'
    ): Promise<Result<{ id: string }>>;
    deleteCalEvent(
      calendarId: string,
      eventId: string,
      sendUpdates?: 'all' | 'externalOnly' | 'none'
    ): Promise<Result<{ ok: boolean }>>;
  };
  slack: {
    saveToken(token: string): Promise<Result<{ ok: boolean; team: string; user: string; url: string }>>;
    status(): Promise<Result<SlackStatus>>;
    signOut(): Promise<Result<void>>;
    listChannels(types?: string): Promise<Result<SlackChannel[]>>;
    readChannel(id: string, lim?: number): Promise<Result<SlackMessage[]>>;
    readMultiple(ids: string[], lim?: number): Promise<Result<(SlackMessage & { channelId: string; userName: string })[]>>;
    search(q: string, count?: number): Promise<Result<SlackMessage[]>>;
    post(ch: string, text: string): Promise<Result<{ ok: boolean; ts: string }>>;
  };
  cfg: {
    get<T = unknown>(key: string): Promise<Result<T | null>>;
    set(key: string, value: unknown): Promise<Result<void>>;
    del(key: string): Promise<Result<void>>;
  };

  sync: {
    start(spreadsheetId: string): Promise<Result<void>>;
    stop(spreadsheetId: string): Promise<Result<void>>;
    startAll(): Promise<Result<string[]>>;
    fetchOnce(spreadsheetId: string): Promise<Result<{ title: string; tabs: Record<string, string[][]>; modifiedTime: string }>>;
    cached(spreadsheetId: string): Promise<Result<{ title: string; tabs: Record<string, string[][]> } | null>>;
    foreground(v: boolean): Promise<Result<void>>;
    status(): Promise<Result<{ spreadsheetId: string; polling: boolean; lastModified: string | null; hasCache: boolean }[]>>;
    onUpdate(cb: (p: SyncPayload) => void): () => void;
    onTick(cb: (p: SyncTick) => void): () => void;
    onError(cb: (p: SyncError) => void): () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export const api = (typeof window !== 'undefined' ? window.electronAPI : null) as ElectronAPI;

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error || 'Unknown error');
  return r.data as T;
}
