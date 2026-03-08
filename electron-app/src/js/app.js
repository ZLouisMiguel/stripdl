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

async function updateLastReadPosition(
  seriesTitle,
  chapterNumber,
  pageIndex,
  totalPages,
) {
  try {
    await window.strip.progress.set(`${seriesTitle}/lastRead`, {
      chapterNumber,
      pageIndex,
      totalPages,
      timestamp: Date.now(),
    });
    await window.strip.progress.set(`${seriesTitle}/recentlyRead`, Date.now());
  } catch (e) {
    console.error("Failed to update last read position:", e);
  }
}

async function getLastReadPosition(seriesTitle) {
  try {
    return await window.strip.progress.get(`${seriesTitle}/lastRead`);
  } catch (e) {
    return null;
  }
}

async function continueReading(series) {
  if (!series || !series.chapters?.length) return;
  const lastRead = await getLastReadPosition(series.title);
  if (!lastRead) {
    openChapter(series, series.chapters[0]);
    return;
  }
  const chapter = series.chapters.find(
    (ch) => ch.number == lastRead.chapterNumber,
  );
  await openChapter(series, chapter || series.chapters[0], lastRead.pageIndex);
}

async function getSeriesProgress(series) {
  if (!series || !series.chapters?.length) return 0;
  const lastRead = await getLastReadPosition(series.title);
  if (!lastRead) return 0;
  const chapterIndex = series.chapters.findIndex(
    (ch) => ch.number == lastRead.chapterNumber,
  );
  if (chapterIndex === -1) return 0;
  const chapterProgress = lastRead.pageIndex / (lastRead.totalPages || 1);
  return ((chapterIndex + chapterProgress) / series.chapters.length) * 100;
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
  document.getElementById(`view-${id}`)?.classList.add("active");
  document.querySelector(`[data-view="${id}"]`)?.classList.add("active");
  state.currentView = id;
}

// ──────────────────────────────────────────────────────────────────
//  Library
// ──────────────────────────────────────────────────────────────────
async function loadLibrary() {
  const grid = document.getElementById("library-grid");

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

  const libraryWithProgress = await Promise.all(
    state.library.map(async (series) => ({
      ...series,
      progress: await getSeriesProgress(series),
    })),
  );

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
  div
    .querySelector("#btn-empty-download")
    .addEventListener("click", () => showView("download"));
  return div;
}

async function buildSeriesCard(series) {
  const card = document.createElement("div");
  card.className = "series-card";
  card.dataset.directory = series.directory;

  const coverHtml = series.coverPath
    ? `<img class="series-cover" src="file:///${series.coverPath.replace(/\\/g, "/")}" alt="${esc(series.title)}" loading="lazy" />`
    : `<div class="series-cover-placeholder">◈</div>`;

  const lastRead = await getLastReadPosition(series.title);
  const progress = await getSeriesProgress(series);

  card.innerHTML = `
    <div class="series-cover-wrap">
      ${coverHtml}
      <span class="series-card-badge">${series.chapters?.length ?? 0} ch</span>
      ${lastRead ? '<div class="series-card-continue-badge">Continue</div>' : ""}
      <div class="series-card-progress" style="display:${progress > 0 ? "block" : "none"}">
        <div class="series-card-progress-fill" style="width:${progress}%"></div>
      </div>
    </div>
    <div class="series-card-title">${esc(series.title)}</div>
    <div class="series-card-meta">${esc(series.author || "")}</div>
  `;

  card.addEventListener("click", (e) => {
    if (e.target.classList.contains("series-card-continue-badge")) return;
    openSeries(series);
  });

  card
    .querySelector(".series-card-continue-badge")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      continueReading(series);
    });

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
  const lastRead = await getLastReadPosition(series.title);
  const lastReadChapter = lastRead
    ? series.chapters?.find((ch) => ch.number == lastRead.chapterNumber)
    : null;

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
          </button>`
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

  container.querySelectorAll(".chapter-row").forEach((row) => {
    row.addEventListener("click", () => {
      openChapter(series, series.chapters[parseInt(row.dataset.chapterIndex)]);
    });
  });

  container.querySelector("#btn-read-first")?.addEventListener("click", () => {
    if (series.chapters?.length) openChapter(series, series.chapters[0]);
  });

  container
    .querySelector("#btn-continue-reading")
    ?.addEventListener("click", () => {
      continueReading(series);
    });

  container
    .querySelector("#btn-series-download")
    ?.addEventListener("click", () => {
      document.getElementById("download-url").value =
        series.metadata?.url ?? "";
      showView("download");
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
function updateChapterNavButtons() {
  const { currentSeries: series, currentChapter: chapter } = state;
  if (!series || !chapter) return;

  const idx = series.chapters.findIndex((c) => c.number === chapter.number);
  document.getElementById("btn-prev-chapter").disabled = idx <= 0;
  document.getElementById("btn-next-chapter").disabled =
    idx >= series.chapters.length - 1;
  document.getElementById("btn-end-prev-chapter").disabled = idx <= 0;
  document.getElementById("btn-end-next-chapter").disabled =
    idx >= series.chapters.length - 1;
}

async function openChapter(series, chapter, scrollToPage = 0) {
  state.currentSeries = series;
  state.currentChapter = chapter;
  state.currentPageIndex = 0;

  const pagesEl = document.getElementById("reader-pages");
  const titleEl = document.getElementById("reader-title");
  const pageInfo = document.getElementById("reader-page-info");
  const overlay = document.getElementById("chapter-end-overlay");

  titleEl.textContent = `${series.title}  ·  Chapter ${chapter.number}`;
  pagesEl.innerHTML = "";
  pageInfo.textContent = "";

  // Reset overlay — class toggle only, no display change
  overlay.classList.remove("is-visible");
  overlay.setAttribute("aria-hidden", "true");

  showView("reader");
  updateChapterNavButtons();

  // Update end-of-chapter card text and button states
  setupChapterEndOverlay(series, chapter);

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

  const progressKey = `${series.title}/${chapter.number}`;
  let startPage = 0;
  try {
    startPage =
      scrollToPage > 0
        ? scrollToPage
        : await window.strip.progress.get(progressKey);
  } catch (_) {}

  pages.forEach((filePath, i) => {
    const wrapper = document.createElement("div");
    wrapper.style.width = "100%";
    wrapper.style.position = "relative";

    const shimmer = document.createElement("div");
    shimmer.className = "reader-page-loading";
    wrapper.appendChild(shimmer);

    const img = document.createElement("img");
    img.className = "reader-page-img";
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

    img.src = "file:///" + filePath.replace(/\\/g, "/");
    wrapper.appendChild(img);
    pagesEl.appendChild(wrapper);
  });

  pageInfo.textContent = `${pages.length} pages`;

  if (startPage > 0 && startPage < pages.length) {
    setTimeout(() => {
      const imgs = pagesEl.querySelectorAll("img");
      imgs[startPage]?.closest("div")?.scrollIntoView({ behavior: "smooth" });
    }, 200);
  }

  const container = document.getElementById("reader-container");
  let saveTimer = null;

  // Remove previous chapter's listener before attaching a new one
  if (container._scrollListener) {
    container.removeEventListener("scroll", container._scrollListener);
  }

  const scrollListener = () => {
    // ── Page counter ───────────────────────────────────────────────
    const imgs = pagesEl.querySelectorAll("img");
    let visibleIdx = 0;
    imgs.forEach((img, i) => {
      const rect = img.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2 && rect.bottom > 0) visibleIdx = i;
    });
    pageInfo.textContent = `${visibleIdx + 1} / ${pages.length}`;

    // ── Save progress (debounced) ──────────────────────────────────
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      window.strip.progress.set(progressKey, visibleIdx);
      updateLastReadPosition(
        series.title,
        chapter.number,
        visibleIdx,
        pages.length,
      );
    }, 500);

    // ── End-of-chapter overlay ─────────────────────────────────────
    // Hysteresis: show at <120px from bottom, hide only when scrolled
    // back >180px. Class-toggle only — zero display changes, zero reflow.
    const distFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isVisible = overlay.classList.contains("is-visible");

    if (!isVisible && distFromBottom < 120) {
      overlay.classList.add("is-visible");
      overlay.setAttribute("aria-hidden", "false");
    } else if (isVisible && distFromBottom > 180) {
      overlay.classList.remove("is-visible");
      overlay.setAttribute("aria-hidden", "true");
    }
  };

  container._scrollListener = scrollListener;
  container.addEventListener("scroll", scrollListener, { passive: true });
}

function setupChapterEndOverlay(series, chapter) {
  const overlay = document.getElementById("chapter-end-overlay");
  const endTitle = document.getElementById("chapter-end-title");
  const endPrevBtn = document.getElementById("btn-end-prev-chapter");
  const endNextBtn = document.getElementById("btn-end-next-chapter");

  endTitle.textContent = `${series.title} · Chapter ${chapter.number}`;

  const idx = series.chapters.findIndex((c) => c.number === chapter.number);
  endPrevBtn.disabled = idx <= 0;
  endNextBtn.disabled = idx >= series.chapters.length - 1;

  // Always hidden when a chapter first loads — scroll listener shows it
  overlay.classList.remove("is-visible");
  overlay.setAttribute("aria-hidden", "true");
}

function goBackFromReader() {
  if (state.currentSeries) {
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
      case "chapter_progress": {
        chapterInfo.textContent = `Chapter ${data.chapter_number}: ${esc(data.chapter_title ?? "")}  (${data.current}/${data.total})`;
        const overall = Math.round((data.current / data.total) * 100);
        fillEl.style.width = overall + "%";
        pctEl.textContent = overall + "%";
        break;
      }
      case "progress":
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
  if (theme === "dark") {
    document.body.setAttribute("data-theme", "dark");
  } else if (theme === "light") {
    document.body.setAttribute("data-theme", "light");
  } else {
    document.body.setAttribute(
      "data-theme",
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    );
  }
}

// ──────────────────────────────────────────────────────────────────
//  Bootstrap
// ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    state.config = await window.strip.config.get();
    applyTheme(state.config.theme ?? "system");
  } catch (_) {}

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      showView(view);
      if (view === "library") loadLibrary();
      if (view === "settings") loadSettings();
    });
  });

  document
    .getElementById("btn-refresh-library")
    ?.addEventListener("click", loadLibrary);
  document
    .getElementById("btn-add-download")
    ?.addEventListener("click", () => showView("download"));

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

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const next =
      document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    window.strip.theme.set(next);
    state.config.theme = next;
  });

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

  document
    .getElementById("setting-theme")
    ?.addEventListener("change", async (e) => {
      const theme = e.target.value;
      applyTheme(theme);
      await window.strip.theme.set(theme);
      await window.strip.config.set({ theme });
    });

  document.addEventListener("keydown", (e) => {
    if (state.currentView !== "reader") return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    const key = e.key.toLowerCase();

    if (key === "escape") {
      e.preventDefault();
      goBackFromReader();
      return;
    }
    if (key === "n") {
      e.preventDefault();
      const idx = state.currentSeries?.chapters.findIndex(
        (c) => c.number === state.currentChapter?.number,
      );
      if (idx !== -1 && idx < state.currentSeries.chapters.length - 1)
        openChapter(state.currentSeries, state.currentSeries.chapters[idx + 1]);
      return;
    }
    if (key === "p") {
      e.preventDefault();
      const idx = state.currentSeries?.chapters.findIndex(
        (c) => c.number === state.currentChapter?.number,
      );
      if (idx > 0)
        openChapter(state.currentSeries, state.currentSeries.chapters[idx - 1]);
      return;
    }

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

document.addEventListener("DOMContentLoaded", init);
