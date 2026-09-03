// 후보자 안내 메일 — 면접 캘린더 일정 기준 발송.
//
// 흐름: 사업장(퍼플카운티/용인) → 본부(생산/영업/연구소/크솔) → 단계 양식 선택
//       → 면접 캘린더에 잡힌 후보자 목록에서 상대 메일 주소만 넣고 [발송]
// 발송은 Gmail API 직접 발송(gmail.send). 사용자가 버튼을 누른 경우에만 나간다 — 자동 발송 경로 없음.
// 처우협의(offer)만 예외로 잠금 유지: 자동 prefill 금지 + 2단계 확인.
//
// 단계: 면접 안내 → (면접) → 합격 안내 / 불합격 안내 → 처우협의 → 최종 입사 안내
//       CPI 인성검사는 폐지(2026-08)되어 제거. 2차 면접은 아직 미구현.

import { useEffect, useMemo, useRef, useState } from 'react';
import { IS_VIEWER } from '../lib/mode';
import { INTERVIEW_CAL_IDS } from '../lib/sharedCalendars';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { isInterviewKind, parseInterviewTitle } from './CalendarPage';
import { api } from '../lib/api';
import type { SmsConfig } from '../lib/api';
import {
  loadSmsTemplates,
  saveSmsTemplate,
  resetSmsTemplate,
  renderSms,
  defaultSmsText,
  SMS_VARS,
  type SmsTemplate,
} from '../lib/smsTemplates';
import {
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  createBlankTemplate,
  extractVariables,
  renderTemplate,
  findMissingVars,
  gmailComposeUrl,
  appendSendLog,
  loadSendLog,
  loadEmailCache,
  loadAutoEmailCache,
  saveAutoEmail,
  saveEmail,
  loadSignature,
  saveSignature,
  loadAutoBcc,
  saveAutoBcc,
  buildHtmlBody,
  DEFAULT_AUTO_BCC,
  type MailSignature,
  STAGE_ORDER,
  STAGE_LABEL,
  type EmailTemplate,
  type TemplateStage,
  type SendLogEntry,
} from '../lib/emailTemplates';
import {
  loadSites,
  saveSites,
  loadHqs,
  saveHqs,
  loadHqOverrides,
  saveHqOverride,
  loadExcludeNames,
  saveExcludeNames,
  inferHq,
  inferSite,
  HQ_UNSET,
  type MailSite,
  type MailHq,
} from '../lib/mailPresets';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];

function whenLabel(dt: string, tm: string): string {
  if (!dt) return '';
  const [y, mo, d] = dt.split('-').map(Number);
  const date = new Date(y, (mo || 1) - 1, d || 1);
  const [h, mi] = (tm || '').split(':');
  const time = h ? ` ${Number(h)}시 ${mi || '00'}분` : '';
  return `${mo}월 ${d}일(${DAY[date.getDay()]})${time}`;
}


// ── 후보자 목록 기간 기준 ───────────────────────────────────────────────────
// 기본값은 항상 "전체"다. 한 화면에서 면접 안내 / 합격 / 처우협의 / 불합격 안내를
// 다 처리하기 때문에, 기간으로 사람을 미리 잘라내면 반드시 누가 사라진다.
// (2026-09: 면접을 마친 서현·박강선 님이 처우협의 화면에서 통째로 안 보였던 원인)
// 좁혀 보고 싶을 때만 사용자가 예정/지난을 직접 고른다.
type RangeMode = 'upcoming' | 'past' | 'all';

// 면접을 이미 본 사람이 대상인 단계 — 안내 문구용 (목록을 자르는 데는 쓰지 않는다)
const POST_INTERVIEW_STAGES: TemplateStage[] = ['pass', 'offer', 'onboarding', 'reject'];

/**
 * 채용 흐름에서 바로 앞 단계.
 * 앞 단계를 끝낸 사람이 다음 단계 대기열에 묻혀 있으면 놓치기 쉽다
 * ("1차 합격 안내는 보냈는데 처우협의가 안 나갔다" — 2026-09-03 김보민 님 건).
 * 이 표로 "이전 단계 완료만" 필터를 만들어 다음에 할 일을 바로 집어낸다.
 */
const PREV_STAGE: Partial<Record<TemplateStage, TemplateStage>> = {
  pass: 'interview_1st',
  offer: 'pass',
  onboarding: 'offer',
};

/**
 * 채용 흐름 순서. 단계는 순서이므로 뒷 단계를 처리했으면 앞 단계는 이미 끝난 것이다.
 * 합격 안내를 보냈으면 면접 안내는 당연히 나갔다 — 그런데도 앞 단계 대기열에 남아 있었다
 * (2026-09-03 김보민 님: 합격 문자까지 보냈는데 '면접 안내'에 그대로 있었다).
 */
const FLOW: TemplateStage[] = ['interview_1st', 'pass', 'offer', 'onboarding'];

function defaultRange(_stage: TemplateStage): RangeMode {
  return 'all';
}

// ── 문자(SMS) ──────────────────────────────────────────────────────────────
// 앱이 직접 문자를 쏘려면 발신번호 사전등록 + 유료 문자 API 계약이 필요하다(회사 명의).
// 그 전까지는 "번호와 문구를 완성해서 손에 쥐여주는" 데까지 앱이 한다 —
// 클립보드에 넣고 구글 메시지 웹 / Windows 휴대폰과 연결을 열면 붙여넣기만 하면 된다.
// 발송 흐름을 실제 후보자에게 쏘기 전에 끝까지 확인해보기 위한 가짜 후보자.
// 캘린더·시트에는 전혀 손대지 않고 목록에만 얹는다. [🧪 테스트] 버튼으로 켜고 끈다.
const TEST_CANDIDATE_NAME = 'test 이형도';
const TEST_PHONE_CFG_KEY = 'smsTestPhone';

const SMS_APPS = [
  { id: 'google', label: '구글 메시지 웹', url: 'https://messages.google.com/web', help: '안드로이드 폰 QR 연결 — PC에서 바로 문자 발송' },
  { id: 'phonelink', label: '휴대폰과 연결', url: 'ms-phone:', help: 'Windows 기본 앱 — 안드로이드/아이폰 문자 송수신' },
];

/** 010-1234-5678 / +82 10-1234-5678 → 01012345678 (붙여넣기용 정규화) */
function normalizePhone(raw: string): string {
  const d = (raw || '').replace(/[^0-9+]/g, '').replace(/^\+82/, '0');
  return d.replace(/[^0-9]/g, '');
}

function prettyPhone(raw: string): string {
  const d = normalizePhone(raw);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw || '';
}

/** 한국 문자 과금 기준 — EUC-KR 기준 한글 2바이트, 90바이트까지 SMS */
function smsBytes(text: string): number {
  let n = 0;
  for (const ch of text || '') n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 클립보드 권한이 없는 환경 — 숨은 textarea로 폴백
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// ── 처리 큐 ────────────────────────────────────────────────────────────────
// 면접을 본 사람은 날짜가 지났다고 목록에서 사라지면 안 된다.
// "작업자가 여기서 처리해야만 내려간다"가 원칙 — 발송하거나 [처리]를 누른 건만 대기열에서 빠진다.
// 처리 기록은 <이름>::<단계>로 남아, 같은 사람도 단계별로 따로 관리된다.
// 불합격 처리된 사람은 다른 단계에서도 대기열에 뜨지 않는다(채용이 끝난 사람이므로).
type HandledMark = { at: string; via: 'send' | 'manual'; stage: TemplateStage };
type HandledMap = Record<string, HandledMark>;
const HANDLED_CFG_KEY = 'mailHandledCandidates';
const handledKey = (name: string, stage: TemplateStage) => `${name}::${stage}`;

async function loadHandled(): Promise<HandledMap> {
  try {
    const r = await api.cfg.get<HandledMap>(HANDLED_CFG_KEY);
    return (r.ok && r.data) || {};
  } catch {
    return {};
  }
}

async function saveHandled(map: HandledMap): Promise<void> {
  try {
    await api.cfg.set(HANDLED_CFG_KEY, map);
  } catch {
    /* 저장 실패해도 화면 상태는 유지 — 다음 처리 때 다시 저장된다 */
  }
}

const RANGE_TABS: { id: RangeMode; label: string; help: string }[] = [
  { id: 'all', label: '전체', help: '예정·지난 면접 모두 — 기본값' },
  { id: 'upcoming', label: '예정 면접', help: '오늘 이후 면접 — 면접 안내 메일 대상' },
  { id: 'past', label: '지난 면접', help: '이미 본 면접 — 합격·처우협의·입사·불합격 안내 대상' },
];

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

interface CalCandidate {
  key: string;
  name: string;
  team: string;
  dt: string;
  tm: string;
  when: string;
  siteId: string | null;
  hqId: string;
  location: string;
  email: string;
  /** (불참)/(노쇼) 등 제목에 붙은 상태 표기 */
  status: string;
  /** 캘린더 제목 원문 — 이름을 못 읽었을 때 화면에 그대로 보여준다 */
  rawTitle?: string;
  /** 파서가 이름을 못 읽은 건 — 목록에는 남기고 사용자가 직접 채운다 */
  needsName?: boolean;
  /** 제목에 "면접"이 없어 분류기가 놓쳤지만, TA팀이 회의실까지 잡은 일정 — 면접으로 의심 */
  suspect?: boolean;
}

// ── 후보자 판정 보정 ─────────────────────────────────────────
// 면접 캘린더에는 후보자 면접이 아닌 일정도 섞여 있고, 제목 포맷이 어긋나면
// 파서가 엉뚱한 토큰을 이름으로 잡는다. 메일은 사람에게 나가므로 여기서 한 번 더 거른다.
// (2026-08-31 실제 캘린더 46건 대조로 확인된 케이스들)

/** 아예 후보자 면접이 아닌 일정 — 제목에 걸리면 목록에서 뺀다 */
const NOT_CANDIDATE_EVENT =
  /도제실습|도제교육|교육|설명회|weekly|preview|미팅|회의|워크샵|간담회|웨비나|OJT|오리엔테이션|일자리센터|박람회|대기실|안내/i;

// ── "면접"이라는 단어가 없는 면접 ──────────────────────────────────────────
// 회의실만 잡고 면접 캘린더에는 안 올린 일정이 있다. 제목도 "전략구매팀 - 임수현(원료창고)"
// 처럼 면접 키워드가 없어서 분류기를 그냥 통과해버리고, 후보자 목록에서 통째로 빠졌다.
// (2026-09-03 임수현 건. 이력서까지 다 있는데 메일 화면에만 없었다)
//
// 제목만으로는 못 잡으니 일정의 다른 흔적을 본다 —
//   ① TA팀이 만든 일정이고  ② 회의실을 잡았고  ③ 제목에서 사람 이름이 나온다
// 셋이 다 맞으면 면접으로 의심하고 목록에 올린다. 확실하지 않으니 배지를 달아 표시한다.
// 빠뜨리는 것보다 한 번 더 보여주고 사용자가 지우는 편이 낫다.
const TA_EMAILS = ['hdlee@cnccosmetic.com', 'bjkim4@cnccosmetic.com', 'hglim@cnccosmetic.com'];
const RESOURCE_MAIL = /@resource\.calendar\.google\.com$/i;
const ROOM_HINT = /회의실|미팅룸|구내식당|식당|라운지|카페|세미나|대회의|소회의|집무실|VIP/i;
/** 제목이 "부서/팀 - 이름(직무)" 꼴인가 — 회의실 예약이 primary로 sync될 때 만들어지는 형태 */
const DASH_NAME_SHAPE = /[가-힣A-Za-z0-9]\s*[-—–]\s*[가-힣]{2,4}/;

// ── 제목 말고 다른 데서 이름 찾기 ────────────────────────────────────────
// 이름 칸을 사람이 채우게 두는 것 자체가 잘못이다. 일정에는 이미 근거가 있다 —
//   · 설명의 "후보자: 김보민(ERP)" (회의실 예약 페이지가 넣어준다)
//   · 붙어 있는 이력서 파일명 "이력서(생산1팀 PM -박현석).pdf"
// 제목 파서가 실패했을 때 이 둘을 차례로 본다.
const NOT_NAME_TOKEN =
  /^(이력서|면접|회의|미팅|일정|장소|예약|대기|후보|후보자|지원자|면접자|협의|경력|신입|사본|최종|서류|전형|제출|양식|파일|첨부|평가표|질문지|사전|가이드|안내|명단|서무|총괄|파트장|팀장|담당)$/;
const ORG_TAIL = /(팀|파트|실|센터|본부|그룹|스튜디오|랩)$/;
const SITE_TOKEN = /^(퍼플|그린|수원|서울|오산|위워크|본사|판교|강남|온라인)$/;
/** 이력서가 아닌 첨부 — 평가표·사전질문지에는 후보자 이름이 없거나 엉뚱한 이름이 들어 있다 */
const NOT_RESUME_FILE = /평가표|사전\s*질문|질문지|가이드|명단|일정표|양식/;
/** 흔한 성(姓) — 파일명 안에서 사람 이름과 업무 단어를 가르는 가장 확실한 신호 */
const KO_SURNAME =
  /^[김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제탁국진어편용봉피]/;

function nameFromText(text: string): string {
  // 구분자만 공백으로 바꾸고 토큰은 통째로 둔다.
  //   "생산1팀"에서 숫자만 지우면 "생산"이 남아 팀 이름이 사람 이름으로 둔갑한다.
  //   숫자·영문이 섞인 토큰은 사람 이름이 아니므로 통째로 버린다.
  const words = String(text || '')
    .replace(/\.(pdf|docx?|hwpx?|png|jpe?g)$/i, '')
    .split(/[^가-힣A-Za-z0-9]+/)
    .filter(Boolean);
  const ok = (w: string) =>
    /^[가-힣]{2,4}$/.test(w) && !NOT_NAME_TOKEN.test(w) && !ORG_TAIL.test(w) && !SITE_TOKEN.test(w);
  // 성으로 시작하는 토큰을 먼저 — 없으면 그 외 후보 중 첫 번째
  const cands = words.filter(ok);
  return cands.find((w) => KO_SURNAME.test(w)) || cands[0] || '';
}

/** 일정의 설명·첨부에서 후보자 이름을 되찾는다 */
function recoverName(raw: { description?: string; attachments?: { title: string }[] }): string {
  // ① 설명에 명시된 후보자 — 가장 믿을 만하다
  const m = String(raw.description || '').match(/후보자\s*[:：]\s*([가-힣]{2,4})/);
  if (m) return m[1];
  // ② 이력서 파일명
  for (const a of raw.attachments || []) {
    if (NOT_RESUME_FILE.test(a.title || '')) continue; // 평가표·사전질문지에는 후보자 이름이 없다
    const n = nameFromText(a.title);
    if (n) return n;
  }
  return '';
}

/** 사람 이름이 될 수 없는 토큰 — 파서가 이걸 이름으로 잡으면 그 건은 신뢰하지 않는다 */
const NOT_A_NAME = /^(대기|미정|공석|후보자|면접자|지원자|팀장|파트장|담당|담당자|신입|경력|인사팀|채용팀)$/;

/** 제목에 붙은 상태 표기 (불참/노쇼 등) — 메일 대상에서 기본 제외 */
const STATUS_RE = /\((불참|노쇼|no ?show|미참석|지각)\)/i;

/**
 * "생산운영팀장 이재민 후보자" 처럼 '후보자/지원자' 앞에 진짜 이름이 오는 포맷 보정.
 * 이 케이스에서 기본 파서는 이름을 '대기'(뒤 토큰)로 잡아 완전히 다른 사람이 된다.
 */
function fixCandidateName(title: string, parsed: string): string {
  const m = title.match(/([가-힣]{2,4})\s*(?:후보자|지원자|님)/);
  if (m && !NOT_A_NAME.test(m[1])) return m[1];
  return parsed;
}

/**
 * 보관함에 이력서가 없는 지원자 — 받은 메일에 첨부된 이력서를 찾아 거기서 주소를 읽는다.
 * 첨부는 저장하지 않고 그 자리에서 파싱만 한다 (이력서 보관함은 사용자가 직접 넣은 것만 유지).
 * 사전질문지·평가표는 이력서가 아니므로 제외 — 메모리 [이력서만 엄격].
 */
/** 연락처를 함께 쓰는 TA팀 — 내가 찾은 주소를 이들에게 공유하고, 이들이 찾은 것도 받아온다 */
const CONTACT_TEAM = ['hdlee@cnccosmetic.com', 'bjkim4@cnccosmetic.com', 'hglim@cnccosmetic.com'];

const RESUME_FILE_RE = /(이력서|경력기술서|자기소개서|resume|cv)/i;
const NOT_RESUME_FILE_RE = /(사전질문|평가표|면접표|안내문|양식)/i;

async function emailFromGmailResume(name: string): Promise<string> {
  if (!api?.google || !api?.resumes) return '';
  try {
    const r = await api.google.listGmail(`"${name}" has:attachment`, 6);
    if (!r.ok || !r.data?.length) return '';
    for (const msg of r.data) {
      const infos = msg.attachmentInfos || [];
      const pick = infos.find(
        (a) =>
          /\.(pdf|docx?)$/i.test(a.filename) &&
          !NOT_RESUME_FILE_RE.test(a.filename) &&
          (a.filename.includes(name) || RESUME_FILE_RE.test(a.filename))
      );
      if (!pick) continue;
      const f = await api.google.fetchAttachmentBase64(msg.id, pick.filename, pick.attachmentId);
      if (!f.ok || !f.data?.base64) continue;
      const c = await api.resumes.contactsFromData(f.data.base64, f.data.mimeType);
      if (c.ok && c.data?.email) return c.data.email;
    }
  } catch {
    // 메일을 못 읽어도 치명적이지 않다
  }
  return '';
}

/**
 * 면접 일정에 첨부된 이력서에서 주소를 읽는다.
 * 김범준 팀장처럼 다른 사람이 등록한 면접은 이력서가 내 PC에도, 내 메일에도 없고
 * 일정 첨부(드라이브)에만 있다. 드라이브 읽기 전용 권한으로 그 파일만 받아 파싱한다.
 */
export let driveScopeMissing = false;

async function emailFromCalendarAttachment(name: string, dt: string): Promise<string> {
  if (!api?.google?.driveFile || !api?.resumes) return '';
  try {
    const day = dt || new Date().toISOString().slice(0, 10);
    const from = new Date(`${day}T00:00:00+09:00`);
    from.setDate(from.getDate() - 1);
    const to = new Date(`${day}T00:00:00+09:00`);
    to.setDate(to.getDate() + 2);
    const cals = ['primary', ...INTERVIEW_CAL_IDS];
    for (const calId of cals) {
      const r = await api.google.listCalendar(from.toISOString(), to.toISOString(), calId);
      if (!r.ok || !r.data) continue;
      for (const ev of r.data) {
        if (!(ev.summary || '').includes(name)) continue;
        for (const att of ev.attachments || []) {
          if (!att.fileId) continue;
          if (NOT_RESUME_FILE_RE.test(att.title)) continue;
          if (!/\.(pdf|docx?)$/i.test(att.title) && !RESUME_FILE_RE.test(att.title)) continue;
          const f = await api.google.driveFile(att.fileId);
          if (!f.ok) {
            // 403 = 드라이브 읽기 권한이 아직 없음(스코프 추가 후 재로그인 전)
            if (/403|scope|permission/i.test(f.error || '')) driveScopeMissing = true;
            continue;
          }
          if (!f.data?.base64) continue;
          const c = await api.resumes.contactsFromData(f.data.base64, f.data.mimeType);
          if (c.ok && c.data?.email) return c.data.email;
        }
      }
    }
  } catch {
    // 드라이브 권한이 아직 없으면(재로그인 전) 조용히 넘어간다
  }
  return '';
}

export function EmailToolsPage() {
  useLiveData(); // 캘린더 폴링 갱신에 재렌더

  const [sites, setSites] = useState<MailSite[]>([]);
  const [hqs, setHqs] = useState<MailHq[]>([]);
  const [hqOverrides, setHqOverrides] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  // 이력서에서 자동으로 뽑은 주소 (수기 입력이 항상 우선)
  const [autoEmail, setAutoEmail] = useState<Record<string, string>>({});
  const autoTried = useRef<Set<string>>(new Set());
  const [log, setLog] = useState<SendLogEntry[]>([]);

  // 사업장 기본값은 '전체'.
  // 예전 기본값이 '퍼플'이라, 그린·수원에서 본 면접(정태우 등)이 목록에 아예 없었다.
  // 사업장은 좁혀 볼 때 쓰는 보조 필터일 뿐 사람을 지우는 기준이 되면 안 된다.
  const [siteId, setSiteId] = useState<string>('all');
  const [hqId, setHqId] = useState<string>('all');
  const [stage, setStage] = useState<TemplateStage>('interview_1st');
  const [tplId, setTplId] = useState<string | null>(null);
  // 기간 필터 — 기본은 항상 '전체'. 사용자가 직접 좁힐 때만 예정/지난으로 간다.
  const [range, setRange] = useState<RangeMode>('all');
  const [search, setSearch] = useState('');
  const [draftEmail, setDraftEmail] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // (불참)/(노쇼) 표시된 면접은 메일 대상이 아니므로 기본 제외, 필요하면 켠다
  const [includeAbsent, setIncludeAbsent] = useState(false);
  // 메일 대상에서 뺄 내부 인원 (TA팀 등) — 설정에서 편집
  const [excludeNames, setExcludeNames] = useState<string[]>([]);
  const [showDrops, setShowDrops] = useState(false);
  // 처리 완료 표시 — 발송했거나 작업자가 직접 [처리]를 누른 건
  const [handled, setHandled] = useState<HandledMap>({});
  // 이력서에서 자동으로 뽑은 휴대폰 번호 (메일 주소와 같은 경로로 채워진다)
  const [autoPhone, setAutoPhone] = useState<Record<string, string>>({});
  const [smsFor, setSmsFor] = useState<CalCandidate | null>(null);
  const [testOn, setTestOn] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [smsCfg, setSmsCfg] = useState<SmsConfig | null>(null);
  const [showSmsSetup, setShowSmsSetup] = useState(false);
  const [smsTpls, setSmsTpls] = useState<SmsTemplate[]>([]);
  // 파서가 못 읽은 이름을 화면에서 직접 채운 값 (key → 이름)
  const [nameFix, setNameFix] = useState<Record<string, string>>({});
  const [showSmsTpl, setShowSmsTpl] = useState(false);
  const [myEmail, setMyEmail] = useState('');
  const [showHandled, setShowHandled] = useState(false);
  /** 이전 단계를 끝낸 사람만 보기 — 다음에 할 일을 집어내는 필터 */
  const [onlyReady, setOnlyReady] = useState(false);
  // 목록에서 걸러낸 일정과 사유 — 조용히 사라지지 않게 화면에 남긴다
  const dropsRef = useRef<{ title: string; reason: string }[]>([]);

  const [editingTpl, setEditingTpl] = useState<EmailTemplate | null>(null);
  const [modal, setModal] = useState<{ template: EmailTemplate; candidate: CalCandidate } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // 메일 서명(그림 포함)과 자동 숨은참조
  const [signature, setSignature] = useState<MailSignature>({ text: '', image: null });
  const [autoBcc, setAutoBcc] = useState<string[]>(DEFAULT_AUTO_BCC);
  // 드라이브 읽기 권한이 없어 일정 첨부 이력서를 못 읽는 상태 (스코프 추가 후 최초 1회 재로그인 필요)
  const [needDriveAuth, setNeedDriveAuth] = useState(false);
  const driveAuthTried = useRef(false);
  const pushDirty = useRef(false);
  const phoneCache = useRef<Record<string, string>>({});
  // 재로그인 후 못 채운 주소를 한 번 더 훑기 위한 트리거
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    loadSites().then(setSites);
    // 제외 명단 = 설정값 + 지금 로그인한 본인 이름.
    // 본인이 만든 테스트 면접이 후보자로 잡히는 걸 팀원 누구에게나 자동으로 막는다.
    void (async () => {
      const list = await loadExcludeNames();
      let me: string | null = null;
      try {
        const prof = await api?.cfg?.get<{ name?: string }>('googleProfile');
        me = prof?.ok ? prof.data?.name?.trim() || null : null;
      } catch {
        me = null;
      }
      setExcludeNames(me ? [...new Set([...list, me])] : list);
    })();
    loadHqs().then(setHqs);
    loadHqOverrides().then(setHqOverrides);
    loadTemplates().then(setTemplates);
    loadEmailCache().then(setEmailMap);
    loadAutoEmailCache().then(setAutoEmail);
    // 팀원이 찾아둔 지원자 주소도 함께 불러온다 (누가 찾았든 셋 다 쓸 수 있게)
    void (async () => {
      try {
        const r = await api.google.contactsPull();
        if (r.ok && r.data && Object.keys(r.data.contacts).length) {
          setAutoEmail((prev) => ({ ...r.data!.contacts, ...prev }));
        }
        if (r.ok && r.data?.phones && Object.keys(r.data.phones).length) {
          setAutoPhone((prev) => ({ ...r.data!.phones, ...prev }));
        }
      } catch {
        /* 팀 공유 파일이 아직 없으면 그냥 넘어간다 */
      }
    })();
    loadSendLog().then(setLog);
    loadHandled().then(setHandled);
    api.cfg.get<string>(TEST_PHONE_CFG_KEY).then((r) => r.ok && r.data && setTestPhone(r.data));
    loadSmsTemplates().then(setSmsTpls);
    // 보관함 연락처 전체를 왕복 한 번에 받아 즉시 채운다.
    // (예전엔 후보자마다 따로 조회해서 40명이면 왕복이 40번, 화면이 한참 비어 있었다)
    void (async () => {
      try {
        const r = await api.resumes.contactsAll();
        if (!r.ok || !r.data) return;
        const em: Record<string, string> = {};
        const ph: Record<string, string> = {};
        for (const [name, v] of Object.entries(r.data)) {
          if (v.email) em[name] = v.email;
          if (v.phone) ph[name] = v.phone;
        }
        setAutoEmail((prev) => ({ ...em, ...prev }));
        setAutoPhone((prev) => ({ ...ph, ...prev }));
        phoneCache.current = { ...ph, ...phoneCache.current };
      } catch {
        /* 보관함이 비어 있으면 그냥 넘어간다 */
      }
    })();
    api.sms?.config().then((r) => r.ok && r.data && setSmsCfg(r.data));
    api.cfg.get<{ email?: string }>('googleProfile').then((r) => r.ok && r.data?.email && setMyEmail(r.data.email));
    loadSignature().then(setSignature);
    loadAutoBcc().then(setAutoBcc);
  }, []);

  const site = sites.find((s) => s.id === siteId) || sites[0] || null;

  // ── 면접 캘린더 → 후보자 목록 (캘린더 페이지와 동일한 분류기/파서 + 메일 전용 보정)
  const allCandidates = useMemo<CalCandidate[]>(() => {
    if (hqs.length === 0) return [];
    const out = new Map<string, CalCandidate>();
    const drops: { title: string; reason: string }[] = [];
    for (const e of liveCalendarEventsNormalized()) {
      // 종일 + 참석자 없음 + 장소 없음 = 면접이 아니라 to-do 메모다.
      //   "전략구매팀 면접자 일정 협의" 처럼 제목에 '면접'이 들어가도 실제 면접이 아니다.
      //   진짜 면접은 시간이 있고, 참석자나 회의실 중 하나는 반드시 있다.
      if (e.raw.allDay && !(e.raw.attendees || []).length && !(e.location || '').trim()) {
        drops.push({ title: e.title, reason: '종일 메모 — 면접 아님' });
        continue;
      }
      const classified = isInterviewKind(e.title, e.raw.colorId ?? null, e.raw.calendarId ?? null);
      // 분류기가 놓친 일정 — TA팀이 만들고 회의실을 잡은 "이름이 있는" 일정이면 면접으로 의심한다
      let suspect = false;
      if (!classified) {
        const by = (e.raw.creator?.email || e.raw.organizer?.email || '').toLowerCase();
        const byTA = TA_EMAILS.includes(by);
        const hasRoom =
          (e.raw.attendees || []).some((a) => RESOURCE_MAIL.test(a.email || '')) || ROOM_HINT.test(e.location || '');
        if (!byTA || !hasRoom || !DASH_NAME_SHAPE.test(e.title)) continue;
        suspect = true;
      }

      // ① 후보자 면접이 아닌 일정 (도제실습 / 교육 / 내부 미팅 등)
      if (NOT_CANDIDATE_EVENT.test(e.title)) {
        drops.push({ title: e.title, reason: '후보자 면접이 아님' });
        continue;
      }

      const p = parseInterviewTitle(e.title);
      const parsed = fixCandidateName(e.title, (p.candidate || '').trim());

      // ② 이름을 못 읽은 면접 — 지우지 않는다.
      //    면접을 본 사람은 무조건 목록에 있어야 한다는 게 원칙이다(형도님, 2026-09-02).
      //    제목 형식이 제각각이라 파서가 못 읽는 경우가 반드시 생기는데,
      //    그때 조용히 빼버리면 불합격 연락 대상이 통째로 증발한다.
      //    이름 칸을 비워 목록에 올리고 화면에서 직접 채우게 한다.
      const parsedBad = !parsed || parsed.length > 5 || NOT_A_NAME.test(parsed);
      // 제목에서 못 읽었으면 설명("후보자: OOO")과 이력서 첨부 파일명에서 되찾는다.
      // 사람에게 이름을 물어보는 건 마지막 수단이다.
      const recovered = parsedBad ? recoverName(e.raw) : '';
      const name = parsedBad ? recovered : parsed;
      const badName = !name;
      if (parsedBad) {
        drops.push({
          title: e.title,
          reason: recovered ? `이름을 첨부·설명에서 복구: ${recovered}` : '이름 인식 실패 — 목록에서 직접 입력',
        });
      }
      // ③ 내부 인원(TA팀 등) — 메일 대상이 아님
      if (name && excludeNames.includes(name)) {
        drops.push({ title: e.title, reason: `내부 인원(${name}) 제외` });
        continue;
      }

      // 의심 일정은 이름을 못 읽으면 근거가 없다 — 그때만 버린다
      if (suspect && badName) continue;
      const tm = e.tm || p.time || '';
      // 이름을 못 읽은 건은 제목으로 구분해야 서로 뭉개지지 않는다
      const key = `${e.dt}|${tm}|${name || 'title:' + e.title}`;
      if (out.has(key)) continue; // 캘린더 사본 중복 제거
      const teamText = [p.team, p.room, e.location].filter(Boolean).join(' ');
      const st = e.title.match(STATUS_RE);
      out.set(key, {
        key,
        name,
        team: p.team || '',
        dt: e.dt,
        tm,
        when: whenLabel(e.dt, tm),
        siteId: inferSite([p.site, e.location, e.title].filter(Boolean).join(' '), sites),
        hqId: hqOverrides[name] || inferHq(teamText, hqs),
        location: e.location || '',
        email: (name && (emailMap[name] || autoEmail[name])) || '',
        status: st ? st[1] : '',
        rawTitle: e.title,
        needsName: badName,
        suspect,
      });
    }
    dropsRef.current = drops;
    return [...out.values()].sort((a, b) => (a.dt + a.tm).localeCompare(b.dt + b.tm));
  }, [sites, hqs, hqOverrides, emailMap, autoEmail, excludeNames]);

  // ── 이력서 → 받는 사람 주소 자동 인입 ────────────────────────────────────
  // 메일 주소를 손으로 치지 않게, 이력서 보관함의 원본 PDF에서 지원자 이메일을 읽어 채운다.
  // 한 번 찾은 값은 캐시되므로 다음부터는 즉시 뜬다. 수기로 고친 주소는 절대 덮어쓰지 않는다.
  useEffect(() => {
    if (IS_VIEWER || !api?.resumes) return;
    const targets = allCandidates
      .filter((c) => !c.email && !autoPhone[c.name] && c.name && !autoTried.current.has(c.name))
      .slice(0, 60);
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      // 한 명씩 차례로 돌면 사람 수만큼 네트워크 왕복이 직렬로 쌓인다(40명이면 체감 수십 초).
      // Gmail·드라이브 조회는 서로 독립이므로 동시에 몇 건씩 굴린다.
      const LANES = 5;
      let cursor = 0;
      const lookup = async (c: CalCandidate) => {
        try {
          // ① 이력서 보관함
          let found = '';
          const r = await api.resumes.contactsByName(c.name);
          if (r.ok && r.data?.email) found = r.data.email;
          // 문자 발송용 휴대폰 번호도 같은 이력서에서 함께 읽어둔다
          if (r.ok && r.data?.phone) {
            const ph = r.data.phone;
            setAutoPhone((prev) => (prev[c.name] ? prev : { ...prev, [c.name]: ph }));
            phoneCache.current[c.name] = ph;
            pushDirty.current = true;
          }
          // ② 보관함에 없으면 — 메일에 첨부된 이력서를 찾아 그 자리에서 읽는다 (저장은 안 함)
          if (!found) found = await emailFromGmailResume(c.name);
          // ③ 그래도 없으면 면접 일정에 첨부된 이력서(드라이브)에서
          if (!found) found = await emailFromCalendarAttachment(c.name, c.dt);
          if (!found || cancelled) return;
          setAutoEmail((p) => ({ ...p, [c.name]: found }));
          await saveAutoEmail(c.name, found);
          pushDirty.current = true;
        } catch {
          // 이력서가 없거나 못 읽는 형식 — 수기 입력으로 남겨둔다
        }
      };
      const lane = async () => {
        while (!cancelled) {
          const i = cursor++;
          if (i >= targets.length) return;
          autoTried.current.add(targets[i].name);
          await lookup(targets[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(LANES, targets.length) }, lane));
      // 드라이브 권한이 없어 일정 첨부 이력서를 못 읽었다면 — 물어보지 말고 바로 로그인 창을 띄운다.
      // (권한 동의 클릭만 사용자가 하면 되고, 끝나면 못 채운 주소를 자동으로 다시 채운다)
      // 새로 찾은 주소가 있으면 팀에 올린다 (한 번에 모아서)
      if (pushDirty.current && !cancelled) {
        pushDirty.current = false;
        try {
          const cache = await loadAutoEmailCache();
          const me = ((await api.cfg.get<{ email?: string }>('googleProfile'))?.data?.email || '').toLowerCase();
          // 메일 주소 + 휴대폰 번호를 한 벌로 올린다 (구버전 앱은 문자열만 읽어도 동작)
          const payload: Record<string, { email?: string; phone?: string }> = {};
          for (const [name, email] of Object.entries(cache)) payload[name] = { email };
          for (const [name, phone] of Object.entries(phoneCache.current)) {
            payload[name] = { ...(payload[name] || {}), phone };
          }
          await api.google.contactsPush(payload, CONTACT_TEAM.filter((e) => e.toLowerCase() !== me));
        } catch {
          /* 다음 갱신 때 다시 시도 */
        }
      }
      if (driveScopeMissing && !cancelled) {
        setNeedDriveAuth(true);
        if (!driveAuthTried.current) {
          driveAuthTried.current = true;
          try {
            const r = await api.google.startAuth();
            if (r.ok) {
              driveScopeMissing = false;
              setNeedDriveAuth(false);
              autoTried.current.clear(); // 못 채운 사람들 다시 시도
              setRetryTick((t) => t + 1);
            }
          } catch {
            // 사용자가 창을 닫았으면 배너로 다시 안내
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allCandidates, retryTick]);

  const today = todayStr();
  // 면접을 이미 본 사람이 대상인 단계 — 1차 합격 / 처우협의 / 최종 입사 / 불합격 안내.
  // 예전에는 불합격 안내만 지난 면접을 봤고 나머지는 '예정 일정만'이라,
  // 면접을 마친 합격자가 처우협의 화면에서 통째로 안 보였다 (2026-09 서현·박강선 건).
  const isPastStage = POST_INTERVIEW_STAGES.includes(stage);

  // 단계를 고르면 그 단계에 맞는 기간으로 자동 전환한다.
  useEffect(() => {
    setRange(defaultRange(stage));
  }, [stage]);

  // 오늘 면접은 '지난'에도 '예정'에도 들어간다.
  // 날짜만으로는 이미 봤는지 알 수 없고, 오전에 본 면접을 오후에 찾으면 나와야 한다.
  // (2026-09-03 김보민 님 — 오늘 10시 면접인데 '지난 면접'에서 통째로 빠졌다)
  const inRange = (dt: string) => (range === 'all' ? true : range === 'past' ? dt <= today : dt >= today);

  // 테스트 후보자 — 본인에게 실제로 메일/문자를 보내 흐름을 확인하는 용도
  const testCandidate = useMemo<CalCandidate | null>(() => {
    if (!testOn) return null;
    return {
      key: 'test-self',
      name: TEST_CANDIDATE_NAME,
      team: 'TA팀 (테스트)',
      dt: today,
      tm: '',
      when: '테스트',
      siteId: '',
      hqId: 'unset',
      location: '',
      email: myEmail,
      status: '',
    };
  }, [testOn, today, myEmail]);

  // 화면에서 직접 채운 이름을 반영한다 (원본 파싱값보다 우선)
  const withFixedNames = useMemo(
    () =>
      allCandidates.map((c) => {
        const fixed = (nameFix[c.key] || '').trim();
        if (!fixed) return c;
        return {
          ...c,
          name: fixed,
          needsName: false,
          email: c.email || emailMap[fixed] || autoEmail[fixed] || '',
        };
      }),
    [allCandidates, nameFix, emailMap, autoEmail]
  );

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = withFixedNames.filter((c) => {
      if (!inRange(c.dt)) return false;
      if (c.status && !includeAbsent) return false; // (불참)/(노쇼)는 기본 제외
      // 사업장 — 일정에서 사업장을 못 읽은 건은 항상 보여준다(누락 방지)
      if (siteId !== 'all' && c.siteId && c.siteId !== siteId) return false;
      if (hqId !== 'all' && c.hqId !== hqId) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q) || (c.rawTitle || '').toLowerCase().includes(q)))
        return false;
      return true;
    });
    // 지난 면접을 볼 때는 최근에 면접 본 사람이 맨 위로 (오래된 건이 위를 덮지 않게)
    const sorted = range === 'past' ? [...out].reverse() : out;
    // 테스트 후보자는 어떤 필터에도 걸리지 않고 항상 맨 위에 붙는다
    return testCandidate ? [testCandidate, ...sorted] : sorted;
  }, [withFixedNames, range, today, siteId, hqId, search, includeAbsent, testCandidate]);

  // 본부 탭 카운트 (사업장·기간 필터까지 반영한 수)
  const hqCounts = useMemo(() => {
    const base = allCandidates.filter((c) => inRange(c.dt) && (siteId === 'all' || !c.siteId || c.siteId === siteId));
    const m: Record<string, number> = { all: base.length };
    for (const c of base) m[c.hqId] = (m[c.hqId] || 0) + 1;
    return m;
  }, [allCandidates, range, today, siteId]);

  // 이 단계에서 이미 처리한 사람 / 채용이 끝난(불합격) 사람
  // 이름이 비면 처리 여부를 판단할 수 없다. 예전엔 빈 이름으로 '::pass' 같은 키가 만들어져
  // 이름을 못 읽은 사람이 전부 한꺼번에 숨겨졌다. 빈 이름은 항상 '미처리'로 본다.
  const isHandled = (name: string) => {
    if (!name) return false;
    if (handled[handledKey(name, stage)]) return true;
    // 불합격 안내가 나갔으면 채용이 끝났다 — 다른 단계 대기열에 다시 뜨지 않는다
    if (stage !== 'reject' && handled[handledKey(name, 'reject')]) return true;
    // 합격 쪽으로 넘어간 사람은 불합격 대기열에 있을 이유가 없다
    if (stage === 'reject')
      return (['pass', 'offer', 'onboarding'] as TemplateStage[]).some((sg) => !!handled[handledKey(name, sg)]);
    // 뒷 단계를 이미 처리했으면 앞 단계는 끝난 것으로 본다
    const i = FLOW.indexOf(stage);
    if (i >= 0) return FLOW.slice(i + 1).some((later) => !!handled[handledKey(name, later)]);
    return false;
  };

  /** 이 사람이 어느 단계까지 진행됐는지 — 목록에서 한눈에 보이게 (실제로 보낸 것만) */
  const doneStages = (name: string): TemplateStage[] =>
    name ? STAGE_ORDER.filter((sg) => !!handled[handledKey(name, sg)]) : [];

  /** 불합격 안내가 나간 사람 — 채용이 끝났으므로 다른 단계 대기열에 다시 뜨지 않는다 */
  const isRejected = (name: string) => !!name && !!handled[handledKey(name, 'reject')];

  // 대기 = 아직 아무 작업도 안 한 사람. 여기서 처리해야만 아래 '처리 완료'로 내려간다.
  const pending = useMemo(() => candidates.filter((c) => !isHandled(c.name)), [candidates, handled, stage]);
  const doneList = useMemo(() => candidates.filter((c) => isHandled(c.name)), [candidates, handled, stage]);
  // 불합격이라 이 단계에서 빠진 사람 수 — 숫자로 밝혀둔다(조용히 사라지지 않게)
  const rejectedHere = useMemo(
    () => (stage === 'reject' ? 0 : candidates.filter((c) => isRejected(c.name)).length),
    [candidates, handled, stage]
  );
  const prevStage = PREV_STAGE[stage];
  /** 이전 단계는 끝났는데 이 단계가 아직인 사람 — 지금 처리해야 할 대상 */
  const readyList = useMemo(
    () => (prevStage ? pending.filter((c) => !!c.name && !!handled[handledKey(c.name, prevStage)]) : []),
    [pending, handled, prevStage]
  );
  const shown = showHandled ? doneList : onlyReady ? readyList : pending;

  // 단계를 바꾸면 필터도 초기화 — 앞 단계 기준이 달라지므로
  useEffect(() => {
    setOnlyReady(false);
    setShowHandled(false);
  }, [stage]);

  async function markHandled(c: CalCandidate, via: 'send' | 'manual') {
    if (!c.name.trim()) {
      alert('이름을 먼저 채워주세요. 이름 없이 처리하면 나중에 누구인지 알 수 없습니다.');
      return;
    }
    const next = { ...handled, [handledKey(c.name, stage)]: { at: new Date().toISOString(), via, stage } };
    setHandled(next);
    await saveHandled(next);
  }

  async function unmarkHandled(c: CalCandidate) {
    const next = { ...handled };
    delete next[handledKey(c.name, stage)];
    // 불합격 때문에 가려진 경우라면 그 표시까지 풀어야 대기열로 돌아온다
    if (stage !== 'reject') delete next[handledKey(c.name, 'reject')];
    setHandled(next);
    await saveHandled(next);
  }

  // 기간 때문에 가려진 사람 수 — 조용히 사라지지 않게 화면에 숫자로 알린다
  const hiddenByRange = useMemo(() => {
    if (range === 'all') return 0;
    const q = search.trim().toLowerCase();
    return allCandidates.filter((c) => {
      if (inRange(c.dt)) return false;
      if (c.status && !includeAbsent) return false;
      if (siteId !== 'all' && c.siteId && c.siteId !== siteId) return false;
      if (hqId !== 'all' && c.hqId !== hqId) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q))) return false;
      return true;
    }).length;
  }, [allCandidates, range, today, siteId, hqId, search, includeAbsent]);

  // ── 양식: 사업장/본부 전용이 있으면 우선, 없으면 공통
  const stageTemplates = useMemo(() => {
    const fits = (t: EmailTemplate) =>
      (!t.siteId || t.siteId === siteId) && (!t.hqId || hqId === 'all' || t.hqId === hqId);
    return templates.filter((t) => t.stage === stage && fits(t));
  }, [templates, stage, siteId, hqId]);

  const currentTpl = useMemo(() => {
    if (stageTemplates.length === 0) return null;
    const picked = stageTemplates.find((t) => t.id === tplId);
    if (picked) return picked;
    // 전용 > 공통 순으로 자동 선택
    const score = (t: EmailTemplate) => (t.siteId ? 2 : 0) + (t.hqId ? 1 : 0);
    return [...stageTemplates].sort((a, b) => score(b) - score(a))[0];
  }, [stageTemplates, tplId]);

  const availableStages = useMemo(() => {
    const set = new Set(templates.map((t) => t.stage));
    return STAGE_ORDER.filter((s) => set.has(s));
  }, [templates]);

  // ── 변수 자동 채움
  function autoVars(c: CalCandidate, tpl: EmailTemplate): Record<string, string> {
    if (tpl.stage === 'offer') return { 이름: c.name }; // 처우협의는 숫자 자동 채움 금지
    const address = site?.address || c.location || '';
    return {
      이름: c.name,
      면접일시: c.when,
      면접장소: address,
      입사장소: address,
      근무지: site?.label || '',
      장소안내: site?.guide || '',
      사전질문지URL: 'https://forms.gle/Kss5nvQf78QNmWMa8',
      지원직무: c.team || '지원',
      부서: c.team || '',
      직무: c.team || '',
    };
  }

  async function refreshTemplates() {
    setTemplates(await loadTemplates());
  }

  // ── 발송 (Gmail API 직접 발송)
  async function send(
    c: CalCandidate,
    tpl: EmailTemplate,
    to: string,
    vars: Record<string, string>
  ): Promise<boolean> {
    const rendered = renderTemplate(tpl, vars);
    if (!api?.google?.sendGmail) {
      // Electron이 아닌 환경(모바일 뷰어 등) — Gmail 작성 창으로 폴백
      window.open(gmailComposeUrl({ to, subject: rendered.subject, body: rendered.body }), '_blank');
      return true;
    }
    setBusy(c.key);
    try {
      const r = await api.google.sendGmail({
        to,
        subject: rendered.subject,
        body: rendered.body,
        html: buildHtmlBody(rendered.body, signature),
        inlineImage: signature.image
          ? { base64: signature.image.base64, mimeType: signature.image.mimeType, cid: 'sig' }
          : undefined,
        bcc: autoBcc.filter(Boolean).join(', ') || undefined,
      });
      if (!r.ok) {
        alert(`발송 실패: ${r.error || '알 수 없는 오류'}`);
        return false;
      }
      await appendSendLog({
        templateId: tpl.id,
        templateName: tpl.name,
        to,
        subject: rendered.subject,
        variables: vars,
      });
      setLog(await loadSendLog());
      // 테스트로 내 주소에 보낸 걸 후보자 주소로 기억하면, 이력서에서 읽어온 진짜 주소를 덮어버린다.
      // (조성준 건 — 테스트 발송 주소가 계속 남아 있던 문제) 내 주소면 저장하지 않는다.
      const me = (await api.cfg.get<{ email?: string }>('googleProfile'))?.data?.email || '';
      if (to.toLowerCase() !== me.toLowerCase()) {
        await saveEmail(c.name, to);
        setEmailMap((p) => ({ ...p, [c.name]: to }));
      }
      // 발송했으면 이 단계는 끝 — 대기열에서 내려간다
      await markHandled(c, 'send');
      return true;
    } finally {
      setBusy(null);
    }
  }

  // 목록에서 바로 발송 — 비어있는 변수가 있거나 처우협의면 확인 창을 먼저 띄운다
  async function quickSend(c: CalCandidate) {
    if (!currentTpl) return;
    const to = (draftEmail[c.key] ?? c.email).trim();
    if (!to) {
      alert('상대 메일 주소를 먼저 입력해주세요.');
      return;
    }
    const vars = autoVars(c, currentTpl);
    const rendered = renderTemplate(currentTpl, vars);
    const missing = findMissingVars(`${rendered.subject}\n${rendered.body}`);
    if (currentTpl.stage === 'offer' || missing.length > 0) {
      setModal({ template: currentTpl, candidate: { ...c, email: to } });
      return;
    }
    const ok = window.confirm(
      `${c.name}님께 아래 메일을 발송합니다.\n\n수신: ${to}\n양식: ${currentTpl.name}\n제목: ${rendered.subject}`
    );
    if (!ok) return;
    if (await send(c, currentTpl, to, vars)) {
      setDraftEmail((p) => ({ ...p, [c.key]: to }));
    }
  }

  const hqLabel = (id: string) => hqs.find((h) => h.id === id)?.label || HQ_UNSET.label;

  return (
    <div className="space-y-3 text-slate-900">
      {/* ── 1) 사업장 · 본부 선택 ─────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-900">사업장</span>
          <button
            onClick={() => setSiteId('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
              siteId === 'all'
                ? 'bg-accent-purple text-white border-accent-purple'
                : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
            }`}
            title="사업장으로 걸러내지 않습니다 — 한 명도 빠지지 않게"
          >
            전체
          </button>
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setSiteId(s.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                siteId === s.id
                  ? 'bg-accent-purple text-white border-accent-purple'
                  : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {s.label}
              {!s.address && <span className="ml-1 text-red-600">·주소 미입력</span>}
            </button>
          ))}
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1.5 rounded-lg text-sm border border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
          >
            ⚙ 설정
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-200">
          <span className="text-sm font-bold text-slate-900">본부</span>
          {[{ id: 'all', label: '전체' }, ...hqs, HQ_UNSET].map((h) => (
            <button
              key={h.id}
              onClick={() => setHqId(h.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                hqId === h.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {h.label}
              <span className="ml-1 text-xs">{hqCounts[h.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 2) 단계 양식 선택 ─────────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-900">양식</span>
          {availableStages.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStage(s);
                setTplId(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                stage === s
                  ? 'bg-accent-purple text-white border-accent-purple'
                  : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {s === 'offer' && '🔒 '}
              {STAGE_LABEL[s]}
            </button>
          ))}
          {stageTemplates.length > 1 && (
            <select
              value={currentTpl?.id || ''}
              onChange={(e) => setTplId(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {stageTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.siteId ? ` · ${sites.find((s) => s.id === t.siteId)?.label || t.siteId}` : ''}
                  {t.hqId ? ` · ${hqLabel(t.hqId)}` : ''}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-1">
            {currentTpl && (
              <>
                <button
                  onClick={() => setEditingTpl({ ...currentTpl })}
                  className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
                >
                  ✎ 수정
                </button>
                <button
                  onClick={() =>
                    setEditingTpl({
                      ...currentTpl,
                      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      name: `${currentTpl.name} (${site?.label || ''} 전용)`,
                      siteId,
                      hqId: hqId === 'all' ? null : hqId,
                      builtin: false,
                      modifiedAt: undefined,
                      createdAt: Date.now(),
                    })
                  }
                  className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
                >
                  ⧉ 사업장 전용으로 복제
                </button>
              </>
            )}
            <button
              onClick={() => setEditingTpl({ ...createBlankTemplate(), stage, siteId, hqId: hqId === 'all' ? null : hqId })}
              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
            >
              ＋ 새 양식
            </button>
          </div>
        </div>

        {currentTpl ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              {currentTpl.subject} <span className="text-slate-700">— 본문 보기</span>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-900 leading-relaxed bg-slate-50 border border-slate-300 rounded p-3 max-h-64 overflow-auto">
              {currentTpl.body}
            </pre>
          </details>
        ) : (
          <div className="mt-2 text-sm text-slate-900">
            이 사업장/본부에 맞는 양식이 없습니다. [＋ 새 양식]으로 추가하세요.
          </div>
        )}
      </div>

      {/* 드라이브 권한이 없으면 일정 첨부 이력서를 못 읽는다 — 한 번만 재로그인하면 끝난다 */}
      {needDriveAuth && (
        <div
          className="card p-3 flex flex-wrap items-center gap-2 text-[12px]"
          style={{ background: '#fff7ed', borderColor: '#fdba74' }}
        >
          <span className="text-amber-900">
            ⚠ 면접 일정에 <b>첨부된 이력서</b>를 읽으려면 구글 드라이브 읽기 권한이 필요합니다. 한 번만
            다시 로그인하면 주소가 자동으로 채워집니다.
          </span>
          <div className="flex-1" />
          <button
            className="px-3 py-1.5 rounded-lg bg-[#2a2640] text-white text-[12px] font-bold"
            onClick={async () => {
              const r = await api.google.startAuth();
              if (r.ok) {
                setNeedDriveAuth(false);
                autoTried.current.clear();
                alert('로그인 완료 — 이제 일정에 첨부된 이력서에서도 주소를 읽어옵니다.');
              } else {
                alert(`로그인 실패: ${r.error || '알 수 없는 오류'}`);
              }
            }}
          >
            구글 다시 로그인
          </button>
        </div>
      )}

      {/* ── 서명 + 숨은참조 (모든 발송에 공통 적용) ──── */}
      <details className="card p-3">
        <summary className="text-sm font-bold text-slate-900 cursor-pointer">
          ✍️ 메일 서명 · 숨은참조
          <span className="ml-2 text-[11px] font-normal text-slate-500">
            {signature.image ? '이미지 서명 있음' : '이미지 없음'} · 숨은참조 {autoBcc.length}명
          </span>
        </summary>
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-bold text-slate-700 mb-1">서명 이미지 (명함·로고)</div>
            {signature.image ? (
              <div className="flex items-start gap-2">
                <img
                  src={`data:${signature.image.mimeType};base64,${signature.image.base64}`}
                  alt="서명"
                  className="max-w-[260px] max-h-[110px] border rounded"
                  style={{ borderColor: 'var(--cc-p8)' }}
                />
                <button
                  className="btn text-[11px] text-rose-600"
                  onClick={async () => {
                    const next = { ...signature, image: null };
                    setSignature(next);
                    await saveSignature(next);
                  }}
                >
                  제거
                </button>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 mb-1">
                Gmail 서명에 쓰는 이미지 파일을 그대로 올리시면 됩니다 (PNG/JPG)
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              className="mt-1 text-[11px]"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > 2 * 1024 * 1024) {
                  alert('이미지가 너무 큽니다 (2MB 이하로 넣어주세요).');
                  return;
                }
                const buf = new Uint8Array(await f.arrayBuffer());
                let bin = '';
                for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                const next: MailSignature = {
                  ...signature,
                  image: { base64: btoa(bin), mimeType: f.type || 'image/png', name: f.name },
                };
                setSignature(next);
                await saveSignature(next);
              }}
            />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-700 mb-1">서명 문구 (이미지 위에 들어갑니다)</div>
            <textarea
              value={signature.text}
              onChange={(e) => setSignature({ ...signature, text: e.target.value })}
              onBlur={() => void saveSignature(signature)}
              rows={3}
              placeholder={'이형도 사원 / Talent Acquisition팀\nT. 031-000-0000  |  hdlee@cnccosmetic.com'}
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-[12px] text-slate-900"
            />
            <div className="text-[11px] font-bold text-slate-700 mt-2 mb-1">
              숨은참조 (모든 발송에 자동 포함)
            </div>
            <input
              value={autoBcc.join(', ')}
              onChange={(e) => setAutoBcc(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
              onBlur={() => void saveAutoBcc(autoBcc)}
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-[12px] text-slate-900"
              placeholder="bjkim4@cnccosmetic.com, hglim@cnccosmetic.com"
            />
            <div className="text-[10px] text-slate-500 mt-1">
              기본값: 김범준 팀장 · 임한결 주임 — 수신자에게는 보이지 않습니다
            </div>
          </div>
        </div>
      </details>

      {/* ── 3) 면접 캘린더 후보자 → 메일 주소만 넣고 발송 ──── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="text-sm font-bold text-slate-900">
            면접 캘린더 후보자{' '}
            <span className="text-slate-900">
              대기 {pending.length}명
              {doneList.length > 0 && ` · 처리됨 ${doneList.length}명`}
            </span>
          </h3>
          {prevStage && readyList.length > 0 && (
            <button
              onClick={() => {
                setShowHandled(false);
                setOnlyReady((v) => !v);
              }}
              className={
                'px-2 py-1 rounded-lg text-xs font-bold border ' +
                (onlyReady
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50 text-slate-900 border-emerald-400 hover:bg-emerald-100')
              }
              title={`${STAGE_LABEL[prevStage]}는 끝났는데 ${STAGE_LABEL[stage]}가 아직인 사람입니다. 지금 처리할 차례입니다.`}
            >
              ▶ 다음 차례 {readyList.length}명
            </button>
          )}
          <button
            onClick={() => {
              setOnlyReady(false);
              setShowHandled((v) => !v);
            }}
            className={
              'px-2 py-1 rounded-lg text-xs font-bold border ' +
              (showHandled
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100')
            }
            title="처리 완료된 사람 보기 — 되돌릴 수 있습니다"
          >
            {showHandled ? '← 대기 목록' : `처리 완료 ${doneList.length}건`}
          </button>
          {onlyReady && (
            <span className="text-xs font-bold text-emerald-800">
              {prevStage ? STAGE_LABEL[prevStage] : ''} 완료자만 보는 중
            </span>
          )}
          <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden">
            {RANGE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setRange(t.id)}
                title={t.help}
                className={
                  'px-2.5 py-1 text-xs font-bold ' +
                  (range === t.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-900 hover:bg-slate-100')
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          {isPastStage && range === 'past' && (
            <span className="text-xs font-bold text-slate-900">
              {STAGE_LABEL[stage]} — 면접을 이미 본 사람이 대상입니다
            </span>
          )}
          {rejectedHere > 0 && (
            <span
              className="px-2 py-1 rounded-lg border border-slate-400 bg-slate-100 text-xs font-bold text-slate-900"
              title="불합격 안내가 나간 사람입니다. 채용이 끝났으므로 이 단계 대기열에서 뺐습니다. [처리 완료]에서 볼 수 있습니다."
            >
              불합격 제외 {rejectedHere}명
            </span>
          )}
          {hiddenByRange > 0 && (
            <button
              onClick={() => setRange('all')}
              className="px-2 py-1 rounded-lg border border-sky-300 bg-sky-50 text-xs font-bold text-slate-900"
              title="기간 필터에 걸려 지금 안 보이는 후보자"
            >
              기간 밖 {hiddenByRange}명 — 전체 보기
            </button>
          )}
          <label className="flex items-center gap-1 text-sm text-slate-900">
            <input type="checkbox" checked={includeAbsent} onChange={(e) => setIncludeAbsent(e.target.checked)} />
            불참·노쇼 포함
          </label>
          {dropsRef.current.length > 0 && (
            <button
              onClick={() => setShowDrops((v) => !v)}
              className="px-2 py-1 rounded-lg border border-amber-300 bg-amber-50 text-xs font-bold text-slate-900"
            >
              제외됨 {dropsRef.current.length}건
            </button>
          )}
          <button
            onClick={() => setTestOn((v) => !v)}
            className={
              'px-2 py-1 rounded-lg text-xs font-bold border ' +
              (testOn
                ? 'bg-amber-400 text-slate-900 border-amber-500'
                : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100')
            }
            title="본인에게 실제로 메일·문자를 보내 흐름을 끝까지 확인합니다. 캘린더·시트는 건드리지 않습니다."
          >
            🧪 테스트 {testOn ? 'ON' : ''}
          </button>
          <button
            onClick={() => setShowSmsTpl((v) => !v)}
            className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100"
            title="문자는 메일과 따로 관리합니다 — 결과는 메일로, 문자는 '메일 확인' 알림만"
          >
            💬 문자 양식
          </button>
          <button
            onClick={() => setShowSmsSetup((v) => !v)}
            className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100"
            title="문자를 앱에서 바로 쏘려면 문자 API를 연결합니다"
          >
            ⚙ 문자 설정
            {smsCfg && smsCfg.provider !== 'phone' && smsCfg.ready && (
              <span className="ml-1 text-emerald-700">● 연결됨</span>
            )}
          </button>
          <button
            onClick={async () => {
              const rows = shown.map((c) => `${c.name}\t${prettyPhone(autoPhone[c.name] || '')}\t${c.team}\t${c.when}`);
              const ok = await copyToClipboard(['이름\t휴대폰\t소속\t면접일시', ...rows].join('\n'));
              const withPhone = shown.filter((c) => autoPhone[c.name]).length;
              alert(
                ok
                  ? `${shown.length}명 복사했습니다 (번호 있는 사람 ${withPhone}명).\n엑셀이나 문자 발송 프로그램에 그대로 붙여넣으세요.`
                  : '복사에 실패했습니다.'
              );
            }}
            disabled={shown.length === 0}
            className="px-2 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-xs font-bold text-slate-900 hover:bg-emerald-100 disabled:opacity-40"
            title="이름·휴대폰·소속·면접일시를 표로 복사 — 문자 발송 프로그램에 붙여넣기"
          >
            💬 번호 일괄 복사
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·소속 검색"
            className="ml-auto px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-56"
          />
        </div>

        {showSmsTpl && (
          <SmsTemplatePanel
            templates={smsTpls}
            stage={stage}
            onChange={setSmsTpls}
            onClose={() => setShowSmsTpl(false)}
          />
        )}

        {showSmsSetup && (
          <SmsSetupPanel
            config={smsCfg}
            onSaved={(c) => setSmsCfg(c)}
            onClose={() => setShowSmsSetup(false)}
          />
        )}

        {/* 걸러낸 일정 — 왜 목록에 없는지 바로 확인할 수 있게 (조용한 누락 방지) */}
        {showDrops && dropsRef.current.length > 0 && (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 max-h-40 overflow-y-auto">
            {dropsRef.current.map((d, i) => (
              <div key={`${d.title}-${i}`} className="text-xs text-slate-900">
                <span className="font-bold">{d.reason}</span> · {d.title}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-auto rounded-lg border border-slate-300 max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100">
              <tr>
                {['면접일시', '이름', '소속', '본부', '상대 메일 주소', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-bold text-slate-900 border-b border-slate-300">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const to = draftEmail[c.key] ?? c.email;
                const sent = log.find((l) => l.variables?.['이름'] === c.name && l.templateId === currentTpl?.id);
                return (
                  <tr key={c.key} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-900 whitespace-nowrap">{c.when}</td>
                    <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                      {c.needsName ? (
                        <span className="inline-flex flex-col gap-0.5">
                          <input
                            value={nameFix[c.key] ?? ''}
                            onChange={(e) => setNameFix((prev) => ({ ...prev, [c.key]: e.target.value }))}
                            placeholder="이름 입력"
                            className="w-24 px-1.5 py-0.5 border border-amber-400 bg-amber-50 rounded text-sm text-slate-900"
                          />
                          <span className="text-[10px] font-normal text-slate-900 max-w-[200px] truncate" title={c.rawTitle}>
                            {c.rawTitle}
                          </span>
                        </span>
                      ) : (
                        c.name
                      )}
                      {c.status && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-900 border border-rose-200">
                          {c.status}
                        </span>
                      )}
                      {isRejected(c.name) && (
                        <span
                          className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-white align-middle"
                          title="불합격 안내 완료 — 다른 전형 대기열에는 뜨지 않습니다"
                        >
                          불합격
                        </span>
                      )}
                      {doneStages(c.name).length > 0 && (
                        <span className="ml-1 inline-flex gap-0.5 align-middle">
                          {doneStages(c.name).map((sg) => (
                            <span
                              key={sg}
                              title={`${STAGE_LABEL[sg]} 완료`}
                              className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300"
                            >
                              {STAGE_LABEL[sg].replace(' 안내', '')} ✓
                            </span>
                          ))}
                        </span>
                      )}
                      {c.suspect && (
                        <span
                          className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 align-middle"
                          title={`제목에 "면접"이 없어 분류기가 놓친 일정입니다. TA팀이 회의실까지 잡아둬서 면접으로 보고 목록에 올렸습니다.\n${c.rawTitle || ''}`}
                        >
                          면접 추정
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-900">{c.team || '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <select
                        value={c.hqId}
                        onChange={async (e) => {
                          await saveHqOverride(c.name, e.target.value);
                          setHqOverrides((p) => ({ ...p, [c.name]: e.target.value }));
                        }}
                        className="px-1 py-0.5 border border-slate-300 rounded text-xs text-slate-900 bg-white"
                      >
                        {[...hqs, HQ_UNSET].map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={to}
                        onChange={(e) => setDraftEmail((p) => ({ ...p, [c.key]: e.target.value }))}
                        placeholder="candidate@example.com"
                        className="w-56 px-2 py-1 border border-slate-300 rounded text-sm text-slate-900"
                      />
                      {/* 이력서에서 자동으로 끌어온 주소임을 표시 — 수기 입력과 구분 */}
                      {!emailMap[c.name] && autoEmail[c.name] && to === autoEmail[c.name] && (
                        <span
                          className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-800 align-middle"
                          title="이력서 보관함의 원본 PDF에서 자동으로 읽어온 주소입니다"
                        >
                          이력서
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        onClick={() => quickSend(c)}
                        disabled={!currentTpl || busy === c.key}
                        className="px-3 py-1 rounded bg-accent-purple text-white text-xs font-bold disabled:opacity-40 hover:bg-accent-purple/90"
                      >
                        {busy === c.key ? '발송 중…' : '✉ 발송'}
                      </button>
                      <button
                        onClick={() => setSmsFor(c)}
                        disabled={!currentTpl}
                        title={
                          autoPhone[c.name]
                            ? `문자 보내기 — ${prettyPhone(autoPhone[c.name])}`
                            : '이력서에서 번호를 못 찾았습니다 — 창에서 직접 입력할 수 있습니다'
                        }
                        className={
                          'ml-1 px-2 py-1 rounded border text-xs font-bold disabled:opacity-40 ' +
                          (autoPhone[c.name]
                            ? 'border-emerald-300 bg-emerald-50 text-slate-900 hover:bg-emerald-100'
                            : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100')
                        }
                      >
                        💬 문자
                      </button>
                      <button
                        onClick={() => currentTpl && setModal({ template: currentTpl, candidate: { ...c, email: to } })}
                        disabled={!currentTpl}
                        className="ml-1 px-2 py-1 rounded border border-slate-300 bg-white text-xs text-slate-900 hover:bg-slate-100"
                      >
                        미리보기
                      </button>
                      {showHandled ? (
                        <button
                          onClick={() => unmarkHandled(c)}
                          className="ml-1 px-2 py-1 rounded border border-amber-300 bg-amber-50 text-xs font-bold text-slate-900 hover:bg-amber-100"
                          title="대기 목록으로 되돌립니다"
                        >
                          ↩ 되돌리기
                        </button>
                      ) : (
                        <button
                          onClick={() => markHandled(c, 'manual')}
                          className="ml-1 px-2 py-1 rounded border border-slate-300 bg-white text-xs text-slate-900 hover:bg-slate-100"
                          title="메일을 보내지 않고 처리했을 때 — 대기 목록에서만 내려갑니다"
                        >
                          ✓ 처리
                        </button>
                      )}
                      {sent && <span className="ml-1 text-xs font-bold text-green-700">발송됨</span>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-sm text-slate-900">
                    {showHandled
                      ? '처리 완료된 건이 없습니다.'
                      : onlyReady
                        ? '다음 차례인 사람이 없습니다.'
                      : doneList.length > 0
                        ? `대기 중인 후보자가 없습니다 — ${doneList.length}건은 [처리 완료]에 있습니다.`
                        : '조건에 맞는 면접 일정이 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {smsFor && (
        <SmsModal
          candidate={smsFor}
          phone={smsFor.name === TEST_CANDIDATE_NAME ? testPhone : autoPhone[smsFor.name] || ''}
          template={currentTpl}
          smsText={renderSms(
            smsTpls.find((t) => t.stage === stage)?.text ?? defaultSmsText(stage),
            {
              이름: smsFor.name,
              면접일시: smsFor.when,
              소속: smsFor.team,
              사업장: sites.find((x) => x.id === (smsFor.siteId || siteId))?.label || '',
            }
          )}
          config={smsCfg}
          onSavePhone={async (v) => {
            if (smsFor.name !== TEST_CANDIDATE_NAME) return;
            setTestPhone(v);
            await api.cfg.set(TEST_PHONE_CFG_KEY, v);
          }}
          onClose={() => setSmsFor(null)}
          onDone={async (c) => {
            await markHandled(c, 'manual');
            setSmsFor(null);
          }}
        />
      )}

      {/* ── 4) 발송 기록 (접힘) ───────────────────────────── */}
      <div className="card p-3">
        <button onClick={() => setShowLog((v) => !v)} className="text-sm font-bold text-slate-900">
          {showLog ? '▾' : '▸'} 발송 기록 {log.length}건
        </button>
        {showLog && (
          <div className="mt-2 overflow-auto rounded-lg border border-slate-300 max-h-64">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {['시각', '양식', '수신', '제목'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-bold text-slate-900 border-b border-slate-300">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 50).map((e) => (
                  <tr key={e.id} className="border-b border-slate-200">
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-900 whitespace-nowrap">
                      {new Date(e.at).toLocaleString('ko-KR', { hour12: false })}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-900">{e.templateName}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-900 whitespace-nowrap">{e.to}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-900 truncate max-w-[380px]">{e.subject}</td>
                  </tr>
                ))}
                {log.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-4 text-sm text-slate-900">
                      발송 기록 없음
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingTpl && (
        <TemplateEditor
          template={editingTpl}
          sites={sites}
          hqs={hqs}
          onClose={() => setEditingTpl(null)}
          onSave={async (t) => {
            t.variables = extractVariables(`${t.subject} ${t.body}`);
            await saveTemplate(t);
            await refreshTemplates();
            setStage(t.stage);
            setTplId(t.id);
            setEditingTpl(null);
          }}
          onDelete={async (id) => {
            if (!confirm('이 양식을 삭제할까요? (기본 양식은 초기값으로 되돌아갑니다)')) return;
            await deleteTemplate(id);
            await refreshTemplates();
            setTplId(null);
            setEditingTpl(null);
          }}
        />
      )}

      {modal && (
        <SendModal
          template={modal.template}
          candidate={modal.candidate}
          initialVars={autoVars(modal.candidate, modal.template)}
          onClose={() => setModal(null)}
          onSend={async (to, vars) => {
            const ok = await send(modal.candidate, modal.template, to, vars);
            if (ok) setModal(null);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          sites={sites}
          hqs={hqs}
          excludeNames={excludeNames}
          onClose={() => setShowSettings(false)}
          onSave={async (s, h, ex) => {
            await saveSites(s);
            await saveHqs(h);
            await saveExcludeNames(ex);
            setSites(s);
            setHqs(h);
            setExcludeNames(ex);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 발송 모달 — 변수 채우기 + 미리보기 + 발송
// ─────────────────────────────────────────────────────────────
function SendModal({
  template,
  candidate,
  initialVars,
  onClose,
  onSend,
}: {
  template: EmailTemplate;
  candidate: CalCandidate;
  initialVars: Record<string, string>;
  onClose: () => void;
  onSend: (to: string, vars: Record<string, string>) => void;
}) {
  const [to, setTo] = useState(candidate.email);
  const [vars, setVars] = useState<Record<string, string>>(initialVars);
  const rendered = renderTemplate(template, vars);
  const missing = findMissingVars(`${rendered.subject}\n${rendered.body}`);
  const isOffer = template.stage === 'offer';

  function handleSend() {
    if (!to.trim()) return;
    if (missing.length > 0 && !confirm(`비어있는 항목이 있습니다: ${missing.join(', ')}\n그대로 발송할까요?`)) return;
    if (isOffer) {
      const ok = confirm(
        `[처우협의 최종 확인]\n수신: ${to}\n이름: ${candidate.name}\n연봉: ${vars['연봉'] || '(미입력)'}원\n입사일: ${
          vars['입사일'] || '(미입력)'
        }\n\n이대로 발송합니까?`
      );
      if (!ok) return;
    } else if (!confirm(`${candidate.name}님께 발송합니다.\n\n수신: ${to}\n제목: ${rendered.subject}`)) {
      return;
    }
    onSend(to.trim(), vars);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col ${
          isOffer ? 'border-4 border-amber-400' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-300 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              {isOffer ? '🔒 처우협의 — 모든 숫자 수기 입력 · 2단계 확인' : template.name}
            </div>
            <div className="text-lg font-bold text-slate-900">
              {candidate.name} · {candidate.when}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded text-slate-900 hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-900">상대 메일 주소</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="candidate@example.com"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
            />
          </div>
          {template.variables.map((k) => (
            <div key={k}>
              <label className="text-xs font-bold text-slate-900">{`{{${k}}}`}</label>
              <input
                value={vars[k] || ''}
                onChange={(e) => setVars((p) => ({ ...p, [k]: e.target.value }))}
                placeholder={isOffer ? '수기 입력' : ''}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
              />
            </div>
          ))}
          <div>
            <div className="text-xs font-bold text-slate-900 mb-1">미리보기</div>
            <div className="rounded border border-slate-300 bg-slate-50 p-3">
              <div className="font-bold pb-2 mb-2 border-b border-slate-300 text-slate-900">{rendered.subject}</div>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-900 leading-relaxed max-h-64 overflow-auto">
                {rendered.body}
              </pre>
            </div>
          </div>
          {missing.length > 0 && (
            <div className="text-sm font-bold text-red-700">비어있는 항목: {missing.join(', ')}</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-300 flex items-center justify-end gap-2 bg-slate-50">
          <button
            onClick={() => window.open(gmailComposeUrl({ to, subject: rendered.subject, body: rendered.body }), '_blank')}
            className="px-3 py-2 rounded border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100"
          >
            Gmail 창에서 열기
          </button>
          <button
            onClick={handleSend}
            disabled={!to.trim()}
            className={`px-5 py-2 rounded text-sm font-bold disabled:opacity-40 ${
              isOffer ? 'bg-amber-500 text-slate-900 hover:bg-amber-600' : 'bg-accent-purple text-white hover:bg-accent-purple/90'
            }`}
          >
            ✉ 바로 발송
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 양식 편집 — 사업장/본부 전용 지정 포함
// ─────────────────────────────────────────────────────────────
function TemplateEditor({
  template,
  sites,
  hqs,
  onSave,
  onDelete,
  onClose,
}: {
  template: EmailTemplate;
  sites: MailSite[];
  hqs: MailHq[];
  onSave: (t: EmailTemplate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [t, setT] = useState(template);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-300 flex items-center justify-between">
          <div className="text-lg font-bold text-slate-900">{t.builtin ? '기본 양식 수정' : '양식 편집'}</div>
          <button onClick={onClose} className="w-8 h-8 rounded text-slate-900 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-900">양식 이름</label>
            <input
              value={t.name}
              onChange={(e) => setT({ ...t, name: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-900">단계</label>
              <select
                value={t.stage}
                onChange={(e) => setT({ ...t, stage: e.target.value as TemplateStage })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white text-slate-900"
              >
                {STAGE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-900">사업장</label>
              <select
                value={t.siteId || ''}
                onChange={(e) => setT({ ...t, siteId: e.target.value || null })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white text-slate-900"
              >
                <option value="">전 사업장 공통</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} 전용
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-900">본부</label>
              <select
                value={t.hqId || ''}
                onChange={(e) => setT({ ...t, hqId: e.target.value || null })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white text-slate-900"
              >
                <option value="">전 본부 공통</option>
                {hqs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} 전용
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-900">메일 제목</label>
            <input
              value={t.subject}
              onChange={(e) => setT({ ...t, subject: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono text-slate-900"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-900">본문 (변수는 {`{{변수명}}`} 형태)</label>
            <textarea
              value={t.body}
              onChange={(e) => setT({ ...t, body: e.target.value })}
              rows={16}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono leading-relaxed text-slate-900"
            />
          </div>
          <div className="text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded p-2">
            자동 인식 변수: <span className="font-mono">{extractVariables(`${t.subject} ${t.body}`).join(', ') || '(없음)'}</span>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-300 flex items-center justify-end gap-2 bg-slate-50">
          {!t.builtin && (
            <button
              onClick={() => onDelete(t.id)}
              className="mr-auto px-3 py-2 rounded border border-red-400 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              삭제
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100">
            취소
          </button>
          <button
            onClick={() => onSave(t)}
            disabled={!t.name || !t.subject || !t.body}
            className="px-5 py-2 rounded bg-accent-purple text-white text-sm font-bold disabled:opacity-40 hover:bg-accent-purple/90"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 사업장 주소 / 본부 분류 키워드 설정
// ─────────────────────────────────────────────────────────────
function SettingsModal({
  sites,
  hqs,
  excludeNames,
  onSave,
  onClose,
}: {
  sites: MailSite[];
  hqs: MailHq[];
  excludeNames: string[];
  onSave: (sites: MailSite[], hqs: MailHq[], excludeNames: string[]) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<MailSite[]>(sites);
  const [h, setH] = useState<MailHq[]>(hqs);
  const [ex, setEx] = useState<string>(excludeNames.join(', '));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white text-slate-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-300 text-lg font-bold text-slate-900">사업장 · 본부 설정</div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          <div>
            <div className="text-sm font-bold text-slate-900 mb-2">사업장 (메일 본문의 장소/오시는 길)</div>
            {s.map((site, i) => (
              <div key={site.id} className="mb-3 border border-slate-300 rounded p-3">
                <div className="text-sm font-bold text-slate-900 mb-1">{site.label}</div>
                <input
                  value={site.address}
                  onChange={(e) => setS(s.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))}
                  placeholder="예) (주)씨앤씨인터내셔널 퍼플카운티 (경기도 화성시 삼성1로5길 39)"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
                />
                <textarea
                  value={site.guide}
                  onChange={(e) => setS(s.map((x, j) => (j === i ? { ...x, guide: e.target.value } : x)))}
                  rows={2}
                  placeholder="주소 뒤에 붙는 안내 문구 (예: 도착하시어 경비실에서 대기해주시면 안내 도와드리겠습니다.)"
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
                />
              </div>
            ))}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 mb-2">본부 자동 분류 키워드 (쉼표 구분)</div>
            {h.map((hq, i) => (
              <div key={hq.id} className="flex items-center gap-2 mb-2">
                <span className="w-24 text-sm font-bold text-slate-900">{hq.label}</span>
                <input
                  value={hq.match.join(', ')}
                  onChange={(e) =>
                    setH(h.map((x, j) => (j === i ? { ...x, match: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) } : x)))
                  }
                  className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
                />
              </div>
            ))}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 mb-1">메일 대상에서 제외할 이름 (쉼표 구분)</div>
            <div className="text-xs text-slate-900 mb-1">
              TA팀 본인 이름으로 만든 테스트 면접이 후보자로 잡히지 않도록 걸러냅니다.
            </div>
            <input
              value={ex}
              onChange={(e) => setEx(e.target.value)}
              placeholder="이형도, 임세현, 김범준, 임한결"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-slate-900"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-300 flex justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm text-slate-900 hover:bg-slate-100">
            취소
          </button>
          <button
            onClick={() => onSave(s, h, ex.split(',').map((v) => v.trim()).filter(Boolean))}
            className="px-5 py-2 rounded bg-accent-purple text-white text-sm font-bold hover:bg-accent-purple/90"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 문자 보내기 창 ──────────────────────────────────────────────────────────
// 앱이 직접 쏘지는 못하지만(발신번호 등록·문자 API 계약 필요), 번호와 문구를 완성해서
// 클립보드에 넣고 문자 앱을 열어준다. 붙여넣기 한 번이면 끝나게.
function SmsModal({
  candidate,
  phone,
  template,
  smsText,
  config,
  onSavePhone,
  onClose,
  onDone,
}: {
  candidate: CalCandidate;
  phone: string;
  template: EmailTemplate | null;
  /** 단계별 문자 양식을 채운 결과 — 메일 본문과 별개다 */
  smsText: string;
  config: SmsConfig | null;
  onSavePhone?: (v: string) => void | Promise<void>;
  onClose: () => void;
  onDone: (c: CalCandidate) => void;
}) {
  const [to, setTo] = useState(prettyPhone(phone));
  // 문자 양식은 메일과 분리돼 있다 — [💬 문자 양식]에서 단계별로 따로 고친다
  const [text, setText] = useState(smsText);
  const [copied, setCopied] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [needQr, setNeedQr] = useState(false);
  const [needRetry, setNeedRetry] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);

  // phonelink(기본) = 휴대폰과 연결에 번호·문구가 채워진 대화창을 띄운다 (보내기만 누르면 끝)
  // gmessages       = 구글 메시지 웹을 앱이 조작해 보내기까지 자동
  // aligo/solapi    = 유료 API로 앱이 직접 발송
  const provider = config?.provider || 'phonelink';
  const direct = provider === 'phonelink' || provider === 'gmessages' || ((provider === 'aligo' || provider === 'solapi') && !!config?.ready);

  async function fire() {
    if (!digits) {
      setResult('휴대폰 번호를 먼저 입력해주세요.');
      phoneRef.current?.focus();
      return;
    }
    if (direct) {
      const ok = window.confirm(
        `${candidate.name}님(${prettyPhone(digits)})께 문자를 지금 발송합니다.\n\n${text.slice(0, 200)}`
      );
      if (!ok) return;
    }
    // 문자 기능은 앱 본체(메인 프로세스)에 붙어 있어서, 업데이트 직후 새로고침만 해서는 안 잡힌다.
    // 이 경우 조용히 실패시키지 말고 무엇을 해야 하는지 알려주고, 붙여넣기용으로 복사까지 해준다.
    if (!api?.sms?.send) {
      await copyToClipboard(`${digits}\n\n${text}`);
      setResult('앱을 완전히 종료한 뒤 다시 실행해주세요 (문자 기능은 재시작이 필요합니다). 번호와 문구는 복사해뒀습니다.');
      return;
    }
    setSending(true);
    setResult(null);
    setNeedRetry(false);
    try {
      const r = await api.sms.send({ to: digits, text, title: template?.name });
      if (!r.ok) {
        // 막혔으면 최소한 붙여넣을 수 있게 클립보드에 넣어두고 원인을 그대로 보여준다
        await copyToClipboard(`${digits}\n\n${text}`);
        setResult(`실패: ${r.error || '알 수 없는 오류'}`);
        if (/QR|연결되지/.test(r.error || '')) setNeedQr(true);
        return;
      }
      if (r.data?.sent) setResult(`✓ 발송 완료 (${r.data.via})`);
      else if (r.data?.autoSendFailed) {
        setResult('대화창은 떴는데 자동 발송이 막혔습니다 (' + r.data.autoSendFailed + ')');
        setNeedRetry(true);
      } else if (r.data?.via === 'phonelink') {
        setResult('휴대폰과 연결에 대화창을 띄웠습니다 — 엔터만 누르세요.');
      } else if (r.data?.partial) {
        await copyToClipboard(`${digits}\n\n${text}`);
        setResult('문자 앱은 열렸는데 번호·문구를 못 넘겼습니다 — 복사해뒀으니 붙여넣어 주세요.');
      } else setResult('문자 앱을 열었습니다 — 내용 확인하고 보내기만 누르세요. (창이 안 뜨면 작업표시줄을 확인해주세요)');
      await onSavePhone?.(to);
    } catch (e) {
      setResult(`실패: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  const digits = normalizePhone(to);
  const bytes = smsBytes(text);
  const kind = bytes <= 90 ? 'SMS' : bytes <= 2000 ? 'LMS' : '너무 김';

  async function copy(what: 'phone' | 'text' | 'both') {
    const v = what === 'phone' ? digits : what === 'text' ? text : `${digits}\n\n${text}`;
    const ok = await copyToClipboard(v);
    setCopied(ok ? what : null);
    if (ok) setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-base font-bold text-slate-900">💬 문자 보내기 — {candidate.name}님</h3>
          <button onClick={onClose} className="ml-auto text-slate-900 font-bold px-2">
            ✕
          </button>
        </div>

        <label className="block text-xs font-bold text-slate-900 mb-1">
          받는 번호
          {!digits && <span className="ml-1 text-rose-700">— 먼저 입력해주세요</span>}
        </label>
        <div className="flex gap-1 mb-1">
          <input
            ref={phoneRef}
            autoFocus={!phone}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fire()}
            placeholder="010-0000-0000"
            className={
              'flex-1 px-3 py-2 border rounded-lg text-sm text-slate-900 ' +
              (digits ? 'border-slate-300' : 'border-rose-400 bg-rose-50')
            }
          />
          <button
            onClick={() => copy('phone')}
            disabled={!digits}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-40"
          >
            {copied === 'phone' ? '복사됨' : '번호 복사'}
          </button>
        </div>
        <div className="text-[11px] text-slate-900 mb-3">
          {phone
            ? '이력서에서 자동으로 읽어온 번호입니다.'
            : candidate.name === TEST_CANDIDATE_NAME
              ? '테스트용 — 형도님 휴대폰 번호를 넣으세요. 한 번 넣으면 다음부터 자동으로 채워집니다.'
              : '이력서에 번호가 없어 직접 입력해야 합니다.'}
        </div>

        <label className="block text-xs font-bold text-slate-900 mb-1">
          문구{' '}
          <span className="font-normal">
            {bytes}바이트 · {kind}
            {kind === 'LMS' && ' (90바이트 초과 — 장문으로 나갑니다)'}
          </span>
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
        />

        <div className="flex flex-wrap gap-1.5 mt-3">
          <button
            onClick={fire}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-accent-purple text-white text-xs font-bold hover:bg-accent-purple/90 disabled:opacity-40"
          >
            {sending ? '보내는 중…' : direct ? '📨 문자 바로 발송' : '📱 내 폰으로 열기'}
          </button>
          <button
            onClick={() => copy('both')}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100"
          >
            {copied === 'both' ? '✓ 복사됨' : '번호 + 문구 복사'}
          </button>
          <button
            onClick={() => copy('text')}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100"
          >
            {copied === 'text' ? '✓ 복사됨' : '문구만 복사'}
          </button>
          {SMS_APPS.map((a) => (
            <button
              key={a.id}
              onClick={() => window.open(a.url, '_blank')}
              title={a.help}
              className="px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-xs font-bold text-slate-900 hover:bg-emerald-100"
            >
              {a.label} 열기 ↗
            </button>
          ))}
        </div>

        {result && (
          <div
            className={
              'mt-2 rounded-lg border p-2 text-xs font-bold ' +
              (result.startsWith('실패')
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : 'border-emerald-300 bg-emerald-50 text-slate-900')
            }
          >
            {result}
          </div>
        )}

        {needRetry && (
          <button
            onClick={async () => {
              setSending(true);
              try {
                const r = await api.sms.plPressSend();
                if (r.ok && r.data?.sent) { setResult('✓ 발송 완료'); setNeedRetry(false); }
                else setResult('여전히 막혔습니다 (' + (r.error || '') + ') — 휴대폰과 연결 창에서 엔터를 눌러주세요.');
              } finally { setSending(false); }
            }}
            disabled={sending}
            className="mt-2 w-full px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 disabled:opacity-40"
            title="이미 떠 있는 대화창에서 보내기(엔터)만 다시 누릅니다"
          >
            ↻ 보내기 다시 누르기
          </button>
        )}

        {needQr && (
          <button
            onClick={async () => {
              await api.sms.gmConnect();
              setResult('구글 메시지 창을 열었습니다 — 폰에서 QR을 스캔한 뒤 다시 [문자 보내기]를 눌러주세요.');
            }}
            className="mt-2 w-full px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
          >
            📱 구글 메시지에 폰 연결하기 (QR 스캔 · 최초 1회)
          </button>
        )}

        <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-2 text-[11px] text-slate-900 leading-relaxed">
          {provider === 'phonelink' ? (
            <>
              <b>휴대폰과 연결로 바로 발송</b> — 누르면 앱이 <b>휴대폰과 연결</b>에 대화창을 띄우고 번호·문구를 채운 뒤{' '}
              <b>보내기까지 눌러</b> 실제로 발송합니다. 요금은 본인 요금제 안이라 추가 비용이 없고 발신번호 등록도
              필요 없습니다.
              <br />
              Windows 기본 앱 설정과 무관하게 <b>휴대폰과 연결로 직접 전달</b>하므로 브라우저로 새지 않습니다.
              발송 중에는 휴대폰과 연결 창이 잠깐 앞으로 올라옵니다 — 그 사이 키보드를 건드리지 마세요.
            </>
          ) : provider === 'gmessages' ? (
            <>
              <b>내 폰으로 진짜 발송</b> — [문자 보내기]를 누르면 앱이 구글 메시지 창에 번호와 문구를 채우고{' '}
              <b>보내기까지 누릅니다.</b> 폰 연결은 최초 1회 QR 스캔만 하면 되고, 요금은 본인 요금제 안이라 추가 비용이
              없습니다.
            </>
          ) : direct ? (
            <>
              <b>{config?.provider === 'aligo' ? '알리고' : '솔라피'} 연결됨</b> — [문자 보내기]를 누르면 발신번호{' '}
              {prettyPhone(config?.sender || '')} 로 바로 나갑니다.
            </>
          ) : (
            <>
              <b>내 휴대폰으로 보내기</b> — [내 폰으로 열기]를 누르면 Windows <b>휴대폰과 연결</b>에 번호와 문구가
              채워진 채로 대화창이 뜹니다. 보내기만 누르면 끝이고, 요금은 본인 요금제 안이라 추가 비용이 없습니다.
              <br />
              열리지 않으면 [번호 + 문구 복사] 후 아래 앱에 붙여넣으세요. 앱에서 <b>버튼 한 번으로 바로</b> 쏘려면{' '}
              <b>⚙ 문자 설정</b>에서 문자 API를 연결하면 됩니다.
            </>
          )}
        </div>

        <div className="flex gap-1.5 mt-3">
          <button
            onClick={() => onDone(candidate)}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
          >
            ✓ 보냈음 — 처리 완료로 내리기
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 문자 발송 설정 ──────────────────────────────────────────────────────────
// 기본값(내 휴대폰)은 설정이 필요 없다. 앱에서 버튼 한 번으로 바로 쏘고 싶을 때만
// 문자 사업자 API를 연결한다. 키는 암호화 저장되고 화면에는 뒤 4자리만 보인다.
function SmsSetupPanel({
  config,
  onSaved,
  onClose,
}: {
  config: SmsConfig | null;
  onSaved: (c: SmsConfig) => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<SmsConfig['provider']>(config?.provider || 'phonelink');
  const [sender, setSender] = useState(config?.sender || '');
  const [userId, setUserId] = useState(config?.userId || '');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.sms.setConfig({ provider, sender, userId, apiKey, apiSecret });
      if (!r.ok || !r.data) {
        setMsg(`저장 실패: ${r.error || '알 수 없는 오류'}`);
        return;
      }
      onSaved(r.data);
      setApiKey('');
      setApiSecret('');
      setMsg(r.data.ready ? '✓ 저장했습니다. 이제 [지금 발송]으로 바로 나갑니다.' : '저장했습니다 — 아직 빈 항목이 있습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function checkBalance() {
    setBusy(true);
    try {
      const r = await api.sms.balance();
      if (!r.ok || !r.data) {
        setMsg(`조회 실패: ${r.error || '알 수 없는 오류'}`);
        return;
      }
      const d = r.data;
      setMsg(
        d.note
          ? d.note
          : d.provider === 'aligo'
            ? `잔여 SMS ${d.sms}건 · LMS ${d.lms}건`
            : `충전금 ${(d.balance || 0).toLocaleString()}원`
      );
    } finally {
      setBusy(false);
    }
  }

  const paid = provider === 'aligo' || provider === 'solapi';

  return (
    <div className="mb-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-bold text-slate-900">⚙ 문자 발송 설정</h4>
        <button onClick={onClose} className="ml-auto text-slate-900 font-bold px-2">
          ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {(
          [
            { id: 'phonelink', label: '휴대폰과 연결 (무료·추천)', help: '대화창을 띄우고 보내기까지 앱이 눌러 실제로 발송합니다' },
            { id: 'gmessages', label: '구글 메시지', help: '앱 안에서 보내기까지 자동 — 최초 1회 QR 스캔' },
            { id: 'phone', label: '문자 앱 열기', help: 'sms: 링크만 엽니다 — 기본 앱에 따라 브라우저로 샐 수 있음' },
            { id: 'aligo', label: '알리고', help: 'SMS 8.4원 내외 — 가장 단순한 국내 문자 API' },
            { id: 'solapi', label: '솔라피', help: '구 쿨SMS — 문서·기능이 풍부' },
          ] as { id: SmsConfig['provider']; label: string; help: string }[]
        ).map((o) => (
          <button
            key={o.id}
            onClick={() => setProvider(o.id)}
            title={o.help}
            className={
              'px-3 py-1.5 rounded-lg text-xs font-bold border ' +
              (provider === o.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100')
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      {provider === 'phonelink' && (
        <div className="text-xs text-slate-900 leading-relaxed">
          설정할 것이 없습니다. 문자 창에서 <b>[문자 바로 발송]</b>을 누르면 앱이 대화창을 띄우고 보내기까지 눌러
          실제로 발송합니다.
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.sms.plStatus();
                  setMsg(
                    r.ok && r.data?.installed
                      ? '✓ 휴대폰과 연결 설치됨 (v' + r.data.version + ') — 바로 쓸 수 있습니다.'
                      : '휴대폰과 연결이 설치돼 있지 않습니다 — Microsoft Store에서 설치해주세요.'
                  );
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-40"
            >
              설치 상태 확인
            </button>
          </div>
        </div>
      )}

      {provider === 'gmessages' && (
        <div className="text-xs text-slate-900 leading-relaxed">
          앱 안에 구글 메시지 창을 띄워 <b>번호·문구를 채우고 보내기까지 자동으로</b> 누릅니다. 내 폰·내 계정으로
          나가서 추가 비용이 없습니다. 최초 1회만 폰에서 QR을 스캔하면 됩니다.
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.sms.gmStatus();
                  const st = r.ok ? r.data?.state : 'error';
                  setMsg(
                    st === 'ready'
                      ? '✓ 폰이 연결돼 있습니다 — 바로 보낼 수 있습니다.'
                      : st === 'qr'
                        ? 'QR 스캔이 필요합니다 — [폰 연결하기]를 눌러주세요.'
                        : '상태: ' + st
                  );
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-40"
            >
              연결 상태 확인
            </button>
            <button
              onClick={() => api.sms.gmConnect()}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
            >
              📱 폰 연결하기 (QR)
            </button>
          </div>
        </div>
      )}

      {provider === 'phone' && (
        <div className="text-xs text-slate-900 leading-relaxed">
          sms: 링크로 문자 앱만 열어줍니다. 보내기는 직접 누르셔야 하고, Windows가 브라우저로 넘겨버리면 아무것도 안
          뜰 수 있습니다 — <b>구글 메시지</b>를 쓰시는 편이 확실합니다.
        </div>
      )}

      {paid && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-900">
              발신번호 (사전등록된 번호)
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="02-0000-0000 또는 010-0000-0000"
                className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-normal text-slate-900"
              />
            </label>
            {provider === 'aligo' && (
              <label className="text-xs font-bold text-slate-900">
                알리고 아이디
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-normal text-slate-900"
                />
              </label>
            )}
            <label className="text-xs font-bold text-slate-900">
              API Key {config?.apiKey && <span className="font-normal">(현재 {config.apiKey})</span>}
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="바꿀 때만 입력"
                className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-normal text-slate-900"
              />
            </label>
            {provider === 'solapi' && (
              <label className="text-xs font-bold text-slate-900">
                API Secret {config?.apiSecret && <span className="font-normal">(현재 {config.apiSecret})</span>}
                <input
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="바꿀 때만 입력"
                  className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-normal text-slate-900"
                />
              </label>
            )}
          </div>

          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-slate-900 leading-relaxed">
            <b>가입 순서</b> — ① {provider === 'aligo' ? 'smartsms.aligo.in' : 'solapi.com'} 가입 ②{' '}
            <b>발신번호 사전등록</b> (통신서비스 이용증명원 또는 ARS 인증 — 전기통신사업법 의무, 보통 당일~1영업일) ③
            선불 충전 ④ 여기에 키 붙여넣기.
            <br />
            회사 대표번호로 보내려면 총무/IT를 통해 회사 명의로 등록해야 합니다.
          </div>
        </>
      )}

      <div className="flex gap-1.5 mt-3">
        <button
          onClick={save}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        {paid && (
          <button
            onClick={checkBalance}
            disabled={busy}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-40"
          >
            잔액 확인
          </button>
        )}
        {msg && <span className="self-center text-xs font-bold text-slate-900">{msg}</span>}
      </div>
    </div>
  );
}

// ── 문자 양식 편집 ──────────────────────────────────────────────────────────
// 메일 양식과 완전히 분리한다. 메일은 원문(일정·장소·처우까지 전부),
// 문자는 "결과 나왔으니 메일 확인해달라"는 알림만. 문자에 결과나 숫자를 넣지 않는 이유는
// 문자가 남의 눈에 잘 띄고 잘못 보내면 되돌릴 수 없기 때문이다.
function SmsTemplatePanel({
  templates,
  stage,
  onChange,
  onClose,
}: {
  templates: SmsTemplate[];
  stage: TemplateStage;
  onChange: (list: SmsTemplate[]) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<TemplateStage>(stage);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const cur = templates.find((t) => t.stage === editing);
  // 단계를 바꾸면 그 단계 문구를 불러온다
  useEffect(() => {
    setDraft(templates.find((t) => t.stage === editing)?.text ?? defaultSmsText(editing));
    setMsg(null);
  }, [editing, templates]);

  const bytes = smsBytes(draft);
  const kind = bytes <= 90 ? 'SMS' : bytes <= 2000 ? 'LMS' : '너무 김';
  const dirty = draft !== (cur?.text ?? defaultSmsText(editing));

  return (
    <div className="mb-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-bold text-slate-900">💬 문자 양식 (메일과 별도)</h4>
        <button onClick={onClose} className="ml-auto text-slate-900 font-bold px-2">
          ✕
        </button>
      </div>

      <div className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-[11px] text-slate-900 leading-relaxed mb-2">
        <b>메일</b>은 원문입니다 — 일정·장소·처우까지 필요한 정보를 다 담습니다.
        <br />
        <b>문자</b>는 알림입니다 — <b>&quot;결과 나왔으니 메일을 확인해달라&quot;</b>만 보냅니다. 합격 여부나 연봉 같은
        내용은 문자에 넣지 마세요. 잘못 가면 되돌릴 수 없습니다.
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {STAGE_ORDER.map((sg) => (
          <button
            key={sg}
            onClick={() => setEditing(sg)}
            className={
              'px-2.5 py-1 rounded-lg text-xs font-bold border ' +
              (editing === sg
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100')
            }
          >
            {sg === 'offer' && '🔒 '}
            {STAGE_LABEL[sg]}
            {templates.find((t) => t.stage === sg)?.modifiedAt && <span className="ml-1 text-emerald-600">•</span>}
          </button>
        ))}
      </div>

      <label className="block text-xs font-bold text-slate-900 mb-1">
        문구{' '}
        <span className="font-normal">
          {bytes}바이트 · {kind}
          {kind === 'LMS' && ' (90바이트 넘으면 장문으로 나갑니다)'}
        </span>
      </label>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono"
      />

      <div className="text-[11px] text-slate-900 mt-1">
        쓸 수 있는 변수:{' '}
        {SMS_VARS.map((v) => (
          <button
            key={v}
            onClick={() => setDraft((d) => d + `{{${v}}}`)}
            className="mx-0.5 px-1.5 py-0.5 rounded border border-slate-300 bg-white font-mono hover:bg-slate-100"
            title="클릭하면 문구 끝에 넣습니다"
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 mt-3 items-center">
        <button
          onClick={async () => {
            setBusy(true);
            try {
              onChange(await saveSmsTemplate(editing, draft));
              setMsg('✓ 저장했습니다.');
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy || !dirty}
          className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-40"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        <button
          onClick={async () => {
            if (!window.confirm(`${STAGE_LABEL[editing]} 문자 양식을 기본값으로 되돌립니다.`)) return;
            setBusy(true);
            try {
              const next = await resetSmsTemplate(editing);
              onChange(next);
              setDraft(defaultSmsText(editing));
              setMsg('기본 양식으로 되돌렸습니다.');
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-40"
        >
          기본값으로
        </button>
        {msg && <span className="text-xs font-bold text-slate-900">{msg}</span>}
        {dirty && !msg && <span className="text-xs font-bold text-amber-700">저장 안 된 변경이 있습니다</span>}
      </div>
    </div>
  );
}
