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
//  Continue Reading Feature
// ──────────────────────────────────────────────────────────────────

// Track last read position for a series
async function updateLastReadPosition(
  seriesTitle,
  chapterNumber,
  pageIndex,
  totalPages,
) {
  try {
    const lastReadKey = `${seriesTitle}/lastRead`;
    const lastReadData = {
      chapterNumber: chapterNumber,
      pageIndex: pageIndex,
      totalPages: totalPages,
      timestamp: Date.now(),
    };
    await window.strip.progress.set(lastReadKey, lastReadData);

    // Also update a "recently read" timestamp for sorting later if needed
    const recentKey = `${seriesTitle}/recentlyRead`;
    await window.strip.progress.set(recentKey, Date.now());
  } catch (e) {
    console.error("Failed to update last read position:", e);
  }
}

// Get last read position for a series
async function getLastReadPosition(seriesTitle) {
  try {
    const lastReadKey = `${seriesTitle}/lastRead`;
    return await window.strip.progress.get(lastReadKey);
  } catch (e) {
    return null;
  }
}

// Find the last read chapter for a series
async function findLastReadChapter(series) {
  if (!series || !series.chapters?.length) return null;

  const lastRead = await getLastReadPosition(series.title);
  if (!lastRead) return null;

  // Find the chapter with matching number
  const chapter = series.chapters.find(
    (ch) => ch.number == lastRead.chapterNumber,
  );
  return chapter || null;
}

// Continue reading from last saved position
async function continueReading(series) {
  if (!series || !series.chapters?.length) return;

  const lastRead = await getLastReadPosition(series.title);

  if (!lastRead) {
    // If no saved progress, just open the first chapter
    openChapter(series, series.chapters[0]);
    return;
  }

  // Find the chapter
  const chapter = series.chapters.find(
    (ch) => ch.number == lastRead.chapterNumber,
  );
  if (!chapter) {
    // Chapter not found (maybe deleted?), open first chapter
    openChapter(series, series.chapters[0]);
    return;
  }

  // Open chapter and scroll to saved page
  await openChapter(series, chapter, lastRead.pageIndex);
}

// Get reading progress percentage for a series
async function getSeriesProgress(series) {
  if (!series || !series.chapters?.length) return 0;

  const lastRead = await getLastReadPosition(series.title);
  if (!lastRead) return 0;

  // Find chapter index
  const chapterIndex = series.chapters.findIndex(
    (ch) => ch.number == lastRead.chapterNumber,
  );
  if (chapterIndex === -1) return 0;

  // Calculate rough progress: (chapters completed + current chapter progress) / total chapters
  const chaptersCompleted = chapterIndex;
  const chapterProgress = lastRead.pageIndex / (lastRead.totalPages || 1);

  return ((chaptersCompleted + chapterProgress) / series.chapters.length) * 100;
}

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

  // Sort library by recently read (optional)
  const libraryWithProgress = await Promise.all(
    state.library.map(async (series) => {
      const progress = await getSeriesProgress(series);
      return { ...series, progress };
    }),
  );

  // Sort by progress (those with progress first) and then by title
  libraryWithProgress.sort((a, b) => {
    if (a.progress > 0 && b.progress === 0) return -1;
    if (a.progress === 0 && b.progress > 0) return 1;
    return a.title.localeCompare(b.title);
  });

  for (const series of libraryWithProgress) {
    grid.appendChild(await buildSeriesCard(series));
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
    <button class="btn btn-primary" id="btn-empty-download">Download something</button>
  `;

  div.querySelector("#btn-empty-download").addEventListener("click", () => {
    showView("download");
  });

  return div;
}

async function buildSeriesCard(series) {
  const card = document.createElement("div");
  card.className = "series-card";
  card.dataset.directory = series.directory;

  const coverHtml = series.coverPath
    ? `<img class="series-cover" src="file:///${series.coverPath.replace(/\\/g, "/")}" alt="${esc(series.title)}" loading="lazy" />`
    : `<div class="series-cover-placeholder">◈</div>`;

  // Check if this series has a last read position
  const lastRead = await getLastReadPosition(series.title);
  const progress = await getSeriesProgress(series.title);

  card.innerHTML = `
    <div class="series-cover-wrap">
      ${coverHtml}
      <span class="series-card-badge">${series.chapters?.length ?? 0} ch</span>
      ${lastRead ? '<div class="series-card-continue-badge">Continue</div>' : ""}
      <div class="series-card-progress" style="display: ${progress > 0 ? "block" : "none"}">
        <div class="series-card-progress-fill" style="width: ${progress}%"></div>
      </div>
    </div>
    <div class="series-card-title">${esc(series.title)}</div>
    <div class="series-card-meta">${esc(series.author || "")}</div>
  `;

  // Main click opens the series detail
  card.addEventListener("click", (e) => {
    // Don't trigger if clicking on the continue badge
    if (e.target.classList.contains("series-card-continue-badge")) return;
    openSeries(series);
  });

  // Continue badge click handler
  const continueBadge = card.querySelector(".series-card-continue-badge");
  if (continueBadge) {
    continueBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      continueReading(series);
    });
  }

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

  // Check if there's a last read position
  const lastRead = await getLastReadPosition(series.title);
  const lastReadChapter = lastRead
    ? series.chapters?.find((ch) => ch.number == lastRead.chapterNumber)
    : null;

  // Build chapter rows with reading progress indicators
  const chapterRowsHtml = await buildChapterRows(series, lastRead);

  container.innerHTML = `
    <div class="series-detail-hero">
      ${coverHtml}
      <div class="detail-info">
        <h1>${esc(series.title)}</h1>
        <div class="detail-author">${esc(series.author || "Unknown author")}</div>
        ${tags.length ? `<div class="detail-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="detail-desc">${esc(series.description || "")}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="btn-read-first">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            ${lastRead ? "Start Over" : "Read"}
          </button>
          ${
            lastRead
              ? `
          <button class="btn btn-secondary" id="btn-continue-reading">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
            Continue Reading
            ${lastReadChapter ? `<span class="last-read-indicator">Ch. ${lastRead.chapterNumber}</span>` : ""}
          </button>
          `
              : ""
          }
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

  // Read button → open first chapter
  container.querySelector("#btn-read-first")?.addEventListener("click", () => {
    if (series.chapters?.length) openChapter(series, series.chapters[0]);
  });

  // Continue reading button
  const continueBtn = container.querySelector("#btn-continue-reading");
  if (continueBtn) {
    continueBtn.addEventListener("click", () => continueReading(series));
  }

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

async function buildChapterRows(series, lastRead = null) {
  if (!series.chapters?.length)
    return "<p class='muted' style='padding:20px'>No chapters downloaded.</p>";

  // Fetch ALL progress keys in parallel
  const progressResults = await Promise.all(
    series.chapters.map((ch) =>
      window.strip.progress.get(`${series.title}/${ch.number}`).catch(() => 0),
    ),
  );

  return series.chapters
    .map((ch, i) => {
      const hasProgress = progressResults[i] > 0;
      const isLastRead = lastRead && lastRead.chapterNumber == ch.number;
      return `
        <div class="chapter-row ${hasProgress ? "has-progress" : ""} ${isLastRead ? "last-read" : ""}" data-chapter-index="${i}">
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
// Helper to enable/disable chapter navigation buttons
function updateChapterNavButtons() {
  const series = state.currentSeries;
  const chapter = state.currentChapter;
  if (!series || !chapter) return;

  const idx = series.chapters.findIndex((c) => c.number === chapter.number);
  const prevBtn = document.getElementById("btn-prev-chapter");
  const nextBtn = document.getElementById("btn-next-chapter");
  const endPrevBtn = document.getElementById("btn-end-prev-chapter");
  const endNextBtn = document.getElementById("btn-end-next-chapter");

  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= series.chapters.length - 1;
  if (endPrevBtn) endPrevBtn.disabled = idx <= 0;
  if (endNextBtn) endNextBtn.disabled = idx >= series.chapters.length - 1;
}

async function openChapter(series, chapter, scrollToPage = 0) {
  state.currentSeries = series;
  state.currentChapter = chapter;
  state.currentPageIndex = 0;

  const toolbar = document.getElementById("reader-toolbar");
  const pagesEl = document.getElementById("reader-pages");
  const titleEl = document.getElementById("reader-title");
  const pageInfo = document.getElementById("reader-page-info");

  titleEl.textContent = `${series.title}  ·  Chapter ${chapter.number}`;
  pagesEl.innerHTML = "";
  pageInfo.textContent = "";

  showView("reader");

  // Update button states
  updateChapterNavButtons();

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

  // Restore progress (if not overridden by scrollToPage)
  const progressKey = `${series.title}/${chapter.number}`;
  let startPage = 0;
  try {
    startPage =
      scrollToPage > 0
        ? scrollToPage
        : await window.strip.progress.get(progressKey);
  } catch (_) {}

  // Build image elements
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

    // Set src immediately
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

  // Save progress on scroll
  const container = document.getElementById("reader-container");
  let saveTimer = null;

  // Remove old listener if exists
  const oldListener = container._scrollListener;
  if (oldListener) {
    container.removeEventListener("scroll", oldListener);
  }

  const scrollListener = () => {
    // Find which image is most visible
    const imgs = pagesEl.querySelectorAll("img");
    let visibleIdx = 0;
    imgs.forEach((img, i) => {
      const rect = img.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2 && rect.bottom > 0) visibleIdx = i;
    });
    pageInfo.textContent = `${visibleIdx + 1} / ${pages.length}`;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // Save chapter progress
      window.strip.progress.set(progressKey, visibleIdx);
      // Save last read position for the series
      updateLastReadPosition(
        series.title,
        chapter.number,
        visibleIdx,
        pages.length,
      );
    }, 500);
  };

  container._scrollListener = scrollListener;
  container.addEventListener("scroll", scrollListener, { passive: true });

  // Update end-of-chapter overlay
  setupChapterEndOverlay(series, chapter);
}

function setupChapterEndOverlay(series, chapter) {
  const overlay = document.getElementById("chapter-end-overlay");
  const endTitle = document.getElementById("chapter-end-title");
  const endPrevBtn = document.getElementById("btn-end-prev-chapter");
  const endNextBtn = document.getElementById("btn-end-next-chapter");

  endTitle.textContent = `${series.title} · Chapter ${chapter.number}`;

  // Update button states
  const idx = series.chapters.findIndex((c) => c.number === chapter.number);
  if (endPrevBtn) endPrevBtn.disabled = idx <= 0;
  if (endNextBtn) endNextBtn.disabled = idx >= series.chapters.length - 1;

  // Show overlay when reaching bottom
  const container = document.getElementById("reader-container");

  const checkBottom = () => {
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    if (scrollHeight - scrollTop - clientHeight < 100) {
      overlay.style.display = "flex";
    } else {
      overlay.style.display = "none";
    }
  };

  // Remove old listener
  const oldBottomCheck = container._bottomCheck;
  if (oldBottomCheck) {
    container.removeEventListener("scroll", oldBottomCheck);
  }

  container._bottomCheck = checkBottom;
  container.addEventListener("scroll", checkBottom, { passive: true });
}

function goBackFromReader() {
  if (state.currentSeries) {
    // Refresh the series detail view to show updated progress
    openSeries(state.currentSeries);
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

  // Chapter navigation buttons
  document.getElementById("btn-prev-chapter")?.addEventListener("click", () => {
    const idx = state.currentSeries?.chapters.findIndex(
      (c) => c.number === state.currentChapter?.number,
    );
    if (idx > 0)
      openChapter(state.currentSeries, state.currentSeries.chapters[idx - 1]);
  });

  document.getElementById("btn-next-chapter")?.addEventListener("click", () => {
    const idx = state.currentSeries?.chapters.findIndex(
      (c) => c.number === state.currentChapter?.number,
    );
    if (idx !== -1 && idx < state.currentSeries.chapters.length - 1)
      openChapter(state.currentSeries, state.currentSeries.chapters[idx + 1]);
  });

  document
    .getElementById("btn-end-prev-chapter")
    ?.addEventListener("click", () => {
      const idx = state.currentSeries?.chapters.findIndex(
        (c) => c.number === state.currentChapter?.number,
      );
      if (idx > 0)
        openChapter(state.currentSeries, state.currentSeries.chapters[idx - 1]);
    });

  document
    .getElementById("btn-end-next-chapter")
    ?.addEventListener("click", () => {
      const idx = state.currentSeries?.chapters.findIndex(
        (c) => c.number === state.currentChapter?.number,
      );
      if (idx !== -1 && idx < state.currentSeries.chapters.length - 1)
        openChapter(state.currentSeries, state.currentSeries.chapters[idx + 1]);
    });

  document
    .getElementById("btn-end-back")
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

  // Global keyboard shortcuts (reader only)
  document.addEventListener("keydown", (e) => {
    if (state.currentView !== "reader") return;

    // Ignore if user is typing in an input (none in reader, but safe)
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    const key = e.key.toLowerCase();

    // Escape → back to series list
    if (key === "escape") {
      e.preventDefault();
      goBackFromReader();
      return;
    }

    // n / p → next / previous chapter
    if (key === "n") {
      e.preventDefault();
      const idx = state.currentSeries?.chapters.findIndex(
        (c) => c.number === state.currentChapter?.number,
      );
      if (idx !== -1 && idx < state.currentSeries.chapters.length - 1) {
        openChapter(state.currentSeries, state.currentSeries.chapters[idx + 1]);
      }
      return;
    }

    if (key === "p") {
      e.preventDefault();
      const idx = state.currentSeries?.chapters.findIndex(
        (c) => c.number === state.currentChapter?.number,
      );
      if (idx > 0) {
        openChapter(state.currentSeries, state.currentSeries.chapters[idx - 1]);
      }
      return;
    }

    // Arrow keys for scrolling
    const container = document.getElementById("reader-container");
    if (!container) return;

    if (key === "arrowdown" || key === "arrowright") {
      e.preventDefault();
      container.scrollBy({
        top: window.innerHeight * 0.85,
        behavior: "smooth",
      });
    } else if (key === "arrowup" || key === "arrowleft") {
      e.preventDefault();
      container.scrollBy({
        top: -window.innerHeight * 0.85,
        behavior: "smooth",
      });
    }
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
