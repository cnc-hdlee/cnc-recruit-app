/* 대시보드 한 화면 압축 — 3열 카드 그리드 (나이추가/F비자/이력서삭제 반영) */
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
const ROWALT = { red: 0.972, green: 0.980, blue: 0.990 };
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

  // 전사인원현황 미충원(직접) 실시간 읽어 팀별 미충원으로 기입 (재실행 시 갱신)
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
  console.log('미충원(직접)=', JSON.stringify(TO));
  // 미사용 _src 숨김탭 정리
  try {
    const m = await sheets.spreadsheets.get({ spreadsheetId: SS_ID, fields: 'sheets(properties(sheetId,title))' });
    const sx = m.data.sheets.find(s => s.properties.title === '_src');
    if (sx) await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [{ deleteSheet: { sheetId: sx.properties.sheetId } }] } });
  } catch (e) {}

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [
    { updateSheetProperties: { properties: { sheetId: SID, gridProperties: { columnCount: 14, rowCount: 80 } }, fields: 'gridProperties.columnCount,gridProperties.rowCount' } },
    { unmergeCells: { range: { sheetId: SID, startRowIndex: 0, endRowIndex: 80, startColumnIndex: 0, endColumnIndex: 14 } } },
    { updateCells: { range: { sheetId: SID, startRowIndex: 0, endRowIndex: 80, startColumnIndex: 0, endColumnIndex: 14 }, fields: 'userEnteredFormat,userEnteredValue' } },
  ] } });

  const vd = [], rq = [];
  const put = (r, c, v) => vd.push({ range: `대시보드!${A1c(c)}${r + 1}`, values: [[v]] });
  const merge = (r0, r1, c0, c1) => rq.push({ mergeCells: { mergeType: 'MERGE_ALL', range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 } } });
  const cell = (r0, r1, c0, c1, f) => rq.push({ repeatCell: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: f }, fields: 'userEnteredFormat' } });
  const fmt = (fg, bg, size, bold, align) => ({ backgroundColor: bg || WHITE, horizontalAlignment: align || 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'OVERFLOW_CELL', textFormat: { foregroundColor: fg || DK, bold: !!bold, fontSize: size || 11, fontFamily: 'Arial' } });
  const numF = (r0, r1, c0, c1, pat) => rq.push({ repeatCell: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: { type: pat.indexOf('%') >= 0 ? 'PERCENT' : 'NUMBER', pattern: pat } } }, fields: 'userEnteredFormat.numberFormat' } });
  // 외곽선 굵게(SOLID_MEDIUM, 진한색) + 내부선 얇게(연한색)
  const border = (r0, r1, c0, c1) => rq.push({ updateBorders: { range: { sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, top: { style: 'SOLID_MEDIUM', color: OUT }, bottom: { style: 'SOLID_MEDIUM', color: OUT }, left: { style: 'SOLID_MEDIUM', color: OUT }, right: { style: 'SOLID_MEDIUM', color: OUT }, innerHorizontal: { style: 'SOLID', color: BORDC }, innerVertical: { style: 'SOLID', color: BORDC } } });

  // 제목
  put(1, 1, '생산직 외국인 근로자 채용 현황          생산1~4팀  ·  단위: 명');
  merge(1, 2, 1, 13); cell(1, 2, 1, 13, fmt(DK, WHITE, 16, true, 'LEFT'));

  // KPI 5타일 (B:C,D:E,F:G,H:I,J:K)
  const kpis = [
    ['총 지원자', `=${TOTAL}`, '0'],
    ['실제 입사', `=COUNTIF(${Q}W2:W,"입사")`, '0'],
    ['진행중', `=COUNTIF(${Q}W2:W,"진행중")`, '0'],
    ['채용 달성율', `=IFERROR(COUNTIF(${Q}W2:W,"입사")/$K$13,0)`, '0.0%'],
    ['평균 소요일', `=IFERROR(ROUND(AVERAGE(${Q}AC2:AC),1),0)`, '0.0'],
  ];
  kpis.forEach((k, i) => {
    const c0 = 1 + i * 2, c1 = c0 + 2;
    put(3, c0, k[0]); put(4, c0, k[1]);
    merge(3, 4, c0, c1); merge(4, 5, c0, c1);
    cell(3, 4, c0, c1, fmt(WHITE, ACC, 11, true, 'CENTER'));
    cell(4, 5, c0, c1, fmt(NAVY, HEADG, 22, true, 'CENTER'));
    numF(4, 5, c0, c1, k[2]);
    border(3, 5, c0, c1);
  });

  // 팀별 매트릭스 (B~L)  목표(TO)=전사인원현황 미충원(직접)
  put(6, 1, '   팀별 채용 현황   ·   미충원 = 전사인원현황 자동연동(직접)');
  merge(6, 7, 1, 12); cell(6, 7, 1, 12, fmt(WHITE, NAVY, 11, true, 'LEFT'));
  ['팀', '근무지', '지원', '서류', '면접', '검진', '입사', '진행', '탈락', '미충원', '달성율'].forEach((h, i) => put(7, 1 + i, h));
  cell(7, 8, 1, 12, fmt(WHITE, NAVY, 11, true, 'CENTER'));
  const teams = [['생산1팀', '퍼플'], ['생산2팀', '그린'], ['생산3팀', '3공장'], ['생산4팀', '그린']];
  teams.forEach(([t, site], i) => {
    const r = 8 + i;
    put(r, 1, t); put(r, 2, site);
    put(r, 3, `=COUNTIF(${Q}E2:E,"${t}")`);
    put(r, 4, `=COUNTIFS(${Q}E2:E,"${t}",${Q}S2:S,"합격")`);
    put(r, 5, `=COUNTIFS(${Q}E2:E,"${t}",${Q}T2:T,"합격")`);
    put(r, 6, `=COUNTIFS(${Q}E2:E,"${t}",${Q}V2:V,"적합")`);
    put(r, 7, `=COUNTIFS(${Q}E2:E,"${t}",${Q}W2:W,"입사")`);
    put(r, 8, `=COUNTIFS(${Q}E2:E,"${t}",${Q}W2:W,"진행중")`);
    put(r, 9, `=COUNTIFS(${Q}E2:E,"${t}",${Q}W2:W,"탈락")`);
    put(r, 10, TO[t] || 0);
    put(r, 11, `=IFERROR(H${r + 1}/K${r + 1},0)`);
  });
  put(12, 1, '합계');
  for (let c = 3; c <= 10; c++) put(12, c, `=SUM(${A1c(c)}9:${A1c(c)}12)`);
  put(12, 11, '=IFERROR(H13/K13,0)');
  cell(8, 12, 1, 12, fmt(DK, WHITE, 11, false, 'CENTER'));
  cell(8, 12, 1, 2, fmt(DK, WHITE, 11, true, 'LEFT'));
  cell(8, 12, 7, 8, fmt({ red: 0.05, green: 0.35, blue: 0.05 }, LGREEN, 11, true, 'CENTER'));
  cell(8, 12, 9, 10, fmt({ red: 0.6, green: 0, blue: 0.02 }, LRED, 11, false, 'CENTER'));
  cell(8, 12, 10, 11, fmt({ red: 0.1, green: 0.2, blue: 0.5 }, { red: 0.90, green: 0.93, blue: 0.99 }, 11, true, 'CENTER'));
  cell(12, 13, 1, 12, fmt(NAVY, HEADG, 11, true, 'CENTER'));
  cell(12, 13, 1, 2, fmt(NAVY, HEADG, 11, true, 'LEFT'));
  numF(8, 13, 11, 12, '0%');
  border(6, 13, 1, 12);
  const kR = [{ sheetId: SID, startRowIndex: 8, endRowIndex: 12, startColumnIndex: 11, endColumnIndex: 12 }];
  rq.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kR, booleanRule: { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '0.5' }] }, format: { backgroundColor: { red: 0.78, green: 0.91, blue: 0.75 }, textFormat: { foregroundColor: { red: 0.05, green: 0.35, blue: 0.05 }, bold: true } } } } } });
  rq.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kR, booleanRule: { condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0.3' }] }, format: { backgroundColor: { red: 0.99, green: 0.83, blue: 0.83 }, textFormat: { foregroundColor: { red: 0.61, green: 0, blue: 0.02 } } } } } } });

  // 분포 3열 카드
  const cif = (col, v) => `COUNTIF(${Q}${col}2:${col},"${v}")`;
  const card = (top, sc, title, items) => {
    const lc = sc, cnt = sc + 2, pct = sc + 3, end = sc + 4;
    put(top, lc, ' ' + title); merge(top, top + 1, lc, end); cell(top, top + 1, lc, end, fmt(WHITE, NAVY, 11, true, 'LEFT'));
    put(top + 1, lc, '구분'); put(top + 1, cnt, '인원'); put(top + 1, pct, '비중');
    merge(top + 1, top + 2, lc, cnt); cell(top + 1, top + 2, lc, end, fmt(DK, HEADG, 11, true, 'CENTER'));
    cell(top + 1, top + 2, lc, cnt, fmt(DK, HEADG, 11, true, 'LEFT'));
    items.forEach((it, i) => {
      const r = top + 2 + i, bg = i % 2 ? ROWALT : WHITE;
      put(r, lc, it[0]); put(r, cnt, it[1]); put(r, pct, `=IFERROR(${A1c(cnt)}${r + 1}/${TOTAL},0)`);
      merge(r, r + 1, lc, cnt);
      cell(r, r + 1, lc, cnt, fmt(DK, bg, 11, false, 'LEFT'));
      cell(r, r + 1, cnt, pct, fmt(DK, bg, 11, true, 'CENTER'));
      cell(r, r + 1, pct, end, fmt(GRAYT, bg, 11, false, 'CENTER'));
      numF(r, r + 1, pct, end, '0.0%');
    });
    border(top, top + 2 + items.length, lc, end);
    return top + 2 + items.length;
  };
  const C1 = 1, C2 = 5, C3 = 9;
  const natK = ['베트남', '중국', '우즈베키스탄', '캄보디아', '네팔', '필리핀', '태국'];
  // band A
  let a1 = card(14, C1, '센터지역 (일자리센터)', [['화성', `=${cif('Q', '화성')}`], ['오산', `=${cif('Q', '오산')}`], ['수원', `=${cif('Q', '수원')}`], ['안성', `=${cif('Q', '안성')}`], ['용인', `=${cif('Q', '용인')}`], ['기타', `=${cif('Q', '기타')}`]]);
  let a2 = card(14, C2, '유입경로', [['일자리센터', `=${cif('P', '일자리센터')}`], ['지인추천', `=${cif('P', '지인추천')}`], ['직접지원(방문)', `=${cif('P', '직접지원(방문)')}`], ['에이전시', `=${cif('P', '에이전시')}`], ['자사공고', `=${cif('P', '자사공고')}`], ['기타', `=${cif('P', '기타')}`]]);
  let a3 = card(14, C3, '채용유형', [['결원', `=${cif('G', '결원')}`], ['신규', `=${cif('G', '신규')}`], ['대체', `=${cif('G', '대체')}`], ['충원', `=${cif('G', '충원')}`]]);
  const bandB = Math.max(a1, a2, a3) + 1;
  // band B
  let b1 = card(bandB, C1, '국적', [...natK.map(n => [n, `=${cif('M', n)}`]), ['기타', `=${TOTAL}-(${natK.map(n => cif('M', n)).join('+')})`]]);
  let b2 = card(bandB, C2, '체류자격 (F 비자)', [['F-2 거주', `=${cif('N', 'F-2(거주)')}`], ['F-4 재외동포', `=${cif('N', 'F-4(재외동포)')}`], ['F-5 영주', `=${cif('N', 'F-5(영주)')}`], ['F-6 결혼이민', `=${cif('N', 'F-6(결혼이민)')}`]]);
  let b3 = card(bandB, C3, '단계별 퍼널', [['접수', `=COUNTIF(${Q}R2:R,"<>")`], ['서류 합격', `=${cif('S', '합격')}`], ['면접 합격', `=${cif('T', '합격')}`], ['건강검진', `=${cif('V', '적합')}`], ['최종 입사', `=${cif('W', '입사')}`]]);
  let lastRow = Math.max(b1, b2, b3);

  // 미충원 자동연동 승인 안내 + 승인용 IMPORTRANGE 셀 (최초 1회 액세스 허용)
  const authR = lastRow + 2;
  put(authR, 1, '미충원 자동연동 : 우측 셀이 #REF 이면 클릭 → "액세스 허용" 1회 (이후 영구 자동)');
  merge(authR, authR + 1, 1, 9); cell(authR, authR + 1, 1, 9, fmt(GRAYT, WHITE, 9, false, 'LEFT'));
  put(authR, 9, `=IMPORTRANGE("${SRC}","★전사인원현황!P4")`);
  cell(authR, authR + 1, 9, 10, fmt(DK, { red: 1, green: 0.95, blue: 0.70 }, 10, true, 'CENTER'));
  border(authR, authR + 1, 9, 10);
  lastRow = authR;

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SS_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: vd } });

  // 열너비 (B~M) — 화면 꽉차게 넓게 + 행높이 넉넉히
  const W = [28, 158, 104, 96, 102, 158, 104, 96, 102, 158, 104, 96, 102];
  W.forEach((px, i) => rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: 0, endIndex: lastRow + 2 }, properties: { pixelSize: 27 }, fields: 'pixelSize' } });
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } });
  rq.push({ updateDimensionProperties: { range: { sheetId: SID, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } });
  rq.push({ updateSheetProperties: { properties: { sheetId: SID, gridProperties: { hideGridlines: true } }, fields: 'gridProperties.hideGridlines' } });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: rq } });
  console.log('OK lastRow=' + lastRow);
}
main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
