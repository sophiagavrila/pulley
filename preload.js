const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onDataUpdate: (callback) => {
    ipcRenderer.on('pr-data', (_event, data) => callback(data));
  },
  requestRefresh: () => {
    ipcRenderer.send('request-refresh');
  },
  openExternal: (url) => {
    ipcRenderer.send('open-external', url);
  },
  testNotification: () => {
    ipcRenderer.send('test-notification');
  },
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('set-launch-at-login', enabled),
  quitApp: () => ipcRenderer.invoke('quit-app'),
});
