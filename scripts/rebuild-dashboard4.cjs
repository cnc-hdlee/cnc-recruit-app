/* 대시보드 정렬형 — 2열 카드 + 가운데 여백 + 좌우 끝선 L열 정렬 + 섹션 빈행 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const RAW = '생산직 RAW DATA';
const Q = "'" + RAW + "'!";
const SID = 1;
const TOTAL = `COUNTA(${Q}I2:I)`;

const NAVY = { red: 0.121, green: 0.227, blue: 0.388 };
const HEADG = { red: 0.886, green: 0.910, blue: 0.949 };
const WHITE = { red: 1, green: 1, blue: 1 };
const DK = { red: 0.12, green: 0.16, blue: 0.23 };
const ACC = { red: 0.27, green: 0.45, blue: 0.77 };
const ROWALT = { red: 0.973, green: 0.980, blue: 0.990 };
const LGREEN = { red: 0.870, green: 0.937, blue: 0.866 };
const LRED = { red: 0.984, green: 0.886, blue: 0.886 };
const BORDC = { red: 0.82, green: 0.85, blue: 0.89 };
const OUT = { red: 0.36, green: 0.42, blue: 0.52 };
const GRAYT = { red: 0.42, green: 0.45, blue: 0.50 };

const A1c = (c) => { let s = '', n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  // 전사인원현황 미충원(직접) → 팀별 미충원
  const TO = {};
  try {
    const src = await sheets.spreadsheets.values.get({ spreadsheetId: '1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY', range: '★전사인원현황!B3:P210' });
    const want = ['생산1팀', '생산2팀', '생산3팀', '생산4팀'];
    (src.data.values || []).forEach(row => {
      const team = (row[0] || '').trim(), gubun = (row[1] || '').trim();
      const mi = Number(String(row[14] || '0').replace(/[^0-9.-]/g, '')) || 0;
      if (want.includes(team) && gubun === '직접') TO[team] = (TO[team] || 0) + mi;
    });
  } catch (e) { console.error('미충원 fetch warn:', e.message); }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [
    { updateSheetProperties: { properties: { sheetId: SID, gridProperties: { columnCount: 14, rowCount: 90 } }, fields: 'gridProperties.columnCount,gridProperties.rowCount' } },
    { unmergeCells: { range: { sheetId: SID, startRowIndex: 0, endRowIndex: 90, startColumnIndex: 0, endColumnIndex: 14 } } },
    { updateCells: { range: { sheetId: SID, startRowIndex: 0, endRowIndex: 90, startColumnIndex: 0, endColumnIndex: 14 }, fields: 'userEnteredFormat,userEnteredValue' } },
  ] } });

  const vd = [], rq = [], gapRows = [];
  const put = (r, c, v) => vd.push({ range: `대시보드!${A1c(c)}${r + 1}`, values: [[v]] });
  const merge = (r0, r1, c0, c1) => rq.push({ mergeCells: { mergeType: 'MERGE_ALL', range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 } } });
  const cell = (r0, r1, c0, c1, f) => rq.push({ repeatCell: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: f }, fields: 'userEnteredFormat' } });
  const fmt = (fg, bg, size, bold, align) => ({ backgroundColor: bg || WHITE, horizontalAlignment: align || 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'OVERFLOW_CELL', textFormat: { foregroundColor: fg || DK, bold: !!bold, fontSize: size || 10, fontFamily: 'Arial' } });
  const numF = (r0, r1, c0, c1, pat) => rq.push({ repeatCell: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: { type: pat.indexOf('%') >= 0 ? 'PERCENT' : 'NUMBER', pattern: pat } } }, fields: 'userEnteredFormat.numberFormat' } });
  const border = (r0, r1, c0, c1) => rq.push({ updateBorders: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, top: { style: 'SOLID_MEDIUM', color: OUT }, bottom: { style: 'SOLID_MEDIUM', color: OUT }, left: { style: 'SOLID_MEDIUM', color: OUT }, right: { style: 'SOLID_MEDIUM', color: OUT }, innerHorizontal: { style: 'SOLID', color: BORDC }, innerVertical: { style: 'SOLID', color: BORDC } } });

  const RIGHT = 12; // 모든 박스 우측 끝 (열 L = index 11, exclusive 12)
  let R = 1;

  // ── 제목
  put(R, 1, '생산직 외국인 근로자 채용 현황          생산1~4팀 · 단위: 명');
  merge(R, R + 1, 1, RIGHT); cell(R, R + 1, 1, RIGHT, fmt(DK, WHITE, 15, true, 'LEFT'));
  R += 1; gapRows.push(R); R += 1;

  // ── KPI 5타일 (좌우 끝선 정렬: B..L)
  const kpiCols = [[1, 3], [3, 5], [5, 7], [7, 9], [9, 12]];
  const kpis = [
    ['총 지원자', `=${TOTAL}`, '0'],
    ['실제 입사', `=COUNTIF(${Q}W2:W,"입사")`, '0'],
    ['진행중', `=COUNTIF(${Q}W2:W,"진행중")`, '0'],
    ['채용 달성율', `=IFERROR(COUNTIF(${Q}W2:W,"입사")/$K$${0}`, '0.0%'], // K합계 자리 아래서 보정
    ['평균 소요일', `=IFERROR(ROUND(AVERAGE(${Q}AC2:AC),1),0)`, '0.0'],
  ];
  const kpiLabelRow = R, kpiValRow = R + 1;
  R += 2; gapRows.push(R); R += 1;

  // ── 팀별 매트릭스 (B..L) — 미충원/달성율 포함
  const mTop = R;
  put(R, 1, '  팀별 채용 현황   ·   미충원 = 전사인원현황(직접)');
  merge(R, R + 1, 1, RIGHT); cell(R, R + 1, 1, RIGHT, fmt(WHITE, NAVY, 11, true, 'LEFT')); R += 1;
  ['팀', '근무지', '지원', '서류', '면접', '검진', '입사', '진행', '탈락', '미충원', '달성율'].forEach((h, i) => put(R, 1 + i, h));
  cell(R, R + 1, 1, RIGHT, fmt(WHITE, NAVY, 10, true, 'CENTER')); R += 1;
  const teams = [['생산1팀', '퍼플'], ['생산2팀', '그린'], ['생산3팀', '3공장'], ['생산4팀', '그린']];
  const tFirst = R;
  teams.forEach(([t, site]) => {
    put(R, 1, t); put(R, 2, site);
    put(R, 3, `=COUNTIF(${Q}E2:E,"${t}")`);
    put(R, 4, `=COUNTIFS(${Q}E2:E,"${t}",${Q}S2:S,"합격")`);
    put(R, 5, `=COUNTIFS(${Q}E2:E,"${t}",${Q}T2:T,"합격")`);
    put(R, 6, `=COUNTIFS(${Q}E2:E,"${t}",${Q}V2:V,"적합")`);
    put(R, 7, `=COUNTIFS(${Q}E2:E,"${t}",${Q}W2:W,"입사")`);
    put(R, 8, `=COUNTIFS(${Q}E2:E,"${t}",${Q}W2:W,"진행중")`);
    put(R, 9, `=COUNTIFS(${Q}E2:E,"${t}",${Q}W2:W,"탈락")`);
    put(R, 10, TO[t] || 0);
    put(R, 11, `=IFERROR(H${R + 1}/K${R + 1},0)`);
    R += 1;
  });
  const sumRow = R;
  put(R, 1, '합계');
  for (let c = 3; c <= 10; c++) put(R, c, `=SUM(${A1c(c)}${tFirst + 1}:${A1c(c)}${sumRow})`);
  put(R, 11, `=IFERROR(H${sumRow + 1}/K${sumRow + 1},0)`);
  R += 1;
  // 매트릭스 서식
  cell(tFirst, sumRow, 1, RIGHT, fmt(DK, WHITE, 10, false, 'CENTER'));
  cell(tFirst, sumRow, 1, 2, fmt(DK, WHITE, 10, true, 'LEFT'));
  cell(tFirst, sumRow, 7, 8, fmt({ red: 0.05, green: 0.35, blue: 0.05 }, LGREEN, 10, true, 'CENTER'));
  cell(tFirst, sumRow, 9, 10, fmt({ red: 0.6, green: 0, blue: 0.02 }, LRED, 10, false, 'CENTER'));
  cell(tFirst, sumRow, 10, 11, fmt({ red: 0.1, green: 0.2, blue: 0.5 }, { red: 0.90, green: 0.93, blue: 0.99 }, 10, true, 'CENTER'));
  cell(sumRow, sumRow + 1, 1, RIGHT, fmt(NAVY, HEADG, 10, true, 'CENTER'));
  cell(sumRow, sumRow + 1, 1, 2, fmt(NAVY, HEADG, 10, true, 'LEFT'));
  numF(tFirst, sumRow + 1, 11, 12, '0%');
  border(mTop, sumRow + 1, 1, RIGHT);
  // 달성율 조건부 (미충원 합계 K행 = sumRow+1)
  const kCell = `$K$${sumRow + 1}`;
  kpis[3][1] = `=IFERROR(COUNTIF(${Q}W2:W,"입사")/${kCell},0)`;
  const kR = [{ sheetId: SID, startRowIndex: tFirst, endRowIndex: sumRow, startColumnIndex: 11, endColumnIndex: 12 }];
  rq.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kR, booleanRule: { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '0.5' }] }, format: { backgroundColor: { red: 0.78, green: 0.91, blue: 0.75 }, textFormat: { foregroundColor: { red: 0.05, green: 0.35, blue: 0.05 }, bold: true } } } } } });
  rq.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kR, booleanRule: { condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0.3' }] }, format: { backgroundColor: { red: 0.99, green: 0.83, blue: 0.83 }, textFormat: { foregroundColor: { red: 0.61, green: 0, blue: 0.02 } } } } } } });

  // KPI 기입(매트릭스 합계행 확정 후)
  kpis.forEach((k, i) => {
    const [c0, c1] = kpiCols[i];
    put(kpiLabelRow, c0, k[0]); put(kpiValRow, c0, k[1]);
    merge(kpiLabelRow, kpiLabelRow + 1, c0, c1); merge(kpiValRow, kpiValRow + 1, c0, c1);
    cell(kpiLabelRow, kpiLabelRow + 1, c0, c1, fmt(WHITE, ACC, 10, true, 'CENTER'));
    cell(kpiValRow, kpiValRow + 1, c0, c1, fmt(NAVY, HEADG, 20, true, 'CENTER'));
    numF(kpiValRow, kpiValRow + 1, c0, c1, k[2]);
    border(kpiLabelRow, kpiValRow + 1, c0, c1);
  });

  // ── 분포 카드 (2열: 좌 sc=1[B..F], 우 sc=7[H..L], 가운데 G열 여백)
  const cif = (col, v) => `COUNTIF(${Q}${col}2:${col},"${v}")`;
  const card = (top, sc, title, items) => {
    const labEnd = sc + 3, cnt = sc + 3, pct = sc + 4, end = sc + 5;
    put(top, sc, ' ' + title); merge(top, top + 1, sc, end); cell(top, top + 1, sc, end, fmt(WHITE, NAVY, 10, true, 'LEFT'));
    put(top + 1, sc, '구분'); put(top + 1, cnt, '인원'); put(top + 1, pct, '비중');
    merge(top + 1, top + 2, sc, labEnd); cell(top + 1, top + 2, sc, end, fmt(DK, HEADG, 10, true, 'CENTER'));
    cell(top + 1, top + 2, sc, labEnd, fmt(DK, HEADG, 10, true, 'LEFT'));
    items.forEach((it, i) => {
      const r = top + 2 + i, bg = i % 2 ? ROWALT : WHITE;
      put(r, sc, it[0]); put(r, cnt, it[1]); put(r, pct, `=IFERROR(${A1c(cnt)}${r + 1}/${TOTAL},0)`);
      merge(r, r + 1, sc, labEnd);
      cell(r, r + 1, sc, labEnd, fmt(DK, bg, 10, false, 'LEFT'));
      cell(r, r + 1, cnt, pct, fmt(DK, bg, 10, true, 'CENTER'));
      cell(r, r + 1, pct, end, fmt(GRAYT, bg, 10, false, 'CENTER'));
      numF(r, r + 1, pct, end, '0.0%');
    });
    border(top, top + 2 + items.length, sc, end);
    return top + 2 + items.length;
  };
  const natK = ['베트남', '중국', '우즈베키스탄', '캄보디아', '네팔', '필리핀', '태국'];
  const band = (left, right) => {
    gapRows.push(R); R += 1;
    const top = R;
    const b1 = card(top, 1, left[0], left[1]);
    const b2 = card(top, 7, right[0], right[1]);
    R = Math.max(b1, b2);
  };
  band(
    ['센터지역 (일자리센터)', [['화성', `=${cif('Q', '화성')}`], ['오산', `=${cif('Q', '오산')}`], ['수원', `=${cif('Q', '수원')}`], ['안성', `=${cif('Q', '안성')}`], ['용인', `=${cif('Q', '용인')}`], ['기타', `=${cif('Q', '기타')}`]]],
    ['유입경로', [['일자리센터', `=${cif('P', '일자리센터')}`], ['지인추천', `=${cif('P', '지인추천')}`], ['직접지원(방문)', `=${cif('P', '직접지원(방문)')}`], ['에이전시', `=${cif('P', '에이전시')}`], ['자사공고', `=${cif('P', '자사공고')}`], ['기타', `=${cif('P', '기타')}`]]]
  );
  band(
    ['국적', [...natK.map(n => [n, `=${cif('M', n)}`]), ['기타', `=${TOTAL}-(${natK.map(n => cif('M', n)).join('+')})`]]],
    ['체류자격 (F 비자)', [['F-2 거주', `=${cif('N', 'F-2(거주)')}`], ['F-4 재외동포', `=${cif('N', 'F-4(재외동포)')}`], ['F-5 영주', `=${cif('N', 'F-5(영주)')}`], ['F-6 결혼이민', `=${cif('N', 'F-6(결혼이민)')}`]]]
  );
  band(
    ['단계별 퍼널', [['접수', `=COUNTIF(${Q}R2:R,"<>")`], ['서류 합격', `=${cif('S', '합격')}`], ['면접 합격', `=${cif('T', '합격')}`], ['건강검진', `=${cif('V', '적합')}`], ['최종 입사', `=${cif('W', '입사')}`]]],
    ['채용유형', [['결원', `=${cif('G', '결원')}`], ['신규', `=${cif('G', '신규')}`], ['대체', `=${cif('G', '대체')}`], ['충원', `=${cif('G', '충원')}`]]]
  );
  const lastRow = R;

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SS_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: vd } });

  // 열너비 (A 여백 / B..L 본문 / G 가운데여백)
  const W = [22, 84, 58, 58, 54, 60, 40, 84, 58, 58, 54, 60];
  W.forEach((px, i) => rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
  // 행높이: 기본 24 / 제목 30 / KPI값 38 / 섹션 빈행 10
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: 0, endIndex: lastRow + 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } });
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } });
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: kpiValRow, endIndex: kpiValRow + 1 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } });
  gapRows.forEach(gr => rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: gr, endIndex: gr + 1 }, properties: { pixelSize: 10 }, fields: 'pixelSize' } }));
  rq.push({ updateSheetProperties: { properties: { sheetId: SID, gridProperties: { hideGridlines: true } }, fields: 'gridProperties.hideGridlines' } });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: rq } });
  console.log('OK lastRow=' + lastRow);
}
main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
