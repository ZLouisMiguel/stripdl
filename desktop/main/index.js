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
  protocol,
  net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const { buildDownloadConfigArgs } = require("./configKeys");
const { startScheduler } = require("./scheduler");

const isDev =
  process.argv.includes("--dev") || !!process.env.ELECTRON_RENDERER_URL;

// ──────────────────────────────────────────────────────────────────
//  Custom "strip-file://" protocol — serves local files (covers, chapter
//  pages) to the renderer regardless of how the renderer page itself was
//  loaded.
//
//  WHY THIS EXISTS: a page loaded over http:// (as the renderer is during
//  `npm run dev`, served by Vite's dev server at http://localhost:5173)
//  is blocked by Chromium from loading file:// resources at all — this
//  is a hardcoded browser security restriction tied to the *page's own
//  origin*, completely separate from Content-Security-Policy. It would
//  not affect a packaged production build (which loads the renderer via
//  loadFile(), i.e. a file:// origin, so file:// images match), but
//  leaving dev mode broken and only-correct-in-production is a bad place
//  to develop from. Registering our own scheme sidesteps the restriction
//  entirely, in both dev and production alike, since it isn't subject to
//  the file://-from-http:// rule.
//
//  registerSchemesAsPrivileged() MUST run before app 'ready' — hence
//  module-level, not inside whenReady(). `standard: true` and
//  `supportFetchAPI: true` let it behave like a normal resource-loading
//  scheme (relative paths, fetch(), <img src>, etc.); `secure: true`
//  marks it as a secure context so an insecure (http) dev-mode page can
//  still load from it without a mixed-content block.
// ──────────────────────────────────────────────────────────────────

protocol.registerSchemesAsPrivileged([
  {
    scheme: "strip-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

function registerStripFileProtocol() {
  protocol.handle("strip-file", (request) => {
    try {
      const url = new URL(request.url);
      // We build these URLs as "strip-file:///<path>" (see
      // renderer/src/lib/fileUrl.js), so the host portion is empty and
      // the whole path lands in `pathname`, percent-encoded — same shape
      // a file:// URL would have.
      let filePath = decodeURIComponent(url.pathname);
      // On Windows, "strip-file:///C:/Users/..." parses to a pathname of
      // "/C:/Users/...". Strip that leading slash before the drive
      // letter so it becomes a valid Windows path — mirrors what
      // Chromium does internally for file:// URLs on Windows.
      if (process.platform === "win32" && /^\/[a-zA-Z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      return new Response(`strip-file protocol error: ${e.message}`, {
        status: 404,
      });
    }
  });
}

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
    schedules: {},
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

let appConfig = loadConfig();
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
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

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
  registerStripFileProtocol();
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
      resolve({ downloadedCount: 0, hadError: true, errorMessage: e.message });
      return;
    }

    activeDownloads.set(downloadId, child);

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
