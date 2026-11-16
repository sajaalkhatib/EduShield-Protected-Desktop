const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronShield', {
  isElectron: true,
  onRecorderStatus: (callback) => {
    ipcRenderer.on('recorder-status', (_, data) => callback(data));
  },
  onExtensionStatus: (callback) => {
    ipcRenderer.on('extension-status', (_, data) => callback(data));
  }
});
