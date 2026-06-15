const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const SS_ID = '1RxJTfIyE4SalSZDKS9A4xmaSVqMCKNkxOfsOX3aMez4';
const WRITE = process.argv.includes('--write');
const A1c = (c) => { let s = '', n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  const tok = JSON.parse(fs.readFileSync(path.join(__dirname, '.dash-tokens.json'), 'utf8'));
  const oauth = new google.auth.OAuth2(tok.clientId, tok.clientSecret);
  oauth.setCredentials({ refresh_token: tok.refresh_token });
  await oauth.getAccessToken();
  const sheets = google.sheets({ version: 'v4', auth: oauth });

  const RANGE = "'대시보드'!A1:Z120";
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SS_ID, range: RANGE, valueRenderOption: 'FORMULA' });
  const grid = res.data.values || [];
  const updates = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v === 'string' && v[0] === '=' && /(\$300\b)|(AK300\b)|(:\$?[A-Z]{1,2}\$?300\b)/.test(v)) {
        const nv = v.replace(/(\$?[A-Z]{1,2}\$?)300\b/g, '$1' + '1300');
        if (nv !== v) updates.push({ range: `'대시보드'!${A1c(c)}${r + 1}`, values: [[nv]] });
      }
    }
  }
  console.log(`확장 대상 수식 셀: ${updates.length}`);
  console.log('샘플:', updates.slice(0,3).map(u=>u.range).join(', '));
  if (!WRITE) { console.log('[DRY] --write 시 반영'); return; }
  // batch in chunks
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SS_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: chunk } });
  }
  console.log(`[WRITE] ${updates.length}개 셀 범위 300→1300 확장 완료.`);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
