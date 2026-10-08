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

ipcMain.on('db:save', (event, doc) => {
  try {
    event.returnValue = db.save(doc);
  } catch (e) {
    event.returnValue = { ok: false, error: String((e && e.message) || e) };
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

ipcMain.handle('export:save', async (event, { defaultName, filters, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: defaultName,
    filters: Array.isArray(filters) && filters.length ? filters : undefined,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  await fs.promises.writeFile(filePath, String(content ?? ''), 'utf8');
  return { ok: true, path: filePath };
});

ipcMain.handle('export:pdf', async (event, { defaultName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  await fs.promises.writeFile(filePath, data);
  return { ok: true, path: filePath };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
