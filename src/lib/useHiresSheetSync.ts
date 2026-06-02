import { useEffect } from 'react';
import { useLiveData, liveByKindOrScan } from '../store/liveData';
import { parseHireRows, HIRES_SHEET_HEADERS, type HireRow } from '../pages/IncomingHires';
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
    .map((r) => `${r.date}|${r.name}|${r.team}|${r.site}|${r.job}|${r.rank}|${r.career}|${r.phone}|${r.bonbu}|${r.gender}|${r.jikgu}`)
    .sort()
    .join('\n');
}

export function useHiresSheetSync(): void {
  const live = useLiveData();
  useEffect(() => {
    if (!live.hasLive) return;
    const rows = parseHireRows(liveByKindOrScan('incoming'));
    if (rows.length === 0) return;
    const sig = buildSig(rows);
    if (sig === lastSig) return;       // 동일 데이터 → 재동기화 안 함
    if (syncLock) return;              // 진행 중(StrictMode 2차 호출 포함) → skip
    lastSig = sig;
    syncLock = (async () => {
      try {
        const toRow = (r: HireRow): string[] => [
          r.date, r.bonbu, r.team, r.job, r.rank, r.career, r.name, r.gender, r.site, '', r.jikgu, r.phone, '',
        ];
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.team.localeCompare(b.team));
        const byDate = new Map<string, HireRow[]>();
        for (const r of sorted) {
          if (!byDate.has(r.date)) byDate.set(r.date, []);
          byDate.get(r.date)!.push(r);
        }
        const tabs: { name: string; headers: string[]; rows: string[][] }[] = [
          { name: '전체(날짜순)', headers: HIRES_SHEET_HEADERS, rows: sorted.map(toRow) },
        ];
        for (const [date, list] of byDate) {
          tabs.push({ name: `입사 ${date}`, headers: HIRES_SHEET_HEADERS, rows: list.map(toRow) });
        }
        const idRes = await api.cfg.get<string>('incomingHiresSheetId');
        const existingId = idRes.ok && typeof idRes.data === 'string' && idRes.data ? idRes.data : null;
        const res = await api.google.syncHiresSheet(existingId, tabs);
        if (res.ok && res.data) {
          if (res.data.spreadsheetId !== existingId) {
            await api.cfg.set('incomingHiresSheetId', res.data.spreadsheetId);
          }
          // eslint-disable-next-line no-console
          console.info('[hires-sheet-sync] 동기화 완료:', res.data.url, `${rows.length}명 / ${byDate.size}일`);
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
  }, [live]);
}
