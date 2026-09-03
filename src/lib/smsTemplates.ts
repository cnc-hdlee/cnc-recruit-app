// 문자 양식 — 메일 양식과 완전히 분리해서 관리한다.
//
// 역할이 다르다:
//   메일 = 원문. 일정·장소·준비물·처우까지 필요한 정보를 다 담는다.
//   문자 = 알림. "결과 나왔으니 메일을 확인해달라"는 신호만 짧게 보낸다.
//
// 그래서 문자에는 결과 내용(합격/불합격 여부)이나 처우 숫자를 절대 넣지 않는다.
// 문자는 남의 눈에 잘 띄고 잘못 가면 되돌릴 수 없어서, 민감한 내용은 메일로만 간다.
// 90바이트(한글 45자)를 넘으면 LMS로 나가므로 기본 양식은 그 안에 맞춰 두었다.
import { api } from './api';
import type { TemplateStage } from './emailTemplates';

export interface SmsTemplate {
  /** 단계당 하나 — id가 곧 단계다 */
  stage: TemplateStage;
  name: string;
  text: string;
  modifiedAt?: number;
}

const STORE_KEY = 'smsTemplates';

const DEFAULTS: SmsTemplate[] = [
  {
    stage: 'interview_1st',
    name: '면접 안내 문자',
    text: `[씨앤씨인터내셔널] {{이름}}님, 면접 안내 메일을 확인해 주세요.
일정: {{면접일시}}`,
  },
  {
    stage: 'pass',
    name: '합격 안내 문자',
    text: `[씨앤씨인터내셔널] {{이름}}님, 면접 결과 안내 메일을 보내드렸습니다.
메일 확인 부탁드립니다.`,
  },
  {
    stage: 'offer',
    name: '처우협의 안내 문자',
    text: `[씨앤씨인터내셔널] {{이름}}님, 안내 메일을 보내드렸습니다.
메일 확인 후 회신 부탁드립니다.`,
  },
  {
    stage: 'onboarding',
    name: '최종 입사 안내 문자',
    text: `[씨앤씨인터내셔널] {{이름}}님, 입사 안내 메일을 보내드렸습니다.
메일 확인 부탁드립니다.`,
  },
  {
    stage: 'reject',
    name: '불합격 안내 문자',
    text: `[씨앤씨인터내셔널] {{이름}}님, 전형 결과 안내 메일을 보내드렸습니다.
메일 확인 부탁드립니다.`,
  },
  {
    stage: 'custom',
    name: '기타 문자',
    text: `[씨앤씨인터내셔널] {{이름}}님, 안내 메일을 보내드렸습니다.
메일 확인 부탁드립니다.`,
  },
];

/** 저장된 수정본이 있으면 그걸로, 없으면 기본 양식 */
export async function loadSmsTemplates(): Promise<SmsTemplate[]> {
  if (!api?.cfg) return DEFAULTS;
  try {
    const r = await api.cfg.get<SmsTemplate[]>(STORE_KEY);
    const saved = r.ok && Array.isArray(r.data) ? r.data : [];
    const byStage = new Map(saved.map((t) => [t.stage, t]));
    return DEFAULTS.map((d) => {
      const u = byStage.get(d.stage);
      return u && typeof u.text === 'string' ? { ...d, ...u } : d;
    });
  } catch {
    return DEFAULTS;
  }
}

export async function saveSmsTemplate(stage: TemplateStage, text: string): Promise<SmsTemplate[]> {
  const list = await loadSmsTemplates();
  const next = list.map((t) => (t.stage === stage ? { ...t, text, modifiedAt: Date.now() } : t));
  try {
    await api.cfg.set(STORE_KEY, next);
  } catch {
    /* 저장 실패해도 화면 상태는 유지 */
  }
  return next;
}

/** 기본 양식으로 되돌리기 */
export async function resetSmsTemplate(stage: TemplateStage): Promise<SmsTemplate[]> {
  const def = DEFAULTS.find((d) => d.stage === stage);
  return saveSmsTemplate(stage, def ? def.text : '');
}

export function defaultSmsText(stage: TemplateStage): string {
  return (DEFAULTS.find((d) => d.stage === stage) || DEFAULTS[DEFAULTS.length - 1]).text;
}

/** {{이름}} 등을 채운다. 값이 없는 변수는 빈 문자열이 아니라 그대로 남겨 눈에 띄게 한다. */
export function renderSms(text: string, vars: Record<string, string>): string {
  return (text || '').replace(/\{\{([^}]+)\}\}/g, (m, k) => {
    const v = vars[String(k).trim()];
    return v === undefined || v === '' ? m : v;
  });
}

/** 문자에서 쓸 수 있는 변수 목록 — 에디터에 안내용 */
export const SMS_VARS = ['이름', '면접일시', '소속', '사업장'];
