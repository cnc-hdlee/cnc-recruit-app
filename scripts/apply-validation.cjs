/* RAW DATA_정리본: 드롭다운(데이터 검증) + 날짜 달력입력 일괄 적용
 * - 채널: 표준+확장 마스터 목록 드롭다운
 * - 범주형 컬럼 대부분 드롭다운
 * - 날짜 7개 컬럼: 날짜형식(yyyy-mm-dd) + 달력 date picker
 * 모두 strict=false (기존 값 거절 안 함, 경고만) → 기존 1273행 보존
 * 사용: node apply-validation.cjs           (계획만)
 *      node apply-validation.cjs --write     (실제 적용)
 */
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const SS_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const SHEET = 'RAW DATA_정리본';
const GID = 55388169;
const WRITE = process.argv.includes('--write');
const LASTROW = 2000; // 향후 입력분까지 검증 적용

// 채널 마스터: 기존 주요값 + 신규 플랫폼 (표준 표기로 통합)
const CHANNELS = [
  // 채용 플랫폼
  '사람인','사람인 인재풀','잡코리아','원티드','인크루트','리멤버','리멤버 인재풀',
  '링크드인','인디드','캐치','점핏','로켓펀치','블라인드','당근','알바몬','알바천국',
  // 공공/정부
  '고용24','구인24','워크넷','일자리센터','채용박람회','병역일터','산업기능요원','정부기관',
  // 추천/서치펌
  '직원추천','내부추천','지인추천','서치펌','재입사',
  // 학교/산학
  '대학교 추천','산학협력','현장실습','고등학교','특성화고',
  // 자사/기타
  '자사 채용홈페이지','공모전','도급사','인재Pool','기타',
];

// 범주형 드롭다운 정의: [열인덱스, 옵션목록]
const DROPDOWNS = [
  [1,  ['COO','CRIO','CBO','CFO','크리에이티브솔루션']],                                 // B 본부
  [2,  ['영업본부','경영기획본부','생산본부','MakeUp Center','Skin Science Center','크리에이티브 솔루션 본부']], // C 센터
  [3,  ['직속','KPD실','GPD실','CFO Office실','People&Culture실','Workplace Experience실','제조부','생산1부','생산3부','SC Innovation Lab']], // D 실/부
  [6,  ['신규','대체','충원','결원','증원','전환']],                                       // G 채용유형
  [7,  ['그린','퍼플','수원','3공장']],                                                    // H 근무지
  [9,  ['신입','경력','인턴']],                                                            // J 신입/경력
  [10, CHANNELS],                                                                          // K 채널
  [13, ['합격','불합격','보류','검토중']],                                                 // N 서류_결과
  [14, ['합격','불합격','보류','불참','면접포기']],                                        // O 1차면접_결과
  [16, ['합격','불합격','보류','불참','면접포기']],                                        // Q 2차면접_결과
  [18, ['통과','불통과','진행중']],                                                        // S CPI_결과
  [20, ['동의','거절','협의중']],                                                          // U 처우협의_결과
  [22, ['합격','탈락','진행중','보류']],                                                   // W 최종상태
  [23, ['서류','1차면접','2차면접','CPI','처우협의','면접포기']],                          // X 탈락단계
  [27, ['지원접수','서류 합격','1차 면접','1차 합격','2차 면접','2차 합격','CPI','처우 동의','입사','서류 탈락','1차 탈락','2차 탈락','포기']], // AB 현재단계
];

// 날짜 컬럼(달력 입력): M,P,R,T,V,Y,Z
const DATECOLS = [12, 15, 17, 19, 21, 24, 25];

const colLetter = (i) => { let s=''; i+=1; while(i>0){const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26);} return s; };
const rng = (c0, c1) => ({ sheetId: GID, startRowIndex: 1, endRowIndex: LASTROW, startColumnIndex: c0, endColumnIndex: c1 });

function buildRequests() {
  const reqs = [];
  // 그리드 행 확장
  reqs.push({ updateSheetProperties: { properties: { sheetId: GID, gridProperties: { rowCount: LASTROW } }, fields: 'gridProperties.rowCount' } });

  // 드롭다운
  for (const [idx, opts] of DROPDOWNS) {
    reqs.push({ setDataValidation: {
      range: rng(idx, idx+1),
      rule: { condition: { type: 'ONE_OF_LIST', values: opts.map(v => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
    }});
  }

  // 날짜: 형식 + date picker
  for (const idx of DATECOLS) {
    reqs.push({ repeatCell: {
      range: rng(idx, idx+1),
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
      fields: 'userEnteredFormat.numberFormat',
    }});
    reqs.push({ setDataValidation: {
      range: rng(idx, idx+1),
      rule: { condition: { type: 'DATE_IS_VALID' }, showCustomUi: true, strict: false },
    }});
  }
  return reqs;
}

async function main() {
  console.log(`채널 옵션: ${CHANNELS.length}개`);
  console.log(`드롭다운 컬럼: ${DROPDOWNS.map(([i])=>colLetter(i)).join(', ')}`);
  console.log(`날짜 달력 컬럼: ${DATECOLS.map(colLetter).join(', ')}`);
  const reqs = buildRequests();
  console.log(`총 batchUpdate 요청: ${reqs.length}개, 적용범위 행 2~${LASTROW}`);

  if (!WRITE) { console.log('\n[DRY] --write 시 실제 적용'); return; }
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SS_ID, requestBody: { requests: reqs } });
  console.log('\n[WRITE] 완료: 드롭다운 + 날짜 달력 적용됨.');
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
