// 후보자 커뮤니케이션 — 단계별 안내 메일 자동화 (HITL 1-클릭).
// 발송은 Gmail compose URL을 외부 브라우저로 띄워, 형도님이 검토 후 [Send] 클릭.
// Sheets에는 절대 쓰지 않음. 발송 로그는 로컬(cfg)에 저장.

export type CommsStageId =
  | 'interview_1st' // 1차 면접 안내 (서류합격자)
  | 'cpi_after_1st' // 1차 면접 합격 → CPI 안내
  | 'reject' // 불합격 (전 단계 공용)
  | 'offer'; // 처우협의 (잠금 — 자동 큐잉 X, 수기 입력)

export interface CommsTemplate {
  id: CommsStageId;
  label: string;
  category: 'auto' | 'manual'; // auto: 큐잉 가능, manual: 잠금
  subject: string;
  body: string;
  variables: string[]; // {{...}} 키들
}

export const TEMPLATES: Record<CommsStageId, CommsTemplate> = {
  interview_1st: {
    id: 'interview_1st',
    label: '1차 면접 안내 (서류합격)',
    category: 'auto',
    subject: '[(주)씨앤씨인터내셔널] 1차 면접 안내 - {{name}}님',
    body: `안녕하세요. {{name}}님,
(주)씨앤씨인터내셔널 채용팀 이형도입니다.

아래와 같이 면접 안내 드리오니 아래의 일정 확인 부탁드립니다.

일정 : {{interviewAt}}

장소 : {{location}}{{locationGuide}}

사전 질문지 링크 : {{preQuestionUrl}}     ※사전질문지는 면접 하루 전까지 완료 부탁드립니다.

관련하여 궁금하신 내용은 편히 연락 부탁드립니다.
편안한 하루 보내시길 바랍니다.

감사합니다.`,
    variables: ['name', 'interviewAt', 'location', 'locationGuide', 'preQuestionUrl'],
  },

  cpi_after_1st: {
    id: 'cpi_after_1st',
    label: '1차 면접 합격 → CPI 인성검사 안내',
    category: 'auto',
    subject: '[(주)씨앤씨인터내셔널] 1차 면접 합격 및 CPI 인성검사 안내 - {{name}}님',
    body: `안녕하세요 {{name}}님,
(주)씨앤씨인터내셔널 채용팀입니다.

1차 면접 합격을 축하드립니다.
다음 전형은 CPI 검사이며,

이력서에 기재된 메일로 CPI 인성 검사를 발송해 드렸습니다.

확인을 부탁드립니다.

이어서 처우협의 안내도 같이 드리겠습니다.

감사합니다.`,
    variables: ['name'],
  },

  reject: {
    id: 'reject',
    label: '불합격 안내 (전 단계 공용)',
    category: 'auto',
    subject: '[(주)씨앤씨인터내셔널] 채용 전형 결과 안내 - {{name}}님',
    body: `안녕하세요. {{name}}님
(주)씨앤씨인터내셔널 채용팀입니다.

당사에 대한 관심과 함께 {{position}} 포지션에 지원해주셔서 감사드립니다.
아쉽게도 이번 채용에서는 {{name}}님을 모시지 못하게 되었습니다.

이번 채용에서는 함께하지 못하지만 추후 더 좋은 인연으로 만나 뵐 수 있었으면 좋겠습니다.

저희 회사에 지원해주셔서 다시 한번 감사드리며 앞으로도 건강하시고 하시는 일에 항상 성공과 행복이 가득하시길 바랍니다.

감사합니다.`,
    variables: ['name', 'position'],
  },

  offer: {
    id: 'offer',
    label: '처우협의 (수기 입력 · 잠금)',
    category: 'manual',
    subject: '[(주)씨앤씨인터내셔널] 처우 안내 - {{name}}님',
    body: `안녕하세요. {{name}}님,
(주)씨앤씨인터내셔널 채용팀 이형도입니다.

면접 합격을 축하드리며 처우 안내 드리오니 확인 부탁드립니다.

1. 부서 : {{department}}
2. 직무 : {{jobDuty}}
3. 입사일 : {{startDate}} **불가능할 시 가능한 일정 회신 부탁드립니다**
4. 인정 경력 : {{careerType}}
5. 직급 : {{jobLevel}}
6. 급여
  - 연봉 : {{annualSalary}}원
  - 기본급 : {{baseSalary}}원
  - 시간외수당 : {{overtimePay}}원 (월 {{overtimeHours}}시간)
  - 월 {{monthlyTotal}}원

※세전 기준

최종합격에 대한 안내는 아니며 처우에 대한 동의 여부 말씀 주시면 내부 결재 진행 예정이며,
결재 완료 후 최종 입사 안내 예정입니다.

감사합니다.`,
    variables: [
      'name',
      'department',
      'jobDuty',
      'startDate',
      'careerType',
      'jobLevel',
      'annualSalary',
      'baseSalary',
      'overtimePay',
      'overtimeHours',
      'monthlyTotal',
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// 안전장치 — 후보자가 큐에 올라가면 안 되는 케이스
// 메모리 정책 준수: GPD, 비공개 채용, 취소/포기/노쇼
// ─────────────────────────────────────────────────────────────
const BLOCKED_KEYWORDS = [
  '면접포기',
  '취소',
  '노쇼',
  '비공개',
  '이나영',
  '볼트엑스',
];

export function isBlockedCandidate(opts: { name?: string; dept?: string; note?: string; stage?: string }): { blocked: boolean; reason?: string } {
  const n = (opts.name || '').trim();
  const d = (opts.dept || '').trim().toUpperCase();
  const note = (opts.note || '').trim();
  const stage = (opts.stage || '').trim();
  const haystack = `${n} ${note} ${stage}`;

  if (d === 'GPD' || d.includes('GPD')) return { blocked: true, reason: 'GPD 부서 — 메일 자동화 제외' };
  for (const kw of BLOCKED_KEYWORDS) {
    if (haystack.includes(kw)) return { blocked: true, reason: `차단 키워드: ${kw}` };
  }
  return { blocked: false };
}

// ─────────────────────────────────────────────────────────────
// 변수 치환
// ─────────────────────────────────────────────────────────────
export function renderTemplate(tpl: CommsTemplate, vars: Record<string, string>): { subject: string; body: string } {
  const sub = substitute(tpl.subject, vars);
  const body = substitute(tpl.body, vars);
  return { subject: sub, body };
}

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k) => {
    const v = vars[k];
    return v == null || v === '' ? `{{${k}}}` : v; // 빈 값은 placeholder 유지 → 발송 전 검출
  });
}

export function findMissingVars(rendered: string): string[] {
  const matches = rendered.matchAll(/\{\{(\w+)\}\}/g);
  return Array.from(new Set(Array.from(matches).map((m) => m[1])));
}

// ─────────────────────────────────────────────────────────────
// 장소별 안내문 자동 매핑 (locationGuide)
// ─────────────────────────────────────────────────────────────
export function locationGuideFor(location: string): string {
  const loc = (location || '').replace(/\s+/g, '');
  if (loc.includes('퍼플카운티')) {
    return '\n도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.';
  }
  // 본사·기타 사이트 — 추가 양식이 나오면 분기 추가
  return '';
}

// ─────────────────────────────────────────────────────────────
// 사전질문지 URL — 직무별 매핑 (기본값 + 향후 직무별 분기)
// ─────────────────────────────────────────────────────────────
const DEFAULT_PRE_QUESTION_URL = 'https://forms.gle/Kss5nvQf78QNmWMa8';

export function preQuestionUrlFor(_jobDuty: string): string {
  // TODO: 직무별 분기가 필요해지면 여기에 매핑 추가
  return DEFAULT_PRE_QUESTION_URL;
}

// ─────────────────────────────────────────────────────────────
// Gmail compose URL — 외부 브라우저로 열림, 형도님이 검토 후 [Send]
// ─────────────────────────────────────────────────────────────
export function gmailComposeUrl(opts: { to: string; subject: string; body: string; cc?: string; bcc?: string }): string {
  const params = new URLSearchParams();
  params.set('view', 'cm');
  params.set('fs', '1');
  if (opts.to) params.set('to', opts.to);
  if (opts.cc) params.set('cc', opts.cc);
  if (opts.bcc) params.set('bcc', opts.bcc);
  params.set('su', opts.subject);
  params.set('body', opts.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────
// 발송 로그 (로컬 cfg) — 누가·언제·어떤 단계·어떤 후보자
// 처우협의는 입력한 숫자도 함께 기록 (감사용)
// ─────────────────────────────────────────────────────────────
import { api } from './api';

export interface CommsLogEntry {
  id: string; // uuid-ish
  at: number; // epoch ms
  stage: CommsStageId;
  name: string;
  to: string;
  subject: string;
  variables: Record<string, string>;
  bodySnippet: string; // 앞 200자
}

const LOG_KEY = 'candidateCommsLog';
const MAX_LOG = 500;

export async function appendLog(entry: Omit<CommsLogEntry, 'id' | 'at'>): Promise<void> {
  if (!api?.cfg) return;
  try {
    const cur = await api.cfg.get<CommsLogEntry[]>(LOG_KEY);
    const list = cur.ok && Array.isArray(cur.data) ? cur.data : [];
    const next: CommsLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      ...entry,
      bodySnippet: (entry as { bodySnippet?: string }).bodySnippet || '',
    };
    const trimmed = [next, ...list].slice(0, MAX_LOG);
    await api.cfg.set(LOG_KEY, trimmed);
  } catch {
    // non-fatal
  }
}

export async function loadLog(): Promise<CommsLogEntry[]> {
  if (!api?.cfg) return [];
  try {
    const r = await api.cfg.get<CommsLogEntry[]>(LOG_KEY);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  } catch {
    return [];
  }
}

// 재발송 방지 — 같은 (stage, to) 가 최근 N일 내 있는지
export function hasRecentlySent(log: CommsLogEntry[], stage: CommsStageId, to: string, withinDays = 30): CommsLogEntry | null {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  return log.find((e) => e.stage === stage && e.to.toLowerCase() === to.toLowerCase() && e.at > cutoff) || null;
}

// ─────────────────────────────────────────────────────────────
// Gmail 자동 이메일 매칭 — 이력서 첨부 파일에서 후보자 이메일 추출
// ─────────────────────────────────────────────────────────────
// 캐시 키를 v2로 분리 — 이전 헤더 기반 매칭 결과 자동 무효화
const EMAIL_CACHE_KEY = 'candidateEmailCacheV2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일

export interface EmailCacheEntry {
  email: string;
  at: number; // epoch ms
  source: 'gmail' | 'sheet' | 'manual';
  notFound?: boolean;
  // 디버그용 — 왜 못 찾았는지/어떤 첨부에서 찾았는지
  diag?: string;
}

export type EmailCache = Record<string, EmailCacheEntry>;

export async function loadEmailCache(): Promise<EmailCache> {
  if (!api?.cfg) return {};
  try {
    const r = await api.cfg.get<EmailCache>(EMAIL_CACHE_KEY);
    return r.ok && r.data ? r.data : {};
  } catch {
    return {};
  }
}

export async function saveEmailCache(cache: EmailCache): Promise<void> {
  if (!api?.cfg) return;
  try {
    await api.cfg.set(EMAIL_CACHE_KEY, cache);
  } catch {
    // non-fatal
  }
}

// 메일 헤더 문자열에서 모든 email 주소 추출 ("홍길동 <foo@bar.com>" → ["foo@bar.com"])
function extractEmails(headerText: string): string[] {
  if (!headerText) return [];
  const matches = headerText.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g);
  return matches ? Array.from(new Set(matches.map((m) => m.toLowerCase()))) : [];
}

const INTERNAL_DOMAINS = ['cnccosmetic.com', 'cnc.co.kr'];

function isInternalEmail(email: string): boolean {
  const e = email.toLowerCase();
  return INTERNAL_DOMAINS.some((d) => e.endsWith('@' + d));
}

// 첨부가 이력서로 신뢰할 만한지 — 엄격 모드.
// 다음 중 하나 충족해야 통과:
//   (a) 파일명에 후보자명 포함  OR
//   (b) 파일명에 '이력서/resume/cv/자기소개' 키워드 포함
// 그리고 확장자가 .pdf 또는 .docx
function attachmentLooksLikeResume(filename: string, candidateName: string): boolean {
  const f = (filename || '').toLowerCase();
  if (!/(\.pdf$|\.docx$)/i.test(f)) return false;
  const isResumeWord = /이력서|resume|cv|경력기술|자기소개/i.test(f);
  const hasName = !!(candidateName && f.includes(candidateName.toLowerCase()));
  return isResumeWord || hasName;
}

export interface LookupDiag {
  email: string | null;
  reason: string;
}

// 엄격 모드 — 첨부 PDF/DOCX 안의 이메일만 채택. 헤더 fallback 제거.
// 매칭 못 하면 null + 진단 메시지 반환.
export async function lookupCandidateEmail(name: string): Promise<LookupDiag> {
  if (!api?.google?.listGmail || !name) {
    return { email: null, reason: 'Gmail API 사용 불가' };
  }
  if (!api.google.extractAttachmentText) {
    return { email: null, reason: '첨부 텍스트 추출 IPC 없음 — 앱 재시작 필요' };
  }

  const queries = [
    `"${name}" has:attachment (이력서 OR resume OR CV)`,
    `"${name}" has:attachment`,
  ];

  let totalMsgs = 0;
  let resumeAttachTried = 0;
  let extractErr: string | null = null;

  for (const q of queries) {
    let msgs;
    try {
      const r = await api.google.listGmail(q, 10);
      if (!r.ok || !r.data) continue;
      msgs = r.data;
    } catch (e) {
      extractErr = `Gmail 검색 실패: ${String(e)}`;
      continue;
    }

    totalMsgs += msgs.length;

    for (const msg of msgs) {
      const attachInfos = msg.attachmentInfos || [];
      // 엄격: 이력서로 신뢰되는 첨부만
      const resumeLike = attachInfos.filter((a) => attachmentLooksLikeResume(a.filename, name));
      for (const att of resumeLike) {
        resumeAttachTried++;
        try {
          const r = await api.google.extractAttachmentText(msg.id, att.filename, att.attachmentId);
          if (!r.ok) {
            extractErr = r.error || '추출 IPC ok=false';
            continue;
          }
          if (!r.data?.ok || !r.data.text) {
            extractErr = r.data?.reason || '텍스트 비어있음';
            continue;
          }
          const emails = extractEmails(r.data.text).filter((e) => !isInternalEmail(e));
          if (emails.length === 0) {
            extractErr = '첨부에 외부 이메일 없음';
            continue;
          }
          // 첫 매칭 = 이력서 상단 본인 이메일 (가장 신뢰도 높음)
          return { email: emails[0], reason: `${att.filename}에서 추출` };
        } catch (e) {
          extractErr = `추출 예외: ${String(e)}`;
        }
      }
    }
  }

  if (totalMsgs === 0) return { email: null, reason: '이력서 첨부 메일 검색 결과 없음' };
  if (resumeAttachTried === 0) return { email: null, reason: `메일 ${totalMsgs}건 중 이력서로 신뢰되는 첨부 없음 (파일명에 이름 또는 '이력서/resume/cv')` };
  return { email: null, reason: extractErr || '추출 시도 모두 실패' };
}

// 여러 후보자에 대해 일괄 매칭 — 캐시에 있고 만료 안 됐으면 skip
export interface BatchLookupResult {
  resolved: Record<string, string>;
  notFound: { name: string; reason: string }[];
  cached: number;
  fetched: number;
}

export async function batchLookupEmails(
  names: string[],
  onProgress?: (done: number, total: number, currentName: string) => void
): Promise<BatchLookupResult> {
  const cache = await loadEmailCache();
  const now = Date.now();
  const resolved: Record<string, string> = {};
  const notFound: { name: string; reason: string }[] = [];
  const todo: string[] = [];
  let cached = 0;

  for (const name of names) {
    const c = cache[name];
    if (c && now - c.at < CACHE_TTL_MS) {
      if (c.notFound) notFound.push({ name, reason: c.diag || '(캐시)' });
      else if (c.email) resolved[name] = c.email;
      cached++;
    } else {
      todo.push(name);
    }
  }

  let done = 0;
  for (const name of todo) {
    onProgress?.(done, todo.length, name);
    const result = await lookupCandidateEmail(name);
    if (result.email) {
      resolved[name] = result.email;
      cache[name] = { email: result.email, at: now, source: 'gmail', diag: result.reason };
    } else {
      notFound.push({ name, reason: result.reason });
      cache[name] = { email: '', at: now, source: 'gmail', notFound: true, diag: result.reason };
    }
    done++;
  }
  onProgress?.(done, todo.length, '');

  await saveEmailCache(cache);
  return { resolved, notFound, cached, fetched: todo.length };
}
