/**
 * ============================================================
 *  CNC 생산직(외국인 근로자) 채용 RAW DATA + 대시보드 자동 생성기
 * ============================================================
 *
 *  사용법
 *  1) https://script.google.com  접속 → "새 프로젝트"
 *  2) 이 파일 내용 전체를 붙여넣기
 *  3) 상단에서 함수 [createProductionRecruitSheet] 선택 후 ▶ 실행
 *  4) 최초 1회 권한 동의 (본인 Google 계정 / 스프레드시트 생성 권한)
 *  5) 실행 로그(보기 > 로그)에 새로 만들어진 시트 URL 이 찍힘
 *
 *  ※ 기존 사무직 RAW DATA 시트는 절대 건드리지 않고,
 *    완전히 새로운 구글시트를 하나 만들어 줍니다.
 *  ※ 탭 2개: ① "생산직 RAW DATA"  ② "대시보드"
 * ============================================================
 */

function createProductionRecruitSheet() {
  var ss = SpreadsheetApp.create('CNC 생산직(외국인) 채용 RAW DATA');

  var raw = ss.getActiveSheet();
  raw.setName('생산직 RAW DATA');

  buildRawSheet_(raw);
  var dash = ss.insertSheet('대시보드');
  buildDashboard_(dash, '생산직 RAW DATA');

  // 대시보드를 첫 화면(왼쪽)으로 보내고 싶으면 아래 두 줄 주석 해제
  // ss.setActiveSheet(dash);
  // ss.moveActiveSheet(1);

  var url = ss.getUrl();
  Logger.log('=============================================');
  Logger.log(' 완료! 아래 URL 을 클릭하세요:');
  Logger.log(' ' + url);
  Logger.log('=============================================');
  return url;
}

/* ----------------------------------------------------------------
 *  ① 생산직 RAW DATA 시트
 * ---------------------------------------------------------------- */
function buildRawSheet_(sh) {
  // 헤더 (직무까지는 사무직 양식과 동일, 이후 생산직/외국인 전용 항목)
  var headers = [
    '관리번호',            // A  (사무직 채용요청문서번호 대응, 자유 채번)
    'Org1(본부)',          // B
    'Org2',                // C
    'Org3',                // D
    'Org4(팀)',            // E
    '직무',                // F  ← 여기까지 사무직과 동일
    '채용유형',            // G  결원/신규/대체/충원
    '근무지',              // H  공장/사이트
    '후보자명',            // I
    '성별',                // J
    '국적',                // K  ★외국인
    '체류자격(비자)',      // L  ★E-9/H-2/F-4/F-5/F-6/E-7 등
    '비자만료일',          // M  ★노무관리용
    '유입경로',            // N  ★어떻게 들어왔나
    '센터지역',            // O  ★일자리센터: 화성/오산/수원/안성/용인
    '이력서_링크',         // P
    '접수일',              // Q
    '서류_결과',           // R  합격/불합격/생략
    '면접_결과',           // S  합격/불합격/면접포기/대기
    '면접_일자',           // T
    '건강검진_결과',       // U  적합/부적합/대기/-
    '최종상태',            // V  진행중/입사/탈락/포기
    '탈락단계',            // W  서류/면접/건강검진/-
    '입사예정일',          // X
    '실제입사일',          // Y
    '비고',                // Z
    '현재단계(자동)',      // AA
    '총소요일수(자동)'     // AB
  ];
  var nCols = headers.length; // 28

  sh.getRange(1, 1, 1, nCols).setValues([headers])
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1f3864')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.setRowHeight(1, 42);

  // 예시 데이터 3행 (확인용 — 실제 사용 시 지우고 입력)
  var sample = [
    ['CNC-P-001','COO','생산본부','생산1부','생산1팀','생산','신규','수원','응우옌반','남','베트남','E-9','2027-08-15',
     '일자리센터','화성','', '2026-05-20','합격','합격','2026-05-23','적합','입사','', '2026-06-02','2026-06-02','성실, 야간가능','입사','13'],
    ['CNC-P-002','COO','생산본부','제조부','제조2팀','제조','결원','3공장','첸리','여','중국','H-2','2028-03-01',
     '지인추천','해당없음','', '2026-05-25','합격','대기','2026-06-05','대기','진행중','', '', '','면접 예정','면접 대기',''],
    ['CNC-P-003','COO','생산본부','직속','품질관리1팀','포장QC','결원','수원','박세르게이','남','우즈베키스탄','F-4','2029-01-20',
     '일자리센터','오산','', '2026-05-18','불합격','','', '-','탈락','서류','', '','','한국어 미흡','서류 탈락','']
  ];
  sh.getRange(2, 1, sample.length, nCols).setValues(sample);
  sh.getRange(2, 1, sample.length, nCols).setFontColor('#999999').setFontStyle('italic'); // 예시는 회색 이탤릭

  // ---- 자동 계산 수식 (현재단계 / 총소요일수) : 4행부터 빈 양식에 미리 깔아둠 ----
  var firstDataRow = 2;
  var lastRow = 1000;
  for (var r = firstDataRow; r <= lastRow; r++) {
    // AA 현재단계(자동)
    var stageFormula =
      '=IF($I' + r + '="","",' +
        'IFS(' +
          '$V' + r + '="입사","입사",' +
          '$V' + r + '="포기","포기",' +
          '$W' + r + '<>"","탈락("&$W' + r + ')",' +
          '$U' + r + '="적합","건강검진 통과",' +
          '$S' + r + '="합격","면접 합격",' +
          '$R' + r + '="합격","서류 합격",' +
          '$Q' + r + '<>"","접수",' +
          'TRUE,"-"))';
    // AB 총소요일수(자동) : 접수일 ~ (실제입사일 or 오늘)
    var daysFormula =
      '=IF($Q' + r + '="","",' +
        'IF($Y' + r + '<>"",$Y' + r + '-$Q' + r + ',TODAY()-$Q' + r + '))';
    sh.getRange(r, 27).setFormula(stageFormula); // AA
    sh.getRange(r, 28).setFormula(daysFormula);  // AB
  }

  // ---- 드롭다운(데이터 확인) ----
  addList_(sh, 'G', firstDataRow, lastRow, ['결원','신규','대체','충원']);
  addList_(sh, 'H', firstDataRow, lastRow, ['수원','3공장','화성공장','안성공장','기타']);
  addList_(sh, 'J', firstDataRow, lastRow, ['남','여']);
  addList_(sh, 'K', firstDataRow, lastRow,
    ['베트남','중국','우즈베키스탄','캄보디아','네팔','필리핀','태국','미얀마','인도네시아','스리랑카','몽골','한국(귀화)','기타']);
  addList_(sh, 'L', firstDataRow, lastRow,
    ['E-9(비전문취업)','H-2(방문취업)','F-4(재외동포)','F-5(영주)','F-6(결혼이민)','E-7(특정활동)','D-2(유학)','기타']);
  addList_(sh, 'N', firstDataRow, lastRow,
    ['일자리센터','지인추천','직접지원(방문)','에이전시','자사공고','기타']);
  addList_(sh, 'O', firstDataRow, lastRow,
    ['화성','오산','수원','안성','용인','기타','해당없음']);   // ★일자리센터 필수 5개 지역
  addList_(sh, 'R', firstDataRow, lastRow, ['합격','불합격','생략']);
  addList_(sh, 'S', firstDataRow, lastRow, ['합격','불합격','면접포기','대기']);
  addList_(sh, 'U', firstDataRow, lastRow, ['적합','부적합','대기','-']);
  addList_(sh, 'V', firstDataRow, lastRow, ['진행중','입사','탈락','포기']);
  addList_(sh, 'W', firstDataRow, lastRow, ['서류','면접','건강검진','-']);

  // ---- 보기 좋게 ----
  sh.getRange(2, 1, lastRow - 1, nCols).setFontSize(10);
  sh.setColumnWidths(1, nCols, 92);
  sh.setColumnWidth(6, 80);    // 직무
  sh.setColumnWidth(11, 90);   // 국적
  sh.setColumnWidth(12, 120);  // 비자
  sh.setColumnWidth(14, 110);  // 유입경로
  sh.setColumnWidth(15, 80);   // 센터지역
  sh.setColumnWidth(16, 130);  // 이력서링크
  sh.setColumnWidth(26, 160);  // 비고
  sh.setColumnWidth(27, 110);  // 현재단계
  sh.getRange(2, 1, lastRow - 1, nCols).setVerticalAlignment('middle');

  // 날짜 컬럼 서식
  ['M','Q','T','X','Y'].forEach(function(c) {
    sh.getRange(c + firstDataRow + ':' + c + lastRow).setNumberFormat('yyyy-mm-dd');
  });

  // 비자만료 임박(60일 이내) 빨강 강조 — 노무 리스크
  var visaRange = sh.getRange('M' + firstDataRow + ':M' + lastRow);
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($M2<>"",$M2-TODAY()<=60,$M2-TODAY()>=0)')
    .setBackground('#ffc7ce').setFontColor('#9c0006')
    .setRanges([visaRange]).build();
  var rules = sh.getConditionalFormatRules();
  rules.push(rule);
  sh.setConditionalFormatRules(rules);
}

/* ----------------------------------------------------------------
 *  ② 대시보드 시트  (RAW DATA 를 실시간 참조 → 입력하면 자동 갱신)
 * ---------------------------------------------------------------- */
function buildDashboard_(sh, rawName) {
  var R = "'" + rawName + "'!";
  sh.setHiddenGridlines(true);

  // 제목
  sh.getRange('B2').setValue('📊  생산직(외국인) 채용 대시보드')
    .setFontSize(18).setFontWeight('bold').setFontColor('#1f3864');
  sh.getRange('B3').setValue('RAW DATA 입력 시 자동 반영됩니다.')
    .setFontColor('#888888').setFontSize(10);

  // ---------- KPI 카드 (B5:K6) ----------
  var kpi = [
    ['총 지원자', '=COUNTA(' + R + 'I2:I)'],
    ['실제 입사', '=COUNTIF(' + R + 'V2:V,"입사")'],
    ['진행중',   '=COUNTIF(' + R + 'V2:V,"진행중")'],
    ['채용 달성율', '=IFERROR(COUNTIF(' + R + 'V2:V,"입사")/COUNTA(' + R + 'I2:I),0)'],
    ['평균 소요일', '=IFERROR(ROUND(AVERAGE(' + R + 'AB2:AB),1),0)']
  ];
  var col = 2; // B
  kpi.forEach(function(item) {
    sh.getRange(5, col).setValue(item[0])
      .setFontColor('#ffffff').setBackground('#4472c4')
      .setHorizontalAlignment('center').setFontWeight('bold').setFontSize(10);
    var v = sh.getRange(6, col);
    v.setFormula(item[1]).setHorizontalAlignment('center')
      .setFontSize(20).setFontColor ? null : null;
    v.setFontSize(20).setFontWeight('bold').setFontColor('#1f3864')
      .setBackground('#d9e1f2');
    sh.setColumnWidth(col, 110);
    col += 2;
  });
  sh.getRange('K6').setNumberFormat('0.0%'); // 달성율 칸은 위 루프의 4번째(=H)… 실제 위치 보정 아래에서

  // 위 루프 col 간격(2칸)에 맞춘 정확한 서식 보정
  sh.getRange(6, 8).setNumberFormat('0.0%');  // 채용 달성율 (4번째 카드 = H6)

  // ---------- ★ 센터지역별 (일자리센터) ----------
  var top = 9;
  section_(sh, top, 'B', '🏢  유입 센터지역별 (일자리센터)');
  var regions = ['화성','오산','수원','안성','용인','기타'];
  putCountBlock_(sh, top + 1, 'B', regions,
    function(v){ return '=COUNTIF(' + R + 'O2:O,"' + v + '")'; });

  // ---------- 유입경로별 ----------
  section_(sh, top, 'F', '🔗  유입경로별');
  var paths = ['일자리센터','지인추천','직접지원(방문)','에이전시','자사공고','기타'];
  putCountBlock_(sh, top + 1, 'F', paths,
    function(v){ return '=COUNTIF(' + R + 'N2:N,"' + v + '")'; });

  // ---------- 국적별 ----------
  var top2 = top + regions.length + 3; // 18 근처
  section_(sh, top2, 'B', '🌏  국적별');
  var nats = ['베트남','중국','우즈베키스탄','캄보디아','네팔','필리핀','태국','기타'];
  putCountBlock_(sh, top2 + 1, 'B', nats,
    function(v){
      if (v === '기타') {
        return '=COUNTA(' + R + 'K2:K)-(' +
          'COUNTIF(' + R + 'K2:K,"베트남")+COUNTIF(' + R + 'K2:K,"중국")+' +
          'COUNTIF(' + R + 'K2:K,"우즈베키스탄")+COUNTIF(' + R + 'K2:K,"캄보디아")+' +
          'COUNTIF(' + R + 'K2:K,"네팔")+COUNTIF(' + R + 'K2:K,"필리핀")+' +
          'COUNTIF(' + R + 'K2:K,"태국"))';
      }
      return '=COUNTIF(' + R + 'K2:K,"' + v + '")';
    });

  // ---------- 비자유형별 ----------
  section_(sh, top2, 'F', '🛂  체류자격(비자)별');
  var visas = ['E-9(비전문취업)','H-2(방문취업)','F-4(재외동포)','F-5(영주)','F-6(결혼이민)','E-7(특정활동)'];
  putCountBlock_(sh, top2 + 1, 'F', visas,
    function(v){ return '=COUNTIF(' + R + 'L2:L,"' + v + '")'; });

  // ---------- 단계별 퍼널 ----------
  var top3 = top2 + Math.max(nats.length, visas.length) + 3;
  section_(sh, top3, 'B', '📉  채용 단계별 퍼널');
  var funnel = [
    ['접수',     '=COUNTIF(' + R + 'Q2:Q,"<>")'],
    ['서류 합격', '=COUNTIF(' + R + 'R2:R,"합격")'],
    ['면접 합격', '=COUNTIF(' + R + 'S2:S,"합격")'],
    ['건강검진 적합','=COUNTIF(' + R + 'U2:U,"적합")'],
    ['최종 입사', '=COUNTIF(' + R + 'V2:V,"입사")']
  ];
  putFormulaBlock_(sh, top3 + 1, 'B', funnel);

  // ---------- 채용유형별 ----------
  section_(sh, top3, 'F', '📋  채용유형별');
  var types = ['결원','신규','대체','충원'];
  putCountBlock_(sh, top3 + 1, 'F', types,
    function(v){ return '=COUNTIF(' + R + 'G2:G,"' + v + '")'; });

  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 60);
  sh.setColumnWidth(4, 180);
  sh.setColumnWidth(6, 130);
  sh.setColumnWidth(7, 60);
  sh.setColumnWidth(8, 180);
}

/* ---------------- 헬퍼들 ---------------- */

function section_(sh, row, col, title) {
  var c = colNum_(col);
  sh.getRange(row, c, 1, 3).merge()
    .setValue(title).setFontWeight('bold').setFontSize(12)
    .setFontColor('#1f3864').setBackground('#eef2f9')
    .setVerticalAlignment('middle');
  sh.setRowHeight(row, 26);
}

// label / count / bar(REPT) 블록
function putCountBlock_(sh, startRow, col, labels, fnFormula) {
  var c = colNum_(col);
  labels.forEach(function(lb, i) {
    var r = startRow + i;
    sh.getRange(r, c).setValue(lb).setFontSize(10).setFontColor('#000000');
    sh.getRange(r, c + 1).setFormula(fnFormula(lb))
      .setHorizontalAlignment('center').setFontSize(10).setFontWeight('bold');
    // 막대: 카운트만큼 ■ (최대 25개)
    var barF = '=IF(' + a1_(r, c + 1) + '=0,"",REPT("■",MIN(' + a1_(r, c + 1) + ',25)))';
    sh.getRange(r, c + 2).setFormula(barF).setFontColor('#4472c4').setFontSize(10);
  });
}

// label/formula 쌍을 직접 받는 블록 (퍼널 등)
function putFormulaBlock_(sh, startRow, col, pairs) {
  var c = colNum_(col);
  pairs.forEach(function(p, i) {
    var r = startRow + i;
    sh.getRange(r, c).setValue(p[0]).setFontSize(10).setFontColor('#000000');
    sh.getRange(r, c + 1).setFormula(p[1])
      .setHorizontalAlignment('center').setFontSize(10).setFontWeight('bold');
    var barF = '=IF(' + a1_(r, c + 1) + '=0,"",REPT("■",MIN(' + a1_(r, c + 1) + ',25)))';
    sh.getRange(r, c + 2).setFormula(barF).setFontColor('#70ad47').setFontSize(10);
  });
}

function addList_(sh, colLetter, firstRow, lastRow, values) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(true)   // 목록 외 값도 허용(유연하게)
    .build();
  sh.getRange(colLetter + firstRow + ':' + colLetter + lastRow).setDataValidation(rule);
}

function colNum_(letter) {
  var s = 0;
  for (var i = 0; i < letter.length; i++) s = s * 26 + (letter.charCodeAt(i) - 64);
  return s;
}
function a1_(row, colNumber) {
  var c = '', n = colNumber;
  while (n > 0) { var m = (n - 1) % 26; c = String.fromCharCode(65 + m) + c; n = Math.floor((n - 1) / 26); }
  return c + row;
}
