// desktop/main/index.js
// Main process: windows, IPC, Python CLI subprocess, context menus, scheduler.

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  Menu,
  Notification,
  powerMonitor,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { buildDownloadConfigArgs } = require("./configKeys");
const { startScheduler } = require("./scheduler");

// True in `electron-vite dev` (HMR dev server) or when launched with
// --dev directly. ELECTRON_RENDERER_URL is set by electron-vite's dev
// command; its presence is the more reliable signal since it's what
// actually determines whether we loadURL() a dev server or loadFile() the
// built renderer below.
const isDev =
  process.argv.includes("--dev") || !!process.env.ELECTRON_RENDERER_URL;

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
    overwrite: false,
    lazyLoading: true,
    preloadNextChapter: true,
    // seriesKey (series directory) -> { url, title, enabled, days,
    // lastRun, lastResult, lastDownloadedCount, lastError, lastCheckedAt }
    schedules: {},
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

let appConfig = loadConfig();
// Upgrade path for config.json files saved before the scheduler existed.
if (!appConfig.schedules) appConfig.schedules = {};

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
      // electron-vite builds the preload bundle to out/preload/index.js,
      // a sibling of out/main/index.js (where this file itself ends up
      // after being built) — hence "../preload/index.js" rather than the
      // old same-directory "preload.js".
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // v2: webSecurity enabled; CSP in renderer/index.html allows file: images
      webSecurity: true,
    },
  });

  // In dev, electron-vite runs a Vite dev server for the renderer (HMR)
  // and sets ELECTRON_RENDERER_URL to its address. In a built/packaged
  // app, that env var is absent and we load the static built HTML instead
  // — a sibling of out/main/index.js, same layout as the preload path above.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

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
  initScheduler();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (scheduler) scheduler.stop();
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

// Matches chapter directory names produced by the Python side's
// downloader._chapter_dirname():
//   "012"   -> whole chapter 12
//   "012_5" -> half chapter 12.5
const CHAPTER_DIR_RE = /^(\d+)(?:_(\d))?$/;

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
      if (!ch.isDirectory()) continue;
      const m = CHAPTER_DIR_RE.exec(ch.name);
      if (!m) continue;

      const dirNumber =
        parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 10 : 0);
      const chDir = path.join(seriesDir, ch.name);
      const chMeta = path.join(chDir, "metadata.json");
      let chData = {
        number: dirNumber,
        title: `Chapter ${dirNumber}`,
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

/**
 * Spawn `stripdl download` and stream its JSON progress to the renderer
 * (if a window exists) over the same "download:progress" channel used by
 * manual downloads, so the tray reflects auto-triggered downloads too.
 *
 * Returns { downloadId, done }. `done` resolves once the process exits
 * with { downloadedCount, hadError, errorMessage } — it never rejects;
 * spawn/runtime failures are captured in the resolved value so callers (in
 * particular the scheduler) don't need their own try/catch around every
 * possible failure mode.
 */
function spawnDownload({ url, chapters, downloadDir, extraArgs = [] }) {
  const args = ["download", url, "--json-progress"];
  if (chapters) args.push("--chapters", chapters);
  if (downloadDir) args.push("--output", downloadDir);
  args.push(...buildDownloadConfigArgs(appConfig));
  args.push(...extraArgs);

  const cliPath = getStripCliPath();
  const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let downloadedCount = 0;
  let hadError = false;
  let errorMessage = null;

  const send = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("download:progress", {
        downloadId,
        ...payload,
      });
  };

  const done = new Promise((resolve) => {
    let child;
    try {
      child = spawn(cliPath, args, { env: { ...process.env } });
    } catch (e) {
      // Synchronous spawn failure (rare, platform-dependent) — resolve
      // rather than throw so callers never need to wrap this in try/catch.
      resolve({ downloadedCount: 0, hadError: true, errorMessage: e.message });
      return;
    }

    activeDownloads.set(downloadId, child);

    // Previously unhandled: an 'error' event on a ChildProcess with no
    // listener is an uncaught, fatal exception in Node. If `stripdl` isn't
    // on PATH (or the bundled binary is missing in a packaged build),
    // spawn() emits 'error' asynchronously — this listener is what stops
    // that from crashing the entire main process instead of just failing
    // the one download.
    child.on("error", (e) => {
      hadError = true;
      errorMessage = e.message;
      send({ status: "error", message: e.message });
      activeDownloads.delete(downloadId);
      resolve({ downloadedCount, hadError, errorMessage });
    });

    child.stdout.on("data", (data) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch (_) {
          send({ status: "log", message: line });
          continue;
        }
        if (parsed.status === "chapter_done") downloadedCount++;
        if (
          parsed.status === "error" &&
          !parsed.chapter &&
          !parsed.chapter_id
        ) {
          hadError = true;
          errorMessage = parsed.message;
        }
        send(parsed);
      }
    });

    child.stderr.on("data", (data) => {
      send({ status: "error", message: data.toString() });
    });

    child.on("close", (code) => {
      activeDownloads.delete(downloadId);
      send({ status: "process_exit", code });
      if (code !== 0 && !hadError) {
        hadError = true;
        errorMessage = `stripdl exited with code ${code}`;
      }
      resolve({ downloadedCount, hadError, errorMessage });
    });
  });

  return { downloadId, done };
}

ipcMain.handle("download:start", (event, { url, chapters, downloadDir }) => {
  const { downloadId } = spawnDownload({ url, chapters, downloadDir });
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
//  Scheduler — per-series "auto-download on release day"
// ──────────────────────────────────────────────────────────────────

let scheduler = null;

function notifySchedule(entry, result) {
  const title = entry.title || "Series";

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("schedule:event", {
      title,
      downloaded: result.downloadedCount || 0,
      error: result.errorMessage || null,
    });
  }

  if (!Notification.isSupported()) return;
  if (result.hadError) {
    new Notification({
      title: `Strip — couldn't check ${title}`,
      body: result.errorMessage || "Auto-download check failed.",
    }).show();
  } else if (result.downloadedCount > 0) {
    new Notification({
      title: `${title} — new chapter${result.downloadedCount > 1 ? "s" : ""}!`,
      body: `${result.downloadedCount} new chapter${result.downloadedCount > 1 ? "s" : ""} downloaded.`,
    }).show();
  }
}

function initScheduler() {
  scheduler = startScheduler({
    getSchedules: () => appConfig.schedules,
    updateSchedule: (seriesKey, patch) => {
      if (!appConfig.schedules[seriesKey]) return;
      appConfig.schedules[seriesKey] = {
        ...appConfig.schedules[seriesKey],
        ...patch,
      };
      saveConfig(appConfig);
    },
    runCheck: async (seriesKey, entry) => {
      const { done } = spawnDownload({
        url: entry.url,
        downloadDir: appConfig.downloadDir,
      });
      const result = await done;
      notifySchedule(entry, result);
      return {
        downloaded: result.downloadedCount,
        error: result.hadError ? result.errorMessage : undefined,
      };
    },
  });

  powerMonitor.on("resume", () => scheduler.runNow());
}

ipcMain.handle("schedule:get", () => appConfig.schedules);

ipcMain.handle("schedule:set", (_, seriesKey, patch) => {
  const existing = appConfig.schedules[seriesKey] || {};
  appConfig.schedules[seriesKey] = { ...existing, ...patch };
  saveConfig(appConfig);
  return appConfig.schedules[seriesKey];
});

ipcMain.handle("schedule:runNow", async () => {
  if (scheduler) await scheduler.runNow();
  return true;
});

// ──────────────────────────────────────────────────────────────────
//  IPC — File system operations
// ──────────────────────────────────────────────────────────────────

ipcMain.handle("fs:deleteSeries", async (_, seriesDir) => {
  try {
    await fs.promises.rm(seriesDir, { recursive: true, force: true });
    return { success: true, directory: seriesDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("fs:deleteChapter", async (_, chapterDir) => {
  try {
    await fs.promises.rm(chapterDir, { recursive: true, force: true });
    return { success: true, directory: chapterDir };
  } catch (e) {
    return { success: false, error: e.message };
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
