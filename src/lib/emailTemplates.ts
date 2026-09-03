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
  | 'interview_1st' // 면접 안내 (후보자) — 면접을 잡고 보내는 안내
  | 'pass' // 합격 안내 (후보자) — 면접 결과는 합격/불합격 둘 중 하나다
  | 'offer' // 처우협의 안내 (후보자, 잠금)
  | 'onboarding' // 최종 입사 안내 (후보자)
  | 'reject' // 불합격 안내 (후보자)
  | 'custom'; // 사용자 정의

// 실제 채용 흐름 순서 그대로. (CPI 인성검사는 폐지되어 제거 · 2차 면접은 아직 미구현)
export const STAGE_ORDER: TemplateStage[] = ['interview_1st', 'pass', 'offer', 'onboarding', 'reject', 'custom'];
export const STAGE_LABEL: Record<TemplateStage, string> = {
  // 면접 전(안내) → 면접 후 결과는 합격/불합격 두 갈래만.
  // '1차 면접 안내'와 '1차 합격 안내'가 나란히 있으면 라벨이 겹쳐 헷갈린다(2026-09-03).
  interview_1st: '면접 안내',
  pass: '합격 안내',
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
    name: '면접 안내 (서류합격 → 면접)',
    recipient: 'candidate',
    stage: 'interview_1st',
    subject: '[(주)씨앤씨인터내셔널] 면접 안내 - {{이름}}님',
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
    subject: '[(주)씨앤씨인터내셔널] {{이름}}님 입사 안내드립니다.',
    body: `안녕하세요. {{이름}}님,

(주)씨앤씨인터내셔널 인사팀 이형도입니다.

{{이름}}님이 가지고 계신 역량이 (주)씨앤씨인터내셔널 성장에
큰 힘이 될 것이라는 기대와 함께 다음과 같이 입사 안내 드립니다.

□ 부서 : {{부서}}

□ 입사일 : {{입사일}}
  ※입사 당일 8시 30분까지 {{근무지}}로 출근하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.
  ※{{입사장소}}

□ 근무지 : {{근무지}}

□ 통근버스 정보 : https://sites.google.com/cnccosmetic.com/bus

1. 채용 건강 검진
  가. [색신 검사가 포함된 일반채용 건강검진] 실시
  나. 건강검진 결과서 1부는 사전 확인용으로 입사일 전까지 제출
  다. 제출처 : taac@cnccosmetic.com

2. 제출 서류 (PDF파일 이메일 제출 必)
  가. 주민등록등본 1부 (뒷자리 포함)
  나. 기업은행 계좌 사본 1부
  다. 증명사진 1부
  라. 졸업증명서 및 성적증명서 각 1부
  마. 건강검진 결과서 1부
  바. 건강검진 영수증 1부 (비용 정산용, 제출 시 최대 3만원 지급)
  사. 경력증명서 1부 (경력자에 한함)

3. 처우 안내
  가. 직급 : {{직급}}
  나. 계약연봉 : {{연봉}}원
      - (A) 기본급 : {{기본급}}원
      - (B) PI 수당 : {{PI수당}}원
      - (A)+(B) : 月 {{월급여}}원 *월 만근 기준
  시용계약 기간 3개월 후 평가를 통해 정규직 전환, 급여 100% 지급
※ 계약연봉 및 월 급여액 세전 기준

4. 유의사항
  1. 채용건강검진 결과에 따라 입사가 취소될 수 있으니 참고해주시기 바랍니다.
  2. 제출 서류는 taac@cnccosmetic.com 으로 제출해 주시기 바랍니다.
  3. 건강검진은 결과 수령까지 평균 1~3일 소요되므로, 여유 있게 진행 부탁드립니다.
  4. 입사 당일에 모든 채용서류를 제출하지 않을 경우 입사가 유예되거나 채용이 취소될 수 있습니다.
  5. 연봉을 포함한 처우 내용은 제 3자에게 누설하지 않도록 각별한 주의 부탁드립니다.

입사 관련하여 궁금하신 내용은 언제든지 연락 부탁드리며
다시 한번 입사를 축하드립니다.

감사합니다.
이형도 드림`,
    variables: ['이름', '부서', '입사일', '근무지', '입사장소', '직급', '연봉', '기본급', 'PI수당', '월급여'],
    builtin: true,
    createdAt: 0,
  },
  {
    // 그린카운티(용인)는 처우에 '용인 수당'이 추가로 붙는다 — 사업장 전용 양식.
    id: 'builtin-onboarding-yongin',
    name: '최종 입사 안내 — 그린카운티(용인) 전용',
    recipient: 'candidate',
    stage: 'onboarding',
    siteId: 'yongin',
    subject: '[(주)씨앤씨인터내셔널] {{이름}}님 입사 안내드립니다.',
    body: `안녕하세요. {{이름}}님,

(주)씨앤씨인터내셔널 인사팀 이형도입니다.

{{이름}}님이 가지고 계신 역량이 (주)씨앤씨인터내셔널 성장에
큰 힘이 될 것이라는 기대와 함께 다음과 같이 입사 안내 드립니다.

□ 부서 : {{부서}}

□ 입사일 : {{입사일}}
  ※입사 당일 8시 30분까지 그린카운티(용인)로 출근하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.
  ※그린카운티 : 경기도 용인시 처인구 이동읍 덕성산단1로 28번길 12-1, (주)씨앤씨인터내셔널 그린카운티

□ 근무지 : 그린카운티
  (경기도 용인시 처인구 이동읍 덕성산단1로 28번길 12-1)

□ 통근버스 정보 : https://sites.google.com/cnccosmetic.com/bus

1. 채용 건강 검진
  가. [색신 검사가 포함된 일반채용 건강검진] 실시
  나. 건강검진 결과서 1부는 사전 확인용으로 입사일 전까지 제출
  다. 제출처 : taac@cnccosmetic.com

2. 제출 서류 (PDF파일 이메일 제출 必)
  가. 주민등록등본 1부 (뒷자리 포함)
  나. 기업은행 계좌 사본 1부
  다. 증명사진 1부
  라. 졸업증명서 및 성적증명서 각 1부
  마. 건강검진 결과서 1부
  바. 건강검진 영수증 1부 (비용 정산용, 제출 시 최대 3만원 지급)
  사. 경력증명서 1부 (경력자에 한함)

3. 처우 안내
  가. 직급 : {{직급}}
  나. 계약연봉 : {{연봉}}원
      - (A) 기본급 : {{기본급}}원
      - (B) PI 수당 : {{PI수당}}원
      - (C) 용인 수당 : {{용인수당}}원
      - (A)+(B)+(C) : 月 {{월급여}}원 *월 만근 기준
  시용계약 기간 3개월 후 평가를 통해 정규직 전환, 급여 100% 지급
※ 계약연봉 및 월 급여액 세전 기준

4. 유의사항
  1. 채용건강검진 결과에 따라 입사가 취소될 수 있으니 참고해주시기 바랍니다.
  2. 제출 서류는 taac@cnccosmetic.com 으로 제출해 주시기 바랍니다.
  3. 건강검진은 결과 수령까지 평균 1~3일 소요되므로, 여유 있게 진행 부탁드립니다.
  4. 입사 당일에 모든 채용서류를 제출하지 않을 경우 입사가 유예되거나 채용이 취소될 수 있습니다.
  5. 연봉을 포함한 처우 내용은 제 3자에게 누설하지 않도록 각별한 주의 부탁드립니다.

입사 관련하여 궁금하신 내용은 언제든지 연락 부탁드리며
다시 한번 입사를 축하드립니다.

감사합니다.
이형도 드림`,
    variables: ['이름', '부서', '입사일', '직급', '연봉', '기본급', 'PI수당', '용인수당', '월급여'],
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

// ── 메일 서명 & 숨은참조 ────────────────────────────────────────────────────
const SIG_KEY = 'mailSignature'; // { text, image: { base64, mimeType, name } }
const BCC_KEY = 'mailAutoBcc';

export interface MailSignature {
  text: string;
  image: { base64: string; mimeType: string; name: string } | null;
}

/** TA팀 공유용 기본 숨은참조 — 김범준 팀장 / 임한결 주임 */
export const DEFAULT_AUTO_BCC = ['bjkim4@cnccosmetic.com', 'hglim@cnccosmetic.com'];

export async function loadSignature(): Promise<MailSignature> {
  if (!api?.cfg) return { text: '', image: null };
  try {
    const r = await api.cfg.get<MailSignature>(SIG_KEY);
    return r.ok && r.data ? { text: r.data.text || '', image: r.data.image || null } : { text: '', image: null };
  } catch {
    return { text: '', image: null };
  }
}

export async function saveSignature(sig: MailSignature): Promise<void> {
  if (!api?.cfg) return;
  await api.cfg.set(SIG_KEY, sig);
}

export async function loadAutoBcc(): Promise<string[]> {
  if (!api?.cfg) return DEFAULT_AUTO_BCC;
  try {
    const r = await api.cfg.get<string[]>(BCC_KEY);
    return r.ok && Array.isArray(r.data) ? r.data : DEFAULT_AUTO_BCC;
  } catch {
    return DEFAULT_AUTO_BCC;
  }
}

export async function saveAutoBcc(list: string[]): Promise<void> {
  if (!api?.cfg) return;
  await api.cfg.set(BCC_KEY, list);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 본문(평문) + 서명 → HTML 메일 본문.
 * 서명 이미지는 cid:sig 로 참조하고, 실제 이미지는 발송 시 함께 실려 나간다.
 */
export function buildHtmlBody(text: string, sig: MailSignature): string {
  const body = escapeHtml(text || '').replace(/\r?\n/g, '<br>');
  const sigText = sig.text ? `<div style="margin-top:4px">${escapeHtml(sig.text).replace(/\r?\n/g, '<br>')}</div>` : '';
  const sigImg = sig.image ? '<div style="margin-top:8px"><img src="cid:sig" style="max-width:420px;border:0" alt=""></div>' : '';
  const block = sigText || sigImg
    ? `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;color:#374151;font-size:13px">${sigText}${sigImg}</div>`
    : '';
  return `<div style="font-family:'Malgun Gothic','맑은 고딕',Apple SD Gothic Neo,sans-serif;font-size:14px;line-height:1.7;color:#111">${body}${block}</div>`;
}

// 이력서에서 자동으로 뽑아낸 주소 — 수기 입력값과 섞이지 않게 별도 보관한다.
// (수기 > 자동 우선순위. 자동값이 틀리면 이력서만 고치면 다시 뽑힌다)
const EMAIL_AUTO_KEY = 'candidateEmailFromResume';

export async function loadAutoEmailCache(): Promise<Record<string, string>> {
  if (!api?.cfg) return {};
  try {
    const r = await api.cfg.get<Record<string, string>>(EMAIL_AUTO_KEY);
    return r.ok && r.data ? r.data : {};
  } catch {
    return {};
  }
}

export async function saveAutoEmail(name: string, email: string): Promise<void> {
  if (!api?.cfg) return;
  const cur = await loadAutoEmailCache();
  if (cur[name] === email) return;
  cur[name] = email;
  await api.cfg.set(EMAIL_AUTO_KEY, cur);
}
