/**
 * ============================================================
 *  생산직 대시보드 — 미충원(TO) 24시간 클라우드 자동연동
 * ============================================================
 *  전사인원현황의 "미충원(직접) 생산1~4팀" 을 30분마다 자동으로
 *  생산직 대시보드 매트릭스(K9:K12)에 반영합니다.
 *  → PC를 꺼도, 앱을 안 켜도 구글 클라우드에서 알아서 돕니다.
 *
 *  [최초 1회 설정]
 *  1) https://script.google.com  →  "새 프로젝트"
 *  2) 이 코드 전체 붙여넣기
 *  3) 함수 목록에서  setupTrigger  선택  →  ▶ 실행
 *  4) 권한 동의 (본인 계정 / 스프레드시트 접근) — 1회만
 *     → 끝. 이후 30분마다 자동 갱신됩니다.
 *
 *  ※ 둘 다 같은 형도님 계정 소유라 IMPORTRANGE "액세스 허용" 같은
 *    별도 승인 없이 바로 읽고 씁니다.
 * ============================================================
 */

var DASH_ID = '1CcRpw2e7xjUY7b-GpFFegin-Xf94ip4m7Yix2WR3dyo'; // 생산직 RAW DATA 시트
var SRC_ID  = '1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY'; // 전사인원현황 시트
var SRC_TAB = '★전사인원현황';
var DASH_TAB = '대시보드';
var TEAMS = ['생산1팀', '생산2팀', '생산3팀', '생산4팀'];

/** 미충원(직접) 집계 → 대시보드 K9:K12 갱신 */
function syncMichungwon() {
  var src = SpreadsheetApp.openById(SRC_ID).getSheetByName(SRC_TAB);
  var n = src.getLastRow() - 2;
  if (n < 1) return;
  // B3부터 15열(B..P) : 0=팀, 1=구분, 14=미충원
  var rows = src.getRange(3, 2, n, 15).getValues();

  var to = {};
  TEAMS.forEach(function (t) { to[t] = 0; });
  rows.forEach(function (r) {
    var team = String(r[0]).trim();
    var gubun = String(r[1]).trim();
    var mi = Number(String(r[14]).replace(/[^0-9.\-]/g, '')) || 0;
    if (TEAMS.indexOf(team) >= 0 && gubun === '직접') to[team] += mi;
  });

  var dash = SpreadsheetApp.openById(DASH_ID).getSheetByName(DASH_TAB);
  dash.getRange('K9:K12').setValues(TEAMS.map(function (t) { return [to[t]]; }));
  Logger.log('미충원 동기화 완료: ' + JSON.stringify(to));
}

/** 최초 1회 실행 — 30분 자동 트리거 설치 + 즉시 1회 동기화 */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'syncMichungwon') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('syncMichungwon').timeBased().everyMinutes(30).create();
  syncMichungwon();
  Logger.log('설치 완료 — 30분마다 자동 실행됩니다.');
}
