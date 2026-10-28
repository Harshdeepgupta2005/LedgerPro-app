const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ledger', {
  platform: process.platform || '',
  hasSqlite: Boolean(ipcRenderer.sendSync('db:mode')),
  appVersion: ipcRenderer.sendSync('app:version'),
  devSeed: Boolean(ipcRenderer.sendSync('app:flags').devSeed),
  versions: {
    app: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  saveFile: (options) => ipcRenderer.invoke('export:save', options),
  printPDF: (options) => ipcRenderer.invoke('export:pdf', options),
  backupData: () => ipcRenderer.invoke('data:backup'),
  restoreData: () => ipcRenderer.invoke('data:restore'),
  setTitleBarOverlay: (options) => ipcRenderer.send('win:overlay', options),
  quit: () => ipcRenderer.send('app:quit'),
  dbLoad: () => ipcRenderer.sendSync('db:load'),
  dbSave: (doc) => ipcRenderer.invoke('db:save', doc),
});
