// One-shot helper: read encrypted Electron store, decrypt with safeStorage, dump to stdout as JSON.
// Run with: electron scripts/extract-secrets.cjs
// Outputs: { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, SHEETS_CONFIG }

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Match the app name used by the main Electron build so userData path matches.
app.setName('cnc-recruit-app');

app.whenReady().then(() => {
  try {
    const storePath = path.join(app.getPath('userData'), 'cnc-recruit-config.json');
    if (!fs.existsSync(storePath)) {
      console.error(JSON.stringify({ error: `config not found at ${storePath}` }));
      app.exit(2);
      return;
    }
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));

    function decode(entry) {
      if (!entry) return null;
      if (entry && typeof entry === 'object' && 'enc' in entry) {
        if (entry.enc && safeStorage.isEncryptionAvailable()) {
          try {
            const s = safeStorage.decryptString(Buffer.from(entry.v, 'base64'));
            try { return JSON.parse(s); } catch { return s; }
          } catch (e) {
            return null;
          }
        }
        try { return JSON.parse(entry.v); } catch { return entry.v; }
      }
      return entry;
    }

    const googleClient = decode(raw.googleClient) || {};
    const googleTokens = decode(raw.googleTokens) || {};
    const sheetIds = decode(raw.sheetIds) || {};
    const mappings = decode(raw.sheetMappings) || {};

    const list = Array.isArray(sheetIds.list)
      ? sheetIds.list.map((s) => s.spreadsheetId).filter(Boolean)
      : [];

    const out = {
      GOOGLE_CLIENT_ID: googleClient.clientId || null,
      GOOGLE_CLIENT_SECRET: googleClient.clientSecret || null,
      GOOGLE_REFRESH_TOKEN: googleTokens.refresh_token || null,
      SHEETS_CONFIG: JSON.stringify({ sheetIds: list, mappings }),
      _diag: {
        storePath,
        hasClient: !!googleClient.clientId,
        hasTokens: !!googleTokens.refresh_token,
        sheetCount: list.length,
        mappingKinds: Object.keys(mappings || {}),
      },
    };

    process.stdout.write(JSON.stringify(out));
    app.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ error: e?.message || String(e), stack: e?.stack }));
    app.exit(1);
  }
});
