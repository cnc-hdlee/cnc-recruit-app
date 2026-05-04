import { useEffect, useMemo, useState } from 'react';
import { useData, getTodayStr } from '../store';
import { useLiveData, liveCalendarEventsNormalized, refreshCalendarFromGoogle } from '../store/liveData';
import { api } from '../lib/api';
import { SHARED_CAL } from '../lib/sharedCalendars';

// 근무지 프리셋 (퍼플/그린/수원/위워크/온라인 등) — 첫 번째 깊이
const SITE_PRESETS = [
  '퍼플',
  '그린',
  '수원',
  '위워크',
  '온라인',
];

// 회의실 프리셋 (사이트별 흔한 룸) — 두 번째 깊이
const ROOM_PRESETS_BY_SITE: Record<string, string[]> = {
  퍼플: ['VIP룸', '미팅룸 1번', '미팅룸 2번', '미팅룸 3번'],
  그린: ['회의실 A', '회의실 B', '회의실 C'],
  수원: ['회의실 A', '회의실 B', '대회의실'],
  위워크: ['4E 회의실', '5F 회의실'],
  온라인: ['Google Meet', 'Zoom'],
};

interface InterviewForm {
  candidate: string;
  team: string;        // 팀명 (예: 인사팀)
  job: string;         // 직무 (옵션, 비어있으면 team만)
  site: string;        // 근무지 (퍼플/그린/수원/위워크/온라인)
  customSite: string;
  room: string;        // 회의실 (미팅룸 1번 등)
  customRoom: string;
  date: string;
  startTime: string;
  endTime: string;
  interviewers: string;
  notes: string;
  addMeet: boolean;
}

function nextHalfHour(): { date: string; start: string; end: string } {
  const d = new Date();
  d.setSeconds(0, 0);
  // 다음 30분 단위로 올림
  const m = d.getMinutes();
  d.setMinutes(m < 30 ? 30 : 60);
  if (d.getMinutes() === 0) d.setHours(d.getHours() + 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const sh = String(d.getHours()).padStart(2, '0');
  const sm = String(d.getMinutes()).padStart(2, '0');
  d.setHours(d.getHours() + 1);
  const eh = String(d.getHours()).padStart(2, '0');
  const em = String(d.getMinutes()).padStart(2, '0');
  return { date: `${yy}-${mm}-${dd}`, start: `${sh}:${sm}`, end: `${eh}:${em}` };
}

interface InterviewEvent {
  id: string;
  dt: string;
  tm: string;
  endTm: string;
  title: string;
  candidate: string;
  job: string;
  source: 'sheet' | 'calendar';
  htmlLink?: string | null;
  location: string;
  attendees: string[];
  done: boolean;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function diffDays(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((da - db) / 86400000);
}

// 새 포맷: "이형도 / 퍼플 / 인사팀 / 10:00 / 미팅룸 1번"
//   parts: [candidate, site, team, time, room]
// 옛 포맷: "10:00 / 퍼플 / 이형도 / 인사팀"
//   parts: [time, site, candidate, job]
// 둘 다 자동 인식.
function extractCandidate(title: string): { candidate: string; job: string } {
  const t = (title || '').trim();
  if (!t) return { candidate: '', job: '' };

  // 슬래시 구분이면 토큰화 후 패턴 매칭
  if (t.includes('/')) {
    const parts = t.split('/').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      // 시간 토큰 위치 찾기 (HH:MM)
      const timeIdx = parts.findIndex((p) => /^\d{1,2}:\d{2}$/.test(p));
      // 한글 이름 토큰 (2-4자) — 시간이 아닌 것 중 첫 번째
      const nameIdx = parts.findIndex((p, i) => i !== timeIdx && /^[가-힣]{2,4}$/.test(p));
      if (nameIdx >= 0) {
        const candidate = parts[nameIdx];
        // 나머지 토큰 중 의미있는 것 (사이트/팀/회의실) → job 필드에 합쳐 표시
        const rest = parts.filter((_, i) => i !== nameIdx && i !== timeIdx);
        return { candidate, job: rest.join(' / ') };
      }
    }
  }

  // 기존 패턴들 (백업)
  let m = t.match(/^(.+?)\s*-\s*([가-힣]{2,4}|[A-Za-z]+\s?[A-Za-z]+)\s*(?:\((.+)\))?\s*$/);
  if (m) {
    const before = m[1].trim();
    const name = m[2].trim();
    const inside = (m[3] || '').trim();
    return { candidate: name, job: inside || before };
  }
  m = t.match(/^([가-힣]{2,4})\s*\((.+?)\)\s*면접/);
  if (m) return { candidate: m[1], job: m[2] };
  m = t.match(/^([가-힣]{2,4})\s+(.*면접.*)$/);
  if (m) return { candidate: m[1], job: m[2].replace(/면접/g, '').trim() };
  const tokens = t.split(/[\s/·,()\[\]]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^[가-힣]{2,4}$/.test(tokens[i])) {
      return { candidate: tokens[i], job: tokens.filter((_, idx) => idx !== i).join(' ').trim() };
    }
  }
  return { candidate: t, job: '' };
}

function isInterviewKind(summary: string, colorId: string | null): boolean {
  // 입사(colorId 5)·퇴사 명시적으로 제외
  if (colorId === '5') return false;
  if (/입사|퇴사|퇴직/.test(summary)) return false;
  if (colorId === '11') return true; // tomato — 면접 컨벤션
  if (/면접|interview/i.test(summary)) return true;
  // 시간 표기가 "HH:MM /" 형태 (면접용 캘린더 컨벤션)
  if (/\d{1,2}:\d{2}\s*\//.test(summary)) return true;
  return false;
}

export function CalendarPage() {
  const D = useData();
  const live = useLiveData();
  const today = getTodayStr();
  const [query, setQuery] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, forceTick] = useState(0);
  const [creating, setCreating] = useState(false);

  // 매초 "마지막 동기화 X초 전" 표시 갱신
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await refreshCalendarFromGoogle();
    setRefreshing(false);
  };

  const fetchedAt = live.calendarFetchedAt ? new Date(live.calendarFetchedAt) : null;
  const fetchedAgoSec = fetchedAt ? Math.round((Date.now() - fetchedAt.getTime()) / 1000) : null;
  const fetchedAgoLabel =
    fetchedAgoSec == null
      ? '동기화 대기'
      : fetchedAgoSec < 5
      ? '방금'
      : fetchedAgoSec < 60
      ? `${fetchedAgoSec}초 전`
      : `${Math.floor(fetchedAgoSec / 60)}분 전`;

  const allEvents = useMemo<InterviewEvent[]>(() => {
    const fromSheet: InterviewEvent[] = D.calIntv.map((e, i) => {
      const { candidate, job } = extractCandidate(e.title);
      return {
        id: `sheet-${i}-${e.dt}-${e.tm}`,
        dt: e.dt,
        tm: e.tm,
        endTm: '',
        title: e.title,
        candidate,
        job,
        source: 'sheet',
        location: '',
        attendees: [],
        done: !!e.done,
      };
    });
    const fromCalendar: InterviewEvent[] = liveCalendarEventsNormalized()
      .filter((e) => isInterviewKind(e.title, e.raw.colorId))
      .map((e) => {
        const { candidate, job } = extractCandidate(e.title);
        return {
          id: e.id,
          dt: e.dt,
          tm: e.tm,
          endTm: '',
          title: e.title,
          candidate,
          job,
          source: 'calendar' as const,
          htmlLink: e.htmlLink,
          location: e.location,
          attendees: e.attendees,
          done: false,
        };
      });
    const merged = [...fromSheet, ...fromCalendar];
    const seen = new Set<string>();
    const dedup: InterviewEvent[] = [];
    for (const e of merged) {
      const key = `${e.dt}|${e.tm}|${(e.candidate || e.title).trim().slice(0, 12)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(e);
    }
    return dedup;
  }, [D.calIntv, live.calendarEvents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEvents
      .filter((e) => showPast || e.dt >= today)
      .filter((e) => {
        if (!q) return true;
        const hay = `${e.candidate} ${e.job} ${e.title} ${e.location}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) =>
        (a.dt + (a.tm === '종일' ? '00:00' : a.tm)).localeCompare(b.dt + (b.tm === '종일' ? '00:00' : b.tm))
      );
  }, [allEvents, query, showPast, today]);

  const grouped = useMemo(() => {
    const map = new Map<string, InterviewEvent[]>();
    for (const e of filtered) {
      if (!map.has(e.dt)) map.set(e.dt, []);
      map.get(e.dt)!.push(e);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const counts = useMemo(() => {
    const upcoming = allEvents.filter((e) => e.dt >= today);
    const todayCount = upcoming.filter((e) => e.dt === today && !e.done).length;
    const thisWeek = (() => {
      const t = new Date(today + 'T00:00:00');
      const dow = t.getDay(); // 0=Sun
      const monday = new Date(t);
      monday.setDate(t.getDate() - ((dow + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const isoMon = isoDate(monday);
      const isoSun = isoDate(sunday);
      return upcoming.filter((e) => e.dt >= isoMon && e.dt <= isoSun).length;
    })();
    return { todayCount, thisWeek, total: upcoming.length };
  }, [allEvents, today]);

  return (
    <div className="space-y-3">
      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="오늘 면접" count={counts.todayCount} tone="indigo" emphasis />
        <SummaryCard label="이번 주 면접" count={counts.thisWeek} tone="blue" />
        <SummaryCard label="다가오는 면접" count={counts.total} tone="slate" />
      </div>

      {/* 필터 + 동기화 상태 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-full text-xs font-bold border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 shadow-sm flex items-center gap-1"
          >
            <span>+</span>
            새 면접 일정
          </button>
          <Pill active={showPast} onClick={() => setShowPast((v) => !v)}>
            지난 면접 포함
          </Pill>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
            title="구글 캘린더에서 즉시 다시 가져오기"
          >
            <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
            {refreshing ? '동기화 중...' : '즉시 동기화'}
          </button>
          <span className="text-[11px] text-slate-500" title={fetchedAt?.toLocaleString() || ''}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse" />
            마지막 동기화 {fetchedAgoLabel} · 60초마다 자동 · 👥 TA팀 공유
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="후보자/직무/장소 검색..."
            className="ml-auto px-3 py-1.5 rounded-full text-sm bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none w-56 text-slate-700"
          />
          <span className="text-xs text-slate-700 font-semibold">{filtered.length}건</span>
        </div>
      </div>

      {/* 일정 리스트 */}
      {grouped.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-2 opacity-40">📭</div>
          <div className="text-sm text-slate-400">표시할 면접 일정이 없습니다.</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
          {grouped.map(([dt, events]) => (
            <DayBlock key={dt} dt={dt} events={events} today={today} />
          ))}
        </div>
      )}

      {creating && (
        <InterviewCreateModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refreshCalendarFromGoogle();
          }}
        />
      )}
    </div>
  );
}

function InterviewCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const init = nextHalfHour();
  const [form, setForm] = useState<InterviewForm>({
    candidate: '',
    team: '',
    job: '',
    site: SITE_PRESETS[0],
    customSite: '',
    room: ROOM_PRESETS_BY_SITE[SITE_PRESETS[0]][0],
    customRoom: '',
    date: init.date,
    startTime: init.start,
    endTime: init.end,
    interviewers: '',
    notes: '',
    addMeet: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const update = <K extends keyof InterviewForm>(k: K, v: InterviewForm[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // 사이트가 바뀌면 회의실 첫 번째로 자동
      if (k === 'site') {
        const rooms = ROOM_PRESETS_BY_SITE[v as string] || [];
        if (rooms.length > 0) next.room = rooms[0];
        else next.room = '직접 입력';
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    setErr(null);
    if (!form.candidate.trim()) return setErr('후보자명을 입력하세요.');
    if (!form.date) return setErr('일자를 선택하세요.');
    if (!form.startTime || !form.endTime) return setErr('시작/종료 시간을 입력하세요.');

    const finalSite = form.site === '직접 입력' ? form.customSite.trim() : form.site;
    const finalRoom = form.room === '직접 입력' ? form.customRoom.trim() : form.room;
    const isOnline = /온라인|meet|zoom/i.test(finalSite) || /meet|zoom/i.test(finalRoom);

    // 새 포맷: "이형도 / 퍼플 / 인사팀 / 10:00 / 미팅룸 1번"
    const teamOrJob = form.job.trim() || form.team.trim();
    const parts = [
      form.candidate.trim(),
      finalSite,
      teamOrJob,
      form.startTime,
      finalRoom,
    ].filter(Boolean);
    const summary = parts.join(' / ');

    const fullLocation = [finalSite, finalRoom].filter(Boolean).join(' ');
    const startISO = `${form.date}T${form.startTime}:00`;
    const endISO = `${form.date}T${form.endTime}:00`;
    const attendees = form.interviewers
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
      .map((email) => ({ email }));

    const body: Parameters<typeof api.google.insertCalEvent>[1] = {
      summary,
      description:
        `후보자: ${form.candidate.trim()}` +
        (form.team ? `\n팀: ${form.team.trim()}` : '') +
        (form.job ? `\n직무: ${form.job.trim()}` : '') +
        (fullLocation ? `\n장소: ${fullLocation}` : '') +
        (form.notes ? `\n\n${form.notes.trim()}` : ''),
      location: fullLocation,
      start: { dateTime: startISO, timeZone: 'Asia/Seoul' },
      end: { dateTime: endISO, timeZone: 'Asia/Seoul' },
      attendees,
    };
    // colorId 11 (tomato) for 면접 — extend body via cast
    (body as Record<string, unknown>).colorId = '11';
    if (form.addMeet || isOnline) {
      (body as Record<string, unknown>).conferenceData = {
        createRequest: { requestId: `meet-${Date.now()}` },
      };
    }

    setSubmitting(true);
    try {
      // 팀 공유 면접 캘린더에 등록 — 모든 TA팀원의 앱에서 동일하게 보임
      const r = await api.google.insertCalEvent(SHARED_CAL.interview, body);
      if (!r.ok) {
        setErr(r.error || '캘린더 등록 실패');
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">+ 새 면접 일정</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">👥 TA팀 공유 면접 캘린더에 등록됩니다 · 모든 팀원에게 즉시 보임</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2 text-[11px] text-indigo-800 leading-relaxed">
            📋 등록 형식: <b>이름 / 근무지 / 팀 / 시간 / 회의실</b><br />
            예: <span className="font-mono">이형도 / 퍼플 / 인사팀 / 10:00 / 미팅룸 1번</span>
          </div>
          <Field label="① 후보자명 *">
            <input
              type="text"
              value={form.candidate}
              onChange={(e) => update('candidate', e.target.value)}
              placeholder="예: 이형도"
              className="input w-full"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="② 근무지 *">
              <select
                value={form.site}
                onChange={(e) => update('site', e.target.value)}
                className="input w-full"
              >
                {SITE_PRESETS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="직접 입력">직접 입력</option>
              </select>
              {form.site === '직접 입력' && (
                <input
                  type="text"
                  value={form.customSite}
                  onChange={(e) => update('customSite', e.target.value)}
                  placeholder="근무지 직접 입력"
                  className="input w-full mt-1.5"
                />
              )}
            </Field>
            <Field label="③ 팀 / 직무 *">
              <input
                type="text"
                value={form.team}
                onChange={(e) => update('team', e.target.value)}
                placeholder="예: 인사팀"
                className="input w-full"
              />
            </Field>
          </div>
          <Field label="직무 상세 (옵션 — 비우면 팀명만 표시)">
            <input
              type="text"
              value={form.job}
              onChange={(e) => update('job', e.target.value)}
              placeholder="예: 채용 매니저 / 1차"
              className="input w-full"
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="일자 *">
              <input
                type="date"
                value={form.date}
                onChange={(e) => update('date', e.target.value)}
                className="input w-full"
              />
            </Field>
            <Field label="④ 시작 *">
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => update('startTime', e.target.value)}
                className="input w-full"
              />
            </Field>
            <Field label="종료 *">
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => update('endTime', e.target.value)}
                className="input w-full"
              />
            </Field>
          </div>
          <Field label="⑤ 회의실">
            <select
              value={form.room}
              onChange={(e) => update('room', e.target.value)}
              className="input w-full"
            >
              {(ROOM_PRESETS_BY_SITE[form.site] || []).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="직접 입력">직접 입력</option>
            </select>
            {form.room === '직접 입력' && (
              <input
                type="text"
                value={form.customRoom}
                onChange={(e) => update('customRoom', e.target.value)}
                placeholder="회의실 직접 입력"
                className="input w-full mt-1.5"
              />
            )}
          </Field>
          <Field label="면접관 이메일 (쉼표/줄바꿈 구분)">
            <textarea
              value={form.interviewers}
              onChange={(e) => update('interviewers', e.target.value)}
              placeholder="shim@cnccosmetic.com, jhlee3@cnccosmetic.com"
              rows={2}
              className="input w-full font-mono text-xs"
            />
          </Field>
          <Field label="비고 (description)">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="추가 메모"
              rows={2}
              className="input w-full"
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.addMeet}
              onChange={(e) => update('addMeet', e.target.checked)}
              className="rounded"
            />
            Google Meet 링크 자동 생성
          </label>
          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
              ⚠ {err}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn">
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.candidate.trim()}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {submitting ? '등록 중...' : '캘린더에 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function DayBlock({ dt, events, today }: { dt: string; events: InterviewEvent[]; today: string }) {
  const d = new Date(dt + 'T00:00:00');
  const dow = DOW[d.getDay()];
  const dowTone =
    d.getDay() === 0 ? 'text-rose-600' : d.getDay() === 6 ? 'text-blue-600' : 'text-slate-500';
  const isToday = dt === today;
  const isPast = dt < today;
  const dDelta = diffDays(dt, today);
  const dayLabel =
    dDelta === 0
      ? '오늘'
      : dDelta === 1
      ? '내일'
      : dDelta === -1
      ? '어제'
      : dDelta > 0
      ? `D-${dDelta}`
      : `D+${-dDelta}`;

  return (
    <div className={`card overflow-hidden ${isPast ? 'opacity-60' : ''} ${isToday ? 'ring-2 ring-indigo-400' : ''}`}>
      <div
        className={`px-4 py-2 flex items-center gap-3 border-b ${
          isToday ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-2xl font-black tabular-nums tracking-tight ${
              isToday ? 'text-indigo-700' : 'text-slate-800'
            }`}
          >
            {d.getMonth() + 1}.{d.getDate()}
          </span>
          <span className={`text-sm font-bold ${dowTone}`}>({dow})</span>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            isToday
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-200 text-slate-700'
          }`}
        >
          {dayLabel}
        </span>
        <span className="ml-auto text-xs text-slate-600 font-semibold">{events.length}건</span>
      </div>
      <div className="divide-y divide-slate-100">
        {events.map((e) => (
          <InterviewRow key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

function InterviewRow({ event }: { event: InterviewEvent }) {
  const noAttendees = event.source === 'calendar' && event.attendees.length === 0;
  const inner = (
    <div
      className={`px-4 py-2.5 flex items-center gap-4 hover:bg-slate-50/70 transition-colors ${
        event.done ? 'opacity-50' : ''
      }`}
    >
      {/* 시간 — 큰 글씨 */}
      <div className="w-16 shrink-0 text-center">
        <div
          className={`font-mono font-extrabold tabular-nums ${
            event.tm === '종일' ? 'text-sm text-slate-500' : 'text-lg text-blue-700'
          }`}
        >
          {event.tm}
        </div>
      </div>

      {/* 가운데: 후보자 / 직무 / 제목 */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-bold text-slate-900 truncate ${event.done ? 'line-through' : ''}`}>
          {event.candidate || event.title}
          {event.job && (
            <span className="ml-2 font-normal text-[12px] text-slate-500">{event.job}</span>
          )}
        </div>
        {(event.location || event.attendees.length > 0) && (
          <div className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-3 flex-wrap">
            {event.location && <span>📍 {event.location}</span>}
            {event.attendees.length > 0 && <span>👥 {event.attendees.length}</span>}
          </div>
        )}
      </div>

      {/* 우측: 출처 / 경고 */}
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-[10px]">
        {event.source === 'calendar' ? (
          <span className="text-slate-400">📅 캘린더</span>
        ) : (
          <span className="text-slate-400">📋 시트</span>
        )}
        {noAttendees && (
          <span className="chip bg-amber-100 text-amber-800 text-[10px] font-bold">⚠ 면접관 ✗</span>
        )}
        {event.done && <span className="text-emerald-600 font-bold">✓ 완료</span>}
      </div>
    </div>
  );

  if (event.htmlLink) {
    return (
      <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

function SummaryCard({
  label,
  count,
  tone,
  emphasis,
}: {
  label: string;
  count: number;
  tone: 'indigo' | 'blue' | 'slate';
  emphasis?: boolean;
}) {
  const palette = {
    indigo: { bg: 'bg-indigo-50', num: 'text-indigo-700', bar: 'bg-indigo-500' },
    blue: { bg: 'bg-blue-50', num: 'text-blue-700', bar: 'bg-blue-500' },
    slate: { bg: 'bg-slate-50', num: 'text-slate-700', bar: 'bg-slate-400' },
  }[tone];
  return (
    <div
      className={`card p-3 relative overflow-hidden ${palette.bg} ${
        emphasis && count > 0 ? 'ring-2 ring-indigo-400' : ''
      }`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${palette.bar}`} />
      <div className="flex items-baseline justify-between ml-1.5">
        <span className={`text-[11px] uppercase tracking-[0.18em] font-bold ${palette.num}`}>
          {label}
        </span>
        <div className="flex items-baseline gap-0.5">
          <span className={`text-3xl font-black tabular-nums ${palette.num}`}>{count}</span>
          <span className="text-[10px] text-slate-500">건</span>
        </div>
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
