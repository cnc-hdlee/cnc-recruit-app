import { useEffect } from 'react';
import { useLiveData, liveByKindOrScan } from '../store/liveData';
import { parseHireRows, HIRES_SHEET_HEADERS, approvalLabel, type HireRow } from '../pages/IncomingHires';
import { api } from './api';

// 입사자 관리 시트 자동 동기화 (App 레벨 — 어느 페이지에 있든 실행).
// 메모리 [Sheets 쓰기 절대 금지] / drive.file scope: 기존 사용자 시트엔 못 씀.
//   → 앱이 "직접 만든" 새 구글시트에 미러링. 입사예정일별 탭 + 5/20 양식.
// 입사예정(정규직)DB(=incoming)가 바뀌면 자동 재동기화.
// 수기 O(입사안내/건강검진)는 백엔드 syncHiresWorkbook에서 (성명|연락처)로 보존.

// 모듈 레벨 락/시그니처 — React StrictMode의 effect 2회 실행에도 시트 중복 생성 방지.
let syncLock: Promise<void> | null = null;
let lastSig = '';

function buildSig(rows: HireRow[]): string {
  return rows
    // approval 포함 — 입사포기/결재중 등 상태가 바뀌면 시트 '비고'도 다시 미러링되도록.
    .map((r) => `${r.date}|${r.name}|${r.team}|${r.site}|${r.job}|${r.rank}|${r.career}|${r.phone}|${r.bonbu}|${r.gender}|${r.jikgu}|${r.approval}`)
    .sort()
    .join('\n');
}

// 입사예정(정규직)DB → 앱 전용 "입사자 관리" 시트 1회전 미러링. force=true면 시그니처 무시하고 강제.
// 입사 포기자도 함께 미러링하되 마지막 '비고' 컬럼에 "입사포기"로 기록 (지우지 않고 보존·누적).
async function runHiresSheetSync(force = false): Promise<void> {
  const rows = parseHireRows(liveByKindOrScan('incoming'));
  if (rows.length === 0) return;
  const sig = buildSig(rows);
  if (!force && sig === lastSig) return;  // 동일 데이터 → 재동기화 안 함
  if (syncLock) return;                   // 진행 중(StrictMode 2차 호출 포함) → skip
  lastSig = sig;
  syncLock = (async () => {
    try {
      // 헤더 순서에 맞춰 행을 만든다 — 컬럼을 추가·이동해도 HIRES_SHEET_HEADERS만 고치면 된다.
      // 수기 컬럼(입사안내/제출서류/퇴사)은 항상 빈칸으로 보내고, 백엔드가 기존 값을 복원한다.
      const toRow = (r: HireRow): string[] => {
        const byHeader: Record<string, string> = {
          '입사예정일': r.date,
          '본부명': r.bonbu,
          '팀명': r.team,
          '직무': r.job,
          '직급': r.rank,
          '신입/경력': r.career,
          '성명': r.name,
          '성별': r.gender,
          '근무지': r.site,
          '직/간접분류': r.jikgu,
          '연락처': r.phone,
          // '비고' 컬럼 — 입사포기/결재중/결재완료 상태. unknown('-')은 빈칸으로.
          '비고': r.approval === 'unknown' ? '' : approvalLabel(r.approval),
        };
        return HIRES_SHEET_HEADERS.map((h) => byHeader[h] ?? '');
      };
      const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.team.localeCompare(b.team));
      const byDate = new Map<string, HireRow[]>();
      for (const r of sorted) {
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date)!.push(r);
      }
      const tabs: { name: string; headers: string[]; rows: string[][] }[] = [
        { name: '전체(날짜순)', headers: HIRES_SHEET_HEADERS, rows: sorted.map(toRow) },
      ];
      // 입사 포기자만 따로 모은 누적 기록 탭 — 시트에서 사라지지 않는 한 계속 쌓임.
      const declined = sorted.filter((r) => r.approval === 'declined');
      if (declined.length > 0) {
        tabs.push({ name: '입사포기', headers: HIRES_SHEET_HEADERS, rows: declined.map(toRow) });
      }
      // 날짜 탭은 최신 입사일이 앞으로 오도록 내림차순 배치 —
      // 오름차순이면 새로 생긴 탭이 항상 맨 끝으로 밀려서 매번 스크롤해야 한다.
      // (탭 실제 위치는 백엔드 syncHiresWorkbook이 이 배열 순서대로 재정렬한다.)
      const datesDesc = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
      for (const date of datesDesc) {
        tabs.push({ name: `입사 ${date}`, headers: HIRES_SHEET_HEADERS, rows: byDate.get(date)!.map(toRow) });
      }
      const idRes = await api.cfg.get<string>('incomingHiresSheetId');
      const existingId = idRes.ok && typeof idRes.data === 'string' && idRes.data ? idRes.data : null;
      const res = await api.google.syncHiresSheet(existingId, tabs);
      if (res.ok && res.data) {
        if (res.data.spreadsheetId !== existingId) {
          await api.cfg.set('incomingHiresSheetId', res.data.spreadsheetId);
        }
        // eslint-disable-next-line no-console
        console.info('[hires-sheet-sync] 동기화 완료:', res.data.url, `${rows.length}명 / ${byDate.size}일 / 입사포기 ${declined.length}명`);
      } else {
        lastSig = ''; // 실패 → 다음 데이터 변경/재시도 때 다시
        // eslint-disable-next-line no-console
        console.warn('[hires-sheet-sync] 실패:', res);
      }
    } catch (e) {
      lastSig = '';
      // eslint-disable-next-line no-console
      console.warn('[hires-sheet-sync] 예외:', e);
    } finally {
      syncLock = null;
    }
  })();
  return syncLock;
}

// 수동 트리거 — 입사예정자 페이지 "입사포기" 섹션 클릭 시 즉시 강제 미러링.
export function triggerHiresSheetSync(): Promise<void> {
  return runHiresSheetSync(true);
}

export function useHiresSheetSync(): void {
  const live = useLiveData();
  useEffect(() => {
    if (!live.hasLive) return;
    void runHiresSheetSync();
  }, [live]);
}
