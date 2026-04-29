// Maps Google Sheet tabs into app data categories.
// User assigns each tab a "kind"; we never modify sheets.

export type TabKind =
  | 'office_headcount' // 부서별 TO/현원/미충원 — 사무직 위주 (전사인원현황)
  | 'incoming' // 입사예정자
  | 'recruit_request' // 채용요청
  | 'office_pipeline' // 정규직 채용현황 (사무직)
  | 'field_pipeline' // 생산직 면접 내용 (현장직)
  | 'office_interview' // 면접 및 처우 현황 (사무직)
  | 'field_incoming' // 생산입사 예정자
  | 'weekly_log'; // 위클리 업무

export const TAB_KIND_LABELS: Record<TabKind, string> = {
  office_headcount: '인원현황 (TO/미충원/충원율)',
  incoming: '입사예정자 (사무직)',
  recruit_request: '채용요청 관리',
  office_pipeline: '정규직 채용현황 (사무직)',
  field_pipeline: '생산직 면접 내용 (현장직)',
  office_interview: '면접 및 처우 현황 (사무직)',
  field_incoming: '생산입사 예정자 (현장직)',
  weekly_log: '위클리 업무 로그',
};

export const TAB_KIND_GROUPS: Record<TabKind, 'office' | 'field' | 'shared'> = {
  office_headcount: 'shared',
  incoming: 'office',
  recruit_request: 'shared',
  office_pipeline: 'office',
  office_interview: 'office',
  field_pipeline: 'field',
  field_incoming: 'field',
  weekly_log: 'shared',
};

export interface TabMappingEntry {
  spreadsheetId: string;
  tabName: string;
  headerRow: number; // 1-indexed; rows above headerRow are skipped
}

// kind → mapping(s). Some kinds may map to multiple tabs (e.g., headcount split across sites).
export type SheetMappings = Partial<Record<TabKind, TabMappingEntry[]>>;

// Heuristic: suggest a kind for a tab name.
export function suggestKind(tabName: string): TabKind | null {
  const t = tabName.trim();
  if (!t) return null;
  const norm = t.replace(/\s+/g, '');

  // 재직자 DB / 월별 입퇴사 등은 채용 파이프라인이 아님 → 매핑 안 함
  if (/(^|[^가-힣])(정규직|도급직)DB$/.test(norm)) return null;
  if (norm.includes('월별입퇴사') || norm.includes('입퇴사자추이')) return null;

  if (norm.includes('채용요청')) return 'recruit_request';
  if (norm.includes('입사예정') && (norm.includes('도급') || norm.includes('생산') || norm.includes('현장'))) return 'field_incoming';
  if (norm.includes('입사예정')) return 'incoming';
  if (norm.includes('전사인원') || norm.includes('인원현황') || norm.includes('부서별TO') || norm.endsWith('TO')) return 'office_headcount';
  if (norm.includes('생산직') && norm.includes('면접')) return 'field_pipeline';
  if (norm.includes('면접') && norm.includes('처우')) return 'office_interview';
  // 사무직 채용현황 — '정규직DB'는 이미 위에서 걸러짐
  if ((norm.includes('정규직') && norm.includes('채용')) || (norm.includes('채용') && norm.includes('현황'))) return 'office_pipeline';
  if (norm.includes('위클리')) return 'weekly_log';
  return null;
}

// Auto-detect the most plausible header row. Skips title/subtitle rows.
// Picks the first row within first 6 with >=3 non-empty cells where most cells are non-numeric.
export function detectHeaderRow(rows: string[][]): number {
  if (!rows || rows.length === 0) return 1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = rows[i] || [];
    const cells = r.map((c) => String(c ?? '').trim());
    const nonEmpty = cells.filter((c) => c !== '').length;
    if (nonEmpty < 3) continue;
    const numeric = cells.filter((c) => c !== '' && /^-?\d+(\.\d+)?$/.test(c)).length;
    // Header rows are mostly text, not numbers
    if (numeric / nonEmpty < 0.4) return i + 1; // 1-indexed
  }
  return 1;
}

// Convert raw [][] rows → array of objects keyed by header row.
// headerRow: number (1-indexed) | 0 or undefined = auto-detect
// If configured headerRow points to a degenerate row (e.g. a single-cell title), fall back to auto-detect.
export function rowsToObjects(rows: string[][], headerRow = 0): Record<string, string>[] {
  if (!rows || rows.length === 0) return [];
  let effectiveHeaderRow = !headerRow || headerRow < 1 ? detectHeaderRow(rows) : headerRow;
  const probe = (rows[effectiveHeaderRow - 1] || []).map((h) => String(h ?? '').trim()).filter((c) => c !== '');
  if (probe.length < 3) {
    const detected = detectHeaderRow(rows);
    if (detected !== effectiveHeaderRow) effectiveHeaderRow = detected;
  }
  if (rows.length < effectiveHeaderRow) return [];
  const headers = (rows[effectiveHeaderRow - 1] || []).map((h) => String(h ?? '').trim());
  // For multi-row headers (merged cells), if header row has empty cells, look at next row for sub-headers
  const subHeaders = (rows[effectiveHeaderRow] || []).map((h) => String(h ?? '').trim());
  const mergedHeaders = headers.map((h, i) => {
    if (h) return h;
    return subHeaders[i] || '';
  });
  const dataStartRow = effectiveHeaderRow; // skip header row itself; sub-header (if any) treated as data and filtered out
  const out: Record<string, string>[] = [];
  for (let i = dataStartRow; i < rows.length; i++) {
    const r = rows[i] || [];
    // Skip likely sub-header row (mostly empty key cells like "팀" with text values when first row had empty)
    if (i === effectiveHeaderRow) {
      // Heuristic: row right after header — if mostly text + no numeric, it's a sub-header
      const cells = r.map((c) => String(c ?? '').trim());
      const numeric = cells.filter((c) => c !== '' && /^-?\d+(\.\d+)?$/.test(c)).length;
      const nonEmpty = cells.filter((c) => c !== '').length;
      if (nonEmpty > 0 && numeric === 0 && nonEmpty < cells.length * 0.6) {
        continue; // looks like sub-header, skip
      }
    }
    const obj: Record<string, string> = {};
    let hasAny = false;
    for (let c = 0; c < mergedHeaders.length; c++) {
      const key = mergedHeaders[c] || `col${c}`;
      const val = r[c] != null ? String(r[c]).trim() : '';
      obj[key] = val;
      if (val) hasAny = true;
    }
    if (hasAny) out.push(obj);
  }
  return out;
}

// Pick the first key matching any of the candidate names (loose).
export function pickField(obj: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    for (const key of Object.keys(obj)) {
      if (key.replace(/\s+/g, '').includes(c.replace(/\s+/g, ''))) {
        return obj[key];
      }
    }
  }
  return '';
}
