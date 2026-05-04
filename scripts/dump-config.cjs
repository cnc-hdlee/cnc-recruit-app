// 일회용 — 현재 hdlee의 로컬 OAuth + 시트 설정을 추출해서 빌드에 박을 값으로 출력.
// 실행: npx electron scripts/dump-config.cjs
// 결과: 콘솔에 .env 형식으로 출력 → 복사해서 .env.production에 붙여넣음

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 빌드된 .exe와 동일한 userData 경로를 강제 (productName = "CNC Recruit")
app.setName('cnc-recruit-app');
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'cnc-recruit-app'));

app.whenReady().then(() => {
  const configPath = path.join(app.getPath('userData'), 'cnc-recruit-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('[ERR] config 파일 없음:', configPath);
    app.exit(1);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // store.cjs와 동일한 get 로직: enc:true면 decrypt+parse, 아니면 raw 반환
  const getKey = (key) => {
    const entry = raw[key];
    if (!entry) return null;
    if (typeof entry === 'object' && 'enc' in entry) {
      if (entry.enc && safeStorage.isEncryptionAvailable()) {
        try {
          const dec = safeStorage.decryptString(Buffer.from(entry.v, 'base64'));
          try { return JSON.parse(dec); } catch { return dec; }
        } catch { return null; }
      }
      return entry.v;
    }
    return entry;
  };

  const creds = getKey('googleClient') || {};
  const sheetIds = getKey('sheetIds') || {};
  const mappings = getKey('sheetMappings') || {};

  const list = Array.isArray(sheetIds.list)
    ? sheetIds.list.map((s) => s.spreadsheetId).filter(Boolean)
    : [];
  const sheetsConfig = { sheetIds: list, mappings };

  console.log('');
  console.log('==================================================================');
  console.log('아래 4줄 그대로 복사해서 프로젝트 루트의 .env.production 파일에 저장:');
  console.log('==================================================================');
  console.log('');
  console.log(`VITE_DEFAULT_GOOGLE_CLIENT_ID=${creds.clientId || ''}`);
  console.log(`VITE_DEFAULT_GOOGLE_CLIENT_SECRET=${creds.clientSecret || ''}`);
  console.log(`VITE_DEFAULT_SHEETS_CONFIG=${JSON.stringify(sheetsConfig)}`);
  console.log('');
  console.log('==================================================================');
  console.log(`(시트 ${list.length}개, 매핑 ${Object.keys(mappings).length}종 추출됨)`);
  console.log('==================================================================');

  app.exit(0);
});
