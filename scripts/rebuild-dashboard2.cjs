/* 대시보드 가로형 재구성 — 카드 그리드, 글자 안잘림, 깔끔한 업무용 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const RAW = '생산직 RAW DATA';
const Q = "'" + RAW + "'!";
const SID = 1;
const TOTAL = `COUNTA(${Q}I2:I)`;

// 색
const NAVY = { red: 0.121, green: 0.227, blue: 0.388 };
const BAND = { red: 0.949, green: 0.961, blue: 0.976 };
const HEADG = { red: 0.886, green: 0.910, blue: 0.949 };
const WHITE = { red: 1, green: 1, blue: 1 };
const DK = { red: 0.12, green: 0.16, blue: 0.23 };
const ACC = { red: 0.27, green: 0.45, blue: 0.77 };
const ROWALT = { red: 0.972, green: 0.980, blue: 0.990 };
const LGREEN = { red: 0.870, green: 0.937, blue: 0.866 };
const LRED = { red: 0.984, green: 0.886, blue: 0.886 };
const BORDC = { red: 0.80, green: 0.83, blue: 0.87 };
const GRAYT = { red: 0.42, green: 0.45, blue: 0.50 };

const A1c = (c) => { let s = '', n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  // 초기화: 병합해제 + 값/서식 리셋
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [
    { unmergeCells: { range: { sheetId: SID, startRowIndex: 0, endRowIndex: 80, startColumnIndex: 0, endColumnIndex: 14 } } },
    { updateCells: { range: { sheetId: SID, startRowIndex: 0, endRowIndex: 80, startColumnIndex: 0, endColumnIndex: 14 }, fields: 'userEnteredFormat,userEnteredValue' } },
  ] } });

  const vd = [];   // 값
  const rq = [];   // 서식/병합/테두리
  const put = (r, c, v) => vd.push({ range: `대시보드!${A1c(c)}${r + 1}`, values: [[v]] });
  const merge = (r0, r1, c0, c1) => rq.push({ mergeCells: { mergeType: 'MERGE_ALL', range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 } } });
  const cell = (r0, r1, c0, c1, f) => rq.push({ repeatCell: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: f }, fields: 'userEnteredFormat' } });
  const fmt = (fg, bg, size, bold, align) => ({ backgroundColor: bg || WHITE, horizontalAlignment: align || 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'OVERFLOW_CELL', textFormat: { foregroundColor: fg || DK, bold: !!bold, fontSize: size || 10, fontFamily: 'Arial' } });
  const numF = (r0, r1, c0, c1, pat) => rq.push({ repeatCell: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: { type: pat.indexOf('%') >= 0 ? 'PERCENT' : 'NUMBER', pattern: pat } } }, fields: 'userEnteredFormat.numberFormat' } });
  const border = (r0, r1, c0, c1) => rq.push({ updateBorders: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
    top: { style: 'SOLID', color: BORDC }, bottom: { style: 'SOLID', color: BORDC }, left: { style: 'SOLID', color: BORDC }, right: { style: 'SOLID', color: BORDC },
    innerHorizontal: { style: 'SOLID', color: BORDC }, innerVertical: { style: 'SOLID', color: BORDC } } });

  // ── 제목
  put(1, 1, '생산직 외국인 근로자 채용 현황');
  merge(1, 2, 1, 11); cell(1, 2, 1, 11, fmt(DK, WHITE, 17, true, 'LEFT'));
  put(2, 1, '생산1팀 · 생산2팀 · 생산3팀 · 생산4팀          (단위: 명)');
  merge(2, 3, 1, 11); cell(2, 3, 1, 11, fmt(GRAYT, WHITE, 10, false, 'LEFT'));

  // ── KPI (5타일, 각 2열 병합)
  const kpis = [
    ['총 지원자', `=${TOTAL}`, '0'],
    ['실제 입사', `=COUNTIF(${Q}U2:U,"입사")`, '0'],
    ['진행중', `=COUNTIF(${Q}U2:U,"진행중")`, '0'],
    ['채용 달성율', `=IFERROR(COUNTIF(${Q}U2:U,"입사")/${TOTAL},0)`, '0.0%'],
    ['평균 소요일', `=IFERROR(ROUND(AVERAGE(${Q}AA2:AA),1),0)`, '0.0'],
  ];
  kpis.forEach((k, i) => {
    const c0 = 1 + i * 2, c1 = c0 + 2;
    put(4, c0, k[0]); put(5, c0, k[1]);
    merge(4, 5, c0, c1); merge(5, 6, c0, c1);
    cell(4, 5, c0, c1, fmt(WHITE, ACC, 10, true, 'CENTER'));
    cell(5, 6, c0, c1, fmt(NAVY, HEADG, 17, true, 'CENTER'));
    numF(5, 6, c0, c1, k[2]);
    border(4, 6, c0, c1);
  });

  // ── 팀별 매트릭스
  put(7, 1, '팀별 채용 현황');
  merge(7, 8, 1, 11); cell(7, 8, 1, 11, fmt(DK, WHITE, 12, true, 'LEFT'));
  const mh = ['팀', '근무지', '지원', '서류', '면접', '검진', '입사', '진행', '탈락', '달성율'];
  mh.forEach((h, i) => put(8, 1 + i, h));
  cell(8, 9, 1, 11, fmt(WHITE, NAVY, 10, true, 'CENTER'));
  const teams = [['생산1팀', '퍼플'], ['생산2팀', '그린'], ['생산3팀', '3공장'], ['생산4팀', '그린']];
  teams.forEach(([t, site], i) => {
    const r = 9 + i;
    put(r, 1, t); put(r, 2, site);
    put(r, 3, `=COUNTIF(${Q}E2:E,"${t}")`);
    put(r, 4, `=COUNTIFS(${Q}E2:E,"${t}",${Q}Q2:Q,"합격")`);
    put(r, 5, `=COUNTIFS(${Q}E2:E,"${t}",${Q}R2:R,"합격")`);
    put(r, 6, `=COUNTIFS(${Q}E2:E,"${t}",${Q}T2:T,"적합")`);
    put(r, 7, `=COUNTIFS(${Q}E2:E,"${t}",${Q}U2:U,"입사")`);
    put(r, 8, `=COUNTIFS(${Q}E2:E,"${t}",${Q}U2:U,"진행중")`);
    put(r, 9, `=COUNTIFS(${Q}E2:E,"${t}",${Q}U2:U,"탈락")`);
    put(r, 10, `=IFERROR(H${r + 1}/D${r + 1},0)`);
  });
  put(13, 1, '합계'); put(13, 2, '');
  for (let c = 3; c <= 9; c++) put(13, c, `=SUM(${A1c(c)}10:${A1c(c)}13)`);
  put(13, 10, '=IFERROR(H14/D14,0)');
  // 매트릭스 본문 서식 (강조는 마지막에 적용 — 덮임 방지)
  cell(9, 13, 1, 11, fmt(DK, WHITE, 10, false, 'CENTER'));   // 본문 기본
  cell(9, 13, 1, 2, fmt(DK, WHITE, 10, true, 'LEFT'));       // 팀명 왼쪽굵게
  cell(9, 13, 7, 8, fmt({ red: 0.05, green: 0.35, blue: 0.05 }, LGREEN, 10, true, 'CENTER'));  // 입사 강조
  cell(9, 13, 9, 10, fmt({ red: 0.6, green: 0, blue: 0.02 }, LRED, 10, false, 'CENTER'));      // 탈락 강조
  cell(13, 14, 1, 11, fmt(NAVY, HEADG, 10, true, 'CENTER')); // 합계
  cell(13, 14, 1, 2, fmt(NAVY, HEADG, 10, true, 'LEFT'));
  numF(9, 14, 10, 11, '0%');
  border(8, 14, 1, 11);
  // 달성율 조건부
  const kR = [{ sheetId: SID, startRowIndex: 9, endRowIndex: 13, startColumnIndex: 10, endColumnIndex: 11 }];
  rq.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kR, booleanRule: { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '0.5' }] }, format: { backgroundColor: { red: 0.78, green: 0.91, blue: 0.75 }, textFormat: { foregroundColor: { red: 0.05, green: 0.35, blue: 0.05 }, bold: true } } } } } });
  rq.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kR, booleanRule: { condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0.3' }] }, format: { backgroundColor: { red: 0.99, green: 0.83, blue: 0.83 }, textFormat: { foregroundColor: { red: 0.61, green: 0, blue: 0.02 } } } } } } });

  // ── 분포 카드 (2열 그리드)  card = 라벨(2열병합) + 인원 + 비중
  const cif = (col, v) => `COUNTIF(${Q}${col}2:${col},"${v}")`;
  const card = (top, startCol, title, items) => {
    const lc = startCol, cnt = startCol + 2, pct = startCol + 3, end = startCol + 4;
    // 제목
    put(top, lc, title); merge(top, top + 1, lc, end); cell(top, top + 1, lc, end, fmt(WHITE, NAVY, 11, true, 'LEFT'));
    // 헤더
    put(top + 1, lc, '구분'); put(top + 1, cnt, '인원'); put(top + 1, pct, '비중');
    merge(top + 1, top + 2, lc, cnt); cell(top + 1, top + 2, lc, end, fmt(DK, HEADG, 10, true, 'CENTER'));
    cell(top + 1, top + 2, lc, cnt, fmt(DK, HEADG, 10, true, 'LEFT'));
    items.forEach((it, i) => {
      const r = top + 2 + i;
      put(r, lc, it[0]); put(r, cnt, it[1]); put(r, pct, `=IFERROR(${A1c(cnt)}${r + 1}/${TOTAL},0)`);
      merge(r, r + 1, lc, cnt);
      const bg = i % 2 ? ROWALT : WHITE;
      cell(r, r + 1, lc, cnt, fmt(DK, bg, 10, false, 'LEFT'));
      cell(r, r + 1, cnt, pct, fmt(DK, bg, 10, true, 'CENTER'));
      cell(r, r + 1, pct, end, fmt(GRAYT, bg, 10, false, 'CENTER'));
      numF(r, r + 1, pct, end, '0.0%');
    });
    border(top + 1, top + 2 + items.length, lc, end);
    return top + 2 + items.length;
  };
  const LC = 1, RC = 5; // 좌카드 B.., 우카드 F..
  let band = 16;
  let l = card(band, LC, '유입 센터지역 (일자리센터)', [
    ['화성', `=${cif('O', '화성')}`], ['오산', `=${cif('O', '오산')}`], ['수원', `=${cif('O', '수원')}`],
    ['안성', `=${cif('O', '안성')}`], ['용인', `=${cif('O', '용인')}`], ['기타', `=${cif('O', '기타')}`]]);
  let r1 = card(band, RC, '유입경로', [
    ['일자리센터', `=${cif('N', '일자리센터')}`], ['지인추천', `=${cif('N', '지인추천')}`], ['직접지원(방문)', `=${cif('N', '직접지원(방문)')}`],
    ['에이전시', `=${cif('N', '에이전시')}`], ['자사공고', `=${cif('N', '자사공고')}`], ['기타', `=${cif('N', '기타')}`]]);
  band = Math.max(l, r1) + 2;
  const natK = ['베트남', '중국', '우즈베키스탄', '캄보디아', '네팔', '필리핀', '태국'];
  l = card(band, LC, '국적', [...natK.map(n => [n, `=${cif('K', n)}`]), ['기타', `=${TOTAL}-(${natK.map(n => cif('K', n)).join('+')})`]]);
  r1 = card(band, RC, '체류자격 (F 비자)', [
    ['F-2 거주', `=${cif('L', 'F-2(거주)')}`], ['F-4 재외동포', `=${cif('L', 'F-4(재외동포)')}`],
    ['F-5 영주', `=${cif('L', 'F-5(영주)')}`], ['F-6 결혼이민', `=${cif('L', 'F-6(결혼이민)')}`]]);
  band = Math.max(l, r1) + 2;
  l = card(band, LC, '채용 단계별 퍼널', [
    ['접수', `=COUNTIF(${Q}P2:P,"<>")`], ['서류 합격', `=${cif('Q', '합격')}`], ['면접 합격', `=${cif('R', '합격')}`],
    ['건강검진 적합', `=${cif('T', '적합')}`], ['최종 입사', `=${cif('U', '입사')}`]]);
  r1 = card(band, RC, '채용유형', [
    ['결원', `=${cif('G', '결원')}`], ['신규', `=${cif('G', '신규')}`], ['대체', `=${cif('G', '대체')}`], ['충원', `=${cif('G', '충원')}`]]);
  const lastRow = Math.max(l, r1);

  // 값 입력
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SS_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: vd } });

  // 열너비 + 행높이
  const W = [24, 96, 72, 58, 58, 96, 72, 58, 66, 58, 70];
  W.forEach((px, i) => rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: 0, endIndex: lastRow + 2 }, properties: { pixelSize: 23 }, fields: 'pixelSize' } });
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } });
  rq.push({ updateSheetProperties: { properties: { sheetId: SID, gridProperties: { hideGridlines: true } }, fields: 'gridProperties.hideGridlines' } });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: rq } });
  console.log('OK lastRow=' + lastRow);
}
main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
