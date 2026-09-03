// 처우산정표 — 후보자별 탭을 만들고 인적사항을 채운다.
//
// 흐름: '_템플릿(수정금지)' 탭 복제 → '부서_이름(작성중)'으로 이름 지정 → 인적사항 기입 → 링크 반환.
//
// 금액은 절대 자동으로 채우지 않는다. 연봉·기본급 같은 숫자는 오발송 시 사고가 크기 때문에
// 형도님이 직접 넣는 게 원칙이다(메모리: 처우협의 메일은 무조건 수동).
// 대신 호봉/단계 코드 한 칸만 넣으면 기준시급·기본급·시간외수당·PI가 호봉표에서 자동 계산된다.
//
// 인증: 이 워크북은 앱이 만든 파일이 아니라 drive.file 스코프로는 못 건드린다.
// 시트 작업용 토큰(scripts/.dash-tokens.json)을 쓴다 — 대시보드 스크립트들과 같은 자격증명.
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const store = require('./store.cjs');

const SHEET_ID = '1sER6Q5NqqQpjruBKmMMTr0-ccwfhMsTRjnBz24U6d3o';
const TPL_TAB = '_템플릿(수정금지)';
const SHEET_URL = (gid) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${gid}`;

/** 템플릿 좌표 — 템플릿 탭 구조가 바뀌면 여기만 고치면 된다 */
const CELL = {
  성명: 'C5', 생년월일: 'E5', 성별: 'G5', 연락처: 'I5',
  지원부서: 'C6', 지원직무: 'E6', 지원직급: 'G6', 입사예정일: 'I6',
  최종학력: 'C7', 전공: 'E7', 학위: 'G7', 비고: 'I7',
  총경력: 'C13', 관련경력: 'F13', 직전연봉: 'I13',
};
/** 경력 3줄 — 근무처 / 담당업무·직위 / 근무기간 / 연봉 */
const CAREER_ROWS = [10, 11, 12];

function tokensPath() {
  // 개발 중에는 저장소 안, 배포본에서는 앱 설정에 넣어둔 값을 쓴다
  const inRepo = path.join(__dirname, '..', '..', 'scripts', '.dash-tokens.json');
  return fs.existsSync(inRepo) ? inRepo : null;
}

function creds() {
  const p = tokensPath();
  if (p) return JSON.parse(fs.readFileSync(p, 'utf8'));
  const saved = store.get('sheetWriteTokens');
  if (saved) return saved;
  throw new Error('시트 쓰기용 인증 정보가 없습니다 (scripts/.dash-tokens.json)');
}

async function api() {
  const t = creds();
  const o = new google.auth.OAuth2(t.clientId, t.clientSecret);
  o.setCredentials({ refresh_token: t.refresh_token });
  await o.getAccessToken();
  return google.sheets({ version: 'v4', auth: o });
}

/** 탭 이름에 못 쓰는 문자 정리 — 구글 시트는 대괄호·콜론 등을 거부한다 */
const safeTabName = (s) => String(s || '').replace(/[[\]:\\/?*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

/** 이 후보자의 산정표가 이미 있는지 — 이름이 들어간 탭을 찾는다 */
function findExisting(sheets, candidate) {
  const key = String(candidate || '').replace(/\s+/g, '');
  if (!key) return null;
  return sheets.find((x) => x.properties.title.replace(/\s+/g, '').includes(key)) || null;
}

/**
 * 후보자 처우산정표 탭을 만든다.
 * 이미 있으면 만들지 않고 그 탭을 돌려준다 — 같은 사람 산정표가 두 개면 어느 게 맞는지 알 수 없다.
 */
async function createOfferSheet(info) {
  const s = await api();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets(properties(sheetId,title,index))' });
  const sheets = meta.data.sheets;

  const dup = findExisting(sheets, info.candidate);
  if (dup) {
    return {
      created: false, existed: true,
      tab: dup.properties.title, gid: dup.properties.sheetId, url: SHEET_URL(dup.properties.sheetId),
    };
  }

  const tpl = sheets.find((x) => x.properties.title === TPL_TAB);
  if (!tpl) throw new Error(`템플릿 탭이 없습니다: ${TPL_TAB}`);

  const dept = (info.team || '').trim();
  const title = safeTabName(`${dept ? dept + '_' : ''}${info.candidate}(작성중)`);

  const r = await s.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ duplicateSheet: { sourceSheetId: tpl.properties.sheetId, insertSheetIndex: 2, newSheetName: title } }],
    },
  });
  const gid = r.data.replies[0].duplicateSheet.properties.sheetId;

  // 인적사항 — 앱이 아는 것만. 금액 칸은 손대지 않는다.
  const put = [];
  const set = (a1, v) => {
    if (v === undefined || v === null || v === '') return;
    put.push({ range: `'${title}'!${a1}`, values: [[v]] });
  };
  set(CELL.성명, info.candidate);
  set(CELL.연락처, info.phone);
  set(CELL.지원부서, info.team);
  set(CELL.지원직무, info.job);
  set(CELL.지원직급, info.grade);
  set(CELL.생년월일, info.birth);
  set(CELL.성별, info.gender);
  set(CELL.최종학력, info.school);
  set(CELL.전공, info.major);
  set(CELL.학위, info.degree);
  set(CELL.총경력, info.careerTotal);
  // 템플릿 안내 문구는 후보자 탭에서는 지운다
  put.push({ range: `'${title}'!K2:K3`, values: [[''], ['']] });

  // 경력 3줄
  for (let i = 0; i < CAREER_ROWS.length; i++) {
    const c = (info.careers || [])[i];
    if (!c) continue;
    const row = CAREER_ROWS[i];
    if (c.company) put.push({ range: `'${title}'!B${row}`, values: [[c.company]] });
    if (c.role) put.push({ range: `'${title}'!D${row}`, values: [[c.role]] });
    if (c.period) put.push({ range: `'${title}'!G${row}`, values: [[c.period]] });
  }

  if (put.length) {
    await s.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: put },
    });
  }

  return { created: true, existed: false, tab: title, gid, url: SHEET_URL(gid), filled: put.length };
}

/**
 * 처우산정표 진행 상태를 탭 이름에서 읽는다.
 * 탭 이름이 곧 상태다 — (작성중) → (작성완료) → (협의완료) / (입사포기).
 * 앱이 후보자 단계를 자동 판정할 때 쓴다.
 */
async function listOfferSheets() {
  const s = await api();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets(properties(sheetId,title))' });
  const out = [];
  for (const x of meta.data.sheets) {
    const t = x.properties.title;
    if (t === TPL_TAB || t === '호봉표' || t === 'TEST') continue;
    const m = t.match(/[(（]\s*([^)）]+)\s*[)）]\s*$/);
    const status = m ? m[1].replace(/\s+/g, '') : '';
    // 탭 이름에서 사람 이름만 — "부서_이름(상태)" / "부서 - 이름(상태)" 둘 다 대응
    const head = t.replace(/[(（][^)）]*[)）]\s*$/, '').trim();
    const name = (head.split(/[_\-—–]/).pop() || head).trim();
    out.push({ tab: t, gid: x.properties.sheetId, name, status, url: SHEET_URL(x.properties.sheetId) });
  }
  return { sheetId: SHEET_ID, items: out };
}

module.exports = { createOfferSheet, listOfferSheets, SHEET_ID, SHEET_URL };
