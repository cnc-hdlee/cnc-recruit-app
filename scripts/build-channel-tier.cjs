// 입사현황_대시보드_test 에 "채용 경로 티어 관리" 표 추가 (A34:G52)
//   1QEvFE… / gid 2042774143
//
// 기존 레이아웃은 그대로 둔다 — A1:G31(경로별/팀별 현황), I3:M33(전환율/인당 획득비용),
// I35:M45(플랫폼별 모집 현황)은 한 셀도 건드리지 않는다. 비어 있던 A34:G52 만 사용.
//
// 모수/입사/전환율은 '입사예정(형도)' 에서 자동 집계, 비용은 기존 블록에서 끌어온다.
// (같은 값을 두 군데 입력하지 않기 위해 이 표는 "입력"이 아니라 "랭킹 뷰"로 만든다.
//  단 티어만 형도님이 직접 정하는 드롭다운.)
const fs = require('node:fs'), path = require('node:path'), { google } = require('googleapis');

const ID = '1QEvFEWjnXC1CNw6qAZ4ooFQUIxh36ow_9EL3hnM6ZoI';
const SID = 2042774143;
const TAB = '입사현황_대시보드_test';
const SRC = "'입사예정(형도)'";

const HEAD = 34;              // 섹션 헤더 행
const HDR  = 35;              // 열 헤더 행
const R0   = 36, R1 = 51;     // 데이터 행
const SUM  = 52;              // 합계 행
const NCOL = 7;               // A~G

// [경로, 시작 티어(초안)] — 티어는 드롭다운으로 언제든 바꿀 수 있습니다.
const CHANNELS = [
  ['에스텍플러스',     '1tier'],
  ['수원시일자리센터', '1tier'],
  ['용인시일자리센터', '2tier'],
  ['오산시일자리센터', '2tier'],
  ['뉴온',             '3tier'],
  ['리드커리어',       '3tier'],
  ['안성시일자리센터', '4tier'],
  ['화성시일자리센터', '4tier'],
  ['잡코리아',         '4tier'],
  ['유선문의',         '4tier'],
  ['우신',             '4tier'],
  ['세화',             '4tier'],
  ['경기도일자리센터', '4tier'],
  ['수원다문화센터',   '4tier'],
  ['사람인',           '보류'],
  ['당근알바',         '보류'],
];
const TIERS = ['1tier', '2tier', '3tier', '4tier', '보류', '중단'];

const C = (r, g, b) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const NAVY = C(46, 84, 150);     // #2e5496 — 기존 섹션 헤더
const BLUE = C(68, 114, 196);    // #4472c4 — 기존 열 헤더
const WHITE = C(255, 255, 255);
const INPUT = C(255, 242, 204);  // #fff2cc — 기존 입력칸 색
const BORD = C(191, 201, 216);
const ZEBRA = C(247, 249, 252);

const T1 = { bg: C(214, 240, 222), fg: C(20, 92, 50) };
const T2 = { bg: C(220, 233, 250), fg: C(26, 74, 126) };
const T3 = { bg: C(253, 240, 214), fg: C(130, 88, 10) };
const T4 = { bg: C(236, 238, 241), fg: C(96, 102, 112) };
const TH = { bg: C(252, 226, 226), fg: C(150, 40, 40) };

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

(async () => {
  const s = await auth();

  // 표가 들어갈 행이 모자라면 아래로만 늘린다 (기존 행/열은 그대로)
  const props = (await s.spreadsheets.get({
    spreadsheetId: ID, fields: 'sheets(properties(sheetId,gridProperties(rowCount)))',
  })).data.sheets.find((x) => x.properties.sheetId === SID).properties;
  if (props.gridProperties.rowCount < SUM + 2) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: ID,
      requestBody: { requests: [{ appendDimension: { sheetId: SID, dimension: 'ROWS', length: SUM + 2 - props.gridProperties.rowCount } }] },
    });
    console.log(`행 ${props.gridProperties.rowCount} → ${SUM + 2} 로 확장`);
  }

  // 안전장치 — A34:G52 가 비어 있을 때만 쓴다 (기존 데이터 덮어쓰기 방지)
  const cur = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TAB}'!A${HEAD}:G${SUM}`, valueRenderOption: 'FORMULA',
  })).data.values || [];
  const dirty = cur.some((r) => (r || []).some((c) => String(c).trim() !== ''));
  if (dirty && !process.argv.includes('--force')) {
    console.error('중단: A34:G52 에 이미 내용이 있습니다. 확인 후 --force 로 다시 실행하세요.');
    process.exitCode = 1; return;
  }

  // ------------------------------------------------------------ 값/수식
  const rows = [];
  const put = (a1, arr) => rows.push({ range: `'${TAB}'!${a1}`, values: [arr] });

  put(`A${HEAD}`, ['채용 경로 티어 관리']);
  put(`A${HDR}`, ['채용 경로', '티어', '모수(유입)', '입사', '전환율', '총 비용', '인당 비용']);

  CHANNELS.forEach(([name, tier], i) => {
    const r = R0 + i;
    put('A' + r, [
      name,
      tier,
      `=COUNTIF(${SRC}!$N:$N,$A${r})`,
      `=COUNTIFS(${SRC}!$N:$N,$A${r},${SRC}!$M:$M,"입사완료")`,
      `=IFERROR($D${r}/($D${r}+COUNTIFS(${SRC}!$N:$N,$A${r},${SRC}!$M:$M,"입사취소")),0)`,
      // 비용은 기존 "인당 획득비용" 블록(I19:M32) → 없으면 "플랫폼별 모집 현황"(I37:K45) 순으로 가져온다
      `=IFERROR(INDEX($M$19:$M$32,MATCH($A${r}&"*",$I$19:$I$32,0)),`
        + `IFERROR(INDEX($K$37:$K$45,MATCH($A${r}&"*",$I$37:$I$45,0)),0))`,
      `=IF($D${r}=0,"—",$F${r}/$D${r})`,
    ]);
  });

  put(`A${SUM}`, [
    '합계', '',
    `=SUM(C${R0}:C${R1})`,
    `=SUM(D${R0}:D${R1})`,
    `=IFERROR($D${SUM}/($D${SUM}+SUMPRODUCT(COUNTIFS(${SRC}!$N:$N,$A${R0}:$A${R1},${SRC}!$M:$M,"입사취소"))),0)`,
    `=SUM(F${R0}:F${R1})`,
    `=IF($D${SUM}=0,"—",$F${SUM}/$D${SUM})`,
  ]);

  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: ID, requestBody: { valueInputOption: 'USER_ENTERED', data: rows },
  });

  // ------------------------------------------------------------ 서식
  const req = [];

  // 재실행 대비 — 이 표 영역(34행 이하)에 걸린 조건부서식만 정리
  const meta = (await s.spreadsheets.get({
    spreadsheetId: ID, fields: 'sheets(properties(sheetId),conditionalFormats)',
  })).data.sheets.find((x) => x.properties.sheetId === SID);
  ((meta || {}).conditionalFormats || []).forEach((cf, i, arr) => {
    const own = (cf.ranges || []).every((rg) => (rg.startRowIndex || 0) >= HEAD - 1);
    if (own) req.push({ deleteConditionalFormatRule: { sheetId: SID, index: arr.length - 1 - i } });
  });

  // 섹션 헤더 (기존 A7/A26 과 동일)
  req.push({ mergeCells: { range: R(HEAD - 1, HEAD, 0, NCOL), mergeType: 'MERGE_ALL' } });
  req.push(fmt(R(HEAD - 1, HEAD, 0, NCOL), {
    backgroundColor: NAVY, verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT',
    textFormat: { fontSize: 11, bold: true, foregroundColor: WHITE },
  }, 'backgroundColor,verticalAlignment,horizontalAlignment,textFormat'));

  // 열 헤더 (기존 A8/A27 과 동일)
  req.push(fmt(R(HDR - 1, HDR, 0, NCOL), {
    backgroundColor: BLUE, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
    textFormat: { fontSize: 10, bold: true, foregroundColor: WHITE },
  }, 'backgroundColor,horizontalAlignment,verticalAlignment,textFormat'));
  req.push(fmt(R(HDR - 1, HDR, 0, 1), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'));

  // 데이터 영역
  req.push(fmt(R(R0 - 1, SUM, 0, NCOL), {
    backgroundColor: WHITE, verticalAlignment: 'MIDDLE',
    textFormat: { fontSize: 10, bold: false, foregroundColor: C(0, 0, 0) },
    borders: { top: solid(C(226, 231, 238)), bottom: solid(C(226, 231, 238)) },
  }, 'backgroundColor,verticalAlignment,textFormat,borders'));
  req.push(fmt(R(R0 - 1, SUM, 0, 1), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'));
  req.push(fmt(R(R0 - 1, SUM, 1, NCOL), { horizontalAlignment: 'CENTER' }, 'horizontalAlignment'));
  req.push(fmt(R(R0 - 1, SUM, 4, 5), { numberFormat: { type: 'PERCENT', pattern: '0%' } }, 'numberFormat'));
  req.push(fmt(R(R0 - 1, SUM, 5, 7), { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' }, 'numberFormat,horizontalAlignment'));

  // 티어 = 형도님이 정하는 입력칸 (기존 입력칸과 같은 크림색)
  req.push(fmt(R(R0 - 1, R1, 1, 2), {
    backgroundColor: INPUT, textFormat: { fontSize: 10, bold: true, foregroundColor: C(0, 0, 0) },
  }, 'backgroundColor,textFormat'));
  req.push({
    setDataValidation: {
      range: R(R0 - 1, R1, 1, 2),
      rule: {
        condition: { type: 'ONE_OF_LIST', values: TIERS.map((v) => ({ userEnteredValue: v })) },
        showCustomUi: true, strict: false,
      },
    },
  });

  // 합계 행
  req.push(fmt(R(SUM - 1, SUM, 0, NCOL), {
    backgroundColor: C(232, 238, 247),
    textFormat: { fontSize: 10, bold: true, foregroundColor: C(0, 0, 0) },
    borders: { top: { style: 'SOLID_MEDIUM', width: 2, color: BLUE } },
  }, 'backgroundColor,textFormat,borders'));

  // 바깥 테두리
  req.push({ updateBorders: { range: R(HDR - 1, SUM, 0, NCOL), top: solid(BLUE), bottom: solid(BORD), left: solid(BORD), right: solid(BORD) } });

  // 티어 색상
  const tierCf = (label, sty) => req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(R0 - 1, R1, 1, 2)],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: label }] },
          format: { backgroundColor: sty.bg, textFormat: { bold: true, foregroundColor: sty.fg } },
        },
      }, index: 0,
    },
  });
  tierCf('1tier', T1); tierCf('2tier', T2); tierCf('3tier', T3); tierCf('4tier', T4); tierCf('중단', TH);

  // 인당 비용 — 낮을수록 초록 (0원 = 무료 채널)
  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(R0 - 1, R1, 6, 7)],
        gradientRule: {
          minpoint: { color: C(214, 240, 222), type: 'MIN' },
          maxpoint: { color: C(250, 214, 214), type: 'MAX' },
        },
      }, index: 0,
    },
  });
  // 모수 대비 입사가 0인 경로는 흐리게
  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [R(R0 - 1, R1, 0, NCOL)],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=AND($C${R0}=0,$D${R0}=0)` }] },
          format: { textFormat: { foregroundColor: C(160, 166, 175) } },
        },
      }, index: 0,
    },
  });

  await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: req } });
  console.log(`완료 — 값 ${rows.length}건, 서식 ${req.length}건 (A${HEAD}:G${SUM})`);
})().catch((e) => { console.error('ERR', e.message); process.exitCode = 1; });
