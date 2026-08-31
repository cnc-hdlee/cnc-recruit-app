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

export interface GmailAttachmentInfo {
  filename: string;
  attachmentId: string;
  mimeType: string;
  size: number;
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
  attachments?: string[];
  attachmentInfos?: GmailAttachmentInfo[];
}

export interface GCalEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  colorId: string | null;
  allDay: boolean;
  start: string;
  end: string;
  timeZone: string | null;
  htmlLink?: string;
  status: string;
  conferenceUrl: string | null;
  creator?: { email: string | null; self: boolean } | null;
  organizer?: { email: string | null; self: boolean } | null;
  attendees: { email?: string; name?: string; responseStatus?: string; organizer?: boolean; self?: boolean }[];
}

export interface GCalListItem {
  id: string;
  summary: string;
  primary: boolean;
}

// calendarList 항목의 전체 메타 — 사이드바 표시 여부(selected/hidden), 권한, 색깔 등
export interface GCalListEntry {
  id: string;
  summary: string;
  summaryOverride: string | null;
  primary: boolean;
  selected: boolean;
  hidden: boolean;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader' | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  colorId: string | null;
  timeZone: string | null;
  deleted: boolean;
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

export interface UpdateCheckResult {
  dev: boolean;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

interface ElectronAPI {
  platform: string;
  version: string;
  app: {
    getVersion(): Promise<Result<string>>;
    checkForUpdates(): Promise<Result<UpdateCheckResult>>;
    quitAndInstall(): Promise<Result<void>>;
    onUpdateAvailable(cb: (p: { version: string }) => void): () => void;
    onUpdateNotAvailable(cb: (p: { version?: string }) => void): () => void;
    onUpdateProgress(cb: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): () => void;
    onUpdateDownloaded(cb: (p: { version: string }) => void): () => void;
    onUpdateError(cb: (p: { message: string }) => void): () => void;
  };
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
    // 기존 시트 절대 수정 안 함 — drive.file scope로 새 시트만 생성 가능.
    // 익스포트(이번 달 면접 등) 용도. 반환된 url을 새 탭으로 열면 됨.
    createSheet(
      title: string,
      headers: string[],
      rows: string[][]
    ): Promise<Result<{ spreadsheetId: string; url: string }>>;
    // 입사자 관리 워크북 동기화 — 앱이 만든 새 시트에 날짜별 탭 생성/갱신 (drive.file).
    // spreadsheetId=null이면 새로 생성. 수기 O(입사안내/건강검진)는 (성명|연락처)로 보존.
    syncHiresSheet(
      spreadsheetId: string | null,
      tabs: { name: string; headers: string[]; rows: string[][] }[]
    ): Promise<Result<{ spreadsheetId: string; url: string }>>;
    listGmail(q: string, max: number): Promise<Result<GmailMsg[]>>;
    // Gmail WRITE — 후보자 안내 메일 발송. 사용자가 발송 버튼을 눌렀을 때만 호출.
    sendGmail(payload: { to: string; subject: string; body: string; cc?: string; bcc?: string }): Promise<Result<{ id: string; threadId: string }>>;
    openAttachment(messageId: string, filename: string, attachmentId?: string): Promise<Result<{ path: string }>>;
    fetchAttachmentBase64(messageId: string, filename: string, attachmentId?: string): Promise<Result<{ base64: string; mimeType: string; filename: string }>>;
    listCalendar(min: string, max: string, id?: string): Promise<Result<GCalEvent[]>>;
    listCalendars(): Promise<Result<GCalListItem[]>>;
    listCalendarsFull(): Promise<Result<GCalListEntry[]>>;
    patchCalendarListEntry(
      calendarId: string,
      body: {
        selected?: boolean;
        hidden?: boolean;
        colorId?: string;
        summaryOverride?: string;
        backgroundColor?: string;
        foregroundColor?: string;
      }
    ): Promise<Result<{ id: string }>>;
    // Calendar WRITE
    insertCalEvent(
      calendarId: string,
      body: {
        summary?: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string; timeZone?: string };
        end: { dateTime?: string; date?: string; timeZone?: string };
        attendees?: { email: string; resource?: boolean }[];
        colorId?: string;
        // 'private'면 다른 사람에게 제목/상세가 안 보이고 '바쁨'으로만 표시된다 (비공개 면접용).
        visibility?: 'default' | 'public' | 'private';
      },
      sendUpdates?: 'all' | 'externalOnly' | 'none'
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
    createCalendar(summary: string, timeZone?: string, description?: string): Promise<Result<{ id: string; summary: string }>>;
    listCalAcl(calendarId: string): Promise<Result<{ id: string; role: string; scope: { type: string; value?: string } }[]>>;
    insertCalAcl(
      calendarId: string,
      email: string,
      role?: 'reader' | 'writer' | 'owner' | 'freeBusyReader',
      scopeType?: 'user' | 'group' | 'domain'
    ): Promise<Result<{ id: string; role: string }>>;
    deleteCalAcl(calendarId: string, ruleId: string): Promise<Result<{ ok: boolean }>>;
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

  mobile: {
    getInfo(): Promise<Result<{
      port: number;
      listening: boolean;
      viewerBuilt: boolean;
      ips: { name: string; address: string }[];
      token: string | null;
      cloudUrl: string | null;
      externalUrl: string | null;
      lanUrls: string[];
      tunnel: { running: boolean; url: string | null; error: string | null };
    }>>;
    rotateToken(): Promise<Result<{ token: string }>>;
    onTunnelUrl(cb: (p: { url: string }) => void): () => void;
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
    onRecovered(cb: (p: { spreadsheetId: string }) => void): () => void;
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
