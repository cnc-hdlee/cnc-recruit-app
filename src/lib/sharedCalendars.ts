// CNC TA팀 공유 캘린더 ID — 팀원이 모두 같은 캘린더에 일정을 등록/조회한다.
// 누구든 본 앱에서 새 면접 일정을 만들면 SHARED_CAL.interview에 기록되고,
// 60초마다 모든 팀원의 앱이 같은 캘린더를 polling 하므로 즉시 보인다.

export const SHARED_CAL = {
  // 면접 (TA팀 공용 — hdlee가 만든 메인) — 이벤트 colorId 3 (grape 보라색)
  interview: 'c_d2a3298862ba8bba109c13c83c2cc7c1ac85560bdc12a305c40c79f6964c65a2@group.calendar.google.com',
  // 면접 (shim@이 만든 보조) — read-only로 구독, 일부 면접 일정 여기 들어감
  interviewAlt: 'c_711021d8db3140f0fa36874c11e98a449ee5528637e020d891cf903cd4b8c443@group.calendar.google.com',
  // 면접 (bjkim4@ 등 채용매니저가 운영하는 팀 면접 캘린더) — read-only 구독.
  // 남이 만들어 hdlee를 초대한 면접이 primary 초대로만 들어와 앱에 누락되던 문제(2026-08) 해결.
  // hdlee reader 권한 확인됨. 여기 이벤트는 isInterviewKind에서 면접으로 신뢰.
  interviewMgr: 'c_21d3c76327cd3e4ab66cb7f7cfdb6f1a7c63500dd0d8af17212640edee2c5459@group.calendar.google.com',
  // 면접 (4번째 — "서울(4E회의실)/…" 포맷으로 OBM/디자인/연구 직군 면접이 등록되는 캘린더).
  // hdlee가 구독(selected)까지 해놨는데 앱 READ 목록에 빠져 있어서 구글 캘린더엔 보이지만
  // 앱에는 통째로 안 뜨던 누락 원인(2026-08-20 확인, 120일 창에서 14건 중 9건이 앱에 없음).
  interviewX: 'c_bebeafad40540c7c46a8b75315ef413571d6f9fb13ef74c0f31cca541bd93587@group.calendar.google.com',
  // 입사 (메인 — 노란색) — colorId 5 (banana). shim@이 owner → hdlee write 권한 없음 (reader)
  onboardingMain: 'c_e006d0f491165344836f40c2589456a597676d6d551c00a477e5fe6c46a8804f@group.calendar.google.com',
  // 입사 (자동 등록 master — 노란색) — hdlee가 owner라 앱이 직접 쓸 수 있는 유일한 입사 캘린더.
  // cfg `hireAutoCalendarId`의 기본값. onboardingMain엔 write 권한이 없어 이 캘린더를 master로 사용.
  // 메모리 [입사예정자 자동 등록+취소] — c_1ff0...가 유일 master, 새 캘린더 만들지 말 것.
  onboardingAuto: 'c_1ff0f668f4f5692de72ab4d7eef91bcbb74ea08ad278ee8e21e9f236d9a20b13@group.calendar.google.com',
  // 퇴사
  offboarding: 'c_6b893ca53cb3b057d4e04928dffae5408a3b4c81332b561668190094bf09c2a7@group.calendar.google.com',
} as const;

// refreshCalendarFromGoogle가 fetch 할 캘린더 목록 (primary + 공유 4개).
// 입사 보조(빨간색 c_1ff0...)는 2026-05-06 사용자 요청으로 polling 제외 — 메인만 사용.
// 동일 이벤트가 중복되지 않도록 ID로 dedup.
export const READ_CALENDAR_IDS: string[] = [
  // primary 우선 — 남이 만들어 hdlee를 초대한 면접은 primary 사본에만 제목이 있다.
  // 공유 면접 캘린더(interviewMgr 등)를 reader로 직접 읽으면 private이라 제목이 빈 채로 오므로,
  // 제목은 반드시 primary 사본이 이겨야 이름/소속이 보인다.
  // ※ 단, dedup은 "먼저 온 사본이 전부 이김"이 아니라 mergeCalendarCopies()로 필드별 병합한다.
  //   (제목=primary, calendarId/colorId=공유 면접 캘린더 → 보라색 신뢰 룰이 죽지 않게)
  'primary',
  SHARED_CAL.interview,
  SHARED_CAL.interviewAlt,
  SHARED_CAL.interviewMgr,
  SHARED_CAL.interviewX,
  SHARED_CAL.onboardingMain,
  SHARED_CAL.offboarding,
];

// 면접 전용 캘린더 — 여기 있는 이벤트는 색/제목 포맷과 무관하게 "면접"으로 신뢰한다.
export const INTERVIEW_CAL_IDS: string[] = [
  SHARED_CAL.interview,
  SHARED_CAL.interviewAlt,
  SHARED_CAL.interviewMgr,
  SHARED_CAL.interviewX,
];

export function isInterviewCalendar(calendarId: string | null | undefined): boolean {
  return !!calendarId && INTERVIEW_CAL_IDS.includes(calendarId);
}
