// CNC TA팀 공유 캘린더 ID — 팀원이 모두 같은 캘린더에 일정을 등록/조회한다.
// 누구든 본 앱에서 새 면접 일정을 만들면 SHARED_CAL.interview에 기록되고,
// 60초마다 모든 팀원의 앱이 같은 캘린더를 polling 하므로 즉시 보인다.

export const SHARED_CAL = {
  // 면접 (TA팀 공용 — hdlee가 만든 메인) — 이벤트 colorId 3 (grape 보라색)
  interview: 'c_d2a3298862ba8bba109c13c83c2cc7c1ac85560bdc12a305c40c79f6964c65a2@group.calendar.google.com',
  // 면접 (shim@이 만든 보조) — read-only로 구독, 일부 면접 일정 여기 들어감
  interviewAlt: 'c_711021d8db3140f0fa36874c11e98a449ee5528637e020d891cf903cd4b8c443@group.calendar.google.com',
  // 입사 (메인 — 노란색) — colorId 5 (banana). shim@이 owner
  onboardingMain: 'c_e006d0f491165344836f40c2589456a597676d6d551c00a477e5fe6c46a8804f@group.calendar.google.com',
  // 퇴사
  offboarding: 'c_6b893ca53cb3b057d4e04928dffae5408a3b4c81332b561668190094bf09c2a7@group.calendar.google.com',
} as const;

// refreshCalendarFromGoogle가 fetch 할 캘린더 목록 (primary + 공유 4개).
// 입사 보조(빨간색 c_1ff0...)는 2026-05-06 사용자 요청으로 polling 제외 — 메인만 사용.
// 동일 이벤트가 중복되지 않도록 ID로 dedup.
export const READ_CALENDAR_IDS: string[] = [
  'primary',
  SHARED_CAL.interview,
  SHARED_CAL.interviewAlt,
  SHARED_CAL.onboardingMain,
  SHARED_CAL.offboarding,
];
