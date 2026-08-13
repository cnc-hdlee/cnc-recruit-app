// 대시보드 이슈 트래킹(형도_작업중) 탭 레이아웃 생성
//   1QEvFE… / gid 1597533740
// 생산운영팀 · 생산1/2/4팀 · 인사팀 사이에 오간 내용을 한 줄씩 쌓는 커뮤니케이션 로그.
// "기록" 열은 입력값에서 자동 조립된다:
//   생산운영팀 생산1팀 인원 140명 확정_26.08.13 by 장용진
//
// 이 탭에만 쓴다. 다른 탭은 건드리지 않는다.
const fs = require('node:fs'), path = require('node:path'), { google } = require('googleapis');

const ID = '1QEvFEWjnXC1CNw6qAZ4ooFQUIxh36ow_9EL3hnM6ZoI';
const SID = 1597533740;
const TAB = '대시보드 이슈 트래킹(형도_작업중)';

const FIRST = 12, LAST = 211;          // 로그 데이터 행
const NCOL = 13;                        // A~M

// ---- palette (다른 대시보드와 동일 계열) ----
const C = (r, g, b) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const INK      = C(26, 32, 44);
const WHITE    = C(255, 255, 255);
const TITLE_BG = C(28, 42, 66);
const HEAD_BG  = C(47, 64, 92);
const SUB_BG   = C(237, 241, 246);
const BAND     = C(248, 250, 252);
const BORD     = C(214, 220, 229);
const RULE     = C(180, 190, 204);
const KPI_BG   = C(244, 248, 252);
const ACCENT   = C(70, 110, 160);

const OK_BG = C(226, 244, 232), OK_FG = C(22, 90, 52);
const GO_BG = C(226, 238, 250), GO_FG = C(28, 78, 128);
const HD_BG = C(253, 243, 220), HD_FG = C(133, 90, 10);
const XX_BG = C(238, 240, 243), XX_FG = C(100, 106, 116);

const TEAMS   = ['생산운영팀', '생산1팀', '생산2팀', '생산4팀', '인사팀'];
const TARGETS = ['생산1팀', '생산2팀', '생산4팀', '생산운영팀', '전체'];
const KINDS   = ['확정', '요청', '변경', '회신', '이슈', '공유'];
const STATES  = ['확정', '진행중', '보류', '취소'];

async function auth() {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const o = new google.auth.OAuth2(t.clientId, t.clientSecret);
  o.setCredentials({ refresh_token: t.refresh_token });
  await o.getAccessToken();
  return google.sheets({ version: 'v4', auth: o });
}

// --- 셀 범위 헬퍼 (0-indexed, end exclusive) ---
const R = (r0, r1, c0, c1) => ({ sheetId: SID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
const solid = (color) => ({ style: 'SOLID', width: 1, color });

function fmt(range, cell, fields) {
  return { repeatCell: { range, cell: { userEnteredFormat: cell }, fields: 'userEnteredFormat(' + fields + ')' } };
}

(async () => {
  const s = await auth();

  // ---------------------------------------------------------- 값 / 수식
  const rows = [];
  const put = (a1, arr) => rows.push({ range: `'${TAB}'!${a1}`, values: [arr] });

  put('A1', ['이슈 트래킹']);
  put('A2', ['생산운영팀 · 생산1/2/4팀 · 인사팀 커뮤니케이션 로그  —  주고받은 내용을 한 줄씩 남깁니다']);

  // KPI 스트립
  put('A4', ['총 기록', '확정', '진행중', '보류', '최근 기록일']);
  put('A5', [
    `=COUNTA($B$${FIRST}:$B$${LAST})`,
    `=COUNTIF($I$${FIRST}:$I$${LAST},"확정")`,
    `=COUNTIF($I$${FIRST}:$I$${LAST},"진행중")`,
    `=COUNTIF($I$${FIRST}:$I$${LAST},"보류")`,
    `=IFERROR(TEXT(MAX($B$${FIRST}:$B$${LAST}),"yy.mm.dd"),"—")`,
  ]);

  // 팀별 최신 확정 인원 — 날짜가 가장 최근인 "확정" 행에서 끌어온다.
  //   구글 시트의 LOOKUP은 1/0 에러 배열을 무시하지 않으므로(엑셀과 다름) FILTER+SORT로 뽑는다.
  put('H4', ['팀별 최신 확정 인원']);
  put('H5', ['팀', '인원', '확정일']);
  ['생산1팀', '생산2팀', '생산4팀'].forEach((t, i) => {
    const r = 6 + i;
    const pick = `SORT(FILTER({$G$${FIRST}:$G$${LAST},$B$${FIRST}:$B$${LAST}},`
      + `($E$${FIRST}:$E$${LAST}="${t}")*($F$${FIRST}:$F$${LAST}="확정")*($G$${FIRST}:$G$${LAST}<>"")),2,FALSE)`;
    put('H' + r, [
      t,
      `=IFERROR(INDEX(${pick},1,1),"—")`,
      `=IFERROR(TEXT(INDEX(${pick},1,2),"yy.mm.dd"),"—")`,
    ]);
  });

  put('A10', ['커뮤니케이션 로그']);
  put('A11', ['No', '일자', '발신', '수신', '대상팀', '구분', '인원', '담당자', '상태', '기록  (자동 생성)', '상세 내용', '후속 조치', '비고']);

  // 로그 행 — No / 기록 은 수식, 나머지는 입력칸
  for (let r = FIRST; r <= LAST; r++) {
    put('A' + r, [`=IF($B${r}="","",COUNTA($B$${FIRST}:$B${r}))`]);
    put('J' + r, [
      `=IF($B${r}="","",$C${r}&" "&$E${r}&IF($G${r}="",""," 인원 "&TEXT($G${r},"0")&"명")&" "&$F${r}&"_"&TEXT($B${r},"yy.mm.dd")&IF($H${r}="",""," by "&$H${r}))`,
    ]);
  }

  // 예시 1행 (형도님이 주신 예시 — 필요 없으면 지우시면 됩니다)
  put(`B${FIRST}`, ['2026-08-13', '생산운영팀', '인사팀', '생산1팀', '확정', 140, '장용진', '확정']);
  put(`K${FIRST}`, ['생산1팀 인원 확정드립니다. 140명']);

  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: rows },
  });

  // ---------------------------------------------------------- 서식
  const req = [];

  // 재실행 대비 정리 — 줄무늬/조건부서식/병합은 중복 추가가 안 되므로 먼저 지운다.
  const meta = (await s.spreadsheets.get({
    spreadsheetId: ID,
    fields: 'sheets(properties(sheetId),merges,bandedRanges(bandedRangeId),conditionalFormats)',
  })).data.sheets.find((x) => x.properties.sheetId === SID);
  (meta.bandedRanges || []).forEach((b) => req.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } }));
  (meta.conditionalFormats || []).forEach((_, i, arr) =>
    req.push({ deleteConditionalFormatRule: { sheetId: SID, index: arr.length - 1 - i } }));
  if ((meta.merges || []).length) req.push({ unmergeCells: { range: R(0, 12, 0, NCOL) } });

  // 열 너비
  const widths = [46, 84, 96, 96, 92, 68, 62, 84, 74, 330, 300, 200, 150];
  widths.forEach((w, i) => req.push({
    updateDimensionProperties: {
      range: { sheetId: SID, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: w }, fields: 'pixelSize',
    },
  }));
  // 행 높이 — 타이틀/스페이서
  const rowH = { 0: 40, 1: 22, 2: 8, 3: 20, 4: 34, 8: 10, 9: 26, 10: 30 };
  Object.entries(rowH).forEach(([r, h]) => req.push({
    updateDimensionProperties: {
      range: { sheetId: SID, dimension: 'ROWS', startIndex: +r, endIndex: +r + 1 },
      properties: { pixelSize: h }, fields: 'pixelSize',
    },
  }));

  // 시트 전체 바탕 흰색 + 기본 글꼴
  req.push(fmt(R(0, 400, 0, NCOL),
    { backgroundColor: WHITE, textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, foregroundColor: INK } },
    'backgroundColor,textFormat'));

  // 타이틀 밴드
  req.push({ mergeCells: { range: R(0, 1, 0, NCOL), mergeType: 'MERGE_ALL' } });
  req.push({ mergeCells: { range: R(1, 2, 0, NCOL), mergeType: 'MERGE_ALL' } });
  req.push(fmt(R(0, 1, 0, NCOL), {
    backgroundColor: TITLE_BG,
    horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
    padding: { left: 14 },
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 16, bold: true, foregroundColor: WHITE },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,padding,textFormat'));
  req.push(fmt(R(1, 2, 0, NCOL), {
    backgroundColor: TITLE_BG,
    horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
    padding: { left: 14 },
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 9, foregroundColor: C(186, 200, 220) },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,padding,textFormat'));

  // KPI 타일 (A4:E5)
  req.push(fmt(R(3, 4, 0, 5), {
    backgroundColor: KPI_BG, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 9, bold: true, foregroundColor: C(70, 82, 100) },
    borders: { top: solid(BORD), left: solid(BORD), right: solid(BORD) },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,textFormat,borders'));
  req.push(fmt(R(4, 5, 0, 5), {
    backgroundColor: KPI_BG, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 16, bold: true, foregroundColor: TITLE_BG },
    borders: { bottom: solid(BORD), left: solid(BORD), right: solid(BORD) },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,textFormat,borders'));
  // 최근 기록일은 숫자가 아니라 날짜문자 → 조금 작게
  req.push(fmt(R(4, 5, 4, 5), {
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 13, bold: true, foregroundColor: ACCENT },
  }, 'textFormat'));

  // 팀별 최신 확정 인원 (H4:J8)
  req.push({ mergeCells: { range: R(3, 4, 7, 10), mergeType: 'MERGE_ALL' } });
  req.push(fmt(R(3, 4, 7, 10), {
    backgroundColor: HEAD_BG, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, bold: true, foregroundColor: WHITE },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,textFormat'));
  req.push(fmt(R(4, 5, 7, 10), {
    backgroundColor: SUB_BG, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 9, bold: true, foregroundColor: INK },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,textFormat'));
  req.push(fmt(R(5, 8, 7, 10), {
    horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, foregroundColor: INK },
  }, 'horizontalAlignment,verticalAlignment,textFormat'));
  req.push(fmt(R(5, 8, 8, 9), {
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 12, bold: true, foregroundColor: TITLE_BG },
  }, 'textFormat'));
  req.push({
    updateBorders: {
      range: R(3, 8, 7, 10),
      top: solid(HEAD_BG), bottom: solid(BORD), left: solid(BORD), right: solid(BORD),
      innerHorizontal: solid(C(232, 236, 242)), innerVertical: solid(C(232, 236, 242)),
    },
  });

  // 섹션 헤더 (A10:M10)
  req.push({ mergeCells: { range: R(9, 10, 0, NCOL), mergeType: 'MERGE_ALL' } });
  req.push(fmt(R(9, 10, 0, NCOL), {
    backgroundColor: WHITE, horizontalAlignment: 'LEFT', verticalAlignment: 'BOTTOM',
    padding: { left: 2, bottom: 3 },
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 11, bold: true, foregroundColor: TITLE_BG },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,padding,textFormat'));
  req.push({ updateBorders: { range: R(9, 10, 0, NCOL), bottom: { style: 'SOLID_MEDIUM', width: 2, color: ACCENT } } });

  // 로그 헤더 (A11:M11)
  req.push(fmt(R(10, 11, 0, NCOL), {
    backgroundColor: HEAD_BG, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    wrapStrategy: 'CLIP',
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 9, bold: true, foregroundColor: WHITE },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat'));

  // 데이터 영역 기본
  req.push(fmt(R(FIRST - 1, LAST, 0, NCOL), {
    verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, foregroundColor: INK },
    borders: { left: solid(C(235, 238, 243)), right: solid(C(235, 238, 243)), bottom: solid(C(238, 241, 245)) },
  }, 'verticalAlignment,wrapStrategy,textFormat,borders'));
  // 정렬: No/일자/발신/수신/대상팀/구분/인원/담당자/상태 = 가운데
  req.push(fmt(R(FIRST - 1, LAST, 0, 9), { horizontalAlignment: 'CENTER' }, 'horizontalAlignment'));
  // 기록/상세/후속/비고 = 왼쪽 + 여백
  req.push(fmt(R(FIRST - 1, LAST, 9, NCOL), { horizontalAlignment: 'LEFT', padding: { left: 8 } }, 'horizontalAlignment,padding'));
  // 일자 서식
  req.push(fmt(R(FIRST - 1, LAST, 1, 2), { numberFormat: { type: 'DATE', pattern: 'yy.mm.dd' } }, 'numberFormat'));
  // 인원 서식
  req.push(fmt(R(FIRST - 1, LAST, 6, 7), { numberFormat: { type: 'NUMBER', pattern: '#,##0"명"' } }, 'numberFormat'));
  // 기록 열 강조
  req.push(fmt(R(FIRST - 1, LAST, 9, 10), {
    backgroundColor: C(250, 251, 253),
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 10, bold: true, foregroundColor: TITLE_BG },
  }, 'backgroundColor,textFormat'));
  // No 열
  req.push(fmt(R(FIRST - 1, LAST, 0, 1), {
    backgroundColor: C(250, 251, 253),
    textFormat: { fontFamily: 'Malgun Gothic', fontSize: 9, foregroundColor: C(120, 130, 145) },
  }, 'backgroundColor,textFormat'));
  // 바깥 테두리
  req.push({
    updateBorders: {
      range: R(10, LAST, 0, NCOL),
      top: solid(HEAD_BG), bottom: { style: 'SOLID_MEDIUM', width: 2, color: RULE },
      left: solid(RULE), right: solid(RULE),
    },
  });

  // 줄무늬 (헤더 제외)
  req.push({
    addBanding: {
      bandedRange: {
        range: R(FIRST - 1, LAST, 0, NCOL),
        rowProperties: { firstBandColor: WHITE, secondBandColor: BAND },
      },
    },
  });

  // 드롭다운
  const dv = (c0, c1, list) => req.push({
    setDataValidation: {
      range: R(FIRST - 1, LAST, c0, c1),
      rule: {
        condition: { type: 'ONE_OF_LIST', values: list.map((v) => ({ userEnteredValue: v })) },
        showCustomUi: true, strict: false,
      },
    },
  });
  dv(2, 3, TEAMS);      // 발신
  dv(3, 4, TEAMS);      // 수신
  dv(4, 5, TARGETS);    // 대상팀
  dv(5, 6, KINDS);      // 구분
  dv(8, 9, STATES);     // 상태

  // 상태 색상 (조건부 서식)
  const cf = (col, value, bg, fg) => req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(FIRST - 1, LAST, col, col + 1)],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
          format: { backgroundColor: bg, textFormat: { bold: true, foregroundColor: fg } },
        },
      },
      index: 0,
    },
  });
  cf(8, '확정', OK_BG, OK_FG);
  cf(8, '진행중', GO_BG, GO_FG);
  cf(8, '보류', HD_BG, HD_FG);
  cf(8, '취소', XX_BG, XX_FG);
  cf(5, '확정', OK_BG, OK_FG);
  cf(5, '이슈', C(253, 231, 231), C(150, 40, 40));
  cf(5, '요청', GO_BG, GO_FG);

  // 취소 행은 전체를 흐리게
  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(FIRST - 1, LAST, 0, NCOL)],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$I${FIRST}="취소"` }] },
          format: { textFormat: { foregroundColor: C(150, 156, 165), strikethrough: true } },
        },
      },
      index: 0,
    },
  });

  // 틀 고정 + 필터
  req.push({
    updateSheetProperties: {
      // 열 고정은 하지 않는다 — 제목/섹션 밴드가 A:M 전체 병합이라 열 고정과 충돌한다.
      properties: { sheetId: SID, gridProperties: { frozenRowCount: 11, frozenColumnCount: 0 } },
      fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    },
  });
  req.push({ setBasicFilter: { filter: { range: R(10, LAST, 0, NCOL) } } });

  await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: req } });
  console.log(`완료 — 서식 요청 ${req.length}건, 값 ${rows.length}건`);
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; });
