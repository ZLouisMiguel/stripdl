// electron-app/main/preload.js
// Secure contextBridge that exposes only named APIs to the renderer.
// The renderer NEVER has access to Node.js directly.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("strip", {
  // Config
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (updates) => ipcRenderer.invoke("config:set", updates),
  },

  // Library
  library: {
    scan: () => ipcRenderer.invoke("library:scan"),
  },

  // Chapter reading
  chapter: {
    pages: (dir) => ipcRenderer.invoke("chapter:pages", dir),
  },

  // Reading progress
  progress: {
    get: (key) => ipcRenderer.invoke("progress:get", key),
    set: (key, pageIndex) => ipcRenderer.invoke("progress:set", key, pageIndex),
  },

  // Downloads
  download: {
    start: (opts) => ipcRenderer.invoke("download:start", opts),
    cancel: (id) => ipcRenderer.invoke("download:cancel", id),
    active: () => ipcRenderer.invoke("download:active"),
    // Register a listener for all progress events (persists across view changes)
    onProgress: (cb) => {
      ipcRenderer.on("download:progress", (_, data) => cb(data));
    },
    // Remove a specific named listener (pass the same function reference)
    offProgress: (cb) => {
      if (cb) {
        ipcRenderer.removeListener("download:progress", cb);
      } else {
        ipcRenderer.removeAllListeners("download:progress");
      }
    },
  },

  // Dialogs
  dialog: {
    openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  },

  // Theme
  theme: {
    get: () => ipcRenderer.invoke("theme:get"),
    set: (theme) => ipcRenderer.invoke("theme:set", theme),
  },
});
