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
};

// ──────────────────────────────────────────────────────────────────
//  Download Tray
//
//  The tray is a persistent bottom drawer that lives across ALL views.
//  It never navigates away from the current view — it simply slides up
//  over the content. Multiple downloads can run concurrently; each is
//  represented by a "job" entry in the tray's job list.
//
//  Public API:
//    DownloadTray.open(prefillUrl?)   – expand & optionally prefill URL
//    DownloadTray.startJob(url, chapters) – queue a new download job
// ──────────────────────────────────────────────────────────────────

const DownloadTray = (() => {
  // jobs: Map<downloadId, JobState>
  const jobs = new Map();

  const tray = () => document.getElementById("download-tray");
  const trayBody = () => document.getElementById("tray-body");
  const jobsEl = () => document.getElementById("tray-jobs");
  const urlInput = () => document.getElementById("tray-url");
  const chapInput = () => document.getElementById("tray-chapters");
  const formError = () => document.getElementById("tray-form-error");
  const jobCount = () => document.getElementById("tray-job-count");
  const navBadge = () => document.getElementById("nav-download-badge");
  const collapseBtn = () => document.getElementById("tray-collapse-btn");

  let _isOpen = false;
  let _isCollapsed = false; // body hidden but header still shows

  // ── Open / close / collapse ──────────────────────────────────────

  function open(prefillUrl = "") {
    _isOpen = true;
    _isCollapsed = false;
    tray().classList.add("is-open");
    tray().classList.remove("is-collapsed");
    if (prefillUrl) {
      urlInput().value = prefillUrl;
      chapInput().value = "";
    }
    setTimeout(() => urlInput().focus(), 50);
    _updateCollapseIcon();
  }

  function close() {
    // Only close completely if no active jobs remain
    const activeCount = [...jobs.values()].filter((j) => j.active).length;
    if (activeCount > 0) {
      collapse();
      return;
    }
    _isOpen = false;
    _isCollapsed = false;
    tray().classList.remove("is-open", "is-collapsed");
  }

  function collapse() {
    _isCollapsed = true;
    tray().classList.add("is-collapsed");
    _updateCollapseIcon();
  }

  function expand() {
    _isCollapsed = false;
    tray().classList.remove("is-collapsed");
    _updateCollapseIcon();
  }

  function toggleCollapse() {
    _isCollapsed ? expand() : collapse();
  }

  function _updateCollapseIcon() {
    const btn = collapseBtn();
    if (!btn) return;
    // Arrow points down when expanded (click = collapse), up when collapsed (click = expand)
    btn.innerHTML = _isCollapsed
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="6 9 12 15 18 9"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="18 15 12 9 6 15"/></svg>`;
  }

  // ── Badge / job count ────────────────────────────────────────────

  function _updateBadge() {
    const active = [...jobs.values()].filter((j) => j.active).length;
    const badge = navBadge();
    const count = jobCount();
    if (active > 0) {
      if (badge) {
        badge.textContent = active;
        badge.style.display = "inline-flex";
      }
      if (count) count.textContent = `(${active} active)`;
    } else {
      if (badge) badge.style.display = "none";
      if (count) count.textContent = jobs.size > 0 ? `(${jobs.size} done)` : "";
    }
  }

  // ── Job DOM helpers ──────────────────────────────────────────────

  function _createJobEl(downloadId, url) {
    const el = document.createElement("div");
    el.className = "tray-job";
    el.dataset.downloadId = downloadId;

    const displayUrl = url.length > 60 ? url.slice(0, 57) + "…" : url;

    el.innerHTML = `
      <div class="tray-job-header">
        <span class="tray-job-title" id="tjt-${downloadId}">${esc(displayUrl)}</span>
        <div class="tray-job-actions">
          <span class="tray-job-status-badge" id="tjs-${downloadId}">starting</span>
          <button class="btn btn-ghost icon-btn tray-job-cancel" data-id="${downloadId}" title="Cancel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="tray-job-chapter" id="tjc-${downloadId}">Initializing…</div>
      <div class="tray-job-bar-wrap">
        <div class="tray-job-bar">
          <div class="tray-job-fill" id="tjf-${downloadId}" style="width:0%"></div>
        </div>
        <span class="tray-job-pct" id="tjp-${downloadId}">0%</span>
      </div>
      <div class="tray-job-log" id="tjl-${downloadId}"></div>
    `;

    el.querySelector(".tray-job-cancel").addEventListener("click", async () => {
      await window.strip.download.cancel(downloadId);
      _setJobStatus(downloadId, "cancelled");
    });

    return el;
  }

  function _setJobStatus(downloadId, status) {
    const badge = document.getElementById(`tjs-${downloadId}`);
    if (!badge) return;
    badge.textContent = status;
    badge.className = `tray-job-status-badge status-${status}`;

    const job = jobs.get(downloadId);
    if (job) {
      job.active = status === "active" || status === "starting";
      _updateBadge();
    }

    // Show dismiss button once finished/errored/cancelled
    if (["done", "error", "cancelled"].includes(status)) {
      const cancelBtn = document.querySelector(
        `.tray-job-cancel[data-id="${downloadId}"]`,
      );
      if (cancelBtn) {
        cancelBtn.title = "Dismiss";
        cancelBtn.addEventListener(
          "click",
          () => {
            document
              .querySelector(`.tray-job[data-download-id="${downloadId}"]`)
              ?.remove();
            jobs.delete(downloadId);
            _updateBadge();
            if (jobs.size === 0) {
              jobsEl().innerHTML = "";
            }
          },
          { once: true },
        );
      }
    }
  }

  function _appendLog(downloadId, msg, type = "info") {
    const logEl = document.getElementById(`tjl-${downloadId}`);
    if (!logEl) return;
    const line = document.createElement("div");
    line.textContent = msg;
    if (type === "error") line.style.color = "var(--danger)";
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ── Global progress listener ─────────────────────────────────────
  // Registered once at boot; handles events for ALL jobs.

  function _onProgress(data) {
    const { downloadId } = data;
    if (!downloadId || !jobs.has(downloadId)) return;

    const titleEl = document.getElementById(`tjt-${downloadId}`);
    const chapterEl = document.getElementById(`tjc-${downloadId}`);
    const fillEl = document.getElementById(`tjf-${downloadId}`);
    const pctEl = document.getElementById(`tjp-${downloadId}`);

    switch (data.status) {
      case "series_info":
        if (titleEl && data.title) titleEl.textContent = esc(data.title);
        _setJobStatus(downloadId, "active");
        break;

      case "fetching_chapters":
        if (chapterEl) chapterEl.textContent = "Fetching chapter list…";
        break;

      case "chapter_list":
        if (chapterEl) chapterEl.textContent = `${data.total} chapters found`;
        break;

      case "chapter_start":
        if (chapterEl)
          chapterEl.textContent = `Ch. ${data.chapter} – ${esc(data.title ?? "")}`;
        _setJobStatus(downloadId, "active");
        break;

      case "chapter_progress": {
        if (chapterEl)
          chapterEl.textContent = `Ch. ${data.chapter_number}: ${esc(data.chapter_title ?? "")}  (${data.current}/${data.total})`;
        const pct = Math.round((data.current / data.total) * 100);
        if (fillEl) fillEl.style.width = pct + "%";
        if (pctEl) pctEl.textContent = pct + "%";
        break;
      }

      case "progress":
        if (fillEl) fillEl.style.width = data.percent + "%";
        if (pctEl) pctEl.textContent = data.percent + "%";
        break;

      case "chapter_done":
        _appendLog(
          downloadId,
          `✓ Ch. ${data.chapter} (${data.pages_saved} pages)`,
        );
        break;

      case "skipped":
        _appendLog(downloadId, `– Ch. ${data.chapter} skipped`);
        break;

      case "rate_limited":
        if (chapterEl)
          chapterEl.textContent = `Rate-limited — waiting ${data.wait_seconds}s…`;
        break;

      case "chapter_delay":
        // Silent; no UI noise needed for normal inter-chapter pauses
        break;

      case "done":
        if (titleEl && data.series) titleEl.textContent = esc(data.series);
        if (chapterEl) chapterEl.textContent = "Complete!";
        if (fillEl) fillEl.style.width = "100%";
        if (pctEl) pctEl.textContent = "100%";
        _appendLog(downloadId, `✓ Saved to ${data.directory}`);
        _setJobStatus(downloadId, "done");
        // Refresh library in background so new chapters appear
        setTimeout(() => loadLibrary(), 1200);
        break;

      case "error":
        _appendLog(downloadId, `✗ ${data.message}`, "error");
        _setJobStatus(downloadId, "error");
        break;

      case "process_exit":
        if (data.code !== 0) {
          const job = jobs.get(downloadId);
          if (job && job.active) {
            _appendLog(
              downloadId,
              `Process exited with code ${data.code}`,
              "error",
            );
            _setJobStatus(downloadId, "error");
          }
        }
        break;

      case "log":
        _appendLog(downloadId, data.message);
        break;
    }
  }

  // ── Start a new download job ─────────────────────────────────────

  async function startJob(url, chapters) {
    const formErr = formError();
    if (formErr) {
      formErr.style.display = "none";
    }

    let downloadId;
    try {
      downloadId = await window.strip.download.start({
        url,
        chapters: chapters || undefined,
        downloadDir: state.config.downloadDir,
      });
    } catch (e) {
      if (formErr) {
        formErr.textContent = `Failed to start: ${e.message}`;
        formErr.style.display = "block";
      }
      return;
    }

    const job = { downloadId, url, active: true };
    jobs.set(downloadId, job);

    const el = _createJobEl(downloadId, url);
    const list = jobsEl();
    list.prepend(el);

    _updateBadge();

    // Clear the form for the next download
    urlInput().value = "";
    chapInput().value = "";
  }

  // ── Init: wire buttons, register global listener ─────────────────

  function init() {
    // Global progress listener — single registration, handles all jobs
    window.strip.download.onProgress(_onProgress);

    document.getElementById("tray-header")?.addEventListener("click", (e) => {
      // Clicking the header bar (not its buttons) toggles collapse
      if (e.target.closest("button")) return;
      if (_isOpen) toggleCollapse();
    });

    document
      .getElementById("tray-collapse-btn")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleCollapse();
      });

    document
      .getElementById("tray-close-btn")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
      });

    document.getElementById("tray-start-btn")?.addEventListener("click", () => {
      const url = urlInput()?.value.trim();
      const chap = chapInput()?.value.trim();
      if (!url) {
        urlInput()?.focus();
        return;
      }
      startJob(url, chap);
    });

    // Allow Enter in the URL field to start
    urlInput()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const url = urlInput().value.trim();
        const chap = chapInput().value.trim();
        if (url) startJob(url, chap);
      }
    });

    // Nav "Download" link opens the tray
    document.getElementById("nav-download")?.addEventListener("click", (e) => {
      e.preventDefault();
      _isOpen ? (_isCollapsed ? expand() : collapse()) : open();
    });
  }

  return { init, open, close, startJob };
})();

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
    .addEventListener("click", () => DownloadTray.open());
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
      // ── Key fix: open the tray pre-filled with this series URL.
      // The user stays on the series detail page and can keep reading
      // while the download runs in the tray.
      const seriesUrl = series.url ?? series.metadata?.url ?? "";
      DownloadTray.open(seriesUrl);
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
  overlay.classList.remove("is-visible");
  overlay.setAttribute("aria-hidden", "true");

  showView("reader");
  updateChapterNavButtons();
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

  if (container._scrollListener) {
    container.removeEventListener("scroll", container._scrollListener);
  }

  const scrollListener = () => {
    const imgs = pagesEl.querySelectorAll("img");
    let visibleIdx = 0;
    imgs.forEach((img, i) => {
      const rect = img.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2 && rect.bottom > 0) visibleIdx = i;
    });
    pageInfo.textContent = `${visibleIdx + 1} / ${pages.length}`;

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

  // Initialise the download tray (registers its IPC listener etc.)
  DownloadTray.init();

  document.querySelectorAll(".nav-link[data-view]").forEach((link) => {
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

  // "Add Comic" in library header → open tray
  document
    .getElementById("btn-add-download")
    ?.addEventListener("click", () => DownloadTray.open());

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
