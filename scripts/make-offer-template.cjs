// 처우산정표 전용 템플릿 탭을 만든다.
//
// 왜: 후보자마다 최근 탭을 복제해 쓰면 지우다 만 값이 섞여 들어간다.
// 사람 정보만 비운 고정 템플릿을 하나 두고 앞으로는 이것만 복제한다.
// 기존 70개 탭은 하나도 건드리지 않는다.
//
// 원본: '품질보증팀(문서관리) 정세완(협의완료)' — 처우 산정 블록이 전부 호봉표 VLOOKUP 수식이라
// 호봉/단계 코드 한 칸만 넣으면 시급·기본급·시간외수당·PI가 자동 계산된다.
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const ID = '1sER6Q5NqqQpjruBKmMMTr0-ccwfhMsTRjnBz24U6d3o';
const SRC_TAB = '품질보증팀(문서관리) 정세완(협의완료)';
const TPL_TAB = '_템플릿(수정금지)';
const DRY = process.env.DRYRUN === '1';

/** 사람마다 달라지는 칸 — 템플릿에서는 비운다. 라벨과 수식은 그대로 둔다. */
const CLEAR_CELLS = [
  // 1. 인적사항
  'C5', 'E5', 'G5', 'I5',
  'C6', 'E6', 'G6', 'I6',
  'C7', 'E7', 'G7', 'I7',
  // 2. 경력사항 (3줄 + 요약)
  'B10', 'D10', 'G10', 'I10',
  'B11', 'D11', 'G11', 'I11',
  'B12', 'D12', 'G12', 'I12',
  'C13', 'F13', 'I13',
  // 3. 현재 처우 (E18은 SUM 수식이라 유지)
  'E16', 'E17',
  // 4. 희망처우
  'C20',
  // 5. 처우 산정 — Option 제목에도 원본 후보자 문구가 남는다
  'B22', 'B40', 'B63',
  // Option 1 (확정직급·호봉코드·산정근거)
  'C23', 'E23', 'C39',
  // Option 2 (별도책정형 — 계약연봉을 넣으면 시급을 역산한다)
  'C41', 'E41', 'E51', 'C62',
  // Option 3
  'C64', 'E64',
];
/** 수당류는 빈칸이 아니라 0으로 — SUM 수식이 빈칸을 만나면 결과가 흐려진다 */
const ZERO_CELLS = ['E29', 'E30', 'E47', 'E48', 'E49'];

async function auth() {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const o = new google.auth.OAuth2(t.clientId, t.clientSecret);
  o.setCredentials({ refresh_token: t.refresh_token });
  await o.getAccessToken();
  return google.sheets({ version: 'v4', auth: o });
}

(async () => {
  const s = await auth();
  const meta = await s.spreadsheets.get({ spreadsheetId: ID, fields: 'sheets(properties(sheetId,title,index))' });
  const byTitle = new Map(meta.data.sheets.map((x) => [x.properties.title, x.properties]));

  const src = byTitle.get(SRC_TAB);
  if (!src) throw new Error(`원본 탭을 찾을 수 없습니다: ${SRC_TAB}`);
  if (byTitle.get(TPL_TAB)) {
    console.log('이미 있습니다: %s (gid=%s) — 새로 만들지 않습니다.', TPL_TAB, byTitle.get(TPL_TAB).sheetId);
    return;
  }

  // 원본 백업 — 복제 전 상태를 파일로 남긴다
  const backup = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${SRC_TAB}'!A1:Z70`, valueRenderOption: 'FORMULA',
  })).data.values || [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(__dirname, `_backup_offertpl_${stamp}.json`), JSON.stringify(backup, null, 1));
  console.log('백업 저장: _backup_offertpl_%s.json (%d행)', stamp, backup.length);

  if (DRY) {
    console.log('[DRYRUN] 복제 대상: %s (gid=%s) → %s', SRC_TAB, src.sheetId, TPL_TAB);
    console.log('[DRYRUN] 비울 칸 %d개 / 0으로 채울 칸 %d개', CLEAR_CELLS.length, ZERO_CELLS.length);
    return;
  }

  // 1) 복제 — 호봉표 바로 뒤(index 1)에 둬서 눈에 띄게
  const dup = await s.spreadsheets.batchUpdate({
    spreadsheetId: ID,
    requestBody: {
      requests: [{ duplicateSheet: { sourceSheetId: src.sheetId, insertSheetIndex: 1, newSheetName: TPL_TAB } }],
    },
  });
  const newId = dup.data.replies[0].duplicateSheet.properties.sheetId;
  console.log('복제 완료: %s (gid=%s)', TPL_TAB, newId);

  // 2) 사람 정보만 비운다
  const data = [
    ...CLEAR_CELLS.map((a1) => ({ range: `'${TPL_TAB}'!${a1}`, values: [['']] })),
    ...ZERO_CELLS.map((a1) => ({ range: `'${TPL_TAB}'!${a1}`, values: [[0]] })),
    // 안내 문구 — 이 탭을 직접 고치면 앞으로 만드는 모든 산정표가 같이 바뀐다
    { range: `'${TPL_TAB}'!K2`, values: [['※ 이 탭은 처우산정표 템플릿입니다. 직접 수정하지 마세요.']] },
    { range: `'${TPL_TAB}'!K3`, values: [['앱 [처우산정표 만들기] 버튼이 이 탭을 복제해 후보자별 탭을 만듭니다.']] },
  ];
  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: ID, requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
  console.log('비우기 완료: %d칸', data.length);

  // 3) 확인 — 라벨과 수식이 남아 있는지
  const after = (await s.spreadsheets.values.get({
    spreadsheetId: ID, range: `'${TPL_TAB}'!A1:Z60`, valueRenderOption: 'FORMULA',
  })).data.values || [];
  const formulas = after.flat().filter((c) => String(c || '').startsWith('=')).length;
  console.log('검증: 남은 수식 %d개 (원본 %d개)', formulas,
    backup.flat().filter((c) => String(c || '').startsWith('=')).length);
  console.log('링크: https://docs.google.com/spreadsheets/d/%s/edit#gid=%s', ID, newId);
})().catch((e) => console.error('ERR', e.message));
