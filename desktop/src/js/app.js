// electron-app/src/js/app.js  — v2
// Renderer process: all UI logic.
// Communicates with main process ONLY via window.strip (preload.js).

"use strict";

// ──────────────────────────────────────────────────────────────────
//  State
// ──────────────────────────────────────────────────────────────────
const state = {
  currentView: "library",
  library: [],
  filteredLibrary: [],
  currentSeries: null,
  currentChapter: null,
  currentPages: [],
  currentPageIndex: 0,
  config: {},
  // Preloaded next-chapter page paths (for instant transition)
  preloadedNextPages: null,
};

// ──────────────────────────────────────────────────────────────────
//  Toast Notifications
// ──────────────────────────────────────────────────────────────────

function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-msg">${esc(message)}</span>
    <button class="toast-close" aria-label="Dismiss">×</button>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);
  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add("toast-show"));

  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ──────────────────────────────────────────────────────────────────
//  Library cache  (localStorage, 5-min TTL; invalidated on download)
// ──────────────────────────────────────────────────────────────────

const LIBRARY_CACHE_KEY = "strip_library_cache";
const LIBRARY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in ms

function _getCachedLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > LIBRARY_CACHE_TTL) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function _setCachedLibrary(data) {
  try {
    localStorage.setItem(
      LIBRARY_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch (_) {}
}

function _invalidateLibraryCache() {
  try {
    localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch (_) {}
}

// ──────────────────────────────────────────────────────────────────
//  Download Tray  (v2: supports multiple active chapters per job)
// ──────────────────────────────────────────────────────────────────

const DownloadTray = (() => {
  // jobs: Map<downloadId, { url, active, chapters: Map<chapterId, ChapterState> }>
  const jobs = new Map();

  // Simple download queue
  const queue = []; // [{url, chapters}]

  const tray = () => document.getElementById("download-tray");
  const jobsEl = () => document.getElementById("tray-jobs");
  const urlInput = () => document.getElementById("tray-url");
  const chapInput = () => document.getElementById("tray-chapters");
  const formError = () => document.getElementById("tray-form-error");
  const jobCount = () => document.getElementById("tray-job-count");
  const navBadge = () => document.getElementById("nav-download-badge");
  const collapseBtn = () => document.getElementById("tray-collapse-btn");

  let _isOpen = false;
  let _isCollapsed = false;

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

  // ── DOM helpers for job element ──────────────────────────────────

  function _createJobEl(downloadId, url) {
    const el = document.createElement("div");
    el.className = "tray-job";
    el.dataset.downloadId = downloadId;
    const displayUrl = url.length > 55 ? url.slice(0, 52) + "…" : url;

    el.innerHTML = `
      <div class="tray-job-header">
        <div class="tray-job-title-row">
          <span class="tray-job-title" id="tjt-${downloadId}">${esc(displayUrl)}</span>
          <div class="tray-job-actions">
            <span class="tray-job-status-badge" id="tjs-${downloadId}">starting</span>
            <button class="btn btn-ghost icon-btn tray-job-expand-btn" id="tjx-${downloadId}" title="Toggle chapters">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <button class="btn btn-ghost icon-btn tray-job-cancel" data-id="${downloadId}" title="Cancel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
        <!-- Overall job progress -->
        <div class="tray-job-bar-wrap">
          <div class="tray-job-bar"><div class="tray-job-fill" id="tjf-${downloadId}" style="width:0%"></div></div>
          <span class="tray-job-pct" id="tjp-${downloadId}">0%</span>
        </div>
      </div>
      <!-- Expandable chapter list -->
      <div class="tray-chapters-list" id="tjcl-${downloadId}" style="display:none"></div>
      <!-- Log lines -->
      <div class="tray-job-log" id="tjl-${downloadId}"></div>
    `;

    el.querySelector(".tray-job-cancel").addEventListener("click", async () => {
      await window.strip.download.cancel(downloadId);
      _setJobStatus(downloadId, "cancelled");
    });

    el.querySelector(`#tjx-${downloadId}`).addEventListener("click", () => {
      const cl = document.getElementById(`tjcl-${downloadId}`);
      if (!cl) return;
      const visible = cl.style.display !== "none";
      cl.style.display = visible ? "none" : "block";
    });

    return el;
  }

  /** Get or create a chapter row inside a job's chapter list. */
  function _ensureChapterRow(downloadId, chapterId, chapterTitle) {
    const listEl = document.getElementById(`tjcl-${downloadId}`);
    if (!listEl) return null;

    let row = listEl.querySelector(`[data-ch="${chapterId}"]`);
    if (!row) {
      row = document.createElement("div");
      row.className = "tray-ch-row";
      row.dataset.ch = chapterId;
      const label = chapterTitle
        ? `Ch.${chapterId} – ${esc(chapterTitle)}`
        : `Ch.${chapterId}`;
      row.innerHTML = `
        <span class="tray-ch-label">${label}</span>
        <div class="tray-ch-bar"><div class="tray-ch-fill" style="width:0%"></div></div>
        <span class="tray-ch-pct">0%</span>
        <span class="tray-ch-status"></span>
      `;
      listEl.appendChild(row);
      // Auto-expand when a new chapter appears
      listEl.style.display = "block";
    }
    return row;
  }

  function _updateChapterRow(downloadId, chapterId, done, total, statusText) {
    const row = document.querySelector(
      `#tjcl-${downloadId} [data-ch="${chapterId}"]`,
    );
    if (!row) return;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const fill = row.querySelector(".tray-ch-fill");
    const pctEl = row.querySelector(".tray-ch-pct");
    const stEl = row.querySelector(".tray-ch-status");
    if (fill) fill.style.width = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
    if (stEl) stEl.textContent = statusText || "";
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
            _startNextQueued();
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

  // ── Overall job progress calculation ────────────────────────────

  function _refreshJobProgress(downloadId) {
    const job = jobs.get(downloadId);
    if (!job || !job.totalChapters) return;
    const done = job.chaptersCompleted || 0;
    const total = job.totalChapters;
    const pct = Math.round((done / total) * 100);
    const fillEl = document.getElementById(`tjf-${downloadId}`);
    const pctEl = document.getElementById(`tjp-${downloadId}`);
    if (fillEl) fillEl.style.width = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
  }

  // ── Global progress listener (one registration handles ALL jobs) ─

  function _onProgress(data) {
    const { downloadId } = data;
    if (!downloadId || !jobs.has(downloadId)) return;

    const job = jobs.get(downloadId);
    const titleEl = document.getElementById(`tjt-${downloadId}`);

    // Use requestAnimationFrame to batch DOM updates under rapid events
    requestAnimationFrame(() => {
      switch (data.status) {
        case "series_info":
          if (titleEl && data.title) titleEl.textContent = esc(data.title);
          _setJobStatus(downloadId, "active");
          break;

        case "fetching_chapters":
          break;

        case "chapter_list":
          job.totalChapters = data.total;
          job.chaptersCompleted = 0;
          break;

        case "downloading":
          // chapters_to_download might be less than total (skipped excluded)
          job.totalChapters =
            (data.chapters_to_download || 0) + (data.chapters_skipped || 0);
          job.chaptersCompleted = data.chapters_skipped || 0;
          _refreshJobProgress(downloadId);
          break;

        case "chapter_start": {
          const chId = data.chapter_id ?? data.chapter;
          const row = _ensureChapterRow(downloadId, chId, data.title);
          _setJobStatus(downloadId, "active");
          break;
        }

        case "progress": {
          // Image-level progress for a chapter
          const chId = data.chapter_id ?? data.chapter;
          _ensureChapterRow(downloadId, chId, null);
          _updateChapterRow(downloadId, chId, data.page, data.total_pages, "");
          break;
        }

        case "chapter_done": {
          const chId = data.chapter_id ?? data.chapter;
          _updateChapterRow(
            downloadId,
            chId,
            data.pages_saved,
            data.pages_saved,
            "✓",
          );
          _appendLog(downloadId, `✓ Ch.${chId} (${data.pages_saved} pages)`);
          if (!job.chaptersCompleted) job.chaptersCompleted = 0;
          job.chaptersCompleted++;
          _refreshJobProgress(downloadId);
          break;
        }

        case "skipped": {
          const chId = data.chapter_id ?? data.chapter;
          _appendLog(downloadId, `– Ch.${chId} skipped`);
          if (!job.chaptersCompleted) job.chaptersCompleted = 0;
          job.chaptersCompleted++;
          _refreshJobProgress(downloadId);
          break;
        }

        case "rate_limited": {
          const chId = data.chapter_id ?? data.chapter;
          if (chId)
            _updateChapterRow(
              downloadId,
              chId,
              0,
              0,
              `⏳ ${data.wait_seconds}s`,
            );
          break;
        }

        case "done":
          if (titleEl && data.series) titleEl.textContent = esc(data.series);
          const fillEl = document.getElementById(`tjf-${downloadId}`);
          const pctEl = document.getElementById(`tjp-${downloadId}`);
          if (fillEl) fillEl.style.width = "100%";
          if (pctEl) pctEl.textContent = "100%";
          _appendLog(downloadId, `✓ Saved to ${data.directory}`);
          _setJobStatus(downloadId, "done");
          _invalidateLibraryCache();
          setTimeout(() => loadLibrary(), 1200);
          _startNextQueued();
          break;

        case "error":
          if (data.chapter_id || data.chapter) {
            const chId = data.chapter_id ?? data.chapter;
            _updateChapterRow(downloadId, chId, 0, 0, "✗");
          }
          _appendLog(downloadId, `✗ ${data.message}`, "error");
          if (!data.chapter_id && !data.chapter) {
            _setJobStatus(downloadId, "error");
            _startNextQueued();
          }
          break;

        case "process_exit":
          if (data.code !== 0) {
            const j = jobs.get(downloadId);
            if (j && j.active) {
              _appendLog(
                downloadId,
                `Process exited (code ${data.code})`,
                "error",
              );
              _setJobStatus(downloadId, "error");
              _startNextQueued();
            }
          }
          break;

        case "log":
          _appendLog(downloadId, data.message);
          break;
      }
    });
  }

  // ── Queue management ─────────────────────────────────────────────

  function _activeJobCount() {
    return [...jobs.values()].filter((j) => j.active).length;
  }

  function _startNextQueued() {
    if (queue.length === 0) return;
    const maxJobs = state.config.maxConcurrentJobs ?? 2;
    if (_activeJobCount() >= maxJobs) return;
    const next = queue.shift();
    if (next) _doStartJob(next.url, next.chapters);
  }

  async function _doStartJob(url, chapters) {
    const formErr = formError();
    if (formErr) formErr.style.display = "none";

    let downloadId;
    try {
      downloadId = await window.strip.download.start({
        url,
        chapters: chapters || undefined,
        downloadDir: state.config.downloadDir,
      });
    } catch (e) {
      showToast(`Failed to start download: ${e.message}`, "error");
      return;
    }

    jobs.set(downloadId, {
      downloadId,
      url,
      active: true,
      chapters: new Map(),
      totalChapters: 0,
      chaptersCompleted: 0,
    });

    const el = _createJobEl(downloadId, url);
    jobsEl().prepend(el);
    _updateBadge();
    urlInput().value = "";
    chapInput().value = "";
  }

  async function startJob(url, chapters) {
    const maxJobs = state.config.maxConcurrentJobs ?? 2;

    if (_activeJobCount() < maxJobs) {
      await _doStartJob(url, chapters);
    } else {
      // Queue it
      queue.push({ url, chapters });
      // Create a queued placeholder card
      const queueId = `queued_${Date.now()}`;
      const el = document.createElement("div");
      el.className = "tray-job tray-job-queued";
      el.dataset.queueId = queueId;
      el.innerHTML = `
        <div class="tray-job-header">
          <span class="tray-job-title">${esc(url.length > 55 ? url.slice(0, 52) + "…" : url)}</span>
          <span class="tray-job-status-badge status-queued">queued</span>
        </div>
      `;
      jobsEl().prepend(el);
      showToast("Download queued — will start when a slot is free.", "info");
    }
  }

  // ── Init ─────────────────────────────────────────────────────────

  function init() {
    window.strip.download.onProgress(_onProgress);

    document.getElementById("tray-header")?.addEventListener("click", (e) => {
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

    urlInput()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const url = urlInput().value.trim();
        const chap = chapInput().value.trim();
        if (url) startJob(url, chap);
      }
    });

    document.getElementById("nav-download")?.addEventListener("click", (e) => {
      e.preventDefault();
      _isOpen ? (_isCollapsed ? expand() : collapse()) : open();
    });
  }

  return { init, open, close, startJob };
})();

// ──────────────────────────────────────────────────────────────────
//  Continue Reading
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
    console.error("Failed to update reading pos:", e);
  }
}

async function getLastReadPosition(seriesTitle) {
  try {
    return await window.strip.progress.get(`${seriesTitle}/lastRead`);
  } catch (_) {
    return null;
  }
}

async function continueReading(series) {
  if (!series?.chapters?.length) return;
  const lastRead = await getLastReadPosition(series.title);
  if (!lastRead) {
    openChapter(series, series.chapters[0]);
    return;
  }
  const ch = series.chapters.find((c) => c.number == lastRead.chapterNumber);
  await openChapter(series, ch || series.chapters[0], lastRead.pageIndex);
}

async function getSeriesProgress(series) {
  if (!series?.chapters?.length) return 0;
  const lastRead = await getLastReadPosition(series.title);
  if (!lastRead) return 0;
  const idx = series.chapters.findIndex(
    (c) => c.number == lastRead.chapterNumber,
  );
  if (idx === -1) return 0;
  const chProg = lastRead.pageIndex / (lastRead.totalPages || 1);
  return ((idx + chProg) / series.chapters.length) * 100;
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
//  Library — load, filter, sort
// ──────────────────────────────────────────────────────────────────

async function loadLibrary(forceRefresh = false) {
  const grid = document.getElementById("library-grid");
  grid.innerHTML =
    '<div class="empty-state"><div class="empty-icon">◈</div><p style="color:var(--text-muted)">Loading…</p></div>';

  try {
    // Try cache first (unless forced refresh)
    let data = forceRefresh ? null : _getCachedLibrary();
    if (!data) {
      data = await window.strip.library.scan();
      _setCachedLibrary(data);
    }
    state.library = data;
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">Error loading library: ${esc(e.message)}</p></div>`;
    showToast(`Library error: ${e.message}`, "error");
    return;
  }

  await renderLibrary();
}

async function renderLibrary() {
  const grid = document.getElementById("library-grid");
  const search = (
    document.getElementById("library-search")?.value || ""
  ).toLowerCase();
  const sort = document.getElementById("library-sort")?.value || "title";

  grid.innerHTML = "";

  if (state.library.length === 0) {
    grid.appendChild(buildEmptyState());
    return;
  }

  // Filter
  let filtered = search
    ? state.library.filter((s) => s.title?.toLowerCase().includes(search))
    : [...state.library];

  // Enrich with progress (async, batched)
  const enriched = await Promise.all(
    filtered.map(async (s) => ({
      ...s,
      progress: await getSeriesProgress(s),
      lastReadTs: await window.strip.progress
        .get(`${s.title}/recentlyRead`)
        .catch(() => 0),
    })),
  );

  // Sort
  if (sort === "title") {
    enriched.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else if (sort === "last_read") {
    enriched.sort((a, b) => (b.lastReadTs || 0) - (a.lastReadTs || 0));
  } else if (sort === "chapters") {
    enriched.sort(
      (a, b) => (b.chapters?.length || 0) - (a.chapters?.length || 0),
    );
  }

  state.filteredLibrary = enriched;

  if (enriched.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty-state";
    msg.innerHTML = `<div class="empty-icon">◈</div><p>No results for "<em>${esc(document.getElementById("library-search").value)}</em>"</p>`;
    grid.appendChild(msg);
    return;
  }

  for (const s of enriched) {
    grid.appendChild(await buildSeriesCard(s));
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
  const progress = series.progress ?? 0;

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

  // Right-click context menu
  card.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    const action = await window.strip.menu.seriesContext({
      seriesDir: series.directory,
      seriesTitle: series.title,
    });
    if (action === "delete") {
      const result = await window.strip.fs.deleteSeries(series.directory);
      if (result === true) {
        _invalidateLibraryCache();
        await loadLibrary(true);
        showToast(`"${series.title}" deleted.`, "success");
      } else if (result?.error) {
        showToast(`Delete failed: ${result.error}`, "error");
      }
    }
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
  const lastReadCh = lastRead
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
            ${lastReadCh ? `<span class="last-read-indicator">Ch.${lastRead.chapterNumber}</span>` : ""}
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

  // Chapter row click → open reader
  container.querySelectorAll(".chapter-row").forEach((row) => {
    row.addEventListener("click", () => {
      openChapter(series, series.chapters[parseInt(row.dataset.chapterIndex)]);
    });
    // Double-click also works (click already handles it; dblclick fires too)
    row.addEventListener("dblclick", () => {
      openChapter(series, series.chapters[parseInt(row.dataset.chapterIndex)]);
    });

    // Right-click context menu on chapters
    row.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      const idx = parseInt(row.dataset.chapterIndex);
      const chapter = series.chapters[idx];
      const action = await window.strip.menu.chapterContext({
        chapterDir: chapter.directory,
        chapterNumber: chapter.number,
      });

      if (action === "mark_read") {
        await window.strip.progress.set(
          `${series.title}/${chapter.number}`,
          chapter.pageCount - 1 || 0,
        );
        await updateLastReadPosition(
          series.title,
          chapter.number,
          chapter.pageCount - 1 || 0,
          chapter.pageCount,
        );
        row.classList.add("has-progress");
        showToast(`Ch.${chapter.number} marked as read.`, "success");
      } else if (action === "delete") {
        const result = await window.strip.fs.deleteChapter(chapter.directory);
        if (result === true) {
          _invalidateLibraryCache();
          row.remove();
          showToast(`Chapter ${chapter.number} deleted.`, "success");
        } else if (result?.error) {
          showToast(`Delete failed: ${result.error}`, "error");
        }
      }
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
      DownloadTray.open(series.url ?? series.metadata?.url ?? "");
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
//  Reader — lazy loading + IntersectionObserver + preload next ch.
// ──────────────────────────────────────────────────────────────────

let _readerObserver = null; // IntersectionObserver instance
let _preloadTriggered = false;

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
  state.preloadedNextPages = null;
  _preloadTriggered = false;

  const pagesEl = document.getElementById("reader-pages");
  const titleEl = document.getElementById("reader-title");
  const pageInfo = document.getElementById("reader-page-info");
  const overlay = document.getElementById("chapter-end-overlay");

  titleEl.textContent = `${series.title}  ·  Chapter ${chapter.number}`;
  pagesEl.innerHTML = "";
  pageInfo.textContent = "";
  overlay.classList.remove("is-visible");
  overlay.setAttribute("aria-hidden", "true");

  // Disconnect any previous observer
  if (_readerObserver) {
    _readerObserver.disconnect();
    _readerObserver = null;
  }

  showView("reader");
  updateChapterNavButtons();
  setupChapterEndOverlay(series, chapter);

  let pages = [];
  try {
    pages = await window.strip.chapter.pages(chapter.directory);
  } catch (e) {
    pagesEl.innerHTML = `<div class="reader-page-error">Could not load pages: ${esc(e.message)}</div>`;
    return;
  }

  state.currentPages = pages;
  if (!pages.length) {
    pagesEl.innerHTML = `<div class="reader-page-error">No pages found in this chapter.</div>`;
    return;
  }

  pageInfo.textContent = `${pages.length} pages`;

  const progressKey = `${series.title}/${chapter.number}`;
  let startPage = 0;
  try {
    startPage =
      scrollToPage > 0
        ? scrollToPage
        : await window.strip.progress.get(progressKey);
  } catch (_) {}

  const useLazy = state.config.lazyLoading !== false;

  // Build image wrappers
  pages.forEach((filePath, i) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "width:100%;position:relative;min-height:200px;";

    const shimmer = document.createElement("div");
    shimmer.className = "reader-page-loading";
    wrapper.appendChild(shimmer);

    const img = document.createElement("img");
    img.className = "reader-page-img";
    img.alt = `Page ${i + 1}`;
    img.style.display = "none";
    img.dataset.src = "file:///" + filePath.replace(/\\/g, "/");
    img.dataset.index = i;

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

    if (!useLazy) {
      // Eager loading — set src immediately
      img.src = img.dataset.src;
    }

    wrapper.appendChild(img);
    pagesEl.appendChild(wrapper);
  });

  if (useLazy) {
    _setupLazyObserver(pagesEl, pages, series, chapter);
  }

  // Scroll to start page
  if (startPage > 0 && startPage < pages.length) {
    setTimeout(() => {
      const wrappers = pagesEl.querySelectorAll("div[style]");
      wrappers[startPage]?.scrollIntoView({ behavior: "smooth" });
    }, 200);
  }

  _setupScrollTracking(series, chapter, pages, pageInfo, overlay);
}

function _setupLazyObserver(pagesEl, pages, series, chapter) {
  const preloadNext = state.config.preloadNextChapter !== false;

  _readerObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target.querySelector("img[data-src]");
        if (img && !img.src.startsWith("file:")) {
          img.src = img.dataset.src;
          delete img.dataset.src;
        }

        // Preload next chapter when user is in the last 5 images
        if (preloadNext && !_preloadTriggered) {
          const idx = parseInt(
            entry.target.querySelector("img")?.dataset.index ?? "-1",
          );
          if (idx >= pages.length - 5) {
            _preloadTriggered = true;
            _preloadNextChapter(series, chapter);
          }
        }
      });
    },
    { rootMargin: "500px 0px", threshold: 0 },
  );

  pagesEl
    .querySelectorAll("div[style]")
    .forEach((w) => _readerObserver.observe(w));
}

async function _preloadNextChapter(series, chapter) {
  const idx = series.chapters.findIndex((c) => c.number === chapter.number);
  if (idx === -1 || idx >= series.chapters.length - 1) return;
  const nextCh = series.chapters[idx + 1];
  try {
    const pages = await window.strip.chapter.pages(nextCh.directory);
    state.preloadedNextPages = pages;
    // Pre-cache the first 3 images
    pages.slice(0, 3).forEach((p) => {
      const img = new Image();
      img.src = "file:///" + p.replace(/\\/g, "/");
    });
  } catch (_) {}
}

function _setupScrollTracking(series, chapter, pages, pageInfo, overlay) {
  const container = document.getElementById("reader-container");
  const pagesEl = document.getElementById("reader-pages");
  const progressKey = `${series.title}/${chapter.number}`;
  let saveTimer = null;

  if (container._scrollListener)
    container.removeEventListener("scroll", container._scrollListener);

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
  if (_readerObserver) {
    _readerObserver.disconnect();
    _readerObserver = null;
  }
  if (state.currentSeries) openSeries(state.currentSeries);
  else showView("library");
}

// ──────────────────────────────────────────────────────────────────
//  Settings
// ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  state.config = await window.strip.config.get();
  const cfg = state.config;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = val ?? "";
  };

  set("setting-download-dir", cfg.downloadDir ?? "~");
  set("setting-theme", cfg.theme ?? "system");
  set("setting-concurrent-chapters", cfg.maxConcurrentChapters ?? 3);
  set("setting-image-concurrency", cfg.imageConcurrency ?? 4);
  set("setting-rate-limit", cfg.rateLimit ?? 8);
  set("setting-cache-ttl", cfg.cacheTtlDays ?? 7);
  set("setting-verify-integrity", cfg.verifyIntegrity ?? false);
  set("setting-max-jobs", cfg.maxConcurrentJobs ?? 2);
  set("setting-lazy-loading", cfg.lazyLoading !== false);
  set("setting-preload-next", cfg.preloadNextChapter !== false);
}

async function saveSettingValue(key, value) {
  try {
    state.config[key] = value;
    await window.strip.config.set({ [key]: value });
  } catch (e) {
    showToast(`Failed to save setting: ${e.message}`, "error");
  }
}

// ──────────────────────────────────────────────────────────────────
//  Theme
// ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === "dark") document.body.setAttribute("data-theme", "dark");
  else if (theme === "light") document.body.setAttribute("data-theme", "light");
  else
    document.body.setAttribute(
      "data-theme",
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    );
}

// ──────────────────────────────────────────────────────────────────
//  Bootstrap
// ──────────────────────────────────────────────────────────────────

async function init() {
  try {
    state.config = await window.strip.config.get();
    applyTheme(state.config.theme ?? "system");
  } catch (_) {}

  DownloadTray.init();

  // Nav links
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
    ?.addEventListener("click", () => {
      _invalidateLibraryCache();
      loadLibrary(true);
    });

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

  // Chapter navigation buttons
  const chNav = (dir) => {
    const idx = state.currentSeries?.chapters.findIndex(
      (c) => c.number === state.currentChapter?.number,
    );
    if (idx === undefined || idx === -1) return;
    const target = idx + dir;
    if (target < 0 || target >= state.currentSeries.chapters.length) return;
    openChapter(state.currentSeries, state.currentSeries.chapters[target]);
  };

  document
    .getElementById("btn-prev-chapter")
    ?.addEventListener("click", () => chNav(-1));
  document
    .getElementById("btn-next-chapter")
    ?.addEventListener("click", () => chNav(+1));
  document
    .getElementById("btn-end-prev-chapter")
    ?.addEventListener("click", () => chNav(-1));
  document
    .getElementById("btn-end-next-chapter")
    ?.addEventListener("click", () => chNav(+1));
  document
    .getElementById("btn-end-back")
    ?.addEventListener("click", goBackFromReader);

  // Search + sort (re-render without re-fetching)
  document
    .getElementById("library-search")
    ?.addEventListener("input", () => renderLibrary());
  document
    .getElementById("library-sort")
    ?.addEventListener("change", () => renderLibrary());

  // Theme toggle
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const next =
      document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    window.strip.theme.set(next);
    state.config.theme = next;
  });

  // ── Settings change handlers ─────────────────────────────────────

  document
    .getElementById("btn-change-folder")
    ?.addEventListener("click", async () => {
      const folder = await window.strip.dialog.openFolder();
      if (folder) {
        await saveSettingValue("downloadDir", folder);
        document.getElementById("setting-download-dir").textContent = folder;
      }
    });

  document
    .getElementById("setting-theme")
    ?.addEventListener("change", async (e) => {
      const theme = e.target.value;
      applyTheme(theme);
      await window.strip.theme.set(theme);
      await saveSettingValue("theme", theme);
    });

  const numSetting = (id, key, transform = Number) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      saveSettingValue(key, transform(e.target.value));
    });
  };
  const boolSetting = (id, key) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      saveSettingValue(key, e.target.checked);
    });
  };

  numSetting(
    "setting-concurrent-chapters",
    "maxConcurrentChapters",
    (v) => parseInt(v) || 3,
  );
  numSetting(
    "setting-image-concurrency",
    "imageConcurrency",
    (v) => parseInt(v) || 4,
  );
  numSetting("setting-rate-limit", "rateLimit", (v) => parseFloat(v) || 8);
  numSetting("setting-cache-ttl", "cacheTtlDays", (v) => parseInt(v) || 7);
  numSetting("setting-max-jobs", "maxConcurrentJobs", (v) => parseInt(v) || 2);
  boolSetting("setting-verify-integrity", "verifyIntegrity");
  boolSetting("setting-lazy-loading", "lazyLoading");
  boolSetting("setting-preload-next", "preloadNextChapter");

  // ── Keyboard shortcuts ───────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.tagName === "SELECT"
    )
      return;

    const key = e.key.toLowerCase();

    if (state.currentView === "reader") {
      if (key === "escape") {
        e.preventDefault();
        goBackFromReader();
        return;
      }
      if (key === "n") {
        e.preventDefault();
        chNav(+1);
        return;
      }
      if (key === "p") {
        e.preventDefault();
        chNav(-1);
        return;
      }
      // j/k = next/previous chapter (spec says j/k — same as n/p but common convention)
      if (key === "j") {
        e.preventDefault();
        chNav(+1);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        chNav(-1);
        return;
      }
      // g = go to chapter list
      if (key === "g") {
        e.preventDefault();
        if (state.currentSeries) openSeries(state.currentSeries);
        return;
      }
      // b = back to library
      if (key === "b") {
        e.preventDefault();
        showView("library");
        loadLibrary();
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
