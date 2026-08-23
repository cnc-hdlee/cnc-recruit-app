import { useEffect } from 'react';
import { useLiveData, liveByKindOrScan, refreshCalendarFromGoogle } from '../store/liveData';
import { getTodayStr } from '../store';
import {
  parseHireRows,
  buildHireDateSummary,
  buildHireDateDescription,
  addDaysIso,
  HIRE_AUTO_MARKER,
  ONBOARDING_CAL_SHARED_EMAILS,
  type HireRow,
} from '../pages/IncomingHires';
import { api } from './api';
import { IS_VIEWER } from './mode';
import { SHARED_CAL } from './sharedCalendars';

// 입사예정자 → 입사 캘린더 자동 등록/취소 (App 레벨 — 어느 페이지에 있든, 입사예정자 페이지를 안 열어도 실행).
// 메모리 룰:
//   [입사예정자 자동 등록+취소 캘린더 동기화] 결재완료 자동 노란색 등록, 시트에서 사라지면 자동 삭제. 수동 부탁 금지.
//   [입사 캘린더는 결재 완료만] 비고가 "전자결재-C&C GW" 링크(approved)일 때만. 결재중/상신예정 제외.
//   [입사 이벤트는 노란색 + 소속·이름] colorId=5, summary에 소속/이름.
//   [입사예정자는 입사예정(정규직)DB 한 시트만] 출처 단일화 (liveByKindOrScan('incoming')).
//   [무조건 자동 동기화] 사용자 버튼 클릭/페이지 오픈 없이 polling으로 보장.
// 권한 우회: shim@ owner 메인 입사 캘린더엔 hdlee write 권한 없음 → hdlee 본인 owner "입사 (자동)" 캘린더 1회 생성.

const POLL_MS = 120_000; // 2분 polling — live 변경 트리거와 별개의 안전망

// 모듈 레벨 락/캐시 — StrictMode 2회 실행 + interval 중첩에도 캘린더 중복 생성/동시 등록 방지.
let cachedCalId: string | null = null;
let bootstrapLock: Promise<string | null> | null = null;
let syncLock: Promise<void> | null = null;
let aclEnsured = false;

// 입사 자동 캘린더 확보 — 메모리 [입사예정자 자동 등록+취소]: c_1ff0...(hdlee owner "입사")가 유일 master.
// cfg에 id가 있으면 그걸 쓰고, 없으면 알려진 canonical 캘린더(SHARED_CAL.onboardingAuto)로 자가 복구.
// ⚠️ 새 캘린더를 만들지 않는다 — 과거 cfg 유실 시 "입사 (자동)"을 새로 만들어 파편화시켰던 버그 제거.
//    (2026-06-04: cfg.hireAutoCalendarId가 undefined가 되어 5/21 이후 자동 등록이 멈춰 김승화(6/4) 누락.)
async function ensureHireCalendar(): Promise<string | null> {
  if (cachedCalId) return cachedCalId;
  if (bootstrapLock) return bootstrapLock;
  const p = (async (): Promise<string | null> => {
    try {
      const r = await api.cfg.get<string>('hireAutoCalendarId');
      if (r.ok && typeof r.data === 'string' && r.data) {
        cachedCalId = r.data;
      } else {
        // cfg 유실/초기 상태 → 알려진 master로 복구 + cfg에 영구 저장.
        cachedCalId = SHARED_CAL.onboardingAuto;
        await api.cfg.set('hireAutoCalendarId', cachedCalId);
        // eslint-disable-next-line no-console
        console.info('[hire-cal-sync] hireAutoCalendarId 복구 → canonical 입사 캘린더:', cachedCalId);
      }
      return cachedCalId;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[hire-cal-sync] 캘린더 부트스트랩 실패:', e);
      return null;
    } finally {
      bootstrapLock = null;
    }
  })();
  bootstrapLock = p;
  return p;
}

// ACL 보장 — 본인 + ga@/yshwang@ reader 누락 시 자동 보강 (1회).
async function ensureAcl(calId: string): Promise<void> {
  if (aclEnsured) return;
  try {
    const r = await api.google.listCalAcl(calId);
    if (!r.ok || !r.data) return;
    const existing = new Set(r.data.map((rule) => (rule.scope?.value || '').toLowerCase()));
    for (const target of ONBOARDING_CAL_SHARED_EMAILS) {
      if (existing.has(target.email.toLowerCase())) continue;
      try {
        await api.google.insertCalAcl(calId, target.email, target.role, 'user');
        // eslint-disable-next-line no-console
        console.info('[hire-cal-sync] 입사 캘린더 공유 추가:', target.email, target.role);
      } catch { /* ignore */ }
    }
    aclEnsured = true;
  } catch { /* ignore — 다음 polling 재시도 */ }
}

async function getDismissed(): Promise<Set<string>> {
  try {
    const r = await api.cfg.get<string[]>('dismissedHireKeys');
    if (r.ok && Array.isArray(r.data)) return new Set(r.data);
  } catch { /* ignore */ }
  return new Set();
}

// 등록 + 취소 1회전. 동시 실행 방지 위해 syncLock으로 직렬화. 모든 동작은 멱등(idempotent).
async function runHireCalendarSync(): Promise<void> {
  if (syncLock) return;
  const p = (async () => {
    try {
      const rows = parseHireRows(liveByKindOrScan('incoming'));
      if (rows.length === 0) return;

      const hireCalId = await ensureHireCalendar();
      if (!hireCalId) return;
      await ensureAcl(hireCalId);

      const today = getTodayStr();
      const dismissed = await getDismissed();

      // hireCalId 이벤트는 READ_CALENDAR_IDS에 없으니 직접 fetch.
      const calStart = `${today}T00:00:00+09:00`;
      const calEnd = '2027-01-01T00:00:00+09:00';
      const calRes = await api.google.listCalendar(calStart, calEnd, hireCalId);
      const onboardingEvents = (calRes.ok && calRes.data) ? calRes.data : [];

      // 등록 대상: 입사포기(declined)를 뺀 시트의 모든 입사예정자 + 미래 입사 + dismiss 안 됨.
      // 2026-06-04: 결재중(pending)도 등록.
      // 2026-08-23: 비고 빈칸(unknown)도 등록 — 시트엔 있는데 캘린더 인원이 모자란 문제
      //   (8/24 시트 7명인데 캘린더 6명, 김가경 비고 빈칸으로 누락). 사용자 지시: 시트 인원을 정확히 미러링.
      const eligible = rows.filter((r) => {
        if (r.approval === 'declined') return false;
        if (r.date < today) return false;
        if (dismissed.has(`${r.date}|${r.name.trim()}`)) return false;
        return true;
      });

      // 1일 1이벤트 정책 — 날짜별 그룹핑.
      const byDate = new Map<string, HireRow[]>();
      for (const r of eligible) {
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date)!.push(r);
      }

      // 입사 포기자 — 날짜별 그룹핑. 별도 노란색 이벤트는 만들지 않고(입사 안 함),
      // 같은 날짜에 실제 입사자가 있으면 그 이벤트 description에 빨간색 "입사 포기" 기록으로 남긴다.
      const declinedByDate = new Map<string, HireRow[]>();
      for (const r of rows) {
        if (r.approval !== 'declined') continue;
        if (r.date < today) continue;
        if (!declinedByDate.has(r.date)) declinedByDate.set(r.date, []);
        declinedByDate.get(r.date)!.push(r);
      }

      let changed = false;

      // ── 레거시 정리: primary에 남아 있는 옛 자동 입사 이벤트 삭제 ──
      // 예전 버전이 primary에 직접 썼는데, master가 c_1ff0(입사 캘린더)로 옮겨간 뒤로도
      // primary 사본이 갱신 없이 남아 날짜마다 인원이 다른 유령 중복이 됐다.
      //   (2026-08-23 확인: 8/24 "입사 3명" vs 실제 7명, 8/18 "2명" vs 23명 등 9개 날짜 중복)
      // 우리 마커가 붙은 노란색 이벤트만 지운다 — 남이 만든 입사 안내 이벤트는 건드리지 않음.
      // 옛 버전이 쓰던 마커 문구까지 함께 인식해야 실제로 지워진다.
      const AUTO_MARKERS = [HIRE_AUTO_MARKER, '입사예정(정규직)DB 시트 기준', '시트 미확인 (자동 동기화 시점)'];
      try {
        // 과거분까지 정리 — primary 사본은 갱신이 멈춘 유령이라 이력 가치가 없다(원본은 입사 캘린더에 보존).
        const sweepStart = addDaysIso(today, -180) + 'T00:00:00+09:00';
        const primRes = await api.google.listCalendar(sweepStart, calEnd, 'primary');
        const legacy = (primRes.ok && primRes.data ? primRes.data : []).filter(
          (e) => e.colorId === '5' && AUTO_MARKERS.some((m) => (e.description || '').includes(m))
        );
        for (const e of legacy) {
          try {
            await api.google.deleteCalEvent('primary', e.id, 'none');
            changed = true;
            // eslint-disable-next-line no-console
            console.info('[hire-cal-sync] primary 레거시 입사 이벤트 삭제:', (e.start || '').slice(0, 10), e.summary);
          } catch { /* 다음 polling 재시도 */ }
        }
      } catch { /* ignore */ }

      // 우리가 만든(노란색+마커) 이벤트를 날짜별로 그룹핑.
      const ourByDate = new Map<string, typeof onboardingEvents>();
      for (const e of onboardingEvents) {
        if (e.colorId !== '5' || !(e.description || '').includes(HIRE_AUTO_MARKER)) continue;
        const dt = (e.start || '').slice(0, 10);
        if (!dt) continue;
        if (!ourByDate.has(dt)) ourByDate.set(dt, []);
        ourByDate.get(dt)!.push(e);
      }

      // 중복 자동 삭제(self-heal): 같은 날짜에 우리 이벤트가 2개 이상이면 1개만 남기고 삭제.
      // (과거 버그로 같은 날짜가 수십 개까지 쌓였던 문제를 매 polling마다 스스로 정리.)
      for (const [dt, dups] of ourByDate) {
        if (dt < today || dups.length <= 1) continue;
        for (const extra of dups.slice(1)) {
          try {
            await api.google.deleteCalEvent(hireCalId, extra.id, 'none');
            changed = true;
            // eslint-disable-next-line no-console
            console.info('[hire-cal-sync] 중복 입사 이벤트 삭제:', dt);
          } catch { /* 다음 polling 재시도 */ }
        }
        dups.length = 1; // 남긴 1개만 이후 로직에서 사용
      }

      // 등록/갱신
      for (const [date, list] of byDate) {
        try {
          const summary = buildHireDateSummary(list);
          const description = buildHireDateDescription(list, declinedByDate.get(date) || []);
          const existing = (ourByDate.get(date) || [])[0];
          if (existing) {
            // 이름 set + 결재 상태 동일하면 skip, 다르면 update.
            if (
              existing.summary === summary &&
              (existing.description || '').replace(/\s+/g, '') === description.replace(/\s+/g, '')
            ) {
              continue;
            }
            await api.google.updateCalEvent(hireCalId, existing.id, {
              summary,
              description,
              colorId: '5',
              start: { date },
              end: { date: addDaysIso(date, 1) },
            }, 'none');
            changed = true;
            // eslint-disable-next-line no-console
            console.info('[hire-cal-sync] 입사 이벤트 갱신:', date, `${list.length}명`);
          } else {
            const body: Parameters<typeof api.google.insertCalEvent>[1] = {
              summary,
              description,
              start: { date },
              end: { date: addDaysIso(date, 1) },
            };
            (body as Record<string, unknown>).colorId = '5';
            await api.google.insertCalEvent(hireCalId, body, 'none');
            changed = true;
            // eslint-disable-next-line no-console
            console.info('[hire-cal-sync] 입사 이벤트 신규:', date, `${list.length}명`);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[hire-cal-sync] 등록 실패 (다음 polling 재시도):', date, e);
        }
      }

      // 취소: 우리가 만든 마커 이벤트 중, 시트에 더 이상 결재완료 입사자가 없는 날짜는 삭제.
      const validDates = new Set(eligible.map((r) => r.date));
      const ourEvents = onboardingEvents.filter(
        (e) => e.colorId === '5' && (e.description || '').includes(HIRE_AUTO_MARKER)
      );
      for (const e of ourEvents) {
        const dt = (e.start || '').slice(0, 10);
        if (!dt || dt < today) continue; // 과거 입사는 이력 보존
        if (validDates.has(dt)) continue;
        try {
          await api.google.deleteCalEvent(hireCalId, e.id, 'none');
          changed = true;
          // eslint-disable-next-line no-console
          console.info('[hire-cal-sync] 시트에서 사라짐 → 캘린더 삭제:', dt);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[hire-cal-sync] 삭제 실패:', dt, err);
        }
      }

      if (changed) void refreshCalendarFromGoogle();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[hire-cal-sync] 예외:', e);
    } finally {
      syncLock = null;
    }
  })();
  syncLock = p;
  return p;
}

// 수동 트리거 — 입사예정자 페이지의 "입사포기" 섹션 클릭 시 즉시 1회전 강제 실행.
// (자동 polling과 별개. 진행 중이면 그 promise를 그대로 반환 — 멱등.)
export function triggerHireCalendarSync(): Promise<void> {
  if (IS_VIEWER) return Promise.resolve();
  return runHireCalendarSync();
}

// App 레벨 훅 — live 변경 시 + 2분 interval 안전망으로 자동 실행.
export function useHireCalendarSync(): void {
  const live = useLiveData();
  useEffect(() => {
    if (IS_VIEWER) return;          // 뷰어 모드는 캘린더 쓰기 안 함
    if (!live.hasLive) return;
    void runHireCalendarSync();
  }, [live]);

  useEffect(() => {
    if (IS_VIEWER) return;
    const t = window.setInterval(() => { void runHireCalendarSync(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, []);
}
