/**
 * IncomingHiresSync.gs  (탭별 관리 버전)
 * --------------------------------------------------------------------------
 * 입사예정(정규직)DB  ->  입사예정일별 "탭" 자동 생성/관리
 *
 *  - 소스 "입사예정(정규직)DB" 탭(gid=492189701)을 읽어
 *    입사예정일마다 탭을 하나씩 만든다.  (탭 이름: "입사 2026-06-08" 형태)
 *  - 각 탭 1행 양식은 2026-05-20 입사자 관리 헤더 그대로:
 *      입사예정일 | 본부명 | 팀명 | 직무 | 직급 | 신입/경력 | 성명 | 성별 |
 *      근무지 | 입사안내 | 직/간접분류 | 연락처 | 건강검진 영수증
 *  - 전원 포함(결재완료/결재중/상신예정 모두).
 *  - 손으로 적은 "입사안내", "건강검진 영수증" O 표시는 성명+연락처 기준으로 보존.
 *  - DB가 바뀌면 1시간마다 자동 갱신(트리거).  메뉴로 즉시 실행도 가능.
 *  - 입사 OO 탭만 관리한다. 다른 탭은 절대 건드리지 않음.
 *
 * 설치 (딱 한 번)
 *  1) 이 시트(1lTtxMy...)에서  확장 프로그램 > Apps Script
 *  2) 내용 전체 붙여넣기 > 저장
 *  3) 함수목록에서 setup 선택 > 실행 (Google 권한 1회 승인)
 *     -> 즉시 탭들 생성 + 1시간마다 자동 트리거 설치 + 메뉴 추가
 * --------------------------------------------------------------------------
 */

var SOURCE_ID  = '1CS2o71Ome6ER_tGx6XhRM2BdXG4spOfEaHWu_CtGobY';
var SOURCE_GID = 492189701;
var TARGET_ID  = '1lTtxMy6kSzMhwu57boV2mbkpUuUxPjYLbdts5ZxC0zw';

// 2026-05-20 입사자 관리 1행 항목 (이 순서 그대로)
var HEADERS = ['입사예정일','본부명','팀명','직무','직급','신입/경력','성명','성별','근무지','입사안내','직/간접분류','연락처','건강검진 영수증'];
var TAB_PREFIX = '입사 ';   // 이 접두어가 붙은 탭만 스크립트가 관리

// ===== 한 번에 설치 =====
function setup() {
  installTrigger();
  syncIncomingHires();
  try { SpreadsheetApp.getActiveSpreadsheet().toast('설치 완료. 날짜별 탭이 생성되고 1시간마다 자동 갱신됩니다.', '입사자 동기화', 6); } catch (e) {}
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('입사자 동기화')
    .addItem('지금 동기화', 'syncIncomingHires')
    .addSeparator()
    .addItem('자동 트리거 설치(1시간)', 'installTrigger')
    .addItem('자동 트리거 제거', 'removeTriggers')
    .addToUi();
}

function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('syncIncomingHires').timeBased().everyHours(1).create();
}
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncIncomingHires') ScriptApp.deleteTrigger(t);
  });
}

// ===== 유틸 =====
function getSheetByGid(ss, gid) {
  var s = ss.getSheets();
  for (var i = 0; i < s.length; i++) if (s[i].getSheetId() === gid) return s[i];
  return null;
}
function fmtDate(v) {
  if (v === '' || v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]')
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(v).trim();
  var m = s.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
  return m ? (m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)) : s;
}
function normSite(v) {
  var s = String(v || '').trim();
  if (/퍼플/.test(s)) return '퍼플';
  if (/그린/.test(s)) return '그린';
  if (/수원/.test(s)) return '수원';
  return s;
}
function phoneKey(p) { return String(p || '').replace(/[^0-9]/g, ''); }

// ===== 소스 읽기 =====
function readSource() {
  var ss = SpreadsheetApp.openById(SOURCE_ID);
  var sh = getSheetByGid(ss, SOURCE_GID);
  if (!sh) throw new Error('소스 탭(gid=' + SOURCE_GID + ')을 못 찾음');
  var values = sh.getDataRange().getValues();

  var hRow = -1;
  for (var r = 0; r < values.length; r++) {
    var row = values[r].map(function (c) { return String(c).trim(); });
    if (row.indexOf('입사예정일') !== -1 && row.indexOf('성명') !== -1) { hRow = r; break; }
  }
  if (hRow === -1) throw new Error('소스 헤더 행을 못 찾음');

  var header = values[hRow].map(function (c) { return String(c).trim(); });
  function col(name) {
    for (var j = 0; j < header.length; j++) if (header[j].indexOf(name) === 0) return j;
    return -1;
  }
  var I = {
    date: col('입사예정일'), hq: col('본부명'), team: col('팀명'), job: col('직무'),
    rank: col('직급'), type: col('신입'), name: col('성명'), sex: col('성별'),
    site: col('근무지'), cat: col('직/간접'), phone: col('연락처')
  };

  var out = [];
  for (var k = hRow + 1; k < values.length; k++) {
    var v = values[k];
    var d = I.date >= 0 ? fmtDate(v[I.date]) : '';
    var nm = I.name >= 0 ? String(v[I.name]).trim() : '';
    if (d === '' && nm === '') break;   // 표 끝
    if (nm === '') continue;
    out.push({
      date: d || '미정',
      hq:   I.hq   >= 0 ? String(v[I.hq]).trim()   : '',
      team: I.team >= 0 ? String(v[I.team]).trim() : '',
      job:  I.job  >= 0 ? String(v[I.job]).trim()  : '',
      rank: I.rank >= 0 ? String(v[I.rank]).trim() : '',
      type: I.type >= 0 ? String(v[I.type]).trim() : '',
      name: nm,
      sex:  I.sex  >= 0 ? String(v[I.sex]).trim()  : '',
      site: normSite(I.site >= 0 ? v[I.site] : ''),
      cat:  I.cat  >= 0 ? String(v[I.cat]).trim()  : '',
      phone:I.phone>= 0 ? String(v[I.phone]).trim(): ''
    });
  }
  return out;
}

// ===== 기존 탭에서 수기 O(입사안내/건강검진) 보존 =====
function readManualMarks(sheet) {
  var marks = {};
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return marks;
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var head = data[0].map(function (c) { return String(c).trim(); });
  var ni = head.indexOf('성명'), pi = head.indexOf('연락처');
  var noticeI = head.indexOf('입사안내'), healthI = head.indexOf('건강검진 영수증');
  if (ni === -1) return marks;
  for (var i = 1; i < data.length; i++) {
    var nm = String(data[i][ni]).trim();
    if (!nm) continue;
    var kk = nm + '|' + (pi >= 0 ? phoneKey(data[i][pi]) : '');
    marks[kk] = {
      notice: noticeI >= 0 ? data[i][noticeI] : '',
      health: healthI >= 0 ? data[i][healthI] : ''
    };
  }
  return marks;
}

// ===== 메인 =====
function syncIncomingHires() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return; }
  try {
    var ss = SpreadsheetApp.openById(TARGET_ID);
    var rows = readSource();

    // 날짜별 그룹화
    var byDate = {};
    rows.forEach(function (r) { (byDate[r.date] = byDate[r.date] || []).push(r); });
    var dates = Object.keys(byDate).sort(function (a, b) {
      if (a === '미정') return 1; if (b === '미정') return -1;
      return a < b ? -1 : (a > b ? 1 : 0);
    });

    dates.forEach(function (d) {
      var tabName = TAB_PREFIX + d;                 // 예: "입사 2026-06-08"
      var sh = ss.getSheetByName(tabName);
      if (!sh) sh = ss.insertSheet(tabName);

      var marks = readManualMarks(sh);              // 기존 수기 O 보존
      sh.clear();

      var out = [HEADERS.slice()];
      byDate[d].forEach(function (r) {
        var m = marks[r.name + '|' + phoneKey(r.phone)] || {};
        out.push([
          r.date, r.hq, r.team, r.job, r.rank, r.type, r.name, r.sex, r.site,
          (m.notice || ''),   // 입사안내 (수기, 보존)
          r.cat,
          r.phone,
          (m.health || '')    // 건강검진 영수증 (수기, 보존)
        ]);
      });

      sh.getRange(1, 1, out.length, HEADERS.length).setValues(out);
      // 헤더 서식
      sh.getRange(1, 1, 1, HEADERS.length)
        .setBackground('#d9ead3').setFontWeight('bold').setFontColor('#000000')
        .setHorizontalAlignment('center');
      sh.setFrozenRows(1);
      sh.autoResizeColumns(1, HEADERS.length);
    });

    try { ss.toast('입사자 ' + rows.length + '명 / 날짜 탭 ' + dates.length + '개 동기화 완료', '입사자 동기화', 5); } catch (e) {}
  } finally {
    lock.releaseLock();
  }
}
