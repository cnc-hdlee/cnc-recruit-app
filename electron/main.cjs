const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const ipc = require('./ipc-handlers.cjs');
const sync = require('./integrations/sync.cjs');

const isDev = process.env.NODE_ENV === 'development';
const VITE_DEV_URL = 'http://localhost:5173';

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
