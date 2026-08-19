// 대시보드(형도_작업중) — 현재 주/월 열에 빨간 테두리 자동 이동.
//   1QEvFE… / gid 475576684
//
// 현재 열 판정: 날짜 기준은 "충원 예정" 행으로 통일한다.
//   충원예정 팀 행의 SUMIFS 가 열마다 시작일·종료일을 둘 다 갖고 있어 가장 명확하다.
//   예) 8월 3주 = 2026-08-17 ~ 2026-08-22 → 오늘(8/19)이 그 안이므로 3주차가 현재.
//   충원예정에 날짜가 없는 열(월 단위 등)은 재직인원 행에서 보조로 읽는다.
//   시트에 9월·10월 열이 채워지면 자동으로 따라간다 (스크립트 수정 불필요).
//
// 라벨로 행을 찾으므로 행이 밀려도 안전. 데이터·수식·조건부서식은 건드리지 않고
// 테두리만 바꾼다.
//
// 실행: node hyeongdo-week-border.cjs [--dry]
const fs = require('node:fs'), path = require('node:path'), { google } = require('googleapis');

const ID = '1QEvFEWjnXC1CNw6qAZ4ooFQUIxh36ow_9EL3hnM6ZoI';
const SID = 475576684;
const TAB = '대시보드(형도_작업중)';
const SCAN = 80;                 // 라벨 탐색 범위
const COL0 = 1, COL1 = 16;       // B~P (0-indexed, end exclusive)
const DRY = process.argv.includes('--dry');

const CL = (i) => { let s = '', x = i + 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, '');
// toISOString 은 UTC라 KST 기준 하루 밀려 보인다 → 로컬 날짜로 찍는다
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

async function auth() {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const o = new google.auth.OAuth2(t.clientId, t.clientSecret);
  o.setCredentials({ refresh_token: t.refresh_token });
  await o.getAccessToken();
  return google.sheets({ version: 'v4', auth: o });
}

(async () => {
  const s = await auth();

  // ---- 1) 표 범위 탐지 (A열 라벨 기준) ----
  const A = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!A1:A${SCAN}`, valueRenderOption: 'FORMATTED_VALUE',
  })).data.values || [];
  const lab = (r) => String(((A[r - 1] || [])[0]) || '').trim();

  const blocks = new Set(['수주량', '생산계획', '목표인원', '재직인원', '퇴사자', '현재 Gap', '충원 예정', '충원 반영(E)', '조정 GAP', '상태']);
  const inMatrix = (L) => blocks.has(L) || /생산\s*\d\s*팀/.test(L);

  let hdrRow = -1, first = -1, jaejik = -1, chungwon = -1;
  for (let r = 1; r <= SCAN; r++) {
    const L = lab(r);
    if (L === '구분' && hdrRow < 0) hdrRow = r;
    if (L === '수주량' && first < 0) first = r;
    if (L === '재직인원' && jaejik < 0) jaejik = r;
    if (L === '충원 예정' && chungwon < 0) chungwon = r;
  }
  if (hdrRow < 0 || first < 0) { log('구분/수주량 행을 못 찾음 — 중단'); process.exitCode = 1; return; }
  if (chungwon < 0) { log('"충원 예정" 행을 못 찾음 — 중단'); process.exitCode = 1; return; }
  let last = first;
  while (last + 1 <= SCAN && inMatrix(lab(last + 1))) last++;
  // 날짜 기준 = 충원 예정 소계행 바로 아래(생산1팀). 보조 = 재직인원 생산1팀.
  const dateRow = chungwon + 1;
  const fbRow = jaejik > 0 ? jaejik + 1 : 0;
  log(`표 탐지: 헤더 R${hdrRow} / 데이터 R${first}~R${last} / 날짜기준 R${dateRow}(충원예정)${fbRow ? ` / 보조 R${fbRow}(재직인원)` : ''}`);

  // ---- 2) 열별 마감 기준일 추출 ----
  const hdr = ((await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!${CL(COL0)}${hdrRow}:${CL(COL1 - 1)}${hdrRow}`,
    valueRenderOption: 'FORMATTED_VALUE',
  })).data.values || [[]])[0] || [];
  const rowFml = async (r) => ((await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!${CL(COL0)}${r}:${CL(COL1 - 1)}${r}`,
    valueRenderOption: 'FORMULA',
  })).data.values || [[]])[0] || [];
  const fml = await rowFml(dateRow);
  const fmlFb = fbRow ? await rowFml(fbRow) : [];

  const datesIn = (f) => [...String(f || '').matchAll(/DATE\((\d+),(\d+),(\d+)\)/g)]
    .map((m) => new Date(+m[1], +m[2] - 1, +m[3]));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cols = [];
  for (let j = 0; j < COL1 - COL0; j++) {
    const label = String(hdr[j] || '').trim();
    if (!label) continue;
    let ds = datesIn(fml[j]), src = '충원예정';
    if (!ds.length) { ds = datesIn(fmlFb[j]); src = '재직인원'; }
    if (!ds.length) continue;
    const times = ds.map((d) => d.getTime());
    cols.push({
      idx: COL0 + j, label, src,
      start: new Date(Math.min(...times)),
      end: new Date(Math.max(...times)),
    });
  }
  if (!cols.length) { log('열 기준일을 못 읽음 — 중단'); process.exitCode = 1; return; }

  // 오늘이 시작~종료 안에 드는 열 = 현재.
  // 주 사이 공백(예: 일요일)에 걸리면 종료일이 오늘 이후인 첫 열, 전부 지났으면 마지막 열.
  const cur = cols.find((c) => c.start <= today && today <= c.end)
           || cols.find((c) => c.end >= today)
           || cols[cols.length - 1];
  log(`오늘 ${ymd(today)} → 현재 열 "${cur.label}" (${CL(cur.idx)}, ${ymd(cur.start)}~${ymd(cur.end)}, 출처 ${cur.src})`);

  // ---- 3) 테두리 이동 ----
  const RED = { red: 1, green: 0, blue: 0 };
  const none = { style: 'NONE' };
  const thick = { style: 'SOLID_THICK', color: RED, colorStyle: { rgbColor: RED } };
  const box = { sheetId: SID, startRowIndex: hdrRow - 1, endRowIndex: last, startColumnIndex: cur.idx, endColumnIndex: cur.idx + 1 };

  if (DRY) { log('DRY RUN — 쓰지 않음'); return; }
  await s.spreadsheets.batchUpdate({
    spreadsheetId: ID,
    requestBody: {
      requests: [
        // 이전 주 테두리 정리 (표 안쪽만)
        {
          updateBorders: {
            range: { sheetId: SID, startRowIndex: hdrRow - 1, endRowIndex: last, startColumnIndex: COL0, endColumnIndex: COL1 },
            top: none, bottom: none, left: none, right: none, innerHorizontal: none, innerVertical: none,
          },
        },
        // 현재 열에 빨간 박스
        { updateBorders: { range: box, top: thick, bottom: thick, left: thick, right: thick } },
      ],
    },
  });
  log(`적용 완료 — ${CL(cur.idx)}열 R${hdrRow}~R${last}`);
})().catch((e) => { log('ERR', e.message); process.exitCode = 1; });
