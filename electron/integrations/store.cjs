const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

let storePath;
function ensurePath() {
  if (!storePath) {
    storePath = path.join(app.getPath('userData'), 'cnc-recruit-config.json');
  }
  return storePath;
}

function readRaw() {
  const p = ensurePath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeRaw(obj) {
  const p = ensurePath();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function encryptIfPossible(value) {
  if (value == null) return null;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, v: safeStorage.encryptString(str).toString('base64') };
  }
  return { enc: false, v: str };
}

function decryptIfPossible(record) {
  if (!record) return null;
  if (record.enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(record.v, 'base64'));
    } catch (e) {
      return null;
    }
  }
  return record.v ?? null;
}

function get(key) {
  const data = readRaw();
  if (!(key in data)) return null;
  const entry = data[key];
  if (entry && typeof entry === 'object' && 'enc' in entry) {
    const dec = decryptIfPossible(entry);
    if (dec == null) return null;
    try {
      return JSON.parse(dec);
    } catch {
      return dec;
    }
  }
  return entry;
}

function set(key, value, encrypt = false) {
  const data = readRaw();
  data[key] = encrypt ? encryptIfPossible(value) : value;
  writeRaw(data);
}

function del(key) {
  const data = readRaw();
  delete data[key];
  writeRaw(data);
}

module.exports = { get, set, del };
