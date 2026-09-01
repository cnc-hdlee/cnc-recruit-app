// 후보자 안내 메일 — 면접 캘린더 일정 기준 발송.
//
// 흐름: 사업장(퍼플카운티/용인) → 본부(생산/영업/연구소/크솔) → 단계 양식 선택
//       → 면접 캘린더에 잡힌 후보자 목록에서 상대 메일 주소만 넣고 [발송]
// 발송은 Gmail API 직접 발송(gmail.send). 사용자가 버튼을 누른 경우에만 나간다 — 자동 발송 경로 없음.
// 처우협의(offer)만 예외로 잠금 유지: 자동 prefill 금지 + 2단계 확인.
//
// 단계: 1차 면접 안내 → 1차 합격 → 처우협의 → 최종 입사 안내 (+불합격)
//       CPI 인성검사는 폐지(2026-08)되어 제거. 2차 면접은 아직 미구현.

import { useEffect, useMemo, useRef, useState } from 'react';
import { IS_VIEWER } from '../lib/mode';
import { INTERVIEW_CAL_IDS } from '../lib/sharedCalendars';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { isInterviewKind, parseInterviewTitle } from './CalendarPage';
import { api } from '../lib/api';
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
}

// ── 후보자 판정 보정 ─────────────────────────────────────────
// 면접 캘린더에는 후보자 면접이 아닌 일정도 섞여 있고, 제목 포맷이 어긋나면
// 파서가 엉뚱한 토큰을 이름으로 잡는다. 메일은 사람에게 나가므로 여기서 한 번 더 거른다.
// (2026-08-31 실제 캘린더 46건 대조로 확인된 케이스들)

/** 아예 후보자 면접이 아닌 일정 — 제목에 걸리면 목록에서 뺀다 */
const NOT_CANDIDATE_EVENT =
  /도제실습|도제교육|교육|설명회|weekly|preview|미팅|회의|워크샵|간담회|웨비나|OJT|오리엔테이션|일자리센터|박람회|대기실|안내/i;

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

  const [siteId, setSiteId] = useState<string>('purple');
  const [hqId, setHqId] = useState<string>('all');
  const [stage, setStage] = useState<TemplateStage>('interview_1st');
  const [tplId, setTplId] = useState<string | null>(null);
  const [onlyUpcoming, setOnlyUpcoming] = useState(true);
  const [search, setSearch] = useState('');
  const [draftEmail, setDraftEmail] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // (불참)/(노쇼) 표시된 면접은 메일 대상이 아니므로 기본 제외, 필요하면 켠다
  const [includeAbsent, setIncludeAbsent] = useState(false);
  // 메일 대상에서 뺄 내부 인원 (TA팀 등) — 설정에서 편집
  const [excludeNames, setExcludeNames] = useState<string[]>([]);
  const [showDrops, setShowDrops] = useState(false);
  // 목록에서 걸러낸 일정과 사유 — 조용히 사라지지 않게 화면에 남긴다
  const dropsRef = useRef<{ title: string; reason: string }[]>([]);

  const [editingTpl, setEditingTpl] = useState<EmailTemplate | null>(null);
  const [modal, setModal] = useState<{ template: EmailTemplate; candidate: CalCandidate } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // 드라이브 읽기 권한이 없어 일정 첨부 이력서를 못 읽는 상태 (스코프 추가 후 최초 1회 재로그인 필요)
  const [needDriveAuth, setNeedDriveAuth] = useState(false);
  const driveAuthTried = useRef(false);
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
    loadSendLog().then(setLog);
  }, []);

  const site = sites.find((s) => s.id === siteId) || sites[0] || null;

  // ── 면접 캘린더 → 후보자 목록 (캘린더 페이지와 동일한 분류기/파서 + 메일 전용 보정)
  const allCandidates = useMemo<CalCandidate[]>(() => {
    if (hqs.length === 0) return [];
    const out = new Map<string, CalCandidate>();
    const drops: { title: string; reason: string }[] = [];
    for (const e of liveCalendarEventsNormalized()) {
      if (!isInterviewKind(e.title, e.raw.colorId ?? null, e.raw.calendarId ?? null)) continue;

      // ① 후보자 면접이 아닌 일정 (도제실습 / 교육 / 내부 미팅 등)
      if (NOT_CANDIDATE_EVENT.test(e.title)) {
        drops.push({ title: e.title, reason: '후보자 면접이 아님' });
        continue;
      }

      const p = parseInterviewTitle(e.title);
      const name = fixCandidateName(e.title, (p.candidate || '').trim());

      // ② 이름을 못 잡았거나 사람 이름이 아닌 토큰
      if (!name || name.length > 5) {
        drops.push({ title: e.title, reason: '이름 인식 실패' });
        continue;
      }
      if (NOT_A_NAME.test(name)) {
        drops.push({ title: e.title, reason: `'${name}'은 사람 이름이 아님` });
        continue;
      }
      // ③ 내부 인원(TA팀 등) — 메일 대상이 아님
      if (excludeNames.includes(name)) {
        drops.push({ title: e.title, reason: `내부 인원(${name}) 제외` });
        continue;
      }

      const tm = e.tm || p.time || '';
      const key = `${e.dt}|${tm}|${name}`;
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
        email: emailMap[name] || autoEmail[name] || '',
        status: st ? st[1] : '',
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
      .filter((c) => !c.email && c.name && !autoTried.current.has(c.name))
      .slice(0, 40);
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const c of targets) {
        autoTried.current.add(c.name);
        try {
          // ① 이력서 보관함
          let found = '';
          const r = await api.resumes.contactsByName(c.name);
          if (r.ok && r.data?.email) found = r.data.email;
          // ② 보관함에 없으면 — 메일에 첨부된 이력서를 찾아 그 자리에서 읽는다 (저장은 안 함)
          if (!found) found = await emailFromGmailResume(c.name);
          // ③ 그래도 없으면 면접 일정에 첨부된 이력서(드라이브)에서
          if (!found) found = await emailFromCalendarAttachment(c.name, c.dt);
          if (!found || cancelled) continue;
          setAutoEmail((p) => ({ ...p, [c.name]: found }));
          await saveAutoEmail(c.name, found);
        } catch {
          // 이력서가 없거나 못 읽는 형식 — 수기 입력으로 남겨둔다
        }
      }
      // 드라이브 권한이 없어 일정 첨부 이력서를 못 읽었다면 — 물어보지 말고 바로 로그인 창을 띄운다.
      // (권한 동의 클릭만 사용자가 하면 되고, 끝나면 못 채운 주소를 자동으로 다시 채운다)
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
  // 이미 치른 면접에만 보내는 단계 — 불합격 안내. 목록을 지난 면접으로 뒤집는다.
  const isPastStage = stage === 'reject';
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCandidates.filter((c) => {
      // 불합격 안내는 이미 본 면접에만 보낼 수 있다 — 지난 면접만 남긴다.
      // (반대로 나머지 단계는 앞으로 있을 면접이 대상이라 '예정 일정만'이 기본)
      if (isPastStage) {
        if (c.dt >= today) return false;
      } else if (onlyUpcoming && c.dt < today) {
        return false;
      }
      if (c.status && !includeAbsent) return false; // (불참)/(노쇼)는 기본 제외
      // 사업장 — 일정에서 사업장을 못 읽은 건은 항상 보여준다(누락 방지)
      if (c.siteId && c.siteId !== siteId) return false;
      if (hqId !== 'all' && c.hqId !== hqId) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [allCandidates, onlyUpcoming, today, siteId, hqId, search, includeAbsent, isPastStage]);

  // 본부 탭 카운트 (사업장·기간 필터까지 반영한 수)
  const hqCounts = useMemo(() => {
    const base = allCandidates.filter(
      (c) =>
        (isPastStage ? c.dt < today : !onlyUpcoming || c.dt >= today) &&
        (!c.siteId || c.siteId === siteId)
    );
    const m: Record<string, number> = { all: base.length };
    for (const c of base) m[c.hqId] = (m[c.hqId] || 0) + 1;
    return m;
  }, [allCandidates, onlyUpcoming, today, siteId, isPastStage]);

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
      const r = await api.google.sendGmail({ to, subject: rendered.subject, body: rendered.body });
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
      await saveEmail(c.name, to);
      setEmailMap((p) => ({ ...p, [c.name]: to }));
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

      {/* ── 3) 면접 캘린더 후보자 → 메일 주소만 넣고 발송 ──── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="text-sm font-bold text-slate-900">
            면접 캘린더 후보자 <span className="text-slate-900">{candidates.length}명</span>
          </h3>
          {isPastStage ? (
            <span className="px-2 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold">
              지난 면접만 — 불합격 안내는 면접을 본 사람에게만
            </span>
          ) : (
            <label className="flex items-center gap-1 text-sm text-slate-900">
              <input type="checkbox" checked={onlyUpcoming} onChange={(e) => setOnlyUpcoming(e.target.checked)} />
              예정 일정만
            </label>
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
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·소속 검색"
            className="ml-auto px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-56"
          />
        </div>

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
              {candidates.map((c) => {
                const to = draftEmail[c.key] ?? c.email;
                const sent = log.find((l) => l.variables?.['이름'] === c.name && l.templateId === currentTpl?.id);
                return (
                  <tr key={c.key} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-900 whitespace-nowrap">{c.when}</td>
                    <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                      {c.name}
                      {c.status && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-900 border border-rose-200">
                          {c.status}
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
                        onClick={() => currentTpl && setModal({ template: currentTpl, candidate: { ...c, email: to } })}
                        disabled={!currentTpl}
                        className="ml-1 px-2 py-1 rounded border border-slate-300 bg-white text-xs text-slate-900 hover:bg-slate-100"
                      >
                        미리보기
                      </button>
                      {sent && <span className="ml-1 text-xs font-bold text-green-700">발송됨</span>}
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-sm text-slate-900">
                    조건에 맞는 면접 일정이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
