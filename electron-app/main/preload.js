// electron-app/main/preload.js  — v2
// Secure contextBridge exposing only named APIs to the renderer.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("strip", {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (updates) => ipcRenderer.invoke("config:set", updates),
  },

  library: {
    scan: () => ipcRenderer.invoke("library:scan"),
  },

  chapter: {
    pages: (dir) => ipcRenderer.invoke("chapter:pages", dir),
  },

  progress: {
    get: (key) => ipcRenderer.invoke("progress:get", key),
    set: (key, pageIndex) => ipcRenderer.invoke("progress:set", key, pageIndex),
  },

  download: {
    start: (opts) => ipcRenderer.invoke("download:start", opts),
    cancel: (id) => ipcRenderer.invoke("download:cancel", id),
    active: () => ipcRenderer.invoke("download:active"),
    onProgress: (cb) => {
      ipcRenderer.on("download:progress", (_, data) => cb(data));
    },
    offProgress: (cb) => {
      if (cb) ipcRenderer.removeListener("download:progress", cb);
      else ipcRenderer.removeAllListeners("download:progress");
    },
  },

  // File-system operations (with confirmation dialogs in main)
  fs: {
    deleteSeries: (dir) => ipcRenderer.invoke("fs:deleteSeries", dir),
    deleteChapter: (dir) => ipcRenderer.invoke("fs:deleteChapter", dir),
    openFolder: (dir) => ipcRenderer.invoke("fs:openFolder", dir),
  },

  // Native context menus
  menu: {
    seriesContext: (opts) => ipcRenderer.invoke("menu:seriesContext", opts),
    chapterContext: (opts) => ipcRenderer.invoke("menu:chapterContext", opts),
  },

  dialog: {
    openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  },

  theme: {
    get: () => ipcRenderer.invoke("theme:get"),
    set: (theme) => ipcRenderer.invoke("theme:set", theme),
  },
});
