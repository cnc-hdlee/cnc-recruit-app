#!/usr/bin/env node
/**
 * sync-snapshot.cjs
 *
 * 24/7 server-side sync runner — designed for GitHub Actions cron.
 * Fetches all configured Google Sheets using a stored OAuth refresh token,
 * writes a snapshot.json that the viewer build reads.
 *
 * Required env vars (provide via GitHub Secrets):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   SHEETS_CONFIG              JSON string — see scripts/sheets-config.example.json
 *
 * Optional:
 *   OUT_PATH                   default ./snapshot.json
 *   EXPORTED_BY                free-form label written into the snapshot
 */

const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const SNAPSHOT_VERSION = 1;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[sync] FATAL: missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

function loadConfig() {
  // Either SHEETS_CONFIG (JSON string in env) or scripts/sheets-config.json (committed file).
  if (process.env.SHEETS_CONFIG) {
    try {
      return JSON.parse(process.env.SHEETS_CONFIG);
    } catch (e) {
      console.error('[sync] FATAL: SHEETS_CONFIG is not valid JSON:', e.message);
      process.exit(1);
    }
  }
  const filePath = path.join(__dirname, 'sheets-config.json');
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  console.error('[sync] FATAL: no SHEETS_CONFIG env and no scripts/sheets-config.json');
  process.exit(1);
}

async function buildOAuth() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function fetchSheet(auth, spreadsheetId) {
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties',
  });
  const tabs = (meta.data.sheets || []).map((s) => s.properties.title);

  const drv = await drive.files.get({ fileId: spreadsheetId, fields: 'modifiedTime' });

  const ranges = tabs.map((t) => `'${t.replace(/'/g, "''")}'`);
  const data = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const tabsOut = {};
  (data.data.valueRanges || []).forEach((vr, i) => {
    tabsOut[tabs[i]] = vr.values || [];
  });

  return {
    title: meta.data.properties.title,
    modifiedTime: drv.data.modifiedTime || new Date().toISOString(),
    tabs: tabsOut,
  };
}

async function main() {
  const config = loadConfig();
  const auth = await buildOAuth();

  const sheetsOut = {};
  const spreadsheetIds = config.sheetIds || [];
  if (!spreadsheetIds.length) {
    console.error('[sync] FATAL: config.sheetIds is empty');
    process.exit(1);
  }

  console.log(`[sync] fetching ${spreadsheetIds.length} sheet(s)...`);
  for (const id of spreadsheetIds) {
    try {
      const data = await fetchSheet(auth, id);
      sheetsOut[id] = data;
      console.log(`[sync]   ✓ ${data.title} (${Object.keys(data.tabs).length} tabs, modified ${data.modifiedTime})`);
    } catch (e) {
      console.error(`[sync]   ✗ ${id}: ${e.message}`);
      // Don't fail the whole run — write what we have
    }
  }

  const snapshot = {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: process.env.EXPORTED_BY || 'github-actions',
    appName: 'CNC 채용 커맨드센터',
    sheets: sheetsOut,
    mappings: config.mappings || {},
  };

  const outPath = process.env.OUT_PATH || path.join(process.cwd(), 'snapshot.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`[sync] wrote ${outPath} (${Object.keys(sheetsOut).length} sheets)`);
}

main().catch((e) => {
  console.error('[sync] FATAL:', e?.stack || e?.message || e);
  process.exit(1);
});
