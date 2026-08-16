// 채용 경로 티어 관리 — 확장 블록 (rows 54~)
//   1QEvFE… / gid 2042774143
//
// 기존 것은 전부 그대로 둔다. A34:G52(티어 표), A1:G31, I3:M45 는 건드리지 않는다.
//
// 읽는 순서가 헷갈리지 않도록 좌우로 벌리지 않고 A:G 한 줄기로만 아래로 쌓는다.
//   A34:G52  ① 채용 경로 티어 관리   (이미 있음)
//   A55:G61  ② 티어별 요약           — 티어별 경로수/모수/입사/비중/비용
//   A64:G82  ③ 경로별 월 유입 추이    — 최근 5개월 + 스파크라인
const fs = require('node:fs'), path = require('node:path'), { google } = require('googleapis');

const ID = '1QEvFEWjnXC1CNw6qAZ4ooFQUIxh36ow_9EL3hnM6ZoI';
const SID = 2042774143;
const TAB = '입사현황_대시보드_test';
const SRC = "'입사예정(형도)'";

// 기존 티어 표 좌표
const T0 = 36, T1 = 51, TSUM = 52;

// 새 블록 좌표
const S_HEAD = 55, S_HDR = 56, S_R0 = 57, S_R1 = 61;   // ② 티어별 요약 (1~4tier, 보류)
const M_HEAD = 64, M_HDR = 65, M_R0 = 66, M_R1 = 81, M_SUM = 82;  // ③ 월 유입 추이

const NCOL = 7;
const TIER_ROWS = ['1tier', '2tier', '3tier', '4tier', '보류'];
const CHANNELS = [
  '에스텍플러스', '수원시일자리센터', '용인시일자리센터', '오산시일자리센터',
  '뉴온', '리드커리어', '안성시일자리센터', '화성시일자리센터',
  '잡코리아', '유선문의', '우신', '세화',
  '경기도일자리센터', '수원다문화센터', '사람인', '당근알바',
];

const C = (r, g, b) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const NAVY = C(46, 84, 150), BLUE = C(68, 114, 196), WHITE = C(255, 255, 255);
const BORD = C(191, 201, 216), SOFT = C(232, 238, 247);

const R = (r0, r1, c0, c1) => ({ sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
const solid = (color) => ({ style: 'SOLID', width: 1, color });
const fmt = (range, cell, fields) => ({ repeatCell: { range, cell: { userEnteredFormat: cell }, fields: 'userEnteredFormat(' + fields + ')' } });

async function auth() {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const o = new google.auth.OAuth2(t.clientId, t.clientSecret);
  o.setCredentials({ refresh_token: t.refresh_token });
  await o.getAccessToken();
  return google.sheets({ version: 'v4', auth: o });
}

// 경로별 "입사취소" 건수 배열 (전환율 계산용)
const CANCEL_ARR = `COUNTIFS(${SRC}!$N:$N,$A$${T0}:$A$${T1},${SRC}!$M:$M,"입사취소")`;

(async () => {
  const s = await auth();

  // 행 확보 (아래로만)
  const props = (await s.spreadsheets.get({
    spreadsheetId: ID, fields: 'sheets(properties(sheetId,gridProperties(rowCount)))',
  })).data.sheets.find((x) => x.properties.sheetId === SID).properties;
  if (props.gridProperties.rowCount < M_SUM + 2) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: ID,
      requestBody: { requests: [{ appendDimension: { sheetId: SID, dimension: 'ROWS', length: M_SUM + 2 - props.gridProperties.rowCount } }] },
    });
  }

  const rows = [];
  const put = (a1, arr) => rows.push({ range: `'${TAB}'!${a1}`, values: [arr] });

  // 읽는 순서를 눈에 보이게 — 기존 티어 표 제목에도 번호를 붙인다 (제목 글자만 변경)
  put('A34', ['① 채용 경로 티어 관리']);

  // ---------------------------------------------------- ② 티어별 요약
  put(`A${S_HEAD}`, ['② 티어별 요약  ·  ①의 티어 칸을 바꾸면 여기 숫자가 따라옵니다']);
  put(`A${S_HDR}`, ['티어', '경로 수', '모수(유입)', '입사', '입사 비중', '총 비용', '인당 비용']);
  TIER_ROWS.forEach((t, i) => {
    const r = S_R0 + i;
    put('A' + r, [
      t,
      `=COUNTIF($B$${T0}:$B$${T1},$A${r})`,
      `=SUMIF($B$${T0}:$B$${T1},$A${r},$C$${T0}:$C$${T1})`,
      `=SUMIF($B$${T0}:$B$${T1},$A${r},$D$${T0}:$D$${T1})`,
      `=IFERROR($D${r}/$D$${TSUM},0)`,
      `=SUMIF($B$${T0}:$B$${T1},$A${r},$F$${T0}:$F$${T1})`,
      `=IF($D${r}=0,"—",$F${r}/$D${r})`,
    ]);
  });

  // ---------------------------------------------------- ③ 경로별 월 유입 추이
  put(`A${M_HEAD}`, ['③ 경로별 월 유입 추이  ·  입사예정일 기준 최근 5개월 (모수가 마르는 경로 확인용)']);
  const monthHdr = ['채용 경로'];
  for (let m = 4; m >= 0; m--) monthHdr.push(`=EOMONTH(TODAY(),-${m})`);
  monthHdr.push('추이');
  put(`A${M_HDR}`, monthHdr);

  CHANNELS.forEach((name, i) => {
    const r = M_R0 + i;
    const cells = [name];
    for (let m = 4; m >= 0; m--) {
      const c = String.fromCharCode(66 + (4 - m)); // B..F
      cells.push(`=COUNTIFS(${SRC}!$N:$N,$A${r},${SRC}!$A:$A,">="&EOMONTH(TODAY(),-${m + 1})+1,${SRC}!$A:$A,"<="&${c}$${M_HDR})`);
    }
    cells.push(`=IF(SUM($B${r}:$F${r})=0,"",SPARKLINE($B${r}:$F${r},{"charttype","line";"color","#4472c4";"linewidth",2;"empty","zero"}))`);
    put('A' + r, cells);
  });
  put(`A${M_SUM}`, ['합계',
    `=SUM(B${M_R0}:B${M_R1})`, `=SUM(C${M_R0}:C${M_R1})`, `=SUM(D${M_R0}:D${M_R1})`,
    `=SUM(E${M_R0}:E${M_R1})`, `=SUM(F${M_R0}:F${M_R1})`,
    `=SPARKLINE(B${M_SUM}:F${M_SUM},{"charttype","column";"color","#2e5496";"empty","zero"})`,
  ]);

  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: ID, requestBody: { valueInputOption: 'USER_ENTERED', data: rows },
  });

  // ---------------------------------------------------- 서식
  const req = [];

  // 가독성 — 섹션 제목은 크게, 데이터는 여유 있게, 구분용 빈 줄은 얇게
  const rowH = (r, h) => req.push({
    updateDimensionProperties: {
      range: { sheetId: SID, dimension: 'ROWS', startIndex: r - 1, endIndex: r },
      properties: { pixelSize: h }, fields: 'pixelSize',
    },
  });
  [34, S_HEAD, M_HEAD].forEach((r) => rowH(r, 30));
  [53, 54, 62, 63].forEach((r) => rowH(r, 12));
  for (let r = S_R0; r <= S_R1; r++) rowH(r, 24);
  for (let r = M_R0; r <= M_SUM; r++) rowH(r, 22);
  const sectionHead = (row, c0, c1) => {
    req.push({ mergeCells: { range: R(row - 1, row, c0, c1), mergeType: 'MERGE_ALL' } });
    req.push(fmt(R(row - 1, row, c0, c1), {
      backgroundColor: NAVY, verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT',
      textFormat: { fontSize: 11, bold: true, foregroundColor: WHITE },
    }, 'backgroundColor,verticalAlignment,horizontalAlignment,textFormat'));
  };
  const colHead = (row, c0, c1) => req.push(fmt(R(row - 1, row, c0, c1), {
    backgroundColor: BLUE, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    textFormat: { fontSize: 10, bold: true, foregroundColor: WHITE },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,textFormat'));

  // ① 티어별 요약
  sectionHead(S_HEAD, 0, NCOL);
  colHead(S_HDR, 0, NCOL);
  req.push(fmt(R(S_HDR - 1, S_HDR, 0, 1), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'));
  req.push(fmt(R(S_R0 - 1, S_R1, 0, NCOL), {
    backgroundColor: WHITE, verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER',
    textFormat: { fontSize: 10, bold: true, foregroundColor: C(0, 0, 0) },
    borders: { top: solid(C(226, 231, 238)), bottom: solid(C(226, 231, 238)) },
  }, 'backgroundColor,verticalAlignment,horizontalAlignment,textFormat,borders'));
  req.push(fmt(R(S_R0 - 1, S_R1, 0, 1), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'));
  req.push(fmt(R(S_R0 - 1, S_R1, 4, 5), { numberFormat: { type: 'PERCENT', pattern: '0%' } }, 'numberFormat'));
  req.push(fmt(R(S_R0 - 1, S_R1, 5, 7), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' }, 'numberFormat,horizontalAlignment'));
  req.push({ updateBorders: { range: R(S_HDR - 1, S_R1, 0, NCOL), top: solid(BLUE), bottom: solid(BORD), left: solid(BORD), right: solid(BORD) } });
  // 입사 비중 데이터바
  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(S_R0 - 1, S_R1, 4, 5)],
        gradientRule: {
          minpoint: { color: WHITE, type: 'NUMBER', value: '0' },
          maxpoint: { color: C(197, 224, 205), type: 'NUMBER', value: '1' },
        },
      }, index: 0,
    },
  });

  // ③ 월 유입 추이
  sectionHead(M_HEAD, 0, NCOL);
  colHead(M_HDR, 0, NCOL);
  req.push(fmt(R(M_HDR - 1, M_HDR, 0, 1), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'));
  req.push(fmt(R(M_HDR - 1, M_HDR, 1, 6), { numberFormat: { type: 'DATE', pattern: 'yy.mm' } }, 'numberFormat'));
  req.push(fmt(R(M_R0 - 1, M_SUM, 0, NCOL), {
    backgroundColor: WHITE, verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER',
    textFormat: { fontSize: 10, bold: false, foregroundColor: C(0, 0, 0) },
    borders: { top: solid(C(226, 231, 238)), bottom: solid(C(226, 231, 238)) },
  }, 'backgroundColor,verticalAlignment,horizontalAlignment,textFormat,borders'));
  req.push(fmt(R(M_R0 - 1, M_SUM, 0, 1), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'));
  req.push(fmt(R(M_SUM - 1, M_SUM, 0, NCOL), {
    backgroundColor: SOFT, textFormat: { fontSize: 10, bold: true, foregroundColor: C(0, 0, 0) },
    borders: { top: { style: 'SOLID_MEDIUM', width: 2, color: BLUE } },
  }, 'backgroundColor,textFormat,borders'));
  req.push({ updateBorders: { range: R(M_HDR - 1, M_SUM, 0, NCOL), top: solid(BLUE), bottom: solid(BORD), left: solid(BORD), right: solid(BORD) } });
  // 유입 0 은 흐리게, 값이 크면 진하게
  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(M_R0 - 1, M_R1, 1, 6)],
        booleanRule: {
          condition: { type: 'NUMBER_EQ', values: [{ userEnteredValue: '0' }] },
          format: { textFormat: { foregroundColor: C(198, 203, 211) } },
        },
      }, index: 0,
    },
  });
  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(M_R0 - 1, M_R1, 1, 6)],
        gradientRule: {
          minpoint: { color: WHITE, type: 'MIN' },
          maxpoint: { color: C(198, 222, 245), type: 'MAX' },
        },
      }, index: 1,
    },
  });

  await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: req } });
  console.log(`완료 — 값 ${rows.length}건, 서식 ${req.length}건`);
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; });
