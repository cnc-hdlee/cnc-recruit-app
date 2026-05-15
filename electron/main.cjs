const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const ipc = require('./ipc-handlers.cjs');
const sync = require('./integrations/sync.cjs');
const mobileServer = require('./mobile-server.cjs');
const cfTunnel = require('./cloudflare-tunnel.cjs');
const store = require('./integrations/store.cjs');
const { autoUpdater } = require('electron-updater');

// dev/prod 모두 같은 userData 폴더(cnc-recruit-app) 사용 — OAuth/매핑/시트 캐시 공유
app.setName('cnc-recruit-app');
app.setPath('userData', path.join(app.getPath('appData'), 'cnc-recruit-app'));

const isDev = process.env.NODE_ENV === 'development';
const VITE_DEV_URL = 'http://localhost:5173';

// ----- 자동 업데이트 -----
// 프로덕션 빌드에서만 동작. GitHub Releases (cnc-hdlee/cnc-recruit-app)에서 새 버전 체크 → 백그라운드 다운로드 → 안내 후 재시작.
function setupAutoUpdater() {
  if (isDev) return; // 개발 중엔 동작 안 함
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    // eslint-disable-next-line no-console
    console.info('[updater] 새 버전 발견:', info.version);
    if (mainWindow) mainWindow.webContents.send('app:update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('app:update-not-available', { version: info?.version });
  });

  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) {
      mainWindow.webContents.send('app:update-progress', {
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    // eslint-disable-next-line no-console
    console.info('[updater] 다운로드 완료:', info.version);
    if (mainWindow) mainWindow.webContents.send('app:update-downloaded', { version: info.version });
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['지금 재시작', '나중에 (다음 종료 시 자동)'],
      defaultId: 0,
      cancelId: 1,
      title: '🎉 새 버전 준비 완료',
      message: `CNC 채용 커맨드센터 ${info.version} 으로 업데이트할 수 있어요.`,
      detail: '재시작하면 5초 안에 새 버전으로 갱신됩니다.',
    });
    if (r.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    // 업데이트 서버 접근 실패 등은 조용히 무시 (오프라인일 수 있음)
    // eslint-disable-next-line no-console
    console.warn('[updater] 오류:', err?.message || err);
    if (mainWindow) {
      mainWindow.webContents.send('app:update-error', { message: err?.message || String(err) });
    }
  });

  // 시작 시 + 4시간마다 한 번씩 체크
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

// IPC: 앱 버전 + 수동 업데이트 체크 (TopBar 메뉴에서 호출)
ipcMain.handle('app:getVersion', () => ({ ok: true, data: app.getVersion() }));
ipcMain.handle('app:checkForUpdates', async () => {
  const currentVersion = app.getVersion();
  if (isDev) {
    return {
      ok: true,
      data: { dev: true, currentVersion, latestVersion: currentVersion, updateAvailable: false },
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo?.version || currentVersion;
    return {
      ok: true,
      data: {
        dev: false,
        currentVersion,
        latestVersion,
        updateAvailable: latestVersion !== currentVersion,
      },
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('app:quitAndInstall', () => {
  if (isDev) return { ok: false, error: 'dev 모드에서는 동작 안 함' };
  try {
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipc.register();

// IPC: mobile bridge info (used by Settings UI to show the phone URL / QR code)
ipcMain.handle('mobile:getInfo', () => {
  try {
    const local = mobileServer.getInfo();
    const tun = cfTunnel.getInfo();
    const token = store.get('mobileAccessToken') || null;
    const cloudBase = store.get('cloudWorkerUrl') || null; // e.g. https://cnc-recruit.cnc-hdlee.workers.dev
    const cloudUrl = cloudBase && token ? `${cloudBase}/?t=${encodeURIComponent(token)}` : null;
    const externalUrl = tun.url && token ? `${tun.url}/?t=${encodeURIComponent(token)}` : null;
    const lanUrls = local.ips.map((i) => token ? `http://${i.address}:${local.port}/?t=${encodeURIComponent(token)}` : `http://${i.address}:${local.port}`);
    return {
      ok: true,
      data: {
        ...local,
        token,
        cloudUrl,
        externalUrl,
        lanUrls,
        tunnel: tun,
      },
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('mobile:rotateToken', () => {
  try {
    const crypto = require('node:crypto');
    const t = crypto.randomBytes(18).toString('base64url');
    store.set('mobileAccessToken', t);
    return { ok: true, data: { token: t } };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    title: 'CNC 채용',
    icon: path.join(__dirname, '..', 'icon.png'),
    backgroundColor: '#0a0a23',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    sync.setWindow(mainWindow.webContents);
    sync.startFromConfig().catch(() => {});
    // 모바일 LAN 브릿지 — 폰에서 같은 WiFi로 본체에 붙어 실시간 데이터 조회
    try {
      mobileServer.start();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[mobile-server] start failed:', e?.message || e);
    }
    // Cloudflare quick tunnel — 사외에서도 URL 한 번으로 접속
    try {
      cfTunnel.start();
      cfTunnel.onChange(({ url }) => {
        if (url && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mobile:tunnelUrl', { url });
        }
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[cloudflared] start failed:', e?.message || e);
    }
    // 창 뜨고 5초 뒤에 업데이트 체크 (앱 초기화에 영향 X)
    setTimeout(setupAutoUpdater, 5000);
  });

  mainWindow.on('focus', () => sync.setForeground(true));
  mainWindow.on('blur', () => sync.setForeground(false));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const menu = Menu.buildFromTemplate([
    {
      label: '파일',
      submenu: [
        { label: '새로고침', accelerator: 'F5', click: () => mainWindow.reload() },
        {
          label: '강제 새로고침',
          accelerator: 'Ctrl+Shift+R',
          click: () => mainWindow.webContents.reloadIgnoringCache(),
        },
        { type: 'separator' },
        {
          label: '개발자 도구',
          accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { label: '종료', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: '보기',
      submenu: [
        {
          label: '확대',
          accelerator: 'Ctrl+=',
          click: () => {
            const wc = mainWindow.webContents;
            wc.setZoomLevel(wc.getZoomLevel() + 0.5);
          },
        },
        {
          label: '축소',
          accelerator: 'Ctrl+-',
          click: () => {
            const wc = mainWindow.webContents;
            wc.setZoomLevel(wc.getZoomLevel() - 0.5);
          },
        },
        { label: '원래 크기', accelerator: 'Ctrl+0', click: () => mainWindow.webContents.setZoomLevel(0) },
        { type: 'separator' },
        {
          label: '전체 화면',
          accelerator: 'F11',
          click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  try { mobileServer.stop(); } catch {}
  try { cfTunnel.stop(); } catch {}
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
