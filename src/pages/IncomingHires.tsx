import { useEffect, useMemo, useState } from 'react';
import { useLiveData, liveByKindOrScan, liveCalendarEventsNormalized, refreshCalendarFromGoogle } from '../store/liveData';
import { getTodayStr } from '../store';
import { parseSheetDate, field, fmtDateLabel } from '../lib/sheetParse';
import { rowsToObjects } from '../lib/sheetMapping';
import { api } from '../lib/api';
import { SHARED_CAL } from '../lib/sharedCalendars';

// 입사안내 메일 발송 정보 — Gmail 발송함 검색 결과 1건
interface OnboardingMail {
  threadId: string;
  date: string;          // YYYY-MM-DD (발송일)
  subject: string;
  to: string;
  fromEmail: string;     // 발송자 이메일 (hdlee@... 또는 shim@...)
  senderLabel: string;   // UI 표시용: "이형도" / "임세현" / "기타"
  hireDate: string | null; // 메일 본문에서 추출한 입사예정일 (YYYY-MM-DD)
  team: string | null;   // 메일 본문에서 추출한 부서
}

// 입사안내를 발송하는 TA팀원 — 본인+팀장
const SENDER_EMAILS: Record<string, string> = {
  'hdlee@cnccosmetic.com': '이형도',
  'shim@cnccosmetic.com': '임세현',
};

// 종일 이벤트 종료일 계산 — Google Calendar all-day 이벤트는 end.date가 exclusive (다음날)
function addDaysIso(iso: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 입사 캘린더 자동 공유 대상 — 사용자 결정: 구성원경험팀(ga@), 인사팀(People Ops 운영 담당 yshwang@).
// 회사에 hr@/peopleops@ 같은 그룹 메일이 없어 운영 담당자 개별 메일로 공유. role=reader (읽기 전용).
const ONBOARDING_CAL_SHARED_EMAILS: { email: string; role: 'reader' | 'writer' }[] = [
  { email: 'ga@cnccosmetic.com', role: 'reader' },       // 구성원경험팀
  { email: 'yshwang@cnccosmetic.com', role: 'reader' },  // People Ops팀 (인사팀 운영)
];

// 메일 본문(snippet)에서 "□ 입사일 : 2026년 5월 18일(월)" 같은 패턴을 YYYY-MM-DD로 변환
function extractHireDateFromSnippet(snippet: string): string | null {
  if (!snippet) return null;
  const m = snippet.match(/입사일\s*[:：]?\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// 메일 본문에서 "□ 부서 : KPD1팀" 같은 부서 추출
function extractTeamFromSnippet(snippet: string): string | null {
  if (!snippet) return null;
  const m = snippet.match(/부서\s*[:：]?\s*([^□\n]+?)(?:\s*□|\s*입사일|\n|$)/);
  return m ? m[1].trim() : null;
}

type SiteTone = 'purple' | 'green' | 'suwon' | 'gray';
type ApprovalStatus = 'approved' | 'pending' | 'unknown';

interface HireRow {
  date: string;
  bonbu: string;
  team: string;
  job: string;
  rank: string;
  career: string;
  name: string;
  gender: string;
  birthYear: string;
  site: string;
  jikgu: string;
  noteRaw: string;
  approval: ApprovalStatus;
  approvalLink: string | null;
}

const SITE_STYLE: Record<SiteTone, { chip: string; bar: string; label: string }> = {
  purple: { chip: 'bg-purple-100 text-purple-800 border-purple-200', bar: 'bg-purple-500', label: '퍼플' },
  green: { chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', bar: 'bg-emerald-500', label: '그린' },
  suwon: { chip: 'bg-sky-100 text-sky-800 border-sky-200', bar: 'bg-sky-500', label: '수원' },
  gray: { chip: 'bg-slate-100 text-slate-700 border-slate-200', bar: 'bg-slate-300', label: '기타' },
};

function classifySite(siteName: string): SiteTone {
  const s = (siteName || '').trim();
  if (!s) return 'gray';
  if (s.includes('퍼플')) return 'purple';
  if (s.includes('그린')) return 'green';
  if (s.includes('수원')) return 'suwon';
  return 'gray';
}

function classifyApproval(note: string): { status: ApprovalStatus; link: string | null } {
  const n = (note || '').trim();
  if (!n) return { status: 'unknown', link: null };
  // 공백/줄바꿈 정규화 후 매칭 — "결재중"/"결재 중"/"결재 진행 중" 등 표기 변형 모두 흡수
  const normalized = n.replace(/\s+/g, '');
  if (/결재중|결재진행/.test(normalized)) return { status: 'pending', link: null };
  // 전자결재 - C&C GW (with or without inline URL, 공백 변형 흡수)
  if (/전자결재|C&CGW/i.test(normalized)) {
    const m = n.match(/(https?:\/\/\S+)/);
    return { status: 'approved', link: m ? m[1] : null };
  }
  return { status: 'unknown', link: null };
}

// 시트의 "입사안내" 컬럼 O 표시 — TA팀 운영시트(1lTtxMy6...)의 날짜별 입사자 탭처럼
// 별도 매핑 없이도 스냅샷 전체를 훑어서 (입사예정일+성명+입사안내) 컬럼이 있는 탭이면
// 모두 매칭. 사용자가 "O" 마크한 사람은 입사안내 발송 완료로 간주.
interface SheetOnboardingMark {
  marked: boolean;
  sheetTitle: string;
  tabName: string;
}

function scanSheetOnboardingMarks(
  snapshots: Record<string, { title: string; tabs: Record<string, string[][]> }>
): Map<string, SheetOnboardingMark> {
  const out = new Map<string, SheetOnboardingMark>();
  for (const snap of Object.values(snapshots)) {
    for (const [tabName, rows] of Object.entries(snap.tabs)) {
      const objs = rowsToObjects(rows, 0);
      if (objs.length === 0) continue;
      const keys = Object.keys(objs[0]);
      const norm = (k: string) => k.replace(/\s+/g, '');
      const hasOnboardCol = keys.some((k) => norm(k).includes('입사안내'));
      const hasNameCol = keys.some((k) => /성명|이름/.test(k));
      const hasDateCol = keys.some((k) => {
        const n = norm(k);
        return n.includes('입사예정일') || n.includes('입사일');
      });
      if (!hasOnboardCol || !hasNameCol || !hasDateCol) continue;
      for (const r of objs) {
        const name = field(r, ['성명', '이름']).trim();
        const dateRaw = field(r, ['입사예정일', '입사일']).trim();
        const date = parseSheetDate(dateRaw);
        if (!name || !date) continue;
        const onboardVal = field(r, ['입사안내']).trim();
        const marked = /^[Oo○0]+$/.test(onboardVal);
        const key = `${name}|${date}`;
        const existing = out.get(key);
        if (!existing || (marked && !existing.marked)) {
          out.set(key, { marked, sheetTitle: snap.title, tabName });
        }
      }
    }
  }
  return out;
}

function parseHireRows(rows: Record<string, string>[]): HireRow[] {
  const out: HireRow[] = [];
  for (const r of rows) {
    const name = field(r, ['성명', '이름']).trim();
    if (!name) continue;
    const dateRaw = field(r, ['입사예정일', '입사일', '입사 예정일', '예정일']).trim();
    const date = parseSheetDate(dateRaw);
    if (!date) continue;
    const noteRaw = field(r, ['비고(채용품의 링크)', '채용품의', '비고']).trim();
    const { status, link } = classifyApproval(noteRaw);
    out.push({
      date,
      bonbu: field(r, ['본부명', '본부']).trim(),
      team: field(r, ['팀명', '팀']).trim(),
      job: field(r, ['직무']).trim(),
      rank: field(r, ['직급']).trim(),
      career: field(r, ['신입/경력', '신입경력']).trim(),
      name,
      gender: field(r, ['성별']).trim(),
      birthYear: field(r, ['출생연도', '출생년도', '생년']).trim(),
      site: field(r, ['근무지']).trim(),
      jikgu: field(r, ['직/간접분류', '직간접분류', '직/간접구분', '직간접']).trim(),
      noteRaw,
      approval: status,
      approvalLink: link,
    });
  }
  return out;
}

// Gmail 발송함에서 입사안내 메일 찾아 이름→메일 매핑 생성.
// 제목 패턴: "[(주)씨앤씨인터내셔널] {이름}님 입사 안내..." / "...입사 안내드립니다."
//            "(재안내) [(주)씨앤씨인터내셔널] {이름}님 입사 안내 드립니다." 변형 다 흡수.
// snippet 본문에 "{이름}님이 가지고 계신 역량이..." 가 거의 항상 있어 fallback으로 사용.
function extractCandidateName(subject: string, snippet: string): string | null {
  // 1) "] {이름}님 입사 안내(드립니다)?" — 가장 흔한 표준 패턴
  let m = subject.match(/[\]》>]\s*([가-힣]{2,5})\s*님\s*입사\s*안내/);
  if (m) return m[1];
  // 2) 대괄호 없이 "(재안내) {이름}님 입사 안내" 형태
  m = subject.match(/([가-힣]{2,5})\s*님\s*입사\s*안내(?:드립니다)?/);
  if (m) return m[1];
  // 3) 발송 메일 본문(snippet) 시작이 "안녕하세요. {이름}님" — 제목이 깨져 있어도 추출 가능
  m = (snippet || '').match(/안녕하세요[.,]?\s*([가-힣]{2,5})\s*님/);
  if (m) return m[1];
  // 4) "{이름}님이 가지고 계신 역량이" 본문 첫 줄 — 입사안내 메일 고유 멘트
  m = (snippet || '').match(/([가-힣]{2,5})\s*님이 가지고 계신 역량/);
  if (m) return m[1];
  return null;
}

// from 헤더에서 이메일만 추출 — "이형도 <hdlee@cnccosmetic.com>" → "hdlee@cnccosmetic.com"
function parseFromEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from || '').trim().toLowerCase();
}

// 동명이인이 여러 건일 때, 행 입사일(hireDate)에 가장 가까운 메일 선택.
// - hireDate가 일치하는 메일이 있으면 그것 우선 (가장 정확)
// - 없으면 발송일이 입사일보다 빠르고 가장 가까운 메일
// - 없으면 가장 최근 발송
function pickBestMail(list: OnboardingMail[], rowHireDate: string): OnboardingMail | undefined {
  if (!list.length) return undefined;
  // 1) hireDate 정확 일치
  const exact = list.find((m) => m.hireDate === rowHireDate);
  if (exact) return exact;
  // 2) 발송일이 입사일 이전 + 가장 가까운 것 (입사 전에 보내는 메일이라 정상)
  const before = list
    .filter((m) => m.date <= rowHireDate)
    .sort((a, b) => b.date.localeCompare(a.date)); // 최신순
  if (before.length > 0) return before[0];
  // 3) 그 외 (입사 후 발송 등) — 가장 최근
  return list[0];
}

async function fetchOnboardingMails(): Promise<Map<string, OnboardingMail[]>> {
  const map = new Map<string, OnboardingMail[]>();
  try {
    // 본인(hdlee@) 발송함 + 임세현(shim@) 팀장이 보낸 메일(받은편지함에 cc/to/bcc된 경우)도 함께 검색.
    // - from:hdlee → 내 sent
    // - from:shim → 임세현이 보낸 것 중 hdlee Gmail에서 보이는 메일 (보통 cc/bcc로 hdlee@ 포함된 케이스)
    const query = '(from:hdlee@cnccosmetic.com OR from:shim@cnccosmetic.com) ("입사 안내" OR 입사안내 OR "입사 안내드립니다") newer_than:180d';
    const r = await api.google.listGmail(query, 400);
    if (!r.ok || !r.data) {
      console.warn('[IncomingHires] listGmail 실패', r);
      (window as Window & { __onboardingMailDebug?: unknown }).__onboardingMailDebug = { error: r.error, count: 0 };
      return map;
    }
    const debugRows: { subject: string; name: string | null; date: string; from: string }[] = [];
    for (const m of r.data) {
      const subject = m.subject || '';
      // 회신/전달 keyword: 영문(Re/Fwd/FW) + 한글(회신/전달/답신) 모두 skip
      if (/^\s*(Re|RE|Fwd|FW|FWD|회신|답신|전달|RE\:|FW\:)\s*[:：]/i.test(subject)) continue;
      const fromEmail = parseFromEmail(m.from || '');
      const senderLabel = SENDER_EMAILS[fromEmail] || (fromEmail ? fromEmail.split('@')[0] : '기타');
      const name = extractCandidateName(subject, m.snippet || '');
      const sentDate = (m.date || '').slice(0, 10);
      debugRows.push({ subject, name, date: sentDate, from: fromEmail });
      if (!name) continue;
      const info: OnboardingMail = {
        threadId: m.threadId,
        date: sentDate,
        subject,
        to: m.to,
        fromEmail,
        senderLabel,
        hireDate: extractHireDateFromSnippet(m.snippet || ''),
        team: extractTeamFromSnippet(m.snippet || ''),
      };
      if (!map.has(name)) map.set(name, []);
      // 같은 이름·같은 thread는 중복 제거 (hdlee가 cc 받으면 두 번 잡힐 수도)
      if (!map.get(name)!.some((x) => x.threadId === info.threadId)) {
        map.get(name)!.push(info);
      }
    }
    // 같은 이름이 여러 건이면 가장 최근 발송 우선 (정확 매칭은 호출 측에서 hireDate 비교로 처리)
    for (const [, list] of map) list.sort((a, b) => b.date.localeCompare(a.date));
    (window as Window & { __onboardingMailDebug?: unknown }).__onboardingMailDebug = {
      fetched: r.data.length,
      matched: debugRows.filter((d) => d.name).length,
      unmatched: debugRows.filter((d) => !d.name).slice(0, 10),
      fromBreakdown: debugRows.reduce((acc, d) => { acc[d.from] = (acc[d.from] || 0) + 1; return acc; }, {} as Record<string, number>),
      sampleNames: Array.from(map.entries()).slice(0, 30).map(([n, l]) => ({ name: n, count: l.length, sender: l[0].senderLabel })),
    };
  } catch (e) {
    console.error('[IncomingHires] fetchOnboardingMails 예외', e);
  }
  return map;
}

export function IncomingHires() {
  const live = useLiveData();
  const today = getTodayStr();
  const [showPast, setShowPast] = useState(false);
  const [siteFilter, setSiteFilter] = useState<'전체' | SiteTone>('전체');
  const [approvalFilter, setApprovalFilter] = useState<'전체' | ApprovalStatus>('전체');
  const [query, setQuery] = useState('');
  const [mailMap, setMailMap] = useState<Map<string, OnboardingMail[]>>(new Map());

  // 입사안내 메일 매핑 fetch — 마운트 + 90초마다 자동 refresh (Gmail API는 read-only)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const m = await fetchOnboardingMails();
      if (alive) setMailMap(m);
    };
    void load();
    const t = window.setInterval(load, 90_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const allRows = useMemo<HireRow[]>(() => {
    if (!live.hasLive) return [];
    // office (정규직) + field (생산입사예정자) 병합 — 같은 사람이면 office 우선
    const office = parseHireRows(liveByKindOrScan('incoming'));
    const field = parseHireRows(liveByKindOrScan('field_incoming'));
    const seen = new Set(office.map((r) => `${r.name}|${r.date}`));
    const fieldExtra = field.filter((r) => !seen.has(`${r.name}|${r.date}`));
    return [...office, ...fieldExtra];
  }, [live]);

  // 시트 "입사안내" O 표시 인덱스 — Gmail 발송 기록과 별개의 보강 신호.
  // TA팀 운영시트(예: 1lTtxMy6...) 날짜별 입사자 탭에서 자동 스캔.
  const sheetMarks = useMemo(
    () => scanSheetOnboardingMarks(live.snapshots),
    [live.snapshots]
  );

  // 입사 캘린더 자동 등록 — 결재 완료(approved) + 미래 입사 + 캘린더 미등록 조건
  // 메모리 룰: 노란색(colorId=5), summary에 "팀 + 이름", 결재 진행중도 등록 (시트 삭제 시 자동 cleanup).
  // dismissedHireKeys cfg로 사용자가 "자동 등록 안 함" 처리한 사람은 skip.
  // hireCalId — shim@ owner 메인 입사 캘린더는 hdlee write 권한 없음. 자동 우회: hdlee 본인 owner 새 캘린더.
  const [hireCalId, setHireCalId] = useState<string | null>(null);
  const [autoRegHires, setAutoRegHires] = useState<Set<string>>(new Set());
  const [dismissedHires, setDismissedHires] = useState<Set<string>>(new Set());
  const [dismissedHiresLoaded, setDismissedHiresLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.cfg.get<string[]>('dismissedHireKeys');
        if (!cancelled && r.ok && Array.isArray(r.data)) setDismissedHires(new Set(r.data));
      } catch { /* ignore */ } finally {
        if (!cancelled) setDismissedHiresLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!dismissedHiresLoaded || !live.hasLive || allRows.length === 0) return;
    if (!hireCalId) return; // 자동 캘린더 부트스트랩 대기

    void (async () => {
    // hireCalId의 이벤트는 READ_CALENDAR_IDS에 안 들어있으니 직접 fetch
    const calStart = `${today}T00:00:00+09:00`;
    const calEnd = '2027-01-01T00:00:00+09:00';
    const calRes = await api.google.listCalendar(calStart, calEnd, hireCalId);
    const onboardingEvents = (calRes.ok && calRes.data) ? calRes.data : [];
    const isAlreadyRegistered = (date: string, name: string) =>
      onboardingEvents.some((e) => {
        const dt = (e.start || '').slice(0, 10);
        return dt === date && (e.summary || '').includes(name);
      });

    // 결재완료 + 결재중 모두 등록 (시트에 입사예정 행이 있다 = 입사 일정 잡혔다는 신호).
    // 결재 풀리거나 시트에서 사라지면 아래 자동 취소 로직이 정리.
    const toRegister = allRows.filter((r) => {
      if (r.approval === 'unknown' && !r.noteRaw) return false; // 비고 비어있는 unknown은 skip
      if (r.date < today) return false; // 미래 + 오늘만
      const key = `${r.date}|${r.name.trim()}`;
      if (dismissedHires.has(key)) return false;
      if (autoRegHires.has(key)) return false;
      if (isAlreadyRegistered(r.date, r.name.trim())) return false;
      return true;
    });
    if (toRegister.length === 0) return;
    // 진행중 set 업데이트
    setAutoRegHires((prev) => {
      const next = new Set(prev);
      for (const r of toRegister) next.add(`${r.date}|${r.name.trim()}`);
      return next;
    });
      for (const r of toRegister) {
        try {
          const teamLabel = (r.team || r.bonbu || '').trim();
          const pendingMark = r.approval === 'pending' ? ' (결재중)' : '';
          const summary = (teamLabel ? `${teamLabel} ${r.name.trim()}` : r.name.trim()) + pendingMark;
          const body: Parameters<typeof api.google.insertCalEvent>[1] = {
            summary,
            description:
              (r.bonbu ? `본부: ${r.bonbu}\n` : '') +
              (r.team ? `팀: ${r.team}\n` : '') +
              (r.job ? `직무: ${r.job}\n` : '') +
              (r.rank ? `직급: ${r.rank}\n` : '') +
              (r.career ? `구분: ${r.career}\n` : '') +
              (r.gender ? `성별: ${r.gender}\n` : '') +
              (r.site ? `근무지: ${r.site}\n` : '') +
              (r.jikgu ? `직/간접: ${r.jikgu}\n` : '') +
              `결재: ${r.approval === 'approved' ? '완료' : r.approval === 'pending' ? '결재중' : '상태미상'}\n` +
              (r.approvalLink ? `링크: ${r.approvalLink}\n` : '') +
              `※ 입사예정자 시트에서 자동 등록 (${getTodayStr()})`,
            start: { date: r.date },
            end: { date: addDaysIso(r.date, 1) },
          };
          (body as Record<string, unknown>).colorId = '5';
          await api.google.insertCalEvent(hireCalId, body, 'none');
          // eslint-disable-next-line no-console
          console.info('[hire-auto-reg] 입사 등록:', r.date, summary);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[hire-auto-reg] 실패 (다음 polling 재시도):', r.name, e);
        }
      }
      setAutoRegHires((prev) => {
        const next = new Set(prev);
        for (const r of toRegister) next.delete(`${r.date}|${r.name.trim()}`);
        return next;
      });
      void refreshCalendarFromGoogle();
    })();
    // 무한 루프 방지: deps에서 live.calendarEvents 제거 (안에서 refreshCalendarFromGoogle 호출하면 무한)
    // autoRegHires도 제거 (안에서 set 변경 → 재실행). closure로 fresh value 매번 새로 캡쳐됨.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, dismissedHires, dismissedHiresLoaded, today, live.hasLive, hireCalId]);

  // 입사 자동 캘린더 부트스트랩 — shim@ owner인 SHARED_CAL.onboardingMain은 hdlee write 권한 없음
  // (Google API "EDITOR access 없음" 거부). 우회: hdlee 본인 owner 새 캘린더 1회 자동 생성 + cfg 저장.
  // 그 후 모든 자동 등록/취소는 이 캘린더에 적용. ga@/yshwang@에 reader 자동 공유.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.cfg.get<string>('hireAutoCalendarId');
        if (cancelled) return;
        if (r.ok && typeof r.data === 'string' && r.data) {
          setHireCalId(r.data);
        } else {
          // 없으면 새로 생성
          const cr = await api.google.createCalendar(
            '입사 (자동)',
            'Asia/Seoul',
            'CNC 채용 커맨드센터가 입사예정자를 자동 등록하는 캘린더. 권한 우회 — shim@ owner 메인 캘린더에 hdlee write 권한 없음.'
          );
          if (!cancelled && cr.ok && cr.data?.id) {
            const newId = cr.data.id;
            await api.cfg.set('hireAutoCalendarId', newId);
            setHireCalId(newId);
            // 즉시 ACL 추가 (본인 + ga@/yshwang@ reader)
            for (const target of ONBOARDING_CAL_SHARED_EMAILS) {
              try {
                await api.google.insertCalAcl(newId, target.email, target.role, 'user');
              } catch { /* ignore */ }
            }
            // eslint-disable-next-line no-console
            console.info('[hire-auto-cal] 새 입사 자동 캘린더 생성:', newId);
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[hire-auto-cal] 부트스트랩 실패:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ACL 보장 (이미 hireCalId 있는 경우에도 누락 자동 보강)
  useEffect(() => {
    if (!hireCalId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.google.listCalAcl(hireCalId);
        if (!r.ok || !r.data || cancelled) return;
        const existing = new Set(r.data.map((rule) => (rule.scope?.value || '').toLowerCase()));
        for (const target of ONBOARDING_CAL_SHARED_EMAILS) {
          if (existing.has(target.email.toLowerCase())) continue;
          try {
            await api.google.insertCalAcl(hireCalId, target.email, target.role, 'user');
            // eslint-disable-next-line no-console
            console.info('[acl-auto] 입사 자동 캘린더 공유 추가:', target.email, target.role);
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [hireCalId]);

  // 입사 자동 취소 — 우리가 자동 등록한 입사 캘린더 이벤트 중 시트에서 사라지거나
  // 결재가 풀린(approved 아닌) 경우 자동 삭제. 외부에서 수동 등록한 이벤트는 절대 건드리지 않음
  // (description에 우리 자동 등록 마커 있는 것만 cleanup 대상).
  useEffect(() => {
    if (!dismissedHiresLoaded || !live.hasLive || !hireCalId) return;
    void (async () => {
    const calStart = `${today}T00:00:00+09:00`;
    const calEnd = '2027-01-01T00:00:00+09:00';
    const calRes = await api.google.listCalendar(calStart, calEnd, hireCalId);
    if (!calRes.ok || !calRes.data) return;
    const ourMarker = '※ 입사예정자 시트에서 자동 등록';
    const ourEvents = calRes.data.filter((e) =>
      e.colorId === '5' && (e.description || '').includes(ourMarker)
    );
    if (ourEvents.length === 0) return;
    // 시트에 (approved or pending) 행이 있는 키 = 유지 대상 (결재중도 cleanup 안 함)
    const validKeys = new Set(
      allRows
        .filter((r) => (r.approval === 'approved' || r.approval === 'pending') && r.date >= today)
        .map((r) => `${r.date}|${r.name.trim()}`)
    );
    for (const e of ourEvents) {
      const dt = (e.start || '').slice(0, 10);
      if (!dt || dt < today) continue; // 과거 입사는 cleanup 안 함 (이력 보존)
      const cleanTitle = (e.summary || '').replace(/\s*\(결재중\)\s*$/, '').trim();
      const tokens = cleanTitle.split(/\s+/);
      const name = (tokens[tokens.length - 1] || '').trim();
      if (!name) continue;
      const key = `${dt}|${name}`;
      if (validKeys.has(key)) continue;
      if (autoRegHires.has(key)) continue;
      try {
        await api.google.deleteCalEvent(hireCalId, e.id, 'none');
        // eslint-disable-next-line no-console
        console.info('[hire-auto-cancel] 시트에서 사라짐 → 캘린더 삭제:', dt, name);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[hire-auto-cancel] 실패:', dt, name, err);
      }
    }
    void refreshCalendarFromGoogle();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, dismissedHiresLoaded, today, live.hasLive, hireCalId]);


  // 지난 입사자 보강: '입사예정' 시트엔 미래만 남고, 입사 후엔 보통 '정규직DB'/'도급직DB'/'재직자'
  // 같은 별도 탭으로 옮겨감. suggestKind는 이런 시트를 의도적으로 제외하므로 (sheetMapping.ts:52)
  // liveByKindOrScan('incoming')이 못 잡음. → snapshots 직접 스캔해서 입사일 있는 행만 추출.
  const pastRows = useMemo<HireRow[]>(() => {
    if (!live.hasLive) return [];
    const all: Record<string, string>[] = [];
    const hitTabs: string[] = [];
    for (const snap of Object.values(live.snapshots)) {
      for (const [tabName, rows] of Object.entries(snap.tabs)) {
        const norm = tabName.replace(/\s+/g, '');
        const isPastSheet =
          /^정규직DB$/.test(norm) ||
          /^도급직DB$/.test(norm) ||
          norm.includes('재직') ||
          norm.includes('월별입퇴사') ||
          (norm.includes('입사자') && !norm.includes('예정'));
        if (!isPastSheet) continue;
        hitTabs.push(`${snap.title}/${tabName}`);
        all.push(...rowsToObjects(rows, 0));
      }
    }
    // 너무 오래된 입사자는 제외 — 2026-04-01 이후만
    const PAST_CUTOFF = '2026-04-01';
    const parsed = parseHireRows(all).filter((r) => r.date >= PAST_CUTOFF);
    if (typeof window !== 'undefined') {
      (window as Window & { __incomingDebug?: unknown }).__incomingDebug = {
        pastSheetTabs: hitTabs,
        pastRowsRaw: all.length,
        pastRowsAfterCutoff: parsed.length,
        cutoff: PAST_CUTOFF,
      };
    }
    return parsed;
  }, [live.snapshots, live.hasLive]);

  // allRows + pastRows 병합 (이름+입사일 중복 제거 — 사용자가 같은 데이터를 양쪽 시트에 둔 경우 방어)
  const combinedAll = useMemo<HireRow[]>(() => {
    const seen = new Set(allRows.map((r) => `${r.name}|${r.date}`));
    const extra = pastRows.filter((r) => !seen.has(`${r.name}|${r.date}`));
    return [...allRows, ...extra];
  }, [allRows, pastRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // showPast=true 시에만 pastRows 포함. 평소엔 가벼운 incoming만 사용.
    const source = showPast ? combinedAll : allRows;
    return source.filter((r) => {
      if (!showPast && r.date < today) return false;
      if (siteFilter !== '전체' && classifySite(r.site) !== siteFilter) return false;
      if (approvalFilter !== '전체' && r.approval !== approvalFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.bonbu} ${r.team} ${r.job} ${r.site} ${r.rank}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, combinedAll, showPast, siteFilter, approvalFilter, query, today]);

  const grouped = useMemo(() => {
    const map = new Map<string, HireRow[]>();
    for (const r of filtered) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const summary = useMemo(() => {
    const upcoming = allRows.filter((r) => r.date >= today);
    // 입사안내 발송 = Gmail 발송 기록 OR 시트 "입사안내" 컬럼 O 표시
    const isAnnounced = (r: HireRow) =>
      (mailMap.get(r.name)?.length || 0) > 0 ||
      !!sheetMarks.get(`${r.name}|${r.date}`)?.marked;
    const mailSent = upcoming.filter(isAnnounced).length;
    return {
      total: upcoming.length,
      approved: upcoming.filter((r) => r.approval === 'approved').length,
      pending: upcoming.filter((r) => r.approval === 'pending').length,
      unknown: upcoming.filter((r) => r.approval === 'unknown').length,
      mailSent,
      mailMissing: upcoming.length - mailSent,
      bySite: {
        purple: upcoming.filter((r) => classifySite(r.site) === 'purple').length,
        green: upcoming.filter((r) => classifySite(r.site) === 'green').length,
        suwon: upcoming.filter((r) => classifySite(r.site) === 'suwon').length,
        gray: upcoming.filter((r) => classifySite(r.site) === 'gray').length,
      },
    };
  }, [allRows, today, mailMap, sheetMarks]);

  if (!live.hasLive) {
    return (
      <div className="card p-8 text-sm text-slate-700 text-center">
        ⚠ 라이브 시트 연결이 필요합니다. ⚙️ 설정 / 연동에서 입사예정(정규직)DB 탭을 매핑하세요.
      </div>
    );
  }

  if (allRows.length === 0) {
    return (
      <div className="card p-8 text-sm text-slate-700 text-center">
        매핑된 입사예정자 시트가 비어있거나, "입사예정자(사무직)" kind으로 매핑된 탭이 없습니다.
        <br />
        ⚙️ 설정 / 연동에서 <span className="font-semibold">입사예정(정규직)DB</span> 탭을 추가하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <SummaryCard label="다가오는 입사" count={summary.total} tone="indigo" />
        <SummaryCard label="결재 완료" count={summary.approved} tone="emerald" />
        <SummaryCard label="결재 진행중" count={summary.pending} tone="amber" />
        <SummaryCard label="입사안내 발송" count={summary.mailSent} tone="emerald" />
        <SummaryCard label="입사안내 미발송" count={summary.mailMissing} tone={summary.mailMissing > 0 ? 'amber' : 'emerald'} />
        <SummaryCard label="퍼플 / 그린" count={summary.bySite.purple + summary.bySite.green} tone="purple" />
      </div>

      {/* 필터 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-700 font-bold mr-1">근무지:</span>
          <Pill active={siteFilter === '전체'} onClick={() => setSiteFilter('전체')}>전체</Pill>
          <Pill active={siteFilter === 'purple'} onClick={() => setSiteFilter('purple')} tone="purple">퍼플</Pill>
          <Pill active={siteFilter === 'green'} onClick={() => setSiteFilter('green')} tone="green">그린</Pill>
          <Pill active={siteFilter === 'suwon'} onClick={() => setSiteFilter('suwon')} tone="sky">수원</Pill>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <span className="text-xs text-slate-700 font-bold mr-1">결재:</span>
          <Pill active={approvalFilter === '전체'} onClick={() => setApprovalFilter('전체')}>전체</Pill>
          <Pill active={approvalFilter === 'approved'} onClick={() => setApprovalFilter('approved')} tone="emerald">완료</Pill>
          <Pill active={approvalFilter === 'pending'} onClick={() => setApprovalFilter('pending')} tone="amber">결재중</Pill>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <Pill active={showPast} onClick={() => setShowPast((v) => !v)} tone="slate">지난 입사 포함</Pill>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름/팀/직무 검색..."
            className="ml-auto px-3 py-1 rounded-full text-xs bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none w-44 text-slate-800"
          />
          <span className="text-xs text-slate-700 font-semibold">{filtered.length}명</span>
        </div>
        {/* 진단 — 어느 시트에서 몇 건 가져왔는지 */}
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-600">
            📊 입사예정 시트: {allRows.length}건
          </span>
          <span
            className={`px-1.5 py-0.5 rounded ${
              pastRows.length > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}
            title={
              pastRows.length > 0
                ? '정규직DB/도급직DB/재직자 탭에서 추가 fetch (2026-04-01 이후만)'
                : '정규직DB/재직자 탭이 매핑돼있지 않거나 비어있음. 설정 → 연동에서 추가'
            }
          >
            📚 지난 입사 (2026-04-01~): {pastRows.length}건
          </span>
          {showPast && filtered.length === 0 && (
            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">
              ⚠ 조건에 맞는 데이터 없음 — 다른 필터 해제 또는 시트 매핑 확인 필요
            </span>
          )}
        </div>
      </div>

      {/* 날짜별 그룹 */}
      {grouped.length === 0 ? (
        <div className="card p-8 text-sm text-slate-500 text-center">조건에 맞는 입사예정자가 없습니다.</div>
      ) : (
        <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
          {grouped.map(([date, rows]) => (
            <DateGroup
              key={date}
              date={date}
              rows={rows}
              today={today}
              mailMap={mailMap}
              sheetMarks={sheetMarks}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DateGroup({
  date,
  rows,
  today,
  mailMap,
  sheetMarks,
}: {
  date: string;
  rows: HireRow[];
  today: string;
  mailMap: Map<string, OnboardingMail[]>;
  sheetMarks: Map<string, SheetOnboardingMark>;
}) {
  const isToday = date === today;
  const isPast = date < today;
  const hasPending = rows.some((r) => r.approval === 'pending');
  const isFuture = date > today;
  // 메일 미발송: 미래 입사이면서 결재 완료(approved)인데도 메일/시트 O 둘 다 없는 사람
  const missingMail = isFuture
    ? rows.filter(
        (r) =>
          r.approval === 'approved' &&
          (mailMap.get(r.name)?.length || 0) === 0 &&
          !sheetMarks.get(`${r.name}|${r.date}`)?.marked
      ).length
    : 0;
  const dateLabel = fmtDateLabel(date, today);
  return (
    <div
      className={`card overflow-hidden ${
        isToday ? 'ring-2 ring-amber-400' : isPast ? 'opacity-60' : ''
      }`}
    >
      <div
        className={`px-4 py-2 flex items-center gap-2 border-b ${
          isToday
            ? 'bg-amber-50 border-amber-200'
            : hasPending
            ? 'bg-amber-50/30 border-slate-200'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        <span className="text-base">📅</span>
        <span className="text-sm font-bold text-slate-800">{dateLabel}</span>
        <span className="chip bg-indigo-100 text-indigo-800 text-[10px]">{rows.length}명</span>
        {hasPending && (
          <span className="chip bg-amber-200 text-amber-900 text-[10px]">⚠ 결재중 포함</span>
        )}
        {missingMail > 0 && (
          <span className="chip bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold">
            ✉️ 입사안내 미발송 {missingMail}명
          </span>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <HireRowCard
            key={`${r.name}-${i}`}
            row={r}
            mail={pickBestMail(mailMap.get(r.name) || [], r.date)}
            sheetMark={sheetMarks.get(`${r.name}|${r.date}`)}
          />
        ))}
      </div>
    </div>
  );
}

function HireRowCard({
  row,
  mail,
  sheetMark,
}: {
  row: HireRow;
  mail?: OnboardingMail;
  sheetMark?: SheetOnboardingMark;
}) {
  const tone = classifySite(row.site);
  const siteStyle = SITE_STYLE[tone];
  const isPending = row.approval === 'pending';
  const isUnknown = row.approval === 'unknown';
  // 메일/시트 둘 다 없으면 진짜 미발송
  const mailMissing = !mail && !sheetMark?.marked;
  return (
    <div
      className={`px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 transition-colors ${
        isPending ? 'bg-amber-50/40' : ''
      }`}
    >
      <div className={`w-1 self-stretch rounded ${siteStyle.bar}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-900">{row.name}</span>
          {row.gender && <span className="text-[11px] text-slate-500">{row.gender}</span>}
          {row.birthYear && <span className="text-[11px] text-slate-500">{row.birthYear}년생</span>}
          <span className={`chip border ${siteStyle.chip} text-[10px]`}>{row.site || '근무지 미정'}</span>
          {row.jikgu && (
            <span className="chip bg-slate-100 text-slate-600 text-[10px]">{row.jikgu}</span>
          )}
        </div>
        <div className="text-[12px] text-slate-700 mt-0.5">
          <span className="font-semibold">{row.bonbu || '본부 미정'}</span>
          {row.team && <span className="text-slate-500"> · {row.team}</span>}
          {row.job && <span> / <span className="text-indigo-700 font-semibold">{row.job}</span></span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-1">
          {row.rank && <span className="chip bg-slate-100 text-slate-700 text-[10px]">{row.rank}</span>}
          {row.career && <span className="chip bg-slate-100 text-slate-700 text-[10px]">{row.career}</span>}
        </div>
        {isPending ? (
          <span className="chip bg-amber-200 text-amber-900 text-[10px] font-bold">⏳ 결재중</span>
        ) : isUnknown ? (
          <span className="chip bg-slate-200 text-slate-700 text-[10px]">상태 미상</span>
        ) : row.approvalLink ? (
          <a
            href={row.approvalLink}
            target="_blank"
            rel="noreferrer"
            className="chip bg-emerald-100 text-emerald-800 text-[10px] font-bold hover:bg-emerald-200"
          >
            ✓ 결재완료 ↗
          </a>
        ) : (
          <span className="chip bg-emerald-100 text-emerald-800 text-[10px] font-bold">✓ 결재완료</span>
        )}
        {/* 입사안내 메일 발송 여부 — 본인(hdlee) + 임세현 팀장 둘 다 검색 */}
        {mail ? (
          <a
            href={`https://mail.google.com/mail/u/0/#all/${mail.threadId}`}
            target="_blank"
            rel="noreferrer"
            className={`chip text-[10px] font-bold ${
              mail.fromEmail === 'shim@cnccosmetic.com'
                ? 'bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
            }`}
            title={`발송자: ${mail.senderLabel} (${mail.fromEmail})\n발송일: ${mail.date}\n받는사람: ${mail.to}\n제목: ${mail.subject}`}
          >
            ✉️ {mail.senderLabel} 발송 ({mail.date.slice(5)}) ↗
          </a>
        ) : sheetMark?.marked ? (
          // 메일 기록은 못 찾았지만 시트에서 입사안내 O 마크 → 발송 완료로 간주
          <span
            className="chip bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold"
            title={`시트 "입사안내" 컬럼에 O 표시됨\n${sheetMark.sheetTitle} / ${sheetMark.tabName}\n(메일 검색에선 못 찾았지만 시트 기준 발송 완료)`}
          >
            ✓ 시트 O 표시
          </span>
        ) : (
          <span
            className="chip bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold"
            title="최근 180일치 메일에서 본인(hdlee@) 또는 임세현(shim@) 발송 입사안내 메일을 찾지 못했고, 시트에도 O 표시 없음."
          >
            ✉️ 입사안내 미발송
          </span>
        )}
        {/* 메일·시트 둘 다 있으면 보강 표시 (메일 chip 옆에 작게) */}
        {mail && sheetMark?.marked && (
          <span
            className="chip bg-teal-50 text-teal-700 border border-teal-200 text-[10px]"
            title={`시트 "입사안내" 컬럼 O 표시 (${sheetMark.sheetTitle} / ${sheetMark.tabName})`}
          >
            📋 시트 ✓
          </span>
        )}
        {mailMissing && row.approval === 'approved' && (
          <span className="text-[9px] text-rose-600 font-bold">⚠ 메일 보내야 함</span>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'indigo' | 'emerald' | 'amber' | 'purple' | 'green';
}) {
  const palette = {
    indigo: { bg: 'bg-indigo-50', num: 'text-indigo-700', bar: 'bg-indigo-500' },
    emerald: { bg: 'bg-emerald-50', num: 'text-emerald-700', bar: 'bg-emerald-500' },
    amber: { bg: 'bg-amber-50', num: 'text-amber-700', bar: 'bg-amber-500' },
    purple: { bg: 'bg-purple-50', num: 'text-purple-700', bar: 'bg-purple-500' },
    green: { bg: 'bg-emerald-50', num: 'text-emerald-700', bar: 'bg-emerald-500' },
  }[tone];
  return (
    <div className={`card p-2.5 relative overflow-hidden ${palette.bg}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${palette.bar}`} />
      <div className="flex items-baseline justify-between ml-1.5">
        <span className={`text-[10px] uppercase tracking-[0.18em] font-bold ${palette.num}`}>
          {label}
        </span>
        <div className="flex items-baseline gap-0.5">
          <span className={`text-2xl font-black tabular-nums ${palette.num}`}>{count}</span>
          <span className="text-[10px] text-slate-500">명</span>
        </div>
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: 'purple' | 'green' | 'sky' | 'amber' | 'emerald' | 'slate';
  children: React.ReactNode;
}) {
  let activeBg = 'bg-indigo-600 text-white border-indigo-600';
  let idle = 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300';
  if (tone === 'purple') {
    activeBg = 'bg-purple-600 text-white border-purple-600';
    idle = 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100';
  } else if (tone === 'green') {
    activeBg = 'bg-emerald-600 text-white border-emerald-600';
    idle = 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
  } else if (tone === 'sky') {
    activeBg = 'bg-sky-600 text-white border-sky-600';
    idle = 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100';
  } else if (tone === 'amber') {
    activeBg = 'bg-amber-600 text-white border-amber-600';
    idle = 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100';
  } else if (tone === 'emerald') {
    activeBg = 'bg-emerald-600 text-white border-emerald-600';
    idle = 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
  } else if (tone === 'slate') {
    activeBg = 'bg-slate-700 text-white border-slate-700';
    idle = 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100';
  }
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
        active ? activeBg + ' shadow-sm' : idle
      }`}
    >
      {children}
    </button>
  );
}
