// 시트 파싱 공통 유틸 — 여러 시트가 같은 날짜 포맷 / 헤더 변형을 쓰므로 한 곳에 모음.

// Parse a wide variety of date formats commonly found in Google Sheets cells.
// Returns ISO YYYY-MM-DD, or '' if it can't be parsed as a real date.
export function parseSheetDate(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/);
  if (m) {
    if (m[1].length === 4) return iso(m[1], m[2], m[3]);
    if (m[3].length === 4) return iso(m[3], m[1], m[2]);
  }
  // 한국에서 자주 쓰는 "5월 4일" 단축형 — 올해로 가정
  m = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/);
  if (m) return iso(new Date().getFullYear(), m[1], m[2]);
  // 시트 직렬번호 (Excel/Sheets epoch 1899-12-30)
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 25569 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      if (!Number.isNaN(d.getTime())) {
        return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
    }
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return '';
}

export function iso(y: string | number, m: string | number, d: string | number): string {
  const ys = String(y).padStart(4, '0');
  const ms = String(m).padStart(2, '0');
  const ds = String(d).padStart(2, '0');
  return `${ys}-${ms}-${ds}`;
}

// 헤더 미세 변형(공백/접미사) 흡수해서 첫 번째 매칭 컬럼 값 반환.
export function field(r: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const cn = c.replace(/\s+/g, '');
    for (const k of Object.keys(r)) {
      if (k.replace(/\s+/g, '').includes(cn)) return r[k] || '';
    }
  }
  return '';
}

// 두 ISO 날짜 사이 일수 차이 (a - b).
export function diffDays(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((da - db) / 86400000);
}

export function fmtDateLabel(isoStr: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return isoStr;
  const [y, m, d] = isoStr.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
  const todayDt = new Date(today + 'T00:00:00');
  const dd = Math.round((dt.getTime() - todayDt.getTime()) / 86400e3);
  let suffix = '';
  if (dd === 0) suffix = ' (오늘)';
  else if (dd === 1) suffix = ' (내일)';
  else if (dd > 1 && dd <= 14) suffix = ` (D-${dd})`;
  else if (dd < 0) suffix = ` (${Math.abs(dd)}일 전)`;
  return `${m}/${d}(${wd})${suffix}`;
}
