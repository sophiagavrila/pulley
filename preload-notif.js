const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notifAPI', {
  clicked: () => ipcRenderer.send('notif-clicked'),
  dismiss: () => ipcRenderer.send('notif-dismiss'),
});
