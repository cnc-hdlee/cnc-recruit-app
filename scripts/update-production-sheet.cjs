/* 생산1~4팀 전용으로 정비 + 근무지 자동매핑 + 전형 항목 강조 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo';
const RAW = '생산직 RAW DATA';
const Q = "'" + RAW + "'!";
const N = 400;

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  // ---------- 값 ----------
  // 예시 4행: 생산1~4팀 (B,C,D,H 는 수식이 채우므로 비워둠)
  const A = [['CNC-P-001'],['CNC-P-002'],['CNC-P-003'],['CNC-P-004']];
  const EFG = [ // E(팀) F(직무) G(채용유형)
    ['생산1팀','생산','신규'],
    ['생산2팀','생산','결원'],
    ['생산3팀','생산','결원'],
    ['생산4팀','생산','신규'],
  ];
  // I~Z (18열): 후보자명,성별,국적,비자,비자만료,유입경로,센터지역,이력서,접수일,서류,면접,면접일,건강검진,최종,탈락단계,입사예정,실제입사,비고
  const IZ = [
    ['응우옌반','남','베트남','E-9(비전문취업)','2027-08-15','일자리센터','화성','','2026-05-20','합격','합격','2026-05-23','적합','입사','','2026-06-02','2026-06-02','성실/야간가능'],
    ['첸리','여','중국','H-2(방문취업)','2028-03-01','지인추천','해당없음','','2026-05-25','합격','대기','2026-06-05','대기','진행중','','','','면접 예정'],
    ['박세르게이','남','우즈베키스탄','F-4(재외동포)','2029-01-20','일자리센터','오산','','2026-05-18','불합격','','','-','탈락','서류','','','한국어 미흡'],
    ['수파차이','남','태국','E-9(비전문취업)','2026-07-20','일자리센터','용인','','2026-05-28','합격','합격','2026-06-02','적합','진행중','','2026-06-10','','우수/근태양호'],
  ];

  // 자동 수식열 (B,C,D,H) 2~N행
  const fB = [], fC = [], fD = [], fH = [];
  for (let r = 2; r <= N; r++) {
    fB.push([`=IF($E${r}="","","COO")`]);
    fC.push([`=IF($E${r}="","","생산본부")`]);
    fD.push([`=IF($E${r}="","","생산"&MID($E${r},3,1)&"부")`]);
    fH.push([`=IF($E${r}="","",IFS($E${r}="생산1팀","퍼플",OR($E${r}="생산2팀",$E${r}="생산4팀"),"그린",$E${r}="생산3팀","3공장",TRUE,""))`]);
  }

  // 대시보드 추가 블록 (팀별 / 근무지별)
  const dash = [];
  dash.push({ range: '대시보드!B34', values: [['🏭  팀별 현황']] });
  const teams = ['생산1팀','생산2팀','생산3팀','생산4팀'];
  teams.forEach((t, i) => {
    const r = 35 + i;
    dash.push({ range: `대시보드!B${r}`, values: [[t]] });
    dash.push({ range: `대시보드!C${r}`, values: [[`=COUNTIF(${Q}E2:E,"${t}")`]] });
    dash.push({ range: `대시보드!D${r}`, values: [[`=IF(C${r}=0,"",REPT("■",MIN(C${r},25)))`]] });
  });
  dash.push({ range: '대시보드!F34', values: [['📍  근무지(사이트)별']] });
  const sites = ['퍼플','그린','3공장'];
  sites.forEach((s, i) => {
    const r = 35 + i;
    dash.push({ range: `대시보드!F${r}`, values: [[s]] });
    dash.push({ range: `대시보드!G${r}`, values: [[`=COUNTIF(${Q}H2:H,"${s}")`]] });
    dash.push({ range: `대시보드!H${r}`, values: [[`=IF(G${r}=0,"",REPT("■",MIN(G${r},25)))`]] });
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SS_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: [
      { range: `${Q}A2`, values: A },
      { range: `${Q}E2`, values: EFG },
      { range: `${Q}I2`, values: IZ },
      { range: `${Q}B2`, values: fB },
      { range: `${Q}C2`, values: fC },
      { range: `${Q}D2`, values: fD },
      { range: `${Q}H2`, values: fH },
      ...dash,
    ] },
  });

  // ---------- 서식/드롭다운/조건부서식 ----------
  const reqs = [];

  // Org4(팀) 드롭다운 = 4개팀만
  reqs.push({ setDataValidation: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: N, startColumnIndex: 4, endColumnIndex: 5 },
    rule: { condition: { type: 'ONE_OF_LIST', values: teams.map(v => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } });
  // 근무지(H) 기존 드롭다운 제거 (이제 자동수식)
  reqs.push({ setDataValidation: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: N, startColumnIndex: 7, endColumnIndex: 8 } } });
  // 자동계산 컬럼 B,C,D,H 연한 회색 배경(수정금지 느낌)
  const AUTOBG = { red: 0.95, green: 0.95, blue: 0.96 };
  [[1,2],[2,3],[3,4],[7,8]].forEach(([c0,c1]) => reqs.push({ repeatCell: {
    range: { sheetId: 0, startRowIndex: 1, endRowIndex: N, startColumnIndex: c0, endColumnIndex: c1 },
    cell: { userEnteredFormat: { backgroundColor: AUTOBG } }, fields: 'userEnteredFormat.backgroundColor' } }));
  // 예시 4행 회색 이탤릭(데이터 컬럼만: A,E,F,G,I..Z)
  reqs.push({ repeatCell: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 28 },
    cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 }, italic: true } } }, fields: 'userEnteredFormat.textFormat' } });

  // ----- 전형 항목 색상 강조 -----
  const GREEN = { bg: { red: 0.80, green: 0.92, blue: 0.77 }, fg: { red: 0.11, green: 0.45, blue: 0.11 } };
  const SGREEN = { bg: { red: 0.62, green: 0.84, blue: 0.55 }, fg: { red: 0.05, green: 0.30, blue: 0.05 } };
  const RED = { bg: { red: 1, green: 0.80, blue: 0.81 }, fg: { red: 0.61, green: 0, blue: 0.02 } };
  const YELLOW = { bg: { red: 1, green: 0.95, blue: 0.70 }, fg: { red: 0.50, green: 0.38, blue: 0 } };
  const GRAYC = { bg: { red: 0.89, green: 0.89, blue: 0.89 }, fg: { red: 0.42, green: 0.42, blue: 0.42 } };
  const BLUEC = { bg: { red: 0.80, green: 0.89, blue: 0.96 }, fg: { red: 0.11, green: 0.30, blue: 0.55 } };
  const ORANGE = { bg: { red: 1, green: 0.85, blue: 0.66 }, fg: { red: 0.60, green: 0.30, blue: 0 } };

  const cf = (col0, type, val, c, bold) => {
    const cond = { type };
    if (val !== null) cond.values = [{ userEnteredValue: String(val) }];
    reqs.push({ addConditionalFormatRule: { index: 0, rule: {
      ranges: [{ sheetId: 0, startRowIndex: 1, endRowIndex: N, startColumnIndex: col0, endColumnIndex: col0 + 1 }],
      booleanRule: { condition: cond, format: { backgroundColor: c.bg, textFormat: { foregroundColor: c.fg, bold: !!bold } } },
    } } });
  };

  // 서류_결과 R=17
  cf(17, 'TEXT_EQ', '합격', GREEN);
  cf(17, 'TEXT_EQ', '불합격', RED);
  cf(17, 'TEXT_EQ', '생략', GRAYC);
  // 면접_결과 S=18
  cf(18, 'TEXT_EQ', '합격', GREEN);
  cf(18, 'TEXT_EQ', '불합격', RED);
  cf(18, 'TEXT_EQ', '대기', YELLOW);
  cf(18, 'TEXT_EQ', '면접포기', GRAYC);
  // 건강검진 U=20
  cf(20, 'TEXT_EQ', '적합', GREEN);
  cf(20, 'TEXT_EQ', '부적합', RED);
  cf(20, 'TEXT_EQ', '대기', YELLOW);
  // 최종상태 V=21
  cf(21, 'TEXT_EQ', '입사', SGREEN, true);
  cf(21, 'TEXT_EQ', '진행중', BLUEC);
  cf(21, 'TEXT_EQ', '탈락', RED);
  cf(21, 'TEXT_EQ', '포기', GRAYC);
  // 탈락단계 W=22 (값 있으면 빨강)
  cf(22, 'NOT_BLANK', null, RED);
  // 현재단계(자동) AA=26
  cf(26, 'TEXT_CONTAINS', '입사', SGREEN, true);
  cf(26, 'TEXT_CONTAINS', '탈락', RED);
  cf(26, 'TEXT_CONTAINS', '통과', GREEN);
  // 총소요일수 AB=27 (20일 초과 = 장기 주의)
  cf(27, 'NUMBER_GREATER', 20, ORANGE, true);
  // 채용유형 G=6 강조
  cf(6, 'TEXT_EQ', '신규', { bg: { red: 0.85, green: 0.93, blue: 0.99 }, fg: { red: 0.1, green: 0.35, blue: 0.6 } });
  cf(6, 'TEXT_EQ', '결원', { bg: { red: 0.96, green: 0.93, blue: 0.86 }, fg: { red: 0.5, green: 0.35, blue: 0.1 } });

  // ----- 대시보드 추가 블록 서식 -----
  const LGRAY = { red: 0.93, green: 0.95, blue: 0.98 };
  const DKBLUE = { red: 0.122, green: 0.220, blue: 0.392 };
  const fmt = (sid, r0, r1, c0, c1, bg, fg, size, bold, align) => reqs.push({ repeatCell: {
    range: { sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
    cell: { userEnteredFormat: { backgroundColor: bg, horizontalAlignment: align || 'LEFT', verticalAlignment: 'MIDDLE', textFormat: { foregroundColor: fg, bold: !!bold, fontSize: size } } },
    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)' } });
  // 섹션헤더 row34(0-based33)
  fmt(1, 33, 34, 1, 4, LGRAY, DKBLUE, 11, true, 'LEFT');
  fmt(1, 33, 34, 5, 8, LGRAY, DKBLUE, 11, true, 'LEFT');
  // 카운트 굵게 center
  fmt(1, 34, 39, 2, 3, { red: 1, green: 1, blue: 1 }, { red: 0, green: 0, blue: 0 }, 10, true, 'CENTER');
  fmt(1, 34, 39, 6, 7, { red: 1, green: 1, blue: 1 }, { red: 0, green: 0, blue: 0 }, 10, true, 'CENTER');
  // 막대색
  reqs.push({ repeatCell: { range: { sheetId: 1, startRowIndex: 34, endRowIndex: 39, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.27, green: 0.45, blue: 0.77 }, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat' } });
  reqs.push({ repeatCell: { range: { sheetId: 1, startRowIndex: 34, endRowIndex: 39, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.44, green: 0.68, blue: 0.28 }, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat' } });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: reqs } });
  console.log('UPDATE_OK');
}

main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
