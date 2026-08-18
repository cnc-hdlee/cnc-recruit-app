// 본부별 채용현황판(1HViqfG) Summary 탭에 "크솔본부" 추가
//
// 기존 디자인/데이터는 그대로 두고 크솔본부만 끼워 넣는다.
//   ① Division 표(C17:H)  — 연구소 아래 22행에 크솔본부 삽입
//        · 전체 행 삽입이 아니라 C:H 범위만 아래로 밀어서(insertRange) 오른쪽 일별표는 안 건드림
//   ② 상단 KPI(C4:E4)     — 합계 범위 18:21 → 18:22
//   ③ Fill Rate % 차트     — 계열 범위 4본부 → 5본부 (Openings 차트는 이미 22행까지라 그대로)
//   ④ 일별 추이표          — 전체(AB:AE) 앞에 4열 삽입해 크솔본부 그룹 자리를 만듦
//                            → 경영기획 영업 생산 연구소 [크솔본부] 전체
//
// 실행: node add-ksol-bonbu.cjs [--dry]
const fs = require('node:fs'), path = require('node:path'), { google } = require('googleapis');

const ID = '1HViqfG68untk-fx_CA_qdSgn_-N9oZXzrz3hRYFIQcw';
const SID = 7607122;                 // Summary
const TAB = 'Summary';
const NEW_ROW = 22;                  // 크솔본부가 들어갈 행 (연구소 21 바로 아래)
const KSOL_COL = 27;                 // AB (0-indexed) — 여기에 4열 삽입
const DRY = process.argv.includes('--dry');

async function auth() {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const o = new google.auth.OAuth2(t.clientId, t.clientSecret);
  o.setCredentials({ refresh_token: t.refresh_token });
  await o.getAccessToken();
  return google.sheets({ version: 'v4', auth: o });
}

(async () => {
  const s = await auth();

  // ---------- 사전 점검 ----------
  const pre = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!C17:H23`, valueRenderOption: 'FORMULA',
  })).data.values || [];
  const nameAt = (r) => String(((pre[r - 17] || [])[0]) || '').trim();
  console.log('현재 Division 표:');
  for (let r = 17; r <= 23; r++) console.log('  R' + r + ': ' + (nameAt(r) || '(빈칸)'));
  if (nameAt(21) !== '연구소') { console.error('중단: R21이 연구소가 아닙니다. 레이아웃이 바뀌었습니다.'); process.exitCode = 1; return; }
  if (nameAt(22).includes('크솔')) { console.error('중단: 이미 크솔본부가 있습니다.'); process.exitCode = 1; return; }

  const grp = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!L4:AE4`, valueRenderOption: 'FORMATTED_VALUE',
  })).data.values || [];
  console.log('일별표 그룹헤더: ' + JSON.stringify(grp[0] || []));

  // 크솔본부 탭 확인 (연구소와 같은 A5/E5/I5 구조인지)
  const ks = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'크솔본부'!A4:M5`, valueRenderOption: 'FORMATTED_VALUE',
  })).data.values || [];
  console.log('크솔본부 탭 R4: ' + JSON.stringify(ks[0] || []) + '  R5: ' + JSON.stringify(ks[1] || []));

  if (DRY) { console.log('\nDRY RUN — 여기까지'); return; }

  // ---------- ① C:H 만 아래로 밀고 크솔본부 행 삽입 ----------
  await s.spreadsheets.batchUpdate({
    spreadsheetId: ID,
    requestBody: {
      requests: [
        {
          insertRange: {
            range: { sheetId: SID, startRowIndex: NEW_ROW - 1, startColumnIndex: 2, endColumnIndex: 8 },
            shiftDimension: 'ROWS',
          },
        },
        // 연구소 행(21)의 서식을 새 행에 그대로 복사 — 디자인 유지
        {
          copyPaste: {
            source: { sheetId: SID, startRowIndex: 20, endRowIndex: 21, startColumnIndex: 2, endColumnIndex: 8 },
            destination: { sheetId: SID, startRowIndex: NEW_ROW - 1, endRowIndex: NEW_ROW, startColumnIndex: 2, endColumnIndex: 8 },
            pasteType: 'PASTE_FORMAT',
          },
        },
        // ---------- ④ 일별표: 전체(AB:AE) 앞에 4열 삽입 ----------
        {
          insertDimension: {
            range: { sheetId: SID, dimension: 'COLUMNS', startIndex: KSOL_COL, endIndex: KSOL_COL + 4 },
            inheritFromBefore: true,
          },
        },
        // 새로 생긴 AB4:AE4 를 그룹헤더로 병합
        {
          mergeCells: {
            range: { sheetId: SID, startRowIndex: 3, endRowIndex: 4, startColumnIndex: KSOL_COL, endColumnIndex: KSOL_COL + 4 },
            mergeType: 'MERGE_ALL',
          },
        },
      ],
    },
  });

  // ---------- 값/수식 ----------
  const data = [
    // ① 크솔본부 행 (연구소와 동일한 수식 형태)
    {
      range: `'${TAB}'!C${NEW_ROW}:G${NEW_ROW}`,
      values: [['크솔본부', `='크솔본부'!A5`, `='크솔본부'!E5+'크솔본부'!I5`,
        `=D${NEW_ROW}-E${NEW_ROW}`, `=E${NEW_ROW}/D${NEW_ROW}`]],
    },
    // ② 상단 KPI 합계 범위 확장 (18:21 → 18:22)
    { range: `'${TAB}'!C4:F4`, values: [['=sum(D18:D22)', '=sum(E18:E22)', '=sum(F18:F22)', '=D4/C4']] },
    // ④ 일별표 크솔본부 그룹 헤더
    { range: `'${TAB}'!AB4`, values: [['크솔본부']] },
    { range: `'${TAB}'!AB5:AE5`, values: [['Openings', 'Hired', 'Residue', 'Fill Rate']] },
  ];
  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: ID, requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  // ---------- ③ Fill Rate % 차트에 크솔본부 포함 ----------
  const charts = ((await s.spreadsheets.get({
    spreadsheetId: ID, fields: 'sheets(properties(sheetId),charts(chartId,spec))',
  })).data.sheets.find((x) => x.properties.sheetId === SID).charts) || [];
  const chartReqs = [];
  charts.forEach((c) => {
    const bc = (c.spec || {}).basicChart; if (!bc) return;
    let touched = false;
    const bump = (src) => {
      const rg = ((src || {}).sourceRange || {}).sources || [];
      rg.forEach((r) => {
        if (r.sheetId === SID && r.startRowIndex === 16 && r.endRowIndex === 21) { r.endRowIndex = 22; touched = true; }
      });
    };
    (bc.domains || []).forEach((d) => bump(d.domain));
    (bc.series || []).forEach((se) => bump(se.series));
    if (touched) chartReqs.push({ updateChartSpec: { chartId: c.chartId, spec: c.spec } });
  });
  if (chartReqs.length) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: chartReqs } });
  }
  console.log(`차트 ${chartReqs.length}개 범위 확장 (4본부 → 5본부)`);

  // ---------- 확인 ----------
  const after = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!C17:H24`, valueRenderOption: 'FORMATTED_VALUE',
  })).data.values || [];
  console.log('\n=== 적용 결과 ===');
  after.forEach((r, i) => console.log('R' + (17 + i) + ': ' + (r || []).map(String).join(' | ')));
  const kpi = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!C3:F4`, valueRenderOption: 'FORMATTED_VALUE',
  })).data.values || [];
  console.log('상단 KPI: ' + JSON.stringify(kpi));
  const g2 = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!K4:AI5`, valueRenderOption: 'FORMATTED_VALUE',
  })).data.values || [];
  console.log('일별표 헤더: ' + JSON.stringify(g2));
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; });
