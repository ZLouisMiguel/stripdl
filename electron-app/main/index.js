// electron-app/main/index.js  — v2
// Main process: windows, IPC, Python CLI subprocess, context menus.

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  Menu,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = process.argv.includes("--dev");

// ──────────────────────────────────────────────────────────────────
//  Config persistence
// ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH))
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_) {}
  return {
    downloadDir: path.join(app.getPath("home"), "strip-data"),
    theme: "system",
    readingProgress: {},
    maxConcurrentJobs: 2,
    maxConcurrentChapters: 3,
    imageConcurrency: 4,
    rateLimit: 8,
    cacheTtlDays: 7,
    verifyIntegrity: false,
    lazyLoading: true,
    preloadNextChapter: true,
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

let appConfig = loadConfig();

// ──────────────────────────────────────────────────────────────────
//  Window management
// ──────────────────────────────────────────────────────────────────

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#f5f1e6",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // v2: webSecurity enabled; CSP in index.html allows file: images
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../src/index.html"));
  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ──────────────────────────────────────────────────────────────────
//  Resolve Python CLI path
// ──────────────────────────────────────────────────────────────────

function getStripCliPath() {
  if (app.isPackaged) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const bundled = path.join(
      process.resourcesPath,
      "strip-cli",
      `stripdl${ext}`,
    );
    if (fs.existsSync(bundled)) return bundled;
  }
  return "stripdl";
}

// ──────────────────────────────────────────────────────────────────
//  IPC — Config
// ──────────────────────────────────────────────────────────────────

ipcMain.handle("config:get", () => appConfig);

ipcMain.handle("config:set", (_, updates) => {
  appConfig = { ...appConfig, ...updates };
  saveConfig(appConfig);
  return appConfig;
});

// ──────────────────────────────────────────────────────────────────
//  IPC — Library scanning
// ──────────────────────────────────────────────────────────────────

ipcMain.handle("library:scan", () => {
  const root = appConfig.downloadDir;
  if (!fs.existsSync(root)) return [];

  const series = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const seriesDir = path.join(root, entry.name);
    const metaPath = path.join(seriesDir, "metadata.json");
    if (!fs.existsSync(metaPath)) continue;

    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch (_) {}

    const coverPath = path.join(seriesDir, "cover.jpg");
    const chapters = [];

    for (const ch of fs.readdirSync(seriesDir, { withFileTypes: true })) {
      if (!ch.isDirectory() || !/^\d+$/.test(ch.name)) continue;
      const chDir = path.join(seriesDir, ch.name);
      const chMeta = path.join(chDir, "metadata.json");
      let chData = {
        number: parseInt(ch.name),
        title: `Chapter ${parseInt(ch.name)}`,
      };
      try {
        chData = { ...chData, ...JSON.parse(fs.readFileSync(chMeta, "utf8")) };
      } catch (_) {}
      const pages = fs
        .readdirSync(chDir)
        .filter((f) => f.endsWith(".jpg") && f !== "cover.jpg").length;
      chapters.push({ ...chData, directory: chDir, pageCount: pages });
    }

    chapters.sort((a, b) => a.number - b.number);
    series.push({
      ...meta,
      directory: seriesDir,
      coverPath: fs.existsSync(coverPath) ? coverPath : null,
      chapters,
    });
  }
  return series;
});

// ──────────────────────────────────────────────────────────────────
//  IPC — Chapter pages
// ──────────────────────────────────────────────────────────────────

ipcMain.handle("chapter:pages", (_, chapterDir) => {
  if (!fs.existsSync(chapterDir)) return [];
  return fs
    .readdirSync(chapterDir)
    .filter((f) => f.endsWith(".jpg") && !f.startsWith("cover"))
    .sort()
    .map((f) => path.join(chapterDir, f));
});

// ──────────────────────────────────────────────────────────────────
//  IPC — Reading progress
// ──────────────────────────────────────────────────────────────────

ipcMain.handle(
  "progress:get",
  (_, key) => appConfig.readingProgress?.[key] ?? 0,
);

ipcMain.handle("progress:set", (_, key, pageIndex) => {
  if (!appConfig.readingProgress) appConfig.readingProgress = {};
  appConfig.readingProgress[key] = pageIndex;
  saveConfig(appConfig);
  return true;
});

// ──────────────────────────────────────────────────────────────────
//  IPC — Downloads
// ──────────────────────────────────────────────────────────────────

const activeDownloads = new Map();

ipcMain.handle("download:start", (event, { url, chapters, downloadDir }) => {
  const args = ["download", url, "--json-progress"];
  if (chapters) args.push("--chapters", chapters);
  if (downloadDir) args.push("--output", downloadDir);

  // Pass Electron config values to CLI via flags
  const cfg = appConfig;
  if (cfg.maxConcurrentChapters)
    args.push("--chapter-concurrency", String(cfg.maxConcurrentChapters));
  if (cfg.imageConcurrency)
    args.push("--image-concurrency", String(cfg.imageConcurrency));
  if (cfg.rateLimit !== undefined)
    args.push("--rate-limit", String(cfg.rateLimit));
  if (cfg.cacheTtlDays !== undefined) {
    // Pass via env var — CLI reads config file; we just trigger a refresh if 0
    if (cfg.cacheTtlDays === 0) args.push("--no-cache");
  }
  if (cfg.verifyIntegrity) args.push("--verify");

  const cliPath = getStripCliPath();
  const child = spawn(cliPath, args, { env: { ...process.env } });

  const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  activeDownloads.set(downloadId, child);

  const send = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("download:progress", {
        downloadId,
        ...payload,
      });
  };

  child.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      try {
        send(JSON.parse(line));
      } catch (_) {
        send({ status: "log", message: line });
      }
    }
  });

  child.stderr.on("data", (data) => {
    send({ status: "error", message: data.toString() });
  });

  child.on("close", (code) => {
    activeDownloads.delete(downloadId);
    send({ status: "process_exit", code });
  });

  return downloadId;
});

ipcMain.handle("download:cancel", (_, downloadId) => {
  const child = activeDownloads.get(downloadId);
  if (child) {
    child.kill();
    activeDownloads.delete(downloadId);
    return true;
  }
  return false;
});

ipcMain.handle("download:active", () => [...activeDownloads.keys()]);

// ──────────────────────────────────────────────────────────────────
//  IPC — File system operations
// ──────────────────────────────────────────────────────────────────

/** Recursively delete a directory. */
function rmdir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

ipcMain.handle("fs:deleteSeries", async (_, seriesDir) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    title: "Delete series",
    message: `Permanently delete this series from disk?\n\n${seriesDir}`,
  });
  if (result.response !== 0) return false;
  try {
    rmdir(seriesDir);
    return true;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("fs:deleteChapter", async (_, chapterDir) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    title: "Delete chapter",
    message: `Permanently delete this chapter?\n\n${chapterDir}`,
  });
  if (result.response !== 0) return false;
  try {
    rmdir(chapterDir);
    return true;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("fs:openFolder", async (_, dirPath) => {
  shell.openPath(dirPath);
});

// ──────────────────────────────────────────────────────────────────
//  IPC — Context menus
// ──────────────────────────────────────────────────────────────────

ipcMain.handle("menu:seriesContext", (_, { seriesDir, seriesTitle }) => {
  return new Promise((resolve) => {
    const template = [
      {
        label: "Open folder in explorer",
        click: () => {
          shell.openPath(seriesDir);
          resolve(null);
        },
      },
      { type: "separator" },
      {
        label: "Delete series…",
        click: () => resolve("delete"),
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow, callback: () => resolve(null) });
  });
});

ipcMain.handle("menu:chapterContext", (_, { chapterDir, chapterNumber }) => {
  return new Promise((resolve) => {
    const template = [
      {
        label: "Open folder in explorer",
        click: () => {
          shell.openPath(chapterDir);
          resolve(null);
        },
      },
      { type: "separator" },
      { label: "Mark as read", click: () => resolve("mark_read") },
      { label: "Delete chapter…", click: () => resolve("delete") },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow, callback: () => resolve(null) });
  });
});

// ──────────────────────────────────────────────────────────────────
//  IPC — Dialog & Theme
// ──────────────────────────────────────────────────────────────────

ipcMain.handle("dialog:openFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.filePaths[0] ?? null;
});

ipcMain.handle("theme:get", () =>
  nativeTheme.shouldUseDarkColors ? "dark" : "light",
);

ipcMain.handle("theme:set", (_, theme) => {
  nativeTheme.themeSource = theme;
  appConfig.theme = theme;
  saveConfig(appConfig);
});
