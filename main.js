const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');

if (process.env.LEDGERPRO_SMOKE && !app.isPackaged) require('./scripts/smoke');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 },
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

app.on('before-quit', () => {
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
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
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
