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
// 특정 탭으로 확실히 들어가는 링크.
//   ?gid=  — 해시만 바꾸면 브라우저가 이미 열린 같은 문서 탭을 다시 로드하지 않는다.
//   #gid=  — 시트가 읽는 표준 앵커.
//   &range=A1 — 구글 시트는 같은 문서를 다른 탭에서 열어두면 로드 후 '마지막 보던 시트'로
//               되돌린다. 범위 앵커가 있으면 그 시트의 셀을 선택해야 하므로 되돌아가지 않는다.
//               (호봉표로 튕기던 문제 — 2026-09-03)
const SHEET_URL = (gid) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${gid}#gid=${gid}&range=A1`;

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
  // 호봉표·TEST·템플릿은 후보자 탭이 아니다 — 이름이 짧으면 엉뚱하게 걸릴 수 있다
  const SKIP = ['호봉표', 'TEST', TPL_TAB];
  return (
    sheets.find(
      (x) => !SKIP.includes(x.properties.title) && x.properties.title.replace(/\s+/g, '').includes(key)
    ) || null
  );
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

  // 새 탭은 TEST 바로 다음에 — 호봉표·템플릿·TEST 같은 기준 탭 뒤, 기존 후보자 탭들 앞.
  // 맨 뒤에 붙이면 탭이 70개라 스크롤해야 보인다.
  const testIdx = sheets.findIndex((x) => x.properties.title === 'TEST');
  const insertAt = testIdx >= 0 ? sheets[testIdx].properties.index + 1 : 2;

  const r = await s.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        { duplicateSheet: { sourceSheetId: tpl.properties.sheetId, insertSheetIndex: insertAt, newSheetName: title } },
      ],
    },
  });
  const gid = r.data.replies[0].duplicateSheet.properties.sheetId;

  // 복제는 원본의 '숨김' 속성까지 물려받는다. 원본 탭이 숨겨져 있으면 새 탭도 숨겨져
  // 화면 탭 목록에 아예 안 나타난다(API로는 보이는데 사람 눈에는 없다 — 2026-09-03 사고).
  // 새로 만든 후보자 탭은 반드시 보이게 한다.
  await s.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ updateSheetProperties: { properties: { sheetId: gid, hidden: false }, fields: 'hidden' } }],
    },
  });

  // 이력서에서 읽을 수 있는 건 읽어서 채운다 — 손으로 옮겨 적던 것들.
  // 호출 쪽이 준 값이 항상 우선한다(면접 일정에서 온 부서·직무가 더 정확하다).
  let prof = null;
  try {
    prof = await require('./resumes.cjs').profileByName(info.candidate);
  } catch {
    /* 이력서가 없거나 못 읽는 형식 — 인적사항만 비워둔 채로 만든다 */
  }
  const pick = (a, b) => (a !== undefined && a !== null && String(a).trim() !== '' ? a : b);

  // 인적사항 — 금액 칸은 손대지 않는다.
  const put = [];
  const set = (a1, v) => {
    if (v === undefined || v === null || v === '') return;
    put.push({ range: `'${title}'!${a1}`, values: [[v]] });
  };
  set(CELL.성명, info.candidate);
  set(CELL.연락처, pick(info.phone, prof && prof.phone));
  set(CELL.지원부서, info.team);
  set(CELL.지원직무, info.job);
  set(CELL.지원직급, info.grade);
  set(CELL.생년월일, pick(info.birth, prof && prof.birth));
  set(CELL.성별, pick(info.gender, prof && prof.gender));
  set(CELL.최종학력, pick(info.school, prof && prof.school));
  set(CELL.전공, pick(info.major, prof && prof.major));
  set(CELL.학위, pick(info.degree, prof && prof.degree));
  set(CELL.총경력, pick(info.careerTotal, prof && prof.careerTotal));
  // 직전연봉은 이력서에 적힌 값을 참고로만 넣는다 — 산정 금액은 여전히 수기다
  set(CELL.직전연봉, pick(info.lastSalary, prof && prof.lastSalary));
  // 템플릿 안내 문구는 후보자 탭에서는 지운다
  put.push({ range: `'${title}'!K2:K3`, values: [[''], ['']] });

  // 경력 3줄
  for (let i = 0; i < CAREER_ROWS.length; i++) {
    const c = (info.careers && info.careers[i]) || (prof && prof.careers && prof.careers[i]);
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

/**
 * 산정 결과를 앱으로 읽어온다 — 호봉 코드 하나만 넣으면 시트가 나머지를 계산해 두므로,
 * 그 계산된 값을 그대로 가져와 앱에서 보여준다. 앱은 절대 계산하지 않는다(시트가 유일한 기준).
 *
 * 행 번호가 아니라 라벨(B열 글자)로 찾는다. 탭마다 레이아웃이 조금씩 달라
 * 행 위치로 읽으면 옛 탭에서 시급을 기본급으로, 월급여를 연봉으로 잘못 가져온다
 * (2026-09-04 임한결 탭에서 실제로 그랬다).
 */
async function readOfferSheet(tab) {
  const s = await api();
  const rows =
    (
      await s.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${tab}'!A1:J120`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      })
    ).data.values || [];

  const cell = (r, colIdx) => (rows[r] || [])[colIdx];
  const text = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const num = (v) => (typeof v === 'number' ? v : Number(String(v || '').replace(/[^0-9.-]/g, '')) || 0);
  // 시트의 날짜는 일련번호로 온다(46265 = 2026-09-15). 사람이 읽는 형태로 바꾼다.
  const asDate = (v) => {
    if (typeof v !== 'number' || v < 20000 || v > 80000) return text(v);
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  };
  const C = 2;
  const Ec = 4;
  const Fc = 5;
  const G = 6;
  const I = 8;

  /** B열(가끔 A/C열)에서 라벨을 찾아 그 행 번호를 돌려준다 */
  const findRow = (labelRe, from = 0, to = rows.length) => {
    for (let r = from; r < to; r++) {
      const b = text((rows[r] || [])[1]) || text((rows[r] || [])[0]);
      if (b && labelRe.test(b)) return r;
    }
    return -1;
  };
  const valueAt = (labelRe, colIdx, from, to) => {
    const r = findRow(labelRe, from, to);
    return r < 0 ? undefined : cell(r, colIdx);
  };

  // ── 머리말 (인적사항)
  const 성명 = text(valueAt(/^성명$/, C, 0, 20));
  const 지원부서 = text(valueAt(/^지원부서$/, C, 0, 20));
  const 지원직무 = text(valueAt(/^지원부서$/, Ec, 0, 20));
  const 입사예정일 = asDate(valueAt(/^지원부서$/, I, 0, 20));
  const 총경력 = text(valueAt(/^총\s*경력/, C, 0, 30));
  const 인정경력 = text(valueAt(/^총\s*경력/, Fc, 0, 30));
  const 현재TC = num(valueAt(/Total\s*Compensation/i, Ec, 0, findRow(/^5\.|처우\s*산정/, 0) + 1));
  const 희망연봉 = text(valueAt(/희망\s*연봉/, C, 0, 40));

  // ── Option 블록 — "Option 1." 같은 줄을 기준으로 잘라 그 안에서만 라벨을 찾는다
  const heads = [];
  for (let r = 0; r < rows.length; r++) {
    const b = text((rows[r] || [])[1]);
    if (/^Option\s*\d/i.test(b)) heads.push({ row: r, title: b });
  }
  const options = [];
  heads.forEach((h, k) => {
    const from = h.row;
    const to = k + 1 < heads.length ? heads[k + 1].row : rows.length;
    const gradeRow = findRow(/확정\s*직급/, from, to);
    const grade = gradeRow < 0 ? '' : text(cell(gradeRow, C));
    const step = gradeRow < 0 ? '' : text(cell(gradeRow, Ec));
    const 계약연봉 = num(valueAt(/계약\s*연봉/, Ec, from, to));
    if (!grade && !step && !계약연봉) return; // 안 쓴 옵션
    const otRow = findRow(/시간외\s*근로\s*수당|시간외수당/, from, to);
    options.push({
      no: k + 1,
      title: h.title,
      grade,
      step,
      수습기간: gradeRow < 0 ? '' : text(cell(gradeRow, G)),
      기본급: num(valueAt(/^기본급$/, Ec, from, to)),
      시간외수당: otRow < 0 ? 0 : num(cell(otRow, Ec)),
      // 비고가 "고정OT시간 42H 기준" 형태라 시간만 뽑는다 — 메일의 (월 N시간)에 들어간다
      고정OT시간: otRow < 0 ? '' : (text(cell(otRow, G)).match(/(\d+(?:\.\d+)?)\s*H/i) || [])[1] || '',
      월급여액: num(valueAt(/월\s*급여/, Ec, from, to)),
      계약연봉,
      TC최소: num(valueAt(/최소/, Ec, from, to)),
      TC최대: num(valueAt(/최대/, Ec, from, to)),
      산정근거: text(valueAt(/산정\s*근거/, C, from, to)),
    });
  });

  return { tab, 성명, 지원부서, 지원직무, 입사예정일, 총경력, 인정경력, 현재TC, 희망연봉, options };
}

module.exports = { createOfferSheet, listOfferSheets, readOfferSheet, SHEET_ID, SHEET_URL };
