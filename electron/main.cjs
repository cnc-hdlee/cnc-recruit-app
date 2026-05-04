const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const ipc = require('./ipc-handlers.cjs');
const sync = require('./integrations/sync.cjs');
const { autoUpdater } = require('electron-updater');

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
  });

  autoUpdater.on('update-downloaded', async (info) => {
    // eslint-disable-next-line no-console
    console.info('[updater] 다운로드 완료:', info.version);
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
  });

  // 시작 시 + 4시간마다 한 번씩 체크
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

ipc.register();

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
    title: 'CNC 채용 커맨드센터',
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
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
