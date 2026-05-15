// Cloudflare quick tunnel — exposes the LAN mobile-server (port 5274) on a public
// trycloudflare.com URL so the user can reach their own command center from outside the office.
//
// No Cloudflare account needed (uses the free quick-tunnel mode). The URL changes each time
// the tunnel restarts; we capture it from stderr and persist the latest one for the UI.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const store = require('./integrations/store.cjs');

const LOCAL_TARGET = 'http://localhost:5274';
const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

let proc = null;
let currentUrl = null;
let lastError = null;
let listeners = [];

function findCloudflared() {
  // Prefer absolute paths (winget just installed it but PATH may not be refreshed in this shell yet).
  const absoluteCandidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe', 'cloudflared.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ];
  for (const c of absoluteCandidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  // Wider scan under LOCALAPPDATA\Microsoft\WinGet\Packages — version directory may differ.
  try {
    const pkgRoot = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(pkgRoot)) {
      const dirs = fs.readdirSync(pkgRoot).filter((d) => d.toLowerCase().includes('cloudflared'));
      for (const d of dirs) {
        const exe = path.join(pkgRoot, d, 'cloudflared.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch {}
  // Last resort: rely on PATH.
  return 'cloudflared.exe';
}

function emit() {
  for (const cb of listeners) {
    try { cb({ url: currentUrl, error: lastError }); } catch {}
  }
}

function start() {
  if (proc) return getInfo();
  const bin = findCloudflared();
  if (!bin) {
    lastError = 'cloudflared 실행 파일을 찾지 못했어요. winget install Cloudflare.cloudflared 로 설치하세요.';
    emit();
    return getInfo();
  }
  try {
    proc = spawn(
      bin,
      ['tunnel', '--no-autoupdate', '--url', LOCAL_TARGET],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    lastError = `cloudflared 시작 실패: ${e.message || e}`;
    emit();
    return getInfo();
  }

  const onLine = (chunk) => {
    const text = String(chunk);
    const m = text.match(URL_REGEX);
    if (m && m[0] !== currentUrl) {
      currentUrl = m[0];
      store.set('mobileTunnelUrl', currentUrl);
      lastError = null;
      // eslint-disable-next-line no-console
      console.info('[cloudflared] tunnel URL:', currentUrl);
      emit();
    }
  };

  proc.stdout.on('data', onLine);
  proc.stderr.on('data', onLine);

  proc.on('error', (err) => {
    lastError = `cloudflared 오류: ${err.message || err}`;
    emit();
  });

  proc.on('exit', (code, signal) => {
    // eslint-disable-next-line no-console
    console.warn(`[cloudflared] exited code=${code} signal=${signal}`);
    proc = null;
    currentUrl = null;
    // Auto-restart after a short delay unless we explicitly stopped it.
    if (!stopping) setTimeout(() => start(), 5000);
    emit();
  });

  return getInfo();
}

let stopping = false;
function stop() {
  stopping = true;
  if (proc) {
    try { proc.kill(); } catch {}
    proc = null;
  }
  currentUrl = null;
}

function getInfo() {
  return {
    running: !!proc,
    url: currentUrl,
    error: lastError,
  };
}

function onChange(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

module.exports = { start, stop, getInfo, onChange };
