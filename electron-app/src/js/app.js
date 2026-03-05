// electron-app/src/js/app.js
// Renderer process – all UI logic.
// Communicates with main process ONLY via window.strip (set by preload.js).

"use strict";

// ──────────────────────────────────────────────────────────────────
//  State
// ──────────────────────────────────────────────────────────────────
const state = {
  currentView: "library",
  library: [],
  currentSeries: null,
  currentChapter: null,
  currentPages: [],
  currentPageIndex: 0,
  config: {},
  activeDownloadId: null,
};

// ──────────────────────────────────────────────────────────────────
//  View router
// ──────────────────────────────────────────────────────────────────
function showView(id) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document
    .querySelectorAll(".nav-link")
    .forEach((a) => a.classList.remove("active"));

  const view = document.getElementById(`view-${id}`);
  if (view) view.classList.add("active");

  const navLink = document.querySelector(`[data-view="${id}"]`);
  if (navLink) navLink.classList.add("active");

  state.currentView = id;
}

// ──────────────────────────────────────────────────────────────────
//  Library
// ──────────────────────────────────────────────────────────────────
async function loadLibrary() {
  const grid = document.getElementById("library-grid");
  const empty = document.getElementById("library-empty");

  grid.innerHTML =
    '<div class="empty-state"><div class="empty-icon">◈</div><p style="color:var(--text-muted)">Loading…</p></div>';

  try {
    state.library = await window.strip.library.scan();
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p style="color:var(--text-muted)">Error loading library: ${e.message}</p></div>`;
    return;
  }

  grid.innerHTML = "";

  if (state.library.length === 0) {
    grid.appendChild(buildEmptyState());
    return;
  }

  for (const series of state.library) {
    grid.appendChild(buildSeriesCard(series));
  }
}

function buildEmptyState() {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.id = "library-empty";
  div.innerHTML = `
    <div class="empty-icon">◈</div>
    <p>Your library is empty.</p>
    <p class="muted">Download a webtoon to get started.</p>
    <button class="btn btn-primary" onclick="showView('download')">Download something</button>
  `;
  return div;
}

function buildSeriesCard(series) {
  const card = document.createElement("div");
  card.className = "series-card";
  card.dataset.directory = series.directory;

  const coverHtml = series.coverPath
    ? `<img class="series-cover" src="file:///${series.coverPath.replace(/\\/g, "/")}" alt="${esc(series.title)}" loading="lazy" />`
    : `<div class="series-cover-placeholder">◈</div>`;

  card.innerHTML = `
    <div class="series-cover-wrap">
      ${coverHtml}
      <span class="series-card-badge">${series.chapters?.length ?? 0} ch</span>
    </div>
    <div class="series-card-title">${esc(series.title)}</div>
    <div class="series-card-meta">${esc(series.author || "")}</div>
  `;

  card.addEventListener("click", () => openSeries(series));
  return card;
}

// ──────────────────────────────────────────────────────────────────
//  Series detail
// ──────────────────────────────────────────────────────────────────
async function openSeries(series) {
  state.currentSeries = series;

  const container = document.getElementById("series-detail");

  const coverHtml = series.coverPath
    ? `<img class="detail-cover" src="file:///${series.coverPath.replace(/\\/g, "/")}" alt="${esc(series.title)}" />`
    : `<div class="detail-cover-placeholder">◈</div>`;

  const tags = [series.genre, series.status].filter(Boolean);

  // Build chapter rows with reading progress indicators
  const chapterRowsHtml = await buildChapterRows(series);

  container.innerHTML = `
    <div class="series-detail-hero">
      ${coverHtml}
      <div class="detail-info">
        <h1>${esc(series.title)}</h1>
        <div class="detail-author">${esc(series.author || "Unknown author")}</div>
        ${tags.length ? `<div class="detail-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="detail-desc">${esc(series.description || "")}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" id="btn-read-first">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Read
          </button>
          <button class="btn btn-ghost" id="btn-series-download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M12 3v13M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
            Download more
          </button>
        </div>
      </div>
    </div>

    <div class="chapter-list-header">
      <h2>Chapters <span class="muted" style="font-size:14px;font-family:var(--font-body)">${series.chapters?.length ?? 0}</span></h2>
    </div>
    <div class="chapter-list" id="series-chapter-list">
      ${chapterRowsHtml}
    </div>
  `;

  // Wire up chapter clicks
  container.querySelectorAll(".chapter-row").forEach((row) => {
    row.addEventListener("click", () => {
      const chIdx = parseInt(row.dataset.chapterIndex);
      openChapter(series, series.chapters[chIdx]);
    });
  });

  // Read button → open first chapter (or last-in-progress)
  container.querySelector("#btn-read-first")?.addEventListener("click", () => {
    if (series.chapters?.length) openChapter(series, series.chapters[0]);
  });

  // Download more button
  container
    .querySelector("#btn-series-download")
    ?.addEventListener("click", () => {
      document.getElementById("download-url").value =
        series.metadata?.url ?? "";
      showView("download");
      // Switch nav highlight
      document
        .querySelectorAll(".nav-link")
        .forEach((a) => a.classList.remove("active"));
      document.querySelector('[data-view="download"]')?.classList.add("active");
    });

  showView("series");
}

async function buildChapterRows(series) {
  if (!series.chapters?.length)
    return "<p class='muted' style='padding:20px'>No chapters downloaded.</p>";

  // Fetch ALL progress keys in parallel — not one await per chapter.
  // A 200-chapter series would hang for several seconds doing it sequentially.
  const progressResults = await Promise.all(
    series.chapters.map((ch) =>
      window.strip.progress.get(`${series.title}/${ch.number}`).catch(() => 0),
    ),
  );

  return series.chapters
    .map((ch, i) => {
      const hasProgress = progressResults[i] > 0;
      return `
        <div class="chapter-row ${hasProgress ? "has-progress" : ""}" data-chapter-index="${i}">
          <span class="chapter-num">${ch.number}</span>
          <span class="chapter-title">${esc(ch.title)}</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="chapter-date">${esc(ch.date ?? "")}</span>
            <div class="chapter-progress-dot" title="In progress"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

// ──────────────────────────────────────────────────────────────────
//  Reader
// ──────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────
//  Reader
// ──────────────────────────────────────────────────────────────────

function chapterIndex(series, chapter) {
  return series.chapters.findIndex((c) => c.number === chapter.number);
}

function updateNavButtons() {
  const series = state.currentSeries;
  const chapter = state.currentChapter;
  if (!series || !chapter) return;
  const idx = chapterIndex(series, chapter);
  const hasPrev = idx > 0;
  const hasNext = idx < series.chapters.length - 1;

  const btnPrev = document.getElementById("btn-prev-chapter");
  const btnNext = document.getElementById("btn-next-chapter");
  if (btnPrev) btnPrev.disabled = !hasPrev;
  if (btnNext) btnNext.disabled = !hasNext;

  const btnEndPrev = document.getElementById("btn-end-prev-chapter");
  const btnEndNext = document.getElementById("btn-end-next-chapter");
  if (btnEndPrev) btnEndPrev.disabled = !hasPrev;
  if (btnEndNext) btnEndNext.disabled = !hasNext;

  const endTitle = document.getElementById("chapter-end-title");
  if (endTitle) {
    if (hasNext) {
      const next = series.chapters[idx + 1];
      endTitle.textContent = `Ch ${next.number}  —  ${next.title}`;
    } else {
      endTitle.textContent = "You've reached the last downloaded chapter.";
    }
  }
}

function navigateChapter(direction) {
  const series = state.currentSeries;
  const chapter = state.currentChapter;
  if (!series || !chapter) return;
  const idx = chapterIndex(series, chapter);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= series.chapters.length) return;
  openChapter(series, series.chapters[targetIdx]);
}

async function openChapter(series, chapter) {
  state.currentSeries = series;
  state.currentChapter = chapter;
  state.currentPageIndex = 0;

  const pagesEl = document.getElementById("reader-pages");
  const titleEl = document.getElementById("reader-title");
  const pageInfo = document.getElementById("reader-page-info");
  const endOverlay = document.getElementById("chapter-end-overlay");

  titleEl.textContent = `${series.title}  ·  Ch ${chapter.number}  —  ${chapter.title}`;
  pagesEl.innerHTML = "";
  pageInfo.textContent = "";
  if (endOverlay) endOverlay.style.display = "none";

  // Scroll to top on chapter switch
  const existingContainer = document.getElementById("reader-container");
  if (existingContainer) existingContainer.scrollTop = 0;

  showView("reader");
  updateNavButtons();

  // Load pages
  let pages = [];
  try {
    pages = await window.strip.chapter.pages(chapter.directory);
  } catch (e) {
    pagesEl.innerHTML = `<div class="reader-page-error">Could not load pages: ${e.message}</div>`;
    return;
  }

  state.currentPages = pages;

  if (!pages.length) {
    pagesEl.innerHTML = `<div class="reader-page-error">No pages found in this chapter.</div>`;
    return;
  }

  // Restore progress
  const progressKey = `${series.title}/${chapter.number}`;
  let startPage = 0;
  try {
    startPage = await window.strip.progress.get(progressKey);
  } catch (_) {}

  // Build image elements
  // Local file:// images load near-instantly — no need for lazy loading.
  // We just set src directly and let the browser handle it.
  pages.forEach((filePath, i) => {
    const wrapper = document.createElement("div");
    wrapper.style.width = "100%";
    wrapper.style.position = "relative";

    const shimmer = document.createElement("div");
    shimmer.className = "reader-page-loading";
    wrapper.appendChild(shimmer);

    const img = document.createElement("img");
    img.className = "reader-page-img";
    // Windows paths use backslashes — file:// URLs require forward slashes
    const fileUrl = "file:///" + filePath.replace(/\\/g, "/");
    img.alt = `Page ${i + 1}`;
    img.style.display = "none";

    img.onload = () => {
      shimmer.remove();
      img.style.display = "block";
    };
    img.onerror = () => {
      shimmer.remove();
      const err = document.createElement("div");
      err.className = "reader-page-error";
      err.textContent = `Page ${i + 1} could not be loaded.`;
      wrapper.appendChild(err);
    };

    // Set src immediately — local files are fast, no lazy-loading needed
    img.src = fileUrl;

    wrapper.appendChild(img);
    pagesEl.appendChild(wrapper);
  });

  pageInfo.textContent = `${pages.length} pages`;

  // Scroll to saved progress
  if (startPage > 0 && startPage < pages.length) {
    setTimeout(() => {
      const imgs = pagesEl.querySelectorAll("img");
      if (imgs[startPage]) {
        imgs[startPage].closest("div")?.scrollIntoView({ behavior: "smooth" });
      }
    }, 200);
  }

  // Clone container to wipe stale scroll listeners from previous chapter
  const oldContainer = document.getElementById("reader-container");
  const freshContainer = oldContainer.cloneNode(true);
  oldContainer.parentNode.replaceChild(freshContainer, oldContainer);
  const container = document.getElementById("reader-container");

  let saveTimer = null;
  let endShown = false;

  container.addEventListener(
    "scroll",
    () => {
      const imgs = container.querySelectorAll("#reader-pages img");
      let visibleIdx = 0;
      imgs.forEach((img, i) => {
        const rect = img.getBoundingClientRect();
        if (rect.top < window.innerHeight / 2 && rect.bottom > 0)
          visibleIdx = i;
      });
      pageInfo.textContent = `${visibleIdx + 1} / ${pages.length}`;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        window.strip.progress.set(progressKey, visibleIdx);
      }, 500);

      // Show end-of-chapter card when within 200px of bottom
      const dist =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const overlay = document.getElementById("chapter-end-overlay");
      if (overlay && dist < 200 && !endShown) {
        endShown = true;
        overlay.style.display = "flex";
        updateNavButtons();
      }
    },
    { passive: true },
  );

  // Keyboard shortcuts
  if (state._keyHandler)
    document.removeEventListener("keydown", state._keyHandler);
  state._keyHandler = (e) => {
    const c = document.getElementById("reader-container");
    if (!c) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      c.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      c.scrollBy({ top: -window.innerHeight * 0.85, behavior: "smooth" });
    } else if (e.key === "Escape") {
      goBackFromReader();
    } else if (e.key === "]" || e.key === "n") {
      navigateChapter(1);
    } else if (e.key === "[" || e.key === "p") {
      navigateChapter(-1);
    }
  };
  document.addEventListener("keydown", state._keyHandler);
}

function goBackFromReader() {
  if (state._keyHandler) {
    document.removeEventListener("keydown", state._keyHandler);
    state._keyHandler = null;
  }
  if (state.currentSeries) {
    showView("series");
    // Re-highlight series nav as "library"
    document
      .querySelectorAll(".nav-link")
      .forEach((a) => a.classList.remove("active"));
    document.querySelector('[data-view="library"]')?.classList.add("active");
  } else {
    showView("library");
  }
}
// ──────────────────────────────────────────────────────────────────
//  Download
// ──────────────────────────────────────────────────────────────────
async function startDownload() {
  const url = document.getElementById("download-url").value.trim();
  const chapters = document.getElementById("download-chapters").value.trim();

  if (!url) {
    document.getElementById("download-url").focus();
    return;
  }

  const progressCard = document.getElementById("download-progress-card");
  const fillEl = document.getElementById("dl-progress-fill");
  const pctEl = document.getElementById("dl-progress-pct");
  const chapterInfo = document.getElementById("dl-chapter-info");
  const seriesTitle = document.getElementById("dl-series-title");
  const logEl = document.getElementById("dl-log");

  progressCard.style.display = "block";
  fillEl.style.width = "0%";
  pctEl.textContent = "0%";
  seriesTitle.textContent = "Starting…";
  chapterInfo.textContent = "Initializing…";
  logEl.innerHTML = "";

  const opts = { url, downloadDir: state.config.downloadDir };
  if (chapters) opts.chapters = chapters;

  try {
    state.activeDownloadId = await window.strip.download.start(opts);
  } catch (e) {
    logEl.innerHTML += `<div style="color:var(--danger)">Error: ${esc(e.message)}</div>`;
    return;
  }

  window.strip.download.onProgress((data) => {
    if (data.downloadId !== state.activeDownloadId) return;

    switch (data.status) {
      case "series_info":
        seriesTitle.textContent = data.title ?? "—";
        break;

      case "chapter_progress":
        chapterInfo.textContent = `Chapter ${data.chapter_number}: ${esc(data.chapter_title ?? "")}  (${data.current}/${data.total})`;
        // Use overall chapter progress as bar
        const overall = Math.round((data.current / data.total) * 100);
        fillEl.style.width = overall + "%";
        pctEl.textContent = overall + "%";
        break;

      case "progress":
        // Per-page progress within current chapter
        fillEl.style.width = data.percent + "%";
        pctEl.textContent = data.percent + "%";
        break;

      case "chapter_done":
        addLog(
          logEl,
          `✓ Chapter ${data.chapter} downloaded (${data.pages_saved} pages)`,
        );
        break;

      case "skipped":
        addLog(logEl, `– Chapter ${data.chapter} skipped (already downloaded)`);
        break;

      case "done":
        seriesTitle.textContent = data.series ?? seriesTitle.textContent;
        chapterInfo.textContent = "Download complete!";
        fillEl.style.width = "100%";
        pctEl.textContent = "100%";
        addLog(logEl, `✓ Saved to ${data.directory}`);
        state.activeDownloadId = null;
        // Auto-refresh library after 1s
        setTimeout(() => loadLibrary(), 1000);
        break;

      case "error":
        addLog(logEl, `✗ ${data.message}`, "error");
        break;

      case "process_exit":
        if (data.code !== 0 && state.activeDownloadId) {
          addLog(logEl, `Process exited with code ${data.code}`, "error");
          state.activeDownloadId = null;
        }
        window.strip.download.offProgress();
        break;

      case "log":
        addLog(logEl, data.message);
        break;
    }
  });
}

function addLog(el, msg, type = "info") {
  const line = document.createElement("div");
  line.textContent = msg;
  if (type === "error") line.style.color = "var(--danger)";
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ──────────────────────────────────────────────────────────────────
//  Settings
// ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  state.config = await window.strip.config.get();

  const dirEl = document.getElementById("setting-download-dir");
  const themeEl = document.getElementById("setting-theme");

  if (dirEl) dirEl.textContent = state.config.downloadDir ?? "~";
  if (themeEl) themeEl.value = state.config.theme ?? "system";
}

// ──────────────────────────────────────────────────────────────────
//  Theme
// ──────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  const body = document.body;
  if (theme === "dark") {
    body.setAttribute("data-theme", "dark");
  } else if (theme === "light") {
    body.setAttribute("data-theme", "light");
  } else {
    // system
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    body.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }
}

// ──────────────────────────────────────────────────────────────────
//  Bootstrap
// ──────────────────────────────────────────────────────────────────
async function init() {
  // Load config first
  try {
    state.config = await window.strip.config.get();
    applyTheme(state.config.theme ?? "system");
  } catch (_) {}

  // Nav links
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      showView(view);
      if (view === "library") loadLibrary();
      if (view === "settings") loadSettings();
    });
  });

  // Library actions
  document
    .getElementById("btn-refresh-library")
    ?.addEventListener("click", loadLibrary);
  document
    .getElementById("btn-add-download")
    ?.addEventListener("click", () => showView("download"));

  // Back buttons
  document.getElementById("btn-back-library")?.addEventListener("click", () => {
    showView("library");
    document
      .querySelectorAll(".nav-link")
      .forEach((a) => a.classList.remove("active"));
    document.querySelector('[data-view="library"]')?.classList.add("active");
  });
  document
    .getElementById("btn-back-series")
    ?.addEventListener("click", goBackFromReader);

  // Download
  document
    .getElementById("btn-start-download")
    ?.addEventListener("click", startDownload);
  document
    .getElementById("btn-cancel-download")
    ?.addEventListener("click", async () => {
      if (state.activeDownloadId) {
        await window.strip.download.cancel(state.activeDownloadId);
        state.activeDownloadId = null;
        document.getElementById("dl-chapter-info").textContent = "Cancelled.";
      }
    });

  // Theme toggle
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    window.strip.theme.set(next);
    state.config.theme = next;
  });

  // Settings: folder picker
  document
    .getElementById("btn-change-folder")
    ?.addEventListener("click", async () => {
      const folder = await window.strip.dialog.openFolder();
      if (folder) {
        await window.strip.config.set({ downloadDir: folder });
        state.config.downloadDir = folder;
        document.getElementById("setting-download-dir").textContent = folder;
      }
    });

  // Settings: theme select
  document
    .getElementById("setting-theme")
    ?.addEventListener("change", async (e) => {
      const theme = e.target.value;
      applyTheme(theme);
      await window.strip.theme.set(theme);
      await window.strip.config.set({ theme });
    });

  // Initial load
  await loadLibrary();
}

// ──────────────────────────────────────────────────────────────────
//  Utils
// ──────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ──────────────────────────────────────────────────────────────────
//  Run
// ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);
