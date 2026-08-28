// 캠퍼스 리쿠르팅 — 캘린더에 잡혀 있는 캠리/채용설명회 일정을 자동으로 모아 보여준다.
//
// 소스는 캘린더뿐이다. 캘린더에 "캠퍼스리쿠르팅(경희대학교)" 처럼 등록해두면
// 학교별로 자동 분류돼서 이 페이지에 뜬다 — 따로 입력할 것 없음.
// 일자리센터/채용박람회는 별도 페이지가 있으므로 여기서는 제외한다.

import { useMemo, useState } from 'react';
import { useLiveData, liveCalendarEventsNormalized } from '../store/liveData';
import { getTodayStr } from '../store';

// 캠리로 인정하는 제목/장소/설명 키워드
const CAMPUS_RE = /캠퍼스\s*리[쿠크]르?팅|캠퍼스\s*리크루팅|campus\s*recruit(ing)?|캠리|채용\s*설명회|캠퍼스\s*채용|학교\s*설명회/i;
// 일자리센터/박람회는 '일자리센터' 페이지 소관 — 중복 표시 방지
const EXCLUDE_RE = /일자리센터|일자리\s*플러스|박람회/i;
// 준비 업무(캠리 디자인 / 배너 2개 준비 / 타임라인 제작 …)는 학교 방문 일정이 아니다.
// 제목에 '캠리'가 들어갔다는 이유만으로 학교 카드가 뜨던 문제 차단. (2026-08)
const TASK_RE = /(디자인|제작|준비|인쇄|발주|시안|초안|샘플|굿즈|기념품|정리|업데이트|발송|확인|검토|점검|기안|품의|계획|보고|회의|미팅|리뷰|촬영|섭외|신청|접수|마감|제출|백월|배너|팜플렛|소책자|현수막)/;

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

interface CampusEvent {
  id: string;
  dt: string;
  tm: string;
  title: string;
  school: string;
  location: string;
  description: string;
  attendees: string[];
  htmlLink: string | null;
  isVehicle: boolean;
}

interface CampusGroup {
  key: string;
  school: string;
  dt: string;
  events: CampusEvent[];
  timeLabel: string;
  places: string[];
  vehicles: string[];
  attendees: string[];
}

/**
 * 제목/설명에서 학교명 추출 — "캠퍼스리쿠르팅(경희대학교)" → 경희대학교.
 * 못 뽑으면 빈 문자열. ('학교 미기재' 같은 가짜 버킷을 만들지 않는다 — 이벤트 제목을 그대로 쓴다)
 */
function pickSchool(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ');
  const full = t.match(/([가-힣A-Za-z]{2,12}(?:대학교|여자대학교|대학))/);
  if (full) return full[1];
  const short = t.match(/([가-힣]{2,6})대(?![학가-힣])/);
  if (short) return `${short[1]}대`;
  return '';
}

function diffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  return Math.round((da - db) / 86400000);
}

function dowLabel(dt: string): string {
  const d = new Date(`${dt}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getDay()];
}

export function CampusRecruiting() {
  const live = useLiveData();
  const today = getTodayStr();
  const [showPast, setShowPast] = useState(false);
  const [schoolFilter, setSchoolFilter] = useState('전체');
  const [query, setQuery] = useState('');

  const allEvents = useMemo<CampusEvent[]>(() => {
    const out: CampusEvent[] = [];
    for (const e of liveCalendarEventsNormalized()) {
      const haystack = `${e.title} ${e.location} ${e.raw.description || ''}`;
      if (!CAMPUS_RE.test(haystack)) continue;
      if (EXCLUDE_RE.test(haystack)) continue;
      if (TASK_RE.test(e.title)) continue; // 준비/제작 업무는 학교 일정이 아님
      // 학교명이 실제로 잡히는 일정만 남긴다 — 대학교 이름이 없으면 캠리 일정이 아님
      const school = pickSchool(`${e.title} ${e.raw.description || ''}`);
      if (!school) continue;
      out.push({
        id: e.id,
        dt: e.dt,
        tm: e.tm,
        title: e.title,
        school,
        location: e.location || '',
        description: (e.raw.description || '').replace(/<[^>]+>/g, ' ').slice(0, 300),
        attendees: e.attendees,
        htmlLink: e.htmlLink,
        isVehicle: /차량|레이|모닝|카니발|스타리아|스타렉스|쏘렌토/.test(`${e.title} ${e.location}`),
      });
    }
    return out;
  }, [live.calendarEvents]);

  // 같은 학교 + 같은 날짜는 한 카드로 묶는다 (종일 일정 + 차량 예약이 따로 잡혀 있는 경우가 많음)
  const groups = useMemo<CampusGroup[]>(() => {
    const map = new Map<string, CampusGroup>();
    for (const e of allEvents) {
      const key = `${e.school}|${e.dt}`;
      let g = map.get(key);
      if (!g) {
        g = { key, school: e.school, dt: e.dt, events: [], timeLabel: '', places: [], vehicles: [], attendees: [] };
        map.set(key, g);
      }
      g.events.push(e);
    }
    for (const g of map.values()) {
      g.events.sort((a, b) => (a.tm === '종일' ? '00:00' : a.tm).localeCompare(b.tm === '종일' ? '00:00' : b.tm));
      const timed = g.events.filter((e) => e.tm !== '종일' && !e.isVehicle);
      const anyTimed = timed.length > 0 ? timed : g.events.filter((e) => e.tm !== '종일');
      g.timeLabel = anyTimed.length > 0 ? anyTimed.map((e) => e.tm).join(', ') : '종일';
      g.places = [...new Set(g.events.filter((e) => e.location && !e.isVehicle).map((e) => e.location))];
      g.vehicles = [...new Set(g.events.filter((e) => e.isVehicle).map((e) => e.location || e.title))];
      g.attendees = [...new Set(g.events.flatMap((e) => e.attendees))];
    }
    return [...map.values()].sort((a, b) => a.dt.localeCompare(b.dt));
  }, [allEvents]);

  const schools = useMemo(() => [...new Set(groups.map((g) => g.school))].sort(), [groups]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => showPast || g.dt >= today)
      .filter((g) => schoolFilter === '전체' || g.school === schoolFilter)
      .filter((g) => {
        if (!q) return true;
        const hay = `${g.school} ${g.events.map((e) => `${e.title} ${e.location} ${e.description}`).join(' ')}`.toLowerCase();
        return hay.includes(q);
      });
  }, [groups, showPast, schoolFilter, today, query]);

  // 타임라인은 월 단위로 끊어서 보여준다
  const monthBlocks = useMemo(() => {
    const map = new Map<string, CampusGroup[]>();
    for (const g of visible) {
      const m = g.dt.slice(0, 7);
      const arr = map.get(m);
      if (arr) arr.push(g);
      else map.set(m, [g]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, items]) => ({
        month,
        label: `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`,
        items,
      }));
  }, [visible]);

  const upcomingCount = groups.filter((g) => g.dt >= today).length;
  const nextGroup = groups.find((g) => g.dt >= today) || null;

  return (
    <div className="space-y-3 text-slate-900">
      {/* 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="card p-3">
          <div className="text-xs font-bold text-slate-900">예정된 캠리</div>
          <div className="text-3xl font-black tabular-nums text-slate-900">{upcomingCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs font-bold text-slate-900">참여 학교</div>
          <div className="text-3xl font-black tabular-nums text-slate-900">
            {new Set(groups.filter((g) => g.dt >= today).map((g) => g.school)).size}
          </div>
        </div>
        <div className="card p-3 col-span-2 md:col-span-1">
          <div className="text-xs font-bold text-slate-900">다음 일정</div>
          {nextGroup ? (
            <div className="text-sm font-bold text-slate-900 mt-1">
              {nextGroup.school} · {nextGroup.dt.slice(5).replace('-', '/')}({dowLabel(nextGroup.dt)}){' '}
              <span className="text-slate-900">
                D{diffDays(nextGroup.dt, today) === 0 ? '-Day' : `-${diffDays(nextGroup.dt, today)}`}
              </span>
            </div>
          ) : (
            <div className="text-sm text-slate-900 mt-1">예정 없음</div>
          )}
        </div>
      </div>

      {/* 필터 */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={schoolFilter === '전체'} onClick={() => setSchoolFilter('전체')}>
            전체 ({upcomingCount})
          </Pill>
          {schools.map((s) => (
            <Pill key={s} active={schoolFilter === s} onClick={() => setSchoolFilter(s)}>
              {s}
            </Pill>
          ))}
          <label className="flex items-center gap-1 text-sm font-semibold text-slate-900 ml-auto">
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
            지난 일정 포함
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="학교·장소 검색"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 w-48"
          />
        </div>
      </div>

      {/* 타임라인 */}
      <div className="card p-4">
        <div className="max-h-[640px] overflow-y-auto pr-1">
          {visible.length === 0 && (
            <div className="text-center py-10 text-sm text-slate-900">
              {groups.length === 0
                ? '캘린더에서 캠퍼스 리쿠르팅 일정을 찾지 못했습니다. 제목에 "캠퍼스리쿠르팅" 또는 "채용설명회"가 들어가면 자동으로 잡힙니다.'
                : '조건에 맞는 일정이 없습니다.'}
            </div>
          )}

          {monthBlocks.map((block) => (
            <div key={block.month} className="mb-5 last:mb-0">
              {/* 월 헤더 */}
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-lg font-black text-slate-900">{block.label}</span>
                <span className="text-sm font-bold text-slate-900">{block.items.length}건</span>
              </div>

              {/* 세로 레일 + 노드 */}
              <div className="relative pl-[86px]">
                <div className="absolute left-[68px] top-1 bottom-1 w-px bg-slate-300" />

                {block.items.map((g) => {
                  const dd = diffDays(g.dt, today);
                  const past = dd < 0;
                  const isNext = nextGroup?.key === g.key;
                  return (
                    <div key={g.key} className="relative mb-3 last:mb-0">
                      {/* 날짜 라벨 (레일 왼쪽) */}
                      <div className="absolute -left-[86px] top-2 w-[56px] text-right">
                        <div className={`text-lg font-black leading-none ${past ? 'text-slate-500' : 'text-slate-900'}`}>
                          {Number(g.dt.slice(8, 10))}
                        </div>
                        <div className={`text-[11px] font-bold ${past ? 'text-slate-500' : 'text-slate-900'}`}>
                          {dowLabel(g.dt)}요일
                        </div>
                      </div>

                      {/* 노드 점 */}
                      <span
                        className={`absolute -left-[24px] top-3 w-3 h-3 rounded-full border-2 border-white ring-2 ${
                          past ? 'bg-slate-300 ring-slate-300' : isNext ? 'bg-indigo-600 ring-indigo-300' : 'bg-slate-900 ring-slate-400'
                        }`}
                      />

                      {/* 카드 */}
                      <div
                        className={`rounded-xl border p-3 ${
                          past
                            ? 'border-slate-200 bg-slate-50'
                            : isNext
                              ? 'border-indigo-300 bg-indigo-50/60 shadow-sm'
                              : 'border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-black text-slate-900">{g.school}</span>
                          <span className="text-sm font-bold text-slate-900">{g.timeLabel}</span>
                          {!past && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-black bg-indigo-600 text-white">
                              {dd === 0 ? 'D-DAY' : `D-${dd}`}
                            </span>
                          )}
                          {past && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-900">완료</span>
                          )}
                          {g.vehicles.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">
                              🚗 {g.vehicles.join(', ')}
                            </span>
                          )}
                        </div>

                        {(g.places.length > 0 || g.attendees.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-900">
                            {g.places.length > 0 && <span>📍 {g.places.join(' / ')}</span>}
                            {g.attendees.length > 0 && (
                              <span>👥 {g.attendees.map((a) => a.split('@')[0]).join(', ')}</span>
                            )}
                          </div>
                        )}

                        <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                          {g.events.map((e) => (
                            <div key={e.id} className="flex items-center gap-2 text-sm text-slate-900">
                              <span className="font-mono text-xs w-11 shrink-0 font-bold">{e.tm}</span>
                              <span className="truncate">{e.title}</span>
                              {e.htmlLink && (
                                <a
                                  href={e.htmlLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ml-auto text-xs font-bold text-indigo-700 hover:underline shrink-0"
                                >
                                  캘린더 ↗
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${
        active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-900 border-slate-300 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
