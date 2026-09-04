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
  // 'private'이면 남의 캘린더에서 제목이 비어 온다 (바쁨 표시만) — 면접 일정표에서 🔒로 표기
  visibility?: string | null;
  transparency?: string | null;
  conferenceUrl: string | null;
  /** 일정에 첨부된 파일 (대부분 지원자 이력서 — 드라이브에 있음) */
  attachments?: { fileId: string | null; title: string; mimeType: string; fileUrl: string }[];
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

// 이력서 보관함 항목 — userData/resumes/index.json 에 저장되는 레코드
export interface ResumeEntry {
  id: string;
  filename: string;
  storedName: string;
  mimeType: string;
  size: number;
  hash: string;
  addedAt: string;
  updatedAt?: string;
  candidate: string;
  team: string;
  job: string;
  channel: string;
  appliedAt: string;
  note: string;
  tags: string[];
  source: string;
  driveFileId: string | null;
  driveLink?: string | null;
  driveError: string | null;
}

// 팀 공유 드라이브에 올라간 이력서 한 건
export interface DriveVaultFile {
  driveFileId: string;
  filename: string;
  team: string;
  size: number;
  modifiedTime: string;
  mimeType: string;
  owner: string;
}

// 문자 발송 방식 — phone은 내 휴대폰으로 열기(무료), 나머지는 문자 사업자 API로 직접 발송
// phonelink  = Windows "휴대폰과 연결"에 번호·문구가 채워진 대화창을 띄운다 (무료·기본값)
// gmessages  = 구글 메시지 웹을 앱 창에서 조작해 자동 발송 (무료)
// phone      = 그냥 sms: 링크 열기 — Windows 기본 앱에 따라 브라우저로 샐 수 있다
export type SmsProvider = 'phonelink' | 'gmessages' | 'phone' | 'aligo' | 'solapi';

export interface SmsConfig {
  provider: SmsProvider;
  /** phonelink — 대화창을 띄운 뒤 앱이 보내기(엔터)까지 누른다 */
  autoSend: boolean;
  /** 발신번호 — 유료 API에서만 쓴다(사전등록 필수) */
  sender: string;
  userId: string;
  /** 화면에는 뒤 4자리만 마스킹돼서 온다 */
  apiKey: string;
  apiSecret: string;
  ready: boolean;
}

export interface SmsSendResult {
  to: string;
  via: SmsProvider;
  /** provider='phone' — 문자 앱을 채워서 열었다 (마지막 보내기는 사람이 누른다) */
  opened?: boolean;
  /** 실제로 발송됐다 */
  sent?: boolean;
  /** 대화창은 떴는데 자동 보내기가 막혔다 — 사람이 엔터를 눌러야 한다 */
  autoSendFailed?: string;
  /** 문자 앱은 열렸지만 번호·문구를 못 넘겼다 — 사용자가 붙여넣어야 한다 */
  partial?: boolean;
  id?: string;
  count?: number;
}

// 이력서에서 뽑아낸 지원자 연락처
export interface ResumeContact {
  id: string | null;
  candidate?: string;
  email: string;
  emails: string[];
  phone: string;
  phones: string[];
  cached?: boolean;
}

export interface PresenceUser {
  email: string;
  name?: string;
  page?: string;
  version?: string;
  platform?: string;
  host?: string;
  lastSeen: number;
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
    sendGmail(payload: {
      to: string;
      subject: string;
      body: string;
      /** HTML 본문 (있으면 이걸로 발송) */
      html?: string;
      /** 서명 이미지 — 본문에 cid로 박아 넣는다 */
      inlineImage?: { base64: string; mimeType: string; cid?: string };
      cc?: string;
      bcc?: string;
    }): Promise<Result<{ id: string; threadId: string }>>;
    openAttachment(messageId: string, filename: string, attachmentId?: string): Promise<Result<{ path: string }>>;
    fetchAttachmentBase64(messageId: string, filename: string, attachmentId?: string): Promise<Result<{ base64: string; mimeType: string; filename: string }>>;
    /** 내가 찾은 지원자 연락처를 드라이브에 올려 팀에 공유 */
    contactsPush(
      map: Record<string, string | { email?: string; phone?: string }>,
      shareWith: string[]
    ): Promise<Result<{ id: string; count: number }>>;
    /** 팀 전체가 찾아둔 지원자 연락처 합본 */
    contactsPull(): Promise<
      Result<{ contacts: Record<string, string>; phones: Record<string, string>; sources: number }>
    >;
    /** 캘린더 일정에 첨부된 드라이브 파일 내려받기 (읽기 전용) */
    driveFile(fileId: string): Promise<Result<{ id: string; name: string; mimeType: string; base64: string }>>;
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
        // Google Meet — 면접 캘린더 일정은 main(google.cjs)에서 자동으로 붙여준다.
        // 여기서 직접 넘기면 그 값이 우선하고, noMeet=true면 자동 부착을 끈다.
        conferenceData?: {
          createRequest?: { requestId?: string; conferenceSolutionKey?: { type: 'hangoutsMeet' } };
        };
        noMeet?: boolean;
      },
      sendUpdates?: 'all' | 'externalOnly' | 'none'
    ): Promise<Result<{ id: string; htmlLink?: string; hangoutLink?: string }>>;
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
  /**
   * 문자(SMS/LMS).
   * provider='phone'(기본·무료)이면 실제 발송이 아니라 내 휴대폰 문자 앱을 번호·문구가
   * 채워진 상태로 열어준다 → 결과의 `opened`가 true. 유료 API(aligo/solapi)를 설정하면
   * 앱이 직접 쏘고 `sent`가 true로 온다.
   */
  sms: {
    config(): Promise<Result<SmsConfig>>;
    setConfig(patch: Partial<SmsConfig> & { apiKey?: string; apiSecret?: string }): Promise<Result<SmsConfig>>;
    send(payload: { to: string; text: string; title?: string }): Promise<Result<SmsSendResult>>;
    sendMany(
      list: { to: string; text: string; title?: string; name?: string }[]
    ): Promise<Result<{ results: (SmsSendResult & { name: string; ok: boolean; error?: string })[]; sent: number; failed: number }>>;
    balance(): Promise<Result<{ provider: string; sms?: number; lms?: number; balance?: number; note?: string }>>;
    /** 구글 메시지 웹 연결 상태 — 'ready' | 'qr'(스캔 필요) | 'unknown' */
    gmStatus(): Promise<Result<{ state: string; url?: string; message?: string }>>;
    /** QR 스캔 창 띄우기 (최초 1회) */
    gmConnect(): Promise<Result<{ opened: boolean }>>;
    /** 휴대폰과 연결 설치 여부 */
    plStatus(): Promise<Result<{ installed: boolean; version: string }>>;
    /** 이미 떠 있는 대화창에서 보내기(엔터)만 다시 누른다 */
    plPressSend(): Promise<Result<{ sent: boolean; via: string }>>;
  };

  /**
   * 처우산정표 — '신규입사자 처우산정(안)' 워크북의 후보자별 탭.
   * create: 템플릿을 복제해 '부서_이름(작성중)' 탭을 만들고 인적사항만 채운다(금액은 손대지 않는다).
   *         같은 사람 탭이 이미 있으면 만들지 않고 그 탭을 돌려준다.
   * list:   탭 이름에서 진행 상태를 읽는다 — (작성중)/(작성완료)/(협의완료)/(입사포기).
   */
  offer: {
    create(info: {
      candidate: string;
      team?: string;
      job?: string;
      grade?: string;
      phone?: string;
      birth?: string;
      gender?: string;
      school?: string;
      major?: string;
      degree?: string;
      careerTotal?: string;
      careers?: { company?: string; role?: string; period?: string }[];
    }): Promise<Result<{ created: boolean; existed: boolean; tab: string; gid: number; url: string; filled?: number }>>;
    list(): Promise<Result<{ sheetId: string; items: { tab: string; gid: number; name: string; status: string; url: string }[] }>>;
    /** 시트가 계산해 둔 산정 결과를 읽는다 — 앱은 계산하지 않는다(시트가 유일한 기준) */
    read(tab: string): Promise<
      Result<{
        tab: string;
        성명: string;
        지원부서: string;
        지원직무: string;
        현재TC: number;
        입사예정일: string;
        총경력: string;
        인정경력: string;
        희망연봉: string;
        options: {
          no: number;
          title: string;
          grade: string;
          step: string;
          기본급: number;
          시간외수당: number;
          월급여액: number;
          계약연봉: number;
          TC최소: number;
          TC최대: number;
          산정근거: string;
          고정OT시간: string;
          수습기간: string;
        }[];
      }>
    >;
  };

  resumes: {
    save(payload: {
      filename: string;
      base64: string;
      meta?: Partial<ResumeEntry>;
    }): Promise<Result<{ entry: ResumeEntry; duplicate: boolean }>>;
    list(): Promise<Result<ResumeEntry[]>>;
    update(id: string, patch: Partial<ResumeEntry>): Promise<Result<ResumeEntry>>;
    read(id: string): Promise<Result<{ base64: string; mimeType: string; filename: string }>>;
    open(id: string): Promise<Result<{ path: string }>>;
    reveal(): Promise<Result<{ path: string }>>;
    remove(id: string): Promise<Result<{ ok: boolean }>>;
    /** 여러 건 삭제 — 기본으로 제외 목록에 넣어 재스캔 시 되살아나지 않게 한다 */
    removeMany(
      ids: string[],
      opt?: { ignore?: boolean }
    ): Promise<Result<{ deleted: number; ignored: number; driveFailed?: number }>>;
    /** 이력서 폴더를 TA팀에게만 공유 */
    shareVault(emails: string[], role?: 'reader' | 'writer'): Promise<Result<{ folderId: string; shared: string[]; removedPublic: number }>>;
    /** 팀 공유 누락분 자동 채우기 */
    syncShare(): Promise<Result<{ checked: number; fixed: number; team: string[] }>>;
    /** 팀 공유 드라이브에 올라간 이력서 목록 */
    driveList(): Promise<Result<{ files: DriveVaultFile[] }>>;
    /** 드라이브 이력서 폴더를 비공개로 강제 (회사 전체 공개 권한 제거) */
    lockDrive(): Promise<Result<{ locked: boolean; removed: number }>>;
    backup(ids?: string[]): Promise<Result<{ uploaded: number; pending: number; errors: string[] }>>;
    classify(
      updates: { id: string; candidate?: string; team?: string; job?: string; matchedBy?: string }[],
      opts?: { overwrite?: boolean }
    ): Promise<Result<{ changed: number }>>;
    /** 이력서 원본(PDF)에서 지원자 이메일·전화를 읽어온다 */
    contacts(id: string): Promise<Result<ResumeContact>>;
    /** 이름으로 보관함을 찾아 연락처를 돌려준다 (가장 최근 이력서 기준) */
    contactsByName(name: string): Promise<Result<ResumeContact>>;
    /**
     * 보관함 전체 연락처를 한 번에 — {이름: {email, phone}}.
     * 이름마다 따로 부르면 왕복이 사람 수만큼 생겨 느리다. 로컬 인덱스만 읽으므로 즉시 끝난다.
     */
    contactsAll(): Promise<Result<Record<string, { email: string; phone: string }>>>;
    /**
     * 팀원이 올린 이력서를 내 보관함으로 가져온다.
     * 팀원 파일은 그 사람 드라이브에 있고 나에겐 읽기 공유만 되므로, 내려받아야 내 목록에 나온다.
     */
    /** 이력서에서 처우산정표용 인적사항을 뽑는다 (출생연도·성별·학력·전공·학위·경력) */
    profile(name: string): Promise<Result<{ birth: string; gender: string; school: string; major: string; degree: string; careerTotal: string; lastSalary: string; careers: { company: string; role: string; period: string; salary?: string }[] } | null>>;
    pullTeam(limit?: number): Promise<Result<{ pulled: number; skipped: number; failed: number; candidates?: number }>>;
    /**
     * 면접 일정에 후보자 이력서를 첨부한다.
     * 보관함 조회 → (필요하면) 드라이브 업로드 → 면접관에게 읽기 공유 → 일정 첨부.
     * 이력서가 없으면 attached:false + reason으로 조용히 돌아온다(예약을 실패시키지 않는다).
     */
    attachToEvent(payload: {
      calendarId: string;
      eventId: string;
      candidate: string;
      shareWith?: string[];
    }): Promise<Result<{ attached: boolean; already?: boolean; title?: string; candidate?: string; shared?: string[]; reason?: string }>>;
    /** 내 PC(바탕화면·다운로드·문서·OneDrive)에서 이력서로 보이는 파일을 찾는다 */
    scan(opt?: { roots?: string[]; names?: string[]; maxDepth?: number; limit?: number }): Promise<
      Result<{ roots: string[]; files: { path: string; filename: string; size: number; mtime: string; matchedBy: string }[] }>
    >;
    /** 찾은 파일을 보관함에 편입 (원본은 그대로 두고 사본만) */
    importPath(
      filePath: string,
      meta?: Partial<ResumeEntry>,
      password?: string
    ): Promise<Result<{ entry?: ResumeEntry; duplicate?: boolean; zip?: boolean; count?: number; added?: number; entries?: ResumeEntry[] }>>;
    /** 저장하지 않고 파일 데이터에서만 연락처를 뽑는다 (메일 첨부 이력서용) */
    contactsFromData(base64: string, mimeType?: string): Promise<Result<ResumeContact>>;
    organize(): Promise<
      Result<{
        localMoved: number;
        driveMoved: number;
        driveRenamed: number;
        pending: number;
        errors: string[];
      }>
    >;
    stats(): Promise<Result<{ count: number; bytes: number; backedUp: number; dir: string }>>;
    driveFolder(): Promise<Result<{ id: string | null; url: string | null }>>;
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
  presence: {
    list(): Promise<Result<{ configured: boolean; now?: number; users: PresenceUser[] }>>;
    setPage(page: string): Promise<Result<{ ok: boolean }>>;
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
