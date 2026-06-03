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

// 입사 자동 캘린더 확보 — cfg에 저장된 id 우선, 없으면 1회 생성 + ACL 공유.
async function ensureHireCalendar(): Promise<string | null> {
  if (cachedCalId) return cachedCalId;
  if (bootstrapLock) return bootstrapLock;
  const p = (async (): Promise<string | null> => {
    try {
      const r = await api.cfg.get<string>('hireAutoCalendarId');
      if (r.ok && typeof r.data === 'string' && r.data) {
        cachedCalId = r.data;
      } else {
        const cr = await api.google.createCalendar(
          '입사 (자동)',
          'Asia/Seoul',
          'CNC 채용 커맨드센터가 입사예정자를 자동 등록하는 캘린더. 권한 우회 — shim@ owner 메인 캘린더에 hdlee write 권한 없음.'
        );
        if (cr.ok && cr.data?.id) {
          cachedCalId = cr.data.id;
          await api.cfg.set('hireAutoCalendarId', cachedCalId);
          // eslint-disable-next-line no-console
          console.info('[hire-cal-sync] 새 입사 자동 캘린더 생성:', cachedCalId);
        }
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

      // 등록 대상: 결재완료(approved) + 미래 입사 + dismiss 안 됨.
      const eligible = rows.filter((r) => {
        if (r.approval !== 'approved') return false;
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

      let changed = false;

      // 등록/갱신
      for (const [date, list] of byDate) {
        try {
          const summary = buildHireDateSummary(list);
          const description = buildHireDateDescription(list);
          const existing = onboardingEvents.find((e) => {
            const dt = (e.start || '').slice(0, 10);
            if (dt !== date) return false;
            return e.colorId === '5' && (e.description || '').includes(HIRE_AUTO_MARKER);
          });
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
