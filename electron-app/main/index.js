// electron-app/main/index.js
// Main process: creates windows, handles IPC, spawns Python CLI subprocess.

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = process.argv.includes("--dev");

// ──────────────────────────────────────────────────────────────────
//  Config persistence (separate from Python config)
// ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (_) {}
  return {
    downloadDir: path.join(app.getPath("home"), "strip-data"),
    theme: "system",
    readingProgress: {},  // { "SeriesName/chapter": lastPageIndex }
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
      // Allow loading local images from the download directory
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../src/index.html"));

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

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
    // Bundled via electron-builder extraResources
    const bundled = path.join(process.resourcesPath, "strip-cli", "strip");
    if (fs.existsSync(bundled)) return bundled;
    // Windows
    const bundledWin = path.join(process.resourcesPath, "strip-cli", "strip.exe");
    if (fs.existsSync(bundledWin)) return bundledWin;
  }
  // Development: use system `strip` command
  return "strip";
}

// ──────────────────────────────────────────────────────────────────
//  IPC handlers
// ──────────────────────────────────────────────────────────────────

// ---- Config

ipcMain.handle("config:get", () => appConfig);

ipcMain.handle("config:set", (_, updates) => {
  appConfig = { ...appConfig, ...updates };
  saveConfig(appConfig);
  return appConfig;
});

// ---- Library scanning

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
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}

    const coverPath = path.join(seriesDir, "cover.jpg");
    const chapters = [];

    for (const ch of fs.readdirSync(seriesDir, { withFileTypes: true })) {
      if (!ch.isDirectory() || !/^\d+$/.test(ch.name)) continue;
      const chDir = path.join(seriesDir, ch.name);
      const chMeta = path.join(chDir, "metadata.json");
      let chData = { number: parseInt(ch.name), title: `Chapter ${parseInt(ch.name)}` };
      try { chData = { ...chData, ...JSON.parse(fs.readFileSync(chMeta, "utf8")) }; } catch (_) {}
      const pages = fs.readdirSync(chDir).filter(f => f.endsWith(".jpg") && f !== "cover.jpg").length;
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

// ---- Chapter pages

ipcMain.handle("chapter:pages", (_, chapterDir) => {
  if (!fs.existsSync(chapterDir)) return [];
  return fs
    .readdirSync(chapterDir)
    .filter(f => f.endsWith(".jpg") && !f.startsWith("cover"))
    .sort()
    .map(f => path.join(chapterDir, f));
});

// ---- Reading progress

ipcMain.handle("progress:get", (_, key) => {
  return appConfig.readingProgress?.[key] ?? 0;
});

ipcMain.handle("progress:set", (_, key, pageIndex) => {
  if (!appConfig.readingProgress) appConfig.readingProgress = {};
  appConfig.readingProgress[key] = pageIndex;
  saveConfig(appConfig);
  return true;
});

// ---- Download (spawn Python CLI)

// Track active downloads so we can cancel
const activeDownloads = new Map();

ipcMain.handle("download:start", (event, { url, chapters, downloadDir }) => {
  const args = ["download", url, "--json-progress"];
  if (chapters) args.push("--chapters", chapters);
  if (downloadDir) args.push("--output", downloadDir);

  const cliPath = getStripCliPath();
  const child = spawn(cliPath, args, {
    env: { ...process.env },
  });

  const downloadId = Date.now().toString();
  activeDownloads.set(downloadId, child);

  child.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // Forward progress events to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("download:progress", { downloadId, ...parsed });
        }
      } catch (_) {
        // Non-JSON line (e.g. tracebacks) – forward as raw message
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("download:progress", {
            downloadId,
            status: "log",
            message: line,
          });
        }
      }
    }
  });

  child.stderr.on("data", (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("download:progress", {
        downloadId,
        status: "error",
        message: data.toString(),
      });
    }
  });

  child.on("close", (code) => {
    activeDownloads.delete(downloadId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("download:progress", {
        downloadId,
        status: "process_exit",
        code,
      });
    }
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

// ---- Folder picker dialog

ipcMain.handle("dialog:openFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.filePaths[0] ?? null;
});

// ---- Theme

ipcMain.handle("theme:get", () => nativeTheme.shouldUseDarkColors ? "dark" : "light");

ipcMain.handle("theme:set", (_, theme) => {
  nativeTheme.themeSource = theme; // "light" | "dark" | "system"
  appConfig.theme = theme;
  saveConfig(appConfig);
});
