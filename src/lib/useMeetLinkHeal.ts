import { useEffect } from 'react';
import { useLiveData, liveCalendarRaw, refreshCalendarFromGoogle } from '../store/liveData';
import { api } from './api';
import { IS_VIEWER } from './mode';
import { SHARED_CAL } from './sharedCalendars';

// 면접 일정 Google Meet 링크 자가복구 (App 레벨 — 면접 캘린더 페이지를 안 열어도 실행).
//
// 배경: main(google.cjs)이 events.insert에 conferenceDataVersion을 안 넘겨서
//       렌더러가 보낸 conferenceData가 구글 API에서 조용히 버려지고 있었다.
//       → 그 기간에 만들어진 면접 일정엔 Meet 링크가 없다.
// 지금은 새로 만드는 면접엔 자동으로 붙지만, 이미 만들어진 앞으로의 면접과
// 누군가 구글 캘린더에서 직접 만든 면접은 여기서 뒤늦게 채워준다.
//
// 메모리 룰 [무조건 자동 동기화] — 사용자 버튼 클릭/페이지 오픈에 의존하지 않는다.
// 안전장치:
//   - hdlee가 owner인 면접 캘린더(SHARED_CAL.interview)만 patch. 남의 캘린더는 안 건드림.
//   - 지난 면접·종일 일정은 제외 (기록 훼손 방지).
//   - 취소/면접포기/불참 라벨 붙은 건 제외 (메모리 룰 [면접 취소/포기 라벨 카드 제외]).
//   - conferenceData만 보내는 patch — 제목/시간/참석자는 절대 안 건드린다.
//   - sendUpdates='none' — 링크 하나 붙었다고 참석자 전원에게 초대 메일이 다시 나가면 안 된다.

const POLL_MS = 300_000; // 5분 — 새 일정은 어차피 만들 때 붙으므로 자주 돌 필요 없다
const CANCELLED = /\(?\s*(면접\s*)?(취소|포기|면접포기|불참|노쇼|no\s*show)\s*\)?/i;

// 한 번 시도한 이벤트는 이 세션에서 다시 안 건드린다 (권한/정책 문제로 계속 실패할 때 무한 재시도 방지).
const attempted = new Set<string>();
let lock: Promise<void> | null = null;

async function runMeetLinkHeal(): Promise<void> {
  if (lock) return lock;
  const p = (async () => {
    const now = Date.now();
    const targets = liveCalendarRaw().filter((e) => {
      if (e.calendarId !== SHARED_CAL.interview) return false;
      if (e.conferenceUrl) return false; // 이미 Meet 있음
      if (e.allDay || !e.start) return false;
      if (e.status === 'cancelled') return false;
      const startMs = Date.parse(e.start);
      if (!Number.isFinite(startMs) || startMs < now) return false; // 지난 면접은 안 건드림
      if (CANCELLED.test(e.summary || '')) return false;
      if (attempted.has(e.id)) return false;
      return true;
    });
    if (targets.length === 0) return;
    let healed = 0;
    for (const t of targets) {
      attempted.add(t.id);
      try {
        // requestId / conferenceSolutionKey 는 main(google.cjs)의 prepareMeet가 채운다.
        const r = await api.google.updateCalEvent(
          SHARED_CAL.interview,
          t.id,
          { conferenceData: { createRequest: {} } } as unknown as Record<string, unknown>,
          'none'
        );
        if (r.ok) healed++;
      } catch {
        /* 실패는 조용히 넘어간다 — 면접 일정 자체는 멀쩡하다 */
      }
    }
    if (healed > 0) await refreshCalendarFromGoogle();
  })();
  lock = p;
  try {
    await p;
  } finally {
    lock = null;
  }
}

export function useMeetLinkHeal(): void {
  const live = useLiveData();
  useEffect(() => {
    if (IS_VIEWER) return; // 뷰어 모드는 캘린더 쓰기 안 함
    if (!live.hasLive) return;
    void runMeetLinkHeal();
  }, [live]);

  useEffect(() => {
    if (IS_VIEWER) return;
    const t = window.setInterval(() => { void runMeetLinkHeal(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, []);
}
