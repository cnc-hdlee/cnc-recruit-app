// 메일 양식 보관 — Phase 1.
// 기본 양식은 코드에 박혀있고, 사용자가 인앱 에디터에서 수정/추가하면 cfg에 저장.
// 로드 시: cfg에 있으면 cfg 우선, 없으면 기본값.
//
// 수신자 분류:
//   candidate — 후보자에게 보내는 메일
//   manager   — 현업 부서장에게 보내는 메일 (Phase 2에서 활용)

import { api } from './api';

export type TemplateRecipient = 'candidate' | 'manager';
export type TemplateStage =
  | 'interview_1st' // 1차 면접 안내 (후보자)
  | 'pass' // 1차 면접 합격 안내 (후보자)
  | 'offer' // 처우협의 안내 (후보자, 잠금)
  | 'onboarding' // 최종 입사 안내 (후보자)
  | 'reject' // 불합격 안내 (후보자)
  | 'custom'; // 사용자 정의

// 실제 채용 흐름 순서 그대로. (CPI 인성검사는 폐지되어 제거 · 2차 면접은 아직 미구현)
export const STAGE_ORDER: TemplateStage[] = ['interview_1st', 'pass', 'offer', 'onboarding', 'reject', 'custom'];
export const STAGE_LABEL: Record<TemplateStage, string> = {
  interview_1st: '1차 면접 안내',
  pass: '1차 합격 안내',
  offer: '처우협의 안내',
  onboarding: '최종 입사 안내',
  reject: '불합격 안내',
  custom: '기타',
};

export interface EmailTemplate {
  id: string;
  name: string;
  recipient: TemplateRecipient;
  stage: TemplateStage;
  subject: string;
  body: string;
  // {{이름}} 같은 표시용 변수 키 목록. 자동 추출도 가능하지만 명시적으로 두면 에디터에서 표시 편리.
  variables: string[];
  // 사업장 전용 양식이면 사이트 id ('purple' | 'yongin'), 전 사업장 공통이면 null/undefined.
  // 퍼플카운티/용인은 장소·일정·처우 문구가 달라 양식을 따로 고를 수 있어야 한다는 요구(2026-08).
  siteId?: string | null;
  // 본부 전용 양식이면 본부 id ('prod' | 'sales' | 'rnd' | 'csol'), 전 본부 공통이면 null/undefined.
  hqId?: string | null;
  builtin: boolean; // 코드에 박힌 기본 양식이면 true (덮어쓰지 않고 수정본은 별도 ID로)
  // 사용자가 수정한 빌트인 양식은 modifiedAt 기록
  modifiedAt?: number;
  createdAt: number;
}

// 기본 양식 4개 — 형도님이 1차로 알려준 양식 그대로
const DEFAULTS: EmailTemplate[] = [
  {
    id: 'builtin-interview-1st',
    name: '1차 면접 안내 (서류합격 → 면접)',
    recipient: 'candidate',
    stage: 'interview_1st',
    subject: '[(주)씨앤씨인터내셔널] 1차 면접 안내 - {{이름}}님',
    body: `안녕하세요. {{이름}}님,
(주)씨앤씨인터내셔널 채용팀 이형도입니다.

아래와 같이 면접 안내 드리오니 아래의 일정 확인 부탁드립니다.

일정 : {{면접일시}}

장소 : {{면접장소}}{{장소안내}}

사전 질문지 링크 : {{사전질문지URL}}     ※사전질문지는 면접 하루 전까지 완료 부탁드립니다.

관련하여 궁금하신 내용은 편히 연락 부탁드립니다.
편안한 하루 보내시길 바랍니다.

감사합니다.`,
    variables: ['이름', '면접일시', '면접장소', '장소안내', '사전질문지URL'],
    builtin: true,
    createdAt: 0,
  },
  {
    id: 'builtin-pass',
    name: '1차 면접 합격 안내',
    recipient: 'candidate',
    stage: 'pass',
    subject: '[(주)씨앤씨인터내셔널] 1차 면접 결과 안내 - {{이름}}님',
    body: `안녕하세요 {{이름}}님,
(주)씨앤씨인터내셔널 채용팀입니다.

1차 면접 합격을 축하드립니다.

이어서 처우협의 안내 드릴 예정이며,
처우 관련 내용은 별도 메일로 다시 안내드리겠습니다.

궁금하신 내용은 편히 연락 부탁드립니다.

감사합니다.`,
    variables: ['이름'],
    builtin: true,
    createdAt: 0,
  },
  {
    id: 'builtin-reject',
    name: '불합격 안내 (전 단계 공용)',
    recipient: 'candidate',
    stage: 'reject',
    subject: '[(주)씨앤씨인터내셔널] 채용 전형 결과 안내 - {{이름}}님',
    body: `안녕하세요. {{이름}}님
(주)씨앤씨인터내셔널 채용팀입니다.

당사에 대한 관심과 함께 {{지원직무}} 포지션에 지원해주셔서 감사드립니다.
아쉽게도 이번 채용에서는 {{이름}}님을 모시지 못하게 되었습니다.

이번 채용에서는 함께하지 못하지만 추후 더 좋은 인연으로 만나 뵐 수 있었으면 좋겠습니다.

저희 회사에 지원해주셔서 다시 한번 감사드리며 앞으로도 건강하시고 하시는 일에 항상 성공과 행복이 가득하시길 바랍니다.

감사합니다.`,
    variables: ['이름', '지원직무'],
    builtin: true,
    createdAt: 0,
  },
  {
    id: 'builtin-offer',
    name: '처우협의 (수기 입력 전용 · 잠금)',
    recipient: 'candidate',
    stage: 'offer',
    subject: '[(주)씨앤씨인터내셔널] 처우 안내 - {{이름}}님',
    body: `안녕하세요. {{이름}}님,
(주)씨앤씨인터내셔널 채용팀 이형도입니다.

면접 합격을 축하드리며 처우 안내 드리오니 확인 부탁드립니다.

1. 부서 : {{부서}}
2. 직무 : {{직무}}
3. 입사일 : {{입사일}} **불가능할 시 가능한 일정 회신 부탁드립니다**
4. 인정 경력 : {{인정경력}}
5. 직급 : {{직급}}
6. 급여
  - 연봉 : {{연봉}}원
  - 기본급 : {{기본급}}원
  - 시간외수당 : {{시간외수당}}원 (월 {{시간외시간}}시간)
  - 월 {{월급여}}원

※세전 기준

최종합격에 대한 안내는 아니며 처우에 대한 동의 여부 말씀 주시면 내부 결재 진행 예정이며,
결재 완료 후 최종 입사 안내 예정입니다.

감사합니다.`,
    variables: ['이름', '부서', '직무', '입사일', '인정경력', '직급', '연봉', '기본급', '시간외수당', '시간외시간', '월급여'],
    builtin: true,
    createdAt: 0,
  },
  {
    id: 'builtin-onboarding',
    name: '최종 입사 안내 (결재 완료 후)',
    recipient: 'candidate',
    stage: 'onboarding',
    subject: '[(주)씨앤씨인터내셔널] 최종 입사 안내 - {{이름}}님',
    body: `안녕하세요. {{이름}}님,
(주)씨앤씨인터내셔널 채용팀 이형도입니다.

내부 결재가 완료되어 최종 입사 안내 드립니다.

1. 입사일 : {{입사일}}
2. 부서 : {{부서}}
3. 직무 : {{직무}}
4. 출근 시간 : {{출근시간}}
5. 장소 : {{입사장소}}{{장소안내}}

입사 당일 구비 서류는 아래와 같습니다.
{{구비서류}}

궁금하신 내용은 편히 연락 부탁드립니다.
입사를 진심으로 환영합니다.

감사합니다.`,
    variables: ['이름', '입사일', '부서', '직무', '출근시간', '입사장소', '장소안내', '구비서류'],
    builtin: true,
    createdAt: 0,
  },
];

const STORE_KEY = 'emailTemplates';

// 사용자 수정본/추가본을 cfg에서 가져와 기본값과 머지.
// 같은 id로 사용자 수정본이 있으면 그게 우선.
export async function loadTemplates(): Promise<EmailTemplate[]> {
  if (!api?.cfg) return DEFAULTS;
  try {
    const r = await api.cfg.get<EmailTemplate[]>(STORE_KEY);
    // CPI 인성검사 폐지(2026-08) — 저장소에 남아있는 옛 양식은 로드 시 걸러낸다.
    const raw = r.ok && Array.isArray(r.data) ? r.data : [];
    const userList = raw
      .filter((t) => t.id !== 'builtin-cpi')
      .map((t) => ((t.stage as string) === 'cpi' ? { ...t, stage: 'custom' as TemplateStage } : t));
    const userById = new Map(userList.map((t) => [t.id, t]));
    const merged: EmailTemplate[] = [];
    // 기본 양식 — 사용자 수정본이 있으면 그걸로 대체
    for (const d of DEFAULTS) {
      merged.push(userById.get(d.id) || d);
    }
    // 사용자 추가 양식 (builtin=false)
    for (const u of userList) {
      if (!DEFAULTS.find((d) => d.id === u.id)) merged.push(u);
    }
    return merged;
  } catch {
    return DEFAULTS;
  }
}

// 단일 양식 저장/추가. cfg에 전체 리스트로 보관.
export async function saveTemplate(tpl: EmailTemplate): Promise<void> {
  if (!api?.cfg) return;
  const all = await loadTemplates();
  const idx = all.findIndex((t) => t.id === tpl.id);
  const next: EmailTemplate = {
    ...tpl,
    modifiedAt: Date.now(),
  };
  const list = [...all];
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  // 기본 양식 중 사용자 미수정인 것은 저장하지 않음 (저장소 깔끔)
  const toStore = list.filter((t) => !t.builtin || t.modifiedAt);
  await api.cfg.set(STORE_KEY, toStore);
}

// 양식 삭제. builtin은 삭제 대신 기본값으로 리셋.
export async function deleteTemplate(id: string): Promise<void> {
  if (!api?.cfg) return;
  const r = await api.cfg.get<EmailTemplate[]>(STORE_KEY);
  const userList = r.ok && Array.isArray(r.data) ? r.data : [];
  const next = userList.filter((t) => t.id !== id);
  await api.cfg.set(STORE_KEY, next);
}

export function createBlankTemplate(): EmailTemplate {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '새 양식',
    recipient: 'candidate',
    stage: 'custom',
    subject: '',
    body: '',
    variables: [],
    builtin: false,
    createdAt: Date.now(),
  };
}

// 본문/제목에서 {{변수}} 자동 추출
export function extractVariables(text: string): string[] {
  const matches = text.matchAll(/\{\{([^}]+)\}\}/g);
  return Array.from(new Set(Array.from(matches).map((m) => m[1].trim())));
}

// 변수 치환 (빈 값은 그대로 둠 → 발송 전 확인용)
export function renderTemplate(tpl: EmailTemplate, vars: Record<string, string>): { subject: string; body: string } {
  const sub = substitute(tpl.subject, vars);
  const body = substitute(tpl.body, vars);
  return { subject: sub, body };
}

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_m, k) => {
    const key = k.trim();
    const v = vars[key];
    return v == null || v === '' ? `{{${key}}}` : v;
  });
}

export function findMissingVars(rendered: string): string[] {
  const matches = rendered.matchAll(/\{\{([^}]+)\}\}/g);
  return Array.from(new Set(Array.from(matches).map((m) => m[1].trim())));
}

// Gmail compose URL — 외부 브라우저로 열어 사용자가 [Send] 직접 클릭 (안전)
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

// 발송 로그
export interface SendLogEntry {
  id: string;
  at: number;
  templateId: string;
  templateName: string;
  to: string;
  subject: string;
  variables: Record<string, string>;
}

const LOG_KEY = 'emailSendLog';
const MAX_LOG = 500;

export async function appendSendLog(entry: Omit<SendLogEntry, 'id' | 'at'>): Promise<void> {
  if (!api?.cfg) return;
  try {
    const cur = await api.cfg.get<SendLogEntry[]>(LOG_KEY);
    const list = cur.ok && Array.isArray(cur.data) ? cur.data : [];
    const next: SendLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      ...entry,
    };
    await api.cfg.set(LOG_KEY, [next, ...list].slice(0, MAX_LOG));
  } catch {
    // non-fatal
  }
}

export async function loadSendLog(): Promise<SendLogEntry[]> {
  if (!api?.cfg) return [];
  try {
    const r = await api.cfg.get<SendLogEntry[]>(LOG_KEY);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  } catch {
    return [];
  }
}

// 후보자 이메일 캐시 (수기 입력 → 영구 보존)
const EMAIL_CACHE_KEY = 'candidateEmailManual';

export async function loadEmailCache(): Promise<Record<string, string>> {
  if (!api?.cfg) return {};
  try {
    const r = await api.cfg.get<Record<string, string>>(EMAIL_CACHE_KEY);
    return r.ok && r.data ? r.data : {};
  } catch {
    return {};
  }
}

export async function saveEmail(name: string, email: string): Promise<void> {
  if (!api?.cfg) return;
  const cur = await loadEmailCache();
  cur[name] = email;
  await api.cfg.set(EMAIL_CACHE_KEY, cur);
}
