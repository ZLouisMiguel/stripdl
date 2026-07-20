// desktop/main/preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("strip", {
  // Add your IPC wrappers here as needed by src/js/app.js
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (key, val) => ipcRenderer.invoke("config:set", { key, val }),
  },
  chapter: {
    pages: (dir) => ipcRenderer.invoke("chapter:pages", dir),
  },
  progress: {
    set: (key, idx) => ipcRenderer.invoke("progress:set", { key, idx }),
  },
});
