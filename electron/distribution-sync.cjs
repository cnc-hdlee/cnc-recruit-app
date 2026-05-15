// 배포 폴더 자동 동기화 — Desktop\CNC-Recruit-배포\ 가 존재하는 PC(hdlee 본인)에서만 동작.
// 새 GitHub Release publish되면 .exe + zip을 알아서 다운로드해서 덮어씀.
// 신규 팀원에게 zip 보낼 때 항상 최신본을 사용할 수 있도록 — 사용자가 매번 빌드/zip 갱신 안 해도 됨.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execSync } = require('node:child_process');

const REPO = 'cnc-hdlee/cnc-recruit-app';
const DIST_FOLDER_NAME = 'CNC-Recruit-배포';
const DIST_EXE_NAME = 'CNC 채용 커맨드센터 (설치).exe';
const DIST_ZIP_NAME = 'CNC-Recruit-배포.zip';

function httpsGetJson(url) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'cnc-recruit-app', Accept: 'application/vnd.github+json' } },
      (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          httpsGetJson(res.headers.location).then(resolve);
          return;
        }
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        });
        res.on('error', () => resolve(null));
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(30_000, () => { req.destroy(); resolve(null); });
  });
}

function httpsDownload(url, dest) {
  return new Promise((resolve, reject) => {
    function follow(target, hopsLeft) {
      if (hopsLeft <= 0) return reject(new Error('too many redirects'));
      const req = https.get(
        target,
        { headers: { 'User-Agent': 'cnc-recruit-app' } },
        (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            follow(res.headers.location, hopsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', reject);
        }
      );
      req.on('error', reject);
      req.setTimeout(180_000, () => { req.destroy(); reject(new Error('timeout')); });
    }
    follow(url, 5);
  });
}

async function syncOnce(desktopDir) {
  const distDir = path.join(desktopDir, DIST_FOLDER_NAME);
  if (!fs.existsSync(distDir)) return { skipped: true, reason: 'no-dist-folder' };

  const release = await httpsGetJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!release || !release.assets) return { skipped: true, reason: 'release-fetch-failed' };

  const exeAsset = release.assets.find((a) => typeof a.name === 'string' && a.name.endsWith('.exe'));
  if (!exeAsset) return { skipped: true, reason: 'no-exe-asset' };

  const targetExe = path.join(distDir, DIST_EXE_NAME);
  const stat = fs.existsSync(targetExe) ? fs.statSync(targetExe) : null;
  if (stat && stat.size === exeAsset.size) {
    return { skipped: true, reason: 'already-latest', version: release.tag_name };
  }

  // 다운로드 (.tmp로 받은 후 atomic rename)
  const tmpExe = `${targetExe}.dl-tmp`;
  if (fs.existsSync(tmpExe)) { try { fs.unlinkSync(tmpExe); } catch { /* ignore */ } }
  await httpsDownload(exeAsset.browser_download_url, tmpExe);
  // size 검증
  const tmpStat = fs.statSync(tmpExe);
  if (tmpStat.size !== exeAsset.size) {
    try { fs.unlinkSync(tmpExe); } catch { /* ignore */ }
    return { skipped: true, reason: 'size-mismatch' };
  }
  try { if (fs.existsSync(targetExe)) fs.unlinkSync(targetExe); } catch { /* ignore */ }
  fs.renameSync(tmpExe, targetExe);

  // zip 갱신 — Compress-Archive (PowerShell)
  const zipPath = path.join(desktopDir, DIST_ZIP_NAME);
  try {
    if (fs.existsSync(zipPath)) { try { fs.unlinkSync(zipPath); } catch { /* ignore */ } }
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${distDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
      { windowsHide: true, timeout: 120_000 }
    );
  } catch (e) {
    // zip 실패는 fatal 아님 — exe는 갱신됐고 zip만 옛것
    // eslint-disable-next-line no-console
    console.warn('[dist-sync] zip 생성 실패:', e && e.message);
  }
  return { updated: true, version: release.tag_name, size: exeAsset.size };
}

let intervalHandle = null;
function start(desktopDir) {
  // 시작 직후 1회 + 5분마다
  const run = async () => {
    try {
      const r = await syncOnce(desktopDir);
      if (r.updated) {
        // eslint-disable-next-line no-console
        console.info('[dist-sync] 배포 폴더 갱신:', r.version, '(' + r.size + 'B)');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[dist-sync] 예외:', e && e.message);
    }
  };
  // 첫 호출은 5초 지연 — 부팅 시점 네트워크 안정 후
  setTimeout(() => { void run(); }, 5_000);
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => { void run(); }, 5 * 60 * 1000);
}

module.exports = { start, syncOnce };
