/* 대시보드 전면 재구성 — 생산1~4팀 팀별 매트릭스 중심 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const RAW = '생산직 RAW DATA';
const Q = "'" + RAW + "'!";
const DSID = 1; // 대시보드 sheetId

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  // 0) 행 수 먼저 확장 + 기존 값 전체 삭제
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: [
    { updateSheetProperties: { properties: { sheetId: DSID, gridProperties: { rowCount: 80 } }, fields: 'gridProperties.rowCount' } },
  ] } });
  await sheets.spreadsheets.values.clear({ spreadsheetId: SS_ID, range: '대시보드!A1:Z80' });

  const teams = ['생산1팀', '생산2팀', '생산3팀', '생산4팀'];
  const siteOf = { '생산1팀': '퍼플', '생산2팀': '그린', '생산3팀': '3공장', '생산4팀': '그린' };
  const cif = (col, v) => `COUNTIF(${Q}${col}2:${col},"${v}")`;
  const cifs = (team, col, v) => `=COUNTIFS(${Q}E2:E,"${team}",${Q}${col}2:${col},"${v}")`;

  const vd = [];
  vd.push({ range: '대시보드!B2', values: [['📊  생산직(외국인) 채용 대시보드 — 팀별']] });
  vd.push({ range: '대시보드!B3', values: [['생산1·2·3·4팀  /  RAW DATA 입력 시 자동 반영']] });

  // KPI (전사 합계)
  vd.push({ range: '대시보드!B5', values: [['총 지원자', '', '실제 입사', '', '진행중', '', '채용 달성율', '', '평균 소요일']] });
  vd.push({ range: '대시보드!B6', values: [[
    `=COUNTA(${Q}I2:I)`, '',
    `=COUNTIF(${Q}V2:V,"입사")`, '',
    `=COUNTIF(${Q}V2:V,"진행중")`, '',
    `=IFERROR(COUNTIF(${Q}V2:V,"입사")/COUNTA(${Q}I2:I),0)`, '',
    `=IFERROR(ROUND(AVERAGE(${Q}AB2:AB),1),0)`,
  ]] });

  // ===== 팀별 매트릭스 =====
  vd.push({ range: '대시보드!B8', values: [['🏭  팀별 채용 현황 (단계별)']] });
  vd.push({ range: '대시보드!B9', values: [['팀', '근무지', '지원', '서류', '면접', '검진', '입사', '진행', '탈락', '달성율']] });
  teams.forEach((t, i) => {
    const r = 10 + i;
    vd.push({ range: `대시보드!B${r}`, values: [[
      t, siteOf[t],
      `=COUNTIF(${Q}E2:E,"${t}")`,
      cifs(t, 'R', '합격'),
      cifs(t, 'S', '합격'),
      cifs(t, 'U', '적합'),
      cifs(t, 'V', '입사'),
      cifs(t, 'V', '진행중'),
      cifs(t, 'V', '탈락'),
      `=IFERROR(H${r}/D${r},0)`,
    ]] });
  });
  vd.push({ range: '대시보드!B14', values: [[
    '합계', '',
    '=SUM(D10:D13)', '=SUM(E10:E13)', '=SUM(F10:F13)', '=SUM(G10:G13)',
    '=SUM(H10:H13)', '=SUM(I10:I13)', '=SUM(J10:J13)', '=IFERROR(H14/D14,0)',
  ]] });

  // ===== 분포 (세로 스택) =====
  const headerRows = [];
  const block = (startRow, title, items) => {
    headerRows.push(startRow);
    vd.push({ range: `대시보드!B${startRow}`, values: [[title]] });
    items.forEach((it, i) => {
      const r = startRow + 1 + i;
      vd.push({ range: `대시보드!B${r}`, values: [[it[0]]] });
      vd.push({ range: `대시보드!C${r}`, values: [[it[1]]] });
      vd.push({ range: `대시보드!D${r}`, values: [[`=IF(C${r}=0,"",REPT("■",MIN(C${r},25)))`]] });
    });
    return startRow + 1 + items.length + 1;
  };
  let row = 17;
  row = block(row, '🏢  유입 센터지역별 (일자리센터)', [
    ['화성', `=${cif('O', '화성')}`], ['오산', `=${cif('O', '오산')}`], ['수원', `=${cif('O', '수원')}`],
    ['안성', `=${cif('O', '안성')}`], ['용인', `=${cif('O', '용인')}`], ['기타', `=${cif('O', '기타')}`],
  ]);
  row = block(row, '🔗  유입경로별', [
    ['일자리센터', `=${cif('N', '일자리센터')}`], ['지인추천', `=${cif('N', '지인추천')}`], ['직접지원(방문)', `=${cif('N', '직접지원(방문)')}`],
    ['에이전시', `=${cif('N', '에이전시')}`], ['자사공고', `=${cif('N', '자사공고')}`], ['기타', `=${cif('N', '기타')}`],
  ]);
  const natKnown = ['베트남', '중국', '우즈베키스탄', '캄보디아', '네팔', '필리핀', '태국'];
  row = block(row, '🌏  국적별', [
    ...natKnown.map(n => [n, `=${cif('K', n)}`]),
    ['기타', `=COUNTA(${Q}K2:K)-(${natKnown.map(n => cif('K', n)).join('+')})`],
  ]);
  row = block(row, '🛂  체류자격(비자)별', [
    ['E-9 비전문취업', `=${cif('L', 'E-9(비전문취업)')}`], ['H-2 방문취업', `=${cif('L', 'H-2(방문취업)')}`],
    ['F-4 재외동포', `=${cif('L', 'F-4(재외동포)')}`], ['F-5 영주', `=${cif('L', 'F-5(영주)')}`],
    ['F-6 결혼이민', `=${cif('L', 'F-6(결혼이민)')}`], ['E-7 특정활동', `=${cif('L', 'E-7(특정활동)')}`],
  ]);
  row = block(row, '📉  채용 단계별 퍼널', [
    ['접수', `=COUNTIF(${Q}Q2:Q,"<>")`], ['서류 합격', `=${cif('R', '합격')}`], ['면접 합격', `=${cif('S', '합격')}`],
    ['건강검진 적합', `=${cif('U', '적합')}`], ['최종 입사', `=${cif('V', '입사')}`],
  ]);
  row = block(row, '📋  채용유형별', [
    ['결원', `=${cif('G', '결원')}`], ['신규', `=${cif('G', '신규')}`], ['대체', `=${cif('G', '대체')}`], ['충원', `=${cif('G', '충원')}`],
  ]);
  const lastRow = row;

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SS_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: vd } });

  // ===== 서식 =====
  const reqs = [];
  const NAVY = { red: 0.122, green: 0.220, blue: 0.392 };
  const DK = { red: 0.122, green: 0.220, blue: 0.392 };
  const WHITE = { red: 1, green: 1, blue: 1 };
  const BLUE = { red: 0.27, green: 0.45, blue: 0.77 };
  const LBLUE = { red: 0.85, green: 0.88, blue: 0.95 };
  const LGRAY = { red: 0.93, green: 0.95, blue: 0.98 };
  const GRAY = { red: 0.6, green: 0.6, blue: 0.6 };
  const BLACK = { red: 0, green: 0, blue: 0 };
  const LGREEN = { red: 0.85, green: 0.94, blue: 0.83 };
  const LRED = { red: 1, green: 0.90, blue: 0.90 };

  const fmt = (r0, r1, c0, c1, o) => reqs.push({ repeatCell: {
    range: { sheetId: DSID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
    cell: { userEnteredFormat: Object.assign({ verticalAlignment: 'MIDDLE' }, o.f) }, fields: o.mask } });
  const txt = (r0, r1, c0, c1, fg, bold, size, align, bg) => fmt(r0, r1, c0, c1, {
    f: { textFormat: { foregroundColor: fg, bold: !!bold, fontSize: size }, horizontalAlignment: align || 'LEFT', backgroundColor: bg || WHITE },
    mask: 'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor,verticalAlignment)' });

  // 0) 전체 리셋(흰 배경/검정/기본)
  fmt(0, 80, 0, 12, { f: { backgroundColor: WHITE, textFormat: { foregroundColor: BLACK, bold: false, italic: false, fontSize: 10 }, horizontalAlignment: 'LEFT' }, mask: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' });

  // 제목/부제
  txt(1, 2, 1, 6, DK, true, 18);
  txt(2, 3, 1, 6, GRAY, false, 9);
  // KPI
  [1, 3, 5, 7, 9].forEach(c => { txt(4, 5, c, c + 1, WHITE, true, 10, 'CENTER', BLUE); txt(5, 6, c, c + 1, DK, true, 18, 'CENTER', LBLUE); });
  reqs.push({ repeatCell: { range: { sheetId: DSID, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } }, fields: 'userEnteredFormat.numberFormat' } });

  // 매트릭스
  txt(7, 8, 1, 11, DK, true, 12, 'LEFT', LGRAY);                 // 섹션 제목
  txt(8, 9, 1, 11, WHITE, true, 10, 'CENTER', NAVY);            // 헤더행 B9:K9
  txt(9, 13, 1, 11, BLACK, false, 10, 'CENTER');               // 팀 4행
  txt(9, 13, 1, 2, BLACK, true, 10, 'LEFT');                   // 팀명 왼쪽정렬 굵게
  txt(13, 14, 1, 11, DK, true, 10, 'CENTER', LBLUE);           // 합계행
  txt(13, 14, 1, 2, DK, true, 10, 'LEFT', LBLUE);
  // 입사/탈락 컬럼 강조 배경 (H=7, J=9) 팀행
  fmt(9, 13, 7, 8, { f: { backgroundColor: LGREEN }, mask: 'userEnteredFormat.backgroundColor' });
  fmt(9, 13, 9, 10, { f: { backgroundColor: LRED }, mask: 'userEnteredFormat.backgroundColor' });
  // 달성율 % + 조건부(K=10) 팀행 10~13
  reqs.push({ repeatCell: { range: { sheetId: DSID, startRowIndex: 9, endRowIndex: 14, startColumnIndex: 10, endColumnIndex: 11 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } }, fields: 'userEnteredFormat.numberFormat' } });
  const kRange = [{ sheetId: DSID, startRowIndex: 9, endRowIndex: 13, startColumnIndex: 10, endColumnIndex: 11 }];
  reqs.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kRange, booleanRule: { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: '0.5' }] }, format: { backgroundColor: { red: 0.78, green: 0.91, blue: 0.75 }, textFormat: { foregroundColor: { red: 0.05, green: 0.35, blue: 0.05 }, bold: true } } } } } });
  reqs.push({ addConditionalFormatRule: { index: 0, rule: { ranges: kRange, booleanRule: { condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0.3' }] }, format: { backgroundColor: { red: 1, green: 0.80, blue: 0.81 }, textFormat: { foregroundColor: { red: 0.61, green: 0, blue: 0.02 } } } } } } });

  // 분포 블록: 카운트(C) 굵게 center, 막대(D) 파랑 — 전 구간 일괄
  txt(16, lastRow, 2, 3, BLACK, true, 10, 'CENTER');
  reqs.push({ repeatCell: { range: { sheetId: DSID, startRowIndex: 16, endRowIndex: lastRow, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: BLUE, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat' } });
  // 분포 섹션 헤더 (나중에 적용 → 위 일괄서식 덮어씀)
  headerRows.forEach(hr => txt(hr - 1, hr, 1, 4, DK, true, 11, 'LEFT', LGRAY));

  // 컬럼 폭
  const width = (c0, c1, px) => reqs.push({ updateDimensionProperties: { range: { sheetId: DSID, dimension: 'COLUMNS', startIndex: c0, endIndex: c1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
  width(0, 1, 22);
  width(1, 2, 128);  // B 팀명/라벨
  width(2, 10, 52);  // C~J 지표
  width(10, 11, 62); // K 달성율

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: reqs } });
  console.log('DASHBOARD_REBUILT lastRow=' + lastRow);
}

main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
