const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  isDesktop: true,
  minimize: () => ipcRenderer.send("jarvis:minimize"),
  close: () => ipcRenderer.send("jarvis:close"),
  setAlwaysOnTop: (on) => ipcRenderer.send("jarvis:always-on-top", on),
});
