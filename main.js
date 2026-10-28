const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');

if (process.env.LEDGERPRO_SMOKE && !app.isPackaged) require('./scripts/smoke');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const TOPBAR_H = 80;

let flushDone = false;
let flushing = null;

// Ask the renderer to persist its pending debounced changes before allowing the
// window to close / the app to quit. Bounded so a broken renderer can't hang quit.
function flushRenderer(win) {
  if (flushing) return flushing;
  flushing = new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    if (!win || win.isDestroyed()) return done();
    win.webContents
      .executeJavaScript(
        '(typeof Store !== "undefined" && typeof Store.flushNow === "function") ? Store.flushNow() : Promise.resolve(true)'
      )
      .then(done, done);
  }).then(() => {
    flushDone = true;
    flushing = null;
  });
  return flushing;
}

// macOS keeps the inset traffic lights; Windows uses a hidden title bar with the
// native window controls drawn as an overlay in the top bar; Linux keeps its
// native frame. The renderer re-colours the Windows overlay on theme changes.
function titleBarOptions() {
  if (isMac) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 16 } };
  if (isWin) {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#f1f3f9', symbolColor: '#0f172a', height: TOPBAR_H },
    };
  }
  return {};
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    ...titleBarOptions(),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile('index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.on('close', (event) => {
    if (flushDone) return;
    event.preventDefault();
    flushRenderer(win).finally(() => {
      if (!win.isDestroyed()) win.close();
    });
  });
  win.once('ready-to-show', () => win.show());
}

ipcMain.on('db:load', (event) => {
  try {
    event.returnValue = { ok: true, doc: db.load() };
  } catch (e) {
    event.returnValue = { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('db:save', async (event, doc) => {
  try {
    return db.save(doc);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.on('app:version', (event) => {
  event.returnValue = app.getVersion();
});

// Feature flags for the renderer, resolved in the main process so sandboxed
// preloads never touch process.env directly. devSeed swaps the synthetic demo
// books for the real-ledger snapshot — an explicit dev opt-in (LEDGERPRO_DEV=1)
// that can never activate in packaged builds.
ipcMain.on('app:flags', (event) => {
  event.returnValue = {
    devSeed: !app.isPackaged && process.env.LEDGERPRO_DEV === '1',
  };
});

ipcMain.on('app:quit', () => {
  app.quit();
});

// Windows-only: match the native window-control overlay to the active theme.
ipcMain.on('win:overlay', (event, opts) => {
  if (!isWin || !opts) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && typeof win.setTitleBarOverlay === 'function') {
    try {
      win.setTitleBarOverlay({
        color: String(opts.color || '#f1f3f9'),
        symbolColor: String(opts.symbolColor || '#0f172a'),
        height: TOPBAR_H,
      });
    } catch (e) {
      /* ignore */
    }
  }
});

ipcMain.on('db:mode', (event) => {
  event.returnValue = db.dbMode();
});

app.whenReady().then(() => {
  try {
    const dockIconPath = path.join(__dirname, 'assets', 'icon-512.png');
    if (process.platform === 'darwin' && app.dock && fs.existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath);
    }
  } catch (e) {
    console.error('Failed to set dock icon', e);
  }

  try {
    db.open();
  } catch (e) {
    console.error('Failed to open database', e);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  if (flushDone) return;
  event.preventDefault();
  const win = BrowserWindow.getAllWindows()[0];
  flushRenderer(win).finally(() => app.quit());
});

app.on('will-quit', () => {
  db.close();
});

async function promptAndWrite(event, { title, defaultName, filters, content, pdfOptions }) {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title,
      defaultPath: defaultName,
      filters: Array.isArray(filters) && filters.length ? filters : undefined,
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const data = pdfOptions ? await win.webContents.printToPDF(pdfOptions) : String(content ?? '');
    await fs.promises.writeFile(filePath, data, pdfOptions ? undefined : 'utf8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

ipcMain.handle('export:save', (event, { defaultName, filters, content }) =>
  promptAndWrite(event, { title: 'Export', defaultName, filters, content })
);

ipcMain.handle('export:pdf', (event, { defaultName }) =>
  promptAndWrite(event, {
    title: 'Export PDF',
    defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    pdfOptions: { printBackground: true, pageSize: 'A4' },
  })
);

function backStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

ipcMain.handle('data:backup', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Backup LedgerPro data',
    defaultPath: `LedgerPro-backup-${backStamp()}.db`,
    filters: [{ name: 'LedgerPro backup', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    return db.exportBackup(filePath);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('data:restore', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Restore LedgerPro backup',
    properties: ['openFile'],
    filters: [{ name: 'LedgerPro backup / database', extensions: ['db'] }],
  });
  if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
  try {
    return db.restoreFrom(filePaths[0]);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
