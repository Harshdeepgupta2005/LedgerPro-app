const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ledger', {
  platform: process.platform || '',
  hasSqlite: Boolean(ipcRenderer.sendSync('db:mode')),
  appVersion: ipcRenderer.sendSync('app:version'),
  versions: {
    app: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  saveFile: (options) => ipcRenderer.invoke('export:save', options),
  printPDF: (options) => ipcRenderer.invoke('export:pdf', options),
  dbLoad: () => ipcRenderer.sendSync('db:load'),
  dbSave: (doc) => ipcRenderer.invoke('db:save', doc),
});
