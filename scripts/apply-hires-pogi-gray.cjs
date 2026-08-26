// 입사자 관리 시트 — 비고(T)에 "입사포기"가 있으면 행 전체 회색 처리 (모든 탭)
const t = require('./.dash-tokens.json');
const SID = '1VaDbsJD09m9AVLKaVhMItuM-h2W4nIjObxxED7IlaAw';

(async () => {
  const rr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: t.clientId, client_secret: t.clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }),
  });
  const at = (await rr.json()).access_token;
  const H = { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' };
  const api = async (p, o) => {
    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SID + p, { headers: H, ...o });
    const j = await res.json();
    if (j.error) { console.error(JSON.stringify(j.error, null, 1)); process.exit(1); }
    return j;
  };

  const meta = await api('?fields=sheets(properties(sheetId,title,gridProperties(columnCount)),conditionalFormats)');
  const isOurs = (title) => title === '전체(날짜순)' || title === '입사포기' || title.indexOf('입사 ') === 0;

  const req = [];
  let n = 0;
  for (const s of meta.sheets) {
    const { sheetId, title, gridProperties } = s.properties;
    if (!isOurs(title)) continue;
    const cols = Math.max(21, gridProperties.columnCount || 21);
    // 기존 규칙 제거 (재실행 시 중복 방지)
    const existing = (s.conditionalFormats || []).length;
    for (let i = existing - 1; i >= 0; i--) req.push({ deleteConditionalFormatRule: { sheetId, index: i } });
    req.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: cols }],
          booleanRule: {
            // "입사포기" / "입사 포기" 둘 다 인식
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=REGEXMATCH($T2&"","포기")' }] },
            format: {
              backgroundColor: { red: 0.85, green: 0.85, blue: 0.86 },
              textFormat: { foregroundColor: { red: 0.42, green: 0.44, blue: 0.48 }, strikethrough: true },
            },
          },
        },
      },
    });
    n++;
  }
  await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: req }) });
  console.log('OK — 탭', n, '개에 입사포기 회색 규칙 적용');
})();
