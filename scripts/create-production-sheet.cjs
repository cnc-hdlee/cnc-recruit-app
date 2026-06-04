/* 생산직(외국인) 채용 RAW DATA + 대시보드 새 구글시트 직접 생성 (drive.file) */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const RAW = '생산직 RAW DATA';
const Q = "'" + RAW + "'!";
const N_ROWS = 400; // 자동수식/드롭다운 적용 행수

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  // 1) 새 스프레드시트 생성 (탭 2개)
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'CNC 생산직(외국인) 채용 RAW DATA' },
      sheets: [
        { properties: { sheetId: 0, title: RAW, gridProperties: { rowCount: 600, columnCount: 28 } } },
        { properties: { sheetId: 1, title: '대시보드', gridProperties: { rowCount: 60, columnCount: 12 } } },
      ],
    },
  });
  const ssId = created.data.spreadsheetId;
  const url = created.data.spreadsheetUrl;

  // 2) 값 입력
  const headers = ['관리번호','Org1(본부)','Org2','Org3','Org4(팀)','직무','채용유형','근무지','후보자명','성별',
    '국적','체류자격(비자)','비자만료일','유입경로','센터지역','이력서_링크','접수일','서류_결과','면접_결과','면접_일자',
    '건강검진_결과','최종상태','탈락단계','입사예정일','실제입사일','비고','현재단계(자동)','총소요일수(자동)'];
  const sample = [
    ['CNC-P-001','COO','생산본부','생산1부','생산1팀','생산','신규','수원','응우옌반','남','베트남','E-9(비전문취업)','2027-08-15','일자리센터','화성','','2026-05-20','합격','합격','2026-05-23','적합','입사','','2026-06-02','2026-06-02','성실/야간가능'],
    ['CNC-P-002','COO','생산본부','제조부','제조2팀','제조','결원','3공장','첸리','여','중국','H-2(방문취업)','2028-03-01','지인추천','해당없음','','2026-05-25','합격','대기','2026-06-05','대기','진행중','','','','면접 예정'],
    ['CNC-P-003','COO','생산본부','직속','품질관리1팀','포장QC','결원','수원','박세르게이','남','우즈베키스탄','F-4(재외동포)','2029-01-20','일자리센터','오산','','2026-05-18','불합격','','','-','탈락','서류','','','한국어 미흡'],
  ];
  // 자동 수식 (AA=현재단계, AB=총소요일수) 2~N행
  const auto = [];
  for (let r = 2; r <= N_ROWS; r++) {
    auto.push([
      `=IF($I${r}="","",IFS($V${r}="입사","입사",$V${r}="포기","포기",$W${r}<>"","탈락("&$W${r}&")",$U${r}="적합","건강검진 통과",$S${r}="합격","면접 합격",$R${r}="합격","서류 합격",$Q${r}<>"","접수",TRUE,"-"))`,
      `=IF($Q${r}="","",IF($Y${r}<>"",$Y${r}-$Q${r},TODAY()-$Q${r}))`,
    ]);
  }

  // 대시보드 값
  const dash = [];
  dash.push({ range: '대시보드!B2', values: [['📊  생산직(외국인) 채용 대시보드']] });
  dash.push({ range: '대시보드!B3', values: [['RAW DATA 입력 시 자동 반영됩니다 · 좌측 시트에 한 줄씩 입력하세요']] });
  // KPI
  dash.push({ range: '대시보드!B5', values: [['총 지원자','', '실제 입사','', '진행중','', '채용 달성율','', '평균 소요일']] });
  dash.push({ range: '대시보드!B6', values: [[
    `=COUNTA(${Q}I2:I)`,'',
    `=COUNTIF(${Q}V2:V,"입사")`,'',
    `=COUNTIF(${Q}V2:V,"진행중")`,'',
    `=IFERROR(COUNTIF(${Q}V2:V,"입사")/COUNTA(${Q}I2:I),0)`,'',
    `=IFERROR(ROUND(AVERAGE(${Q}AB2:AB),1),0)`,
  ]] });

  const block = (headerRow, leftLetter, title, items) => {
    const cIdx = leftLetter.charCodeAt(0) - 64; // B->2
    const colL = String.fromCharCode(64 + cIdx);
    const colC = String.fromCharCode(64 + cIdx + 1);
    const colBar = String.fromCharCode(64 + cIdx + 2);
    dash.push({ range: `대시보드!${colL}${headerRow}`, values: [[title]] });
    items.forEach((it, i) => {
      const r = headerRow + 1 + i;
      dash.push({ range: `대시보드!${colL}${r}`, values: [[it[0]]] });
      dash.push({ range: `대시보드!${colC}${r}`, values: [[it[1]]] });
      dash.push({ range: `대시보드!${colBar}${r}`, values: [[`=IF(${colC}${r}=0,"",REPT("■",MIN(${colC}${r},25)))`]] });
    });
  };
  const cnt = (col, v) => `=COUNTIF(${Q}${col}2:${col},"${v}")`;

  block(8, 'B', '🏢  유입 센터지역별 (일자리센터)', [
    ['화성', cnt('O','화성')],['오산', cnt('O','오산')],['수원', cnt('O','수원')],
    ['안성', cnt('O','안성')],['용인', cnt('O','용인')],['기타', cnt('O','기타')],
  ]);
  block(8, 'F', '🔗  유입경로별', [
    ['일자리센터', cnt('N','일자리센터')],['지인추천', cnt('N','지인추천')],['직접지원(방문)', cnt('N','직접지원(방문)')],
    ['에이전시', cnt('N','에이전시')],['자사공고', cnt('N','자사공고')],['기타', cnt('N','기타')],
  ]);
  const natOther = `=COUNTA(${Q}K2:K)-(${['베트남','중국','우즈베키스탄','캄보디아','네팔','필리핀','태국'].map(n=>`COUNTIF(${Q}K2:K,"${n}")`).join('+')})`;
  block(16, 'B', '🌏  국적별', [
    ['베트남', cnt('K','베트남')],['중국', cnt('K','중국')],['우즈베키스탄', cnt('K','우즈베키스탄')],
    ['캄보디아', cnt('K','캄보디아')],['네팔', cnt('K','네팔')],['필리핀', cnt('K','필리핀')],
    ['태국', cnt('K','태국')],['기타', natOther],
  ]);
  block(16, 'F', '🛂  체류자격(비자)별', [
    ['E-9 비전문취업', cnt('L','E-9(비전문취업)')],['H-2 방문취업', cnt('L','H-2(방문취업)')],
    ['F-4 재외동포', cnt('L','F-4(재외동포)')],['F-5 영주', cnt('L','F-5(영주)')],
    ['F-6 결혼이민', cnt('L','F-6(결혼이민)')],['E-7 특정활동', cnt('L','E-7(특정활동)')],
  ]);
  block(26, 'B', '📉  채용 단계별 퍼널', [
    ['접수', `=COUNTIF(${Q}Q2:Q,"<>")`],['서류 합격', cnt('R','합격')],['면접 합격', cnt('S','합격')],
    ['건강검진 적합', cnt('U','적합')],['최종 입사', cnt('V','입사')],
  ]);
  block(26, 'F', '📋  채용유형별', [
    ['결원', cnt('G','결원')],['신규', cnt('G','신규')],['대체', cnt('G','대체')],['충원', cnt('G','충원')],
  ]);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: ssId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${Q}A1`, values: [headers, ...sample] },
        { range: `${Q}AA2`, values: auto },
        ...dash,
      ],
    },
  });

  // 3) 서식 / 드롭다운 / 조건부서식
  const dv = (c0, vals) => ({ setDataValidation: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: N_ROWS, startColumnIndex: c0, endColumnIndex: c0 + 1 },
    rule: { condition: { type: 'ONE_OF_LIST', values: vals.map(v => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } });
  const dateFmt = (c0) => ({ repeatCell: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: N_ROWS, startColumnIndex: c0, endColumnIndex: c0 + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } });
  const width = (sid, c0, c1, px) => ({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: c0, endIndex: c1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
  const bgBold = (sid, r0, r1, c0, c1, bg, fg, size, bold, align) => ({ repeatCell: { range: { sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
    cell: { userEnteredFormat: { backgroundColor: bg, horizontalAlignment: align || 'LEFT', verticalAlignment: 'MIDDLE', textFormat: { foregroundColor: fg, bold: !!bold, fontSize: size } } },
    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)' } });

  const NAVY = { red: 0.122, green: 0.220, blue: 0.392 };
  const WHITE = { red: 1, green: 1, blue: 1 };
  const DKBLUE = { red: 0.122, green: 0.220, blue: 0.392 };
  const BLUE = { red: 0.27, green: 0.45, blue: 0.77 };
  const LBLUE = { red: 0.85, green: 0.88, blue: 0.95 };
  const LGRAY = { red: 0.93, green: 0.95, blue: 0.98 };
  const GRAY = { red: 0.6, green: 0.6, blue: 0.6 };
  const BLACK = { red: 0, green: 0, blue: 0 };

  const reqs = [];
  // 헤더행
  reqs.push({ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 28 },
    cell: { userEnteredFormat: { backgroundColor: NAVY, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { foregroundColor: WHITE, bold: true, fontSize: 10 } } },
    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)' } });
  reqs.push({ updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
  reqs.push({ updateDimensionProperties: { range: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } });
  // 예시 3행 회색 이탤릭
  reqs.push({ repeatCell: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 26 },
    cell: { userEnteredFormat: { textFormat: { foregroundColor: GRAY, italic: true } } }, fields: 'userEnteredFormat.textFormat' } });
  // 기본 컬럼 폭 + 주요 컬럼 조정
  reqs.push(width(0, 0, 28, 92));
  reqs.push(width(0, 5, 6, 78));   // 직무
  reqs.push(width(0, 11, 12, 120)); // 비자
  reqs.push(width(0, 13, 14, 110)); // 유입경로
  reqs.push(width(0, 15, 16, 130)); // 이력서링크
  reqs.push(width(0, 25, 26, 150)); // 비고
  reqs.push(width(0, 26, 27, 110)); // 현재단계
  // 드롭다운
  reqs.push(dv(6, ['결원','신규','대체','충원']));
  reqs.push(dv(7, ['수원','3공장','화성공장','안성공장','기타']));
  reqs.push(dv(9, ['남','여']));
  reqs.push(dv(10, ['베트남','중국','우즈베키스탄','캄보디아','네팔','필리핀','태국','미얀마','인도네시아','스리랑카','몽골','한국(귀화)','기타']));
  reqs.push(dv(11, ['E-9(비전문취업)','H-2(방문취업)','F-4(재외동포)','F-5(영주)','F-6(결혼이민)','E-7(특정활동)','D-2(유학)','기타']));
  reqs.push(dv(13, ['일자리센터','지인추천','직접지원(방문)','에이전시','자사공고','기타']));
  reqs.push(dv(14, ['화성','오산','수원','안성','용인','기타','해당없음']));
  reqs.push(dv(17, ['합격','불합격','생략']));
  reqs.push(dv(18, ['합격','불합격','면접포기','대기']));
  reqs.push(dv(20, ['적합','부적합','대기','-']));
  reqs.push(dv(21, ['진행중','입사','탈락','포기']));
  reqs.push(dv(22, ['서류','면접','건강검진','-']));
  // 날짜서식 M,Q,T,X,Y = 12,16,19,23,24
  [12,16,19,23,24].forEach(c => reqs.push(dateFmt(c)));
  // 비자 만료 임박(60일) 빨강
  reqs.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: 0, startRowIndex: 1, endRowIndex: N_ROWS, startColumnIndex: 12, endColumnIndex: 13 }],
    booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($M2<>"",$M2-TODAY()<=60,$M2-TODAY()>=0)' }] },
      format: { backgroundColor: { red: 1, green: 0.78, blue: 0.81 }, textFormat: { foregroundColor: { red: 0.61, green: 0, blue: 0.02 } } } } } } });

  // ---- 대시보드 서식 ----
  reqs.push({ updateSheetProperties: { properties: { sheetId: 1, gridProperties: { hideGridlines: true } }, fields: 'gridProperties.hideGridlines' } });
  reqs.push(bgBold(1, 1, 2, 1, 5, WHITE, DKBLUE, 18, true, 'LEFT'));   // 제목
  reqs.push(bgBold(1, 2, 3, 1, 6, WHITE, GRAY, 9, false, 'LEFT'));     // 부제
  // KPI 라벨/값 (cols B,D,F,H,J = 1,3,5,7,9)
  [1,3,5,7,9].forEach(c => {
    reqs.push(bgBold(1, 4, 5, c, c + 1, BLUE, WHITE, 10, true, 'CENTER'));
    reqs.push(bgBold(1, 5, 6, c, c + 1, LBLUE, DKBLUE, 18, true, 'CENTER'));
  });
  // 달성율 % 서식 (H6 = row5,col7)
  reqs.push({ repeatCell: { range: { sheetId: 1, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 7, endColumnIndex: 8 },
    cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } }, }, fields: 'userEnteredFormat.numberFormat' } });
  // 섹션 헤더 (rows 8,16,26 → 0-based 7,15,25 ; cols B=1, F=5)
  [7,15,25].forEach(r => {
    [1,5].forEach(c => reqs.push(bgBold(1, r, r + 1, c, c + 3, LGRAY, DKBLUE, 11, true, 'LEFT')));
  });
  // 카운트 셀 정렬/굵게 (count col = C=2, G=6)
  reqs.push(bgBold(1, 7, 32, 2, 3, WHITE, BLACK, 10, true, 'CENTER'));
  reqs.push(bgBold(1, 7, 32, 6, 7, WHITE, BLACK, 10, true, 'CENTER'));
  // 막대 색 (D=3, H=7)
  reqs.push({ repeatCell: { range: { sheetId: 1, startRowIndex: 7, endRowIndex: 32, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: BLUE, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat' } });
  reqs.push({ repeatCell: { range: { sheetId: 1, startRowIndex: 7, endRowIndex: 32, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0.44, green: 0.68, blue: 0.28 }, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat' } });
  // 대시보드 컬럼 폭
  reqs.push(width(1, 0, 1, 24));
  reqs.push(width(1, 1, 2, 130)); reqs.push(width(1, 2, 3, 58)); reqs.push(width(1, 3, 4, 175));
  reqs.push(width(1, 4, 5, 24));
  reqs.push(width(1, 5, 6, 130)); reqs.push(width(1, 6, 7, 58)); reqs.push(width(1, 7, 8, 175));

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssId, requestBody: { requests: reqs } });

  console.log('OK_URL=' + url);
}

main().catch(e => { console.error('FAILED:', e.response && e.response.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
