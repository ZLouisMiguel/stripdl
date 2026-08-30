// desktop/renderer/src/context/DownloadTrayContext.jsx
//
// Global download-job state and the tray's open/collapsed UI state, both
// live here so the Sidebar's badge count, Library's "Add Comic" button,
// and SeriesDetailView's "Download more" button can all reach the same
// state without prop-drilling through App.jsx.
//
// Job lifecycle mirrors the old vanilla-JS DownloadTray module's
// _onProgress() switch statement — see applyProgress() below, a pure,
// side-effect-free port of that switch. One intentional behavior change
// from the original: when a queued download's turn comes to start, its
// placeholder card is replaced in place by the real job card (see
// PROMOTE_QUEUED) rather than left behind as an orphaned "queued" card
// while a second, separate card gets created above it — the original
// never removed the queued placeholder once _startNextQueued() fired,
// which was a latent display bug, not intended behavior worth preserving.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import { useConfig } from "../hooks/useConfig.js";
import { useToast } from "./ToastContext.jsx";

const DownloadTrayContext = createContext(null);

const initialState = {
  isOpen: false,
  isCollapsed: false,
  prefillUrl: "",
  prefillToken: 0,
  jobs: {}, // downloadId -> job
  queue: {}, // queueId -> { url, chapters }
  itemOrder: [], // [{ type: 'job'|'queued', id }], newest-first
};

function newJob(downloadId, url) {
  return {
    downloadId,
    url,
    title: null,
    active: true,
    status: "starting",
    totalChapters: 0,
    chaptersCompleted: 0,
    chapters: {}, // chapterId -> { title, done, total, statusText }
    chapterOrder: [],
    log: [], // { msg, type }
  };
}

function ensureChapter(chapters, chapterOrder, id, title) {
  if (chapters[id]) return { chapters, chapterOrder };
  return {
    chapters: {
      ...chapters,
      [id]: { title: title || null, done: 0, total: 0, statusText: "" },
    },
    chapterOrder: [...chapterOrder, id],
  };
}

function applyProgress(job, data) {
  switch (data.status) {
    case "series_info":
      return {
        ...job,
        title: data.title || job.title,
        status: "active",
        active: true,
      };

    case "fetching_chapters":
      return job;

    case "chapter_list":
      return { ...job, totalChapters: data.total, chaptersCompleted: 0 };

    case "downloading":
      return {
        ...job,
        totalChapters:
          (data.chapters_to_download || 0) + (data.chapters_skipped || 0),
        chaptersCompleted: data.chapters_skipped || 0,
      };

    case "chapter_start": {
      const chId = data.chapter_id ?? data.chapter;
      const { chapters, chapterOrder } = ensureChapter(
        job.chapters,
        job.chapterOrder,
        chId,
        data.title,
      );
      return { ...job, chapters, chapterOrder, status: "active", active: true };
    }

    case "progress": {
      const chId = data.chapter_id ?? data.chapter;
      const { chapters, chapterOrder } = ensureChapter(
        job.chapters,
        job.chapterOrder,
        chId,
        null,
      );
      return {
        ...job,
        chapterOrder,
        chapters: {
          ...chapters,
          [chId]: {
            ...chapters[chId],
            done: data.page,
            total: data.total_pages,
            statusText: "",
          },
        },
      };
    }

    case "chapter_done": {
      const chId = data.chapter_id ?? data.chapter;
      const { chapters, chapterOrder } = ensureChapter(
        job.chapters,
        job.chapterOrder,
        chId,
        null,
      );
      return {
        ...job,
        chapterOrder,
        chapters: {
          ...chapters,
          [chId]: {
            ...chapters[chId],
            done: data.pages_saved,
            total: data.pages_saved,
            statusText: "✓",
          },
        },
        chaptersCompleted: (job.chaptersCompleted || 0) + 1,
        log: [
          ...job.log,
          { msg: `✓ Ch.${chId} (${data.pages_saved} pages)`, type: "info" },
        ],
      };
    }

    case "skipped": {
      const chId = data.chapter_id ?? data.chapter;
      return {
        ...job,
        chaptersCompleted: (job.chaptersCompleted || 0) + 1,
        log: [...job.log, { msg: `– Ch.${chId} skipped`, type: "info" }],
      };
    }

    case "rate_limited": {
      const chId = data.chapter_id ?? data.chapter;
      if (!chId || !job.chapters[chId]) return job;
      return {
        ...job,
        chapters: {
          ...job.chapters,
          [chId]: {
            ...job.chapters[chId],
            statusText: `⏳ ${data.wait_seconds}s`,
          },
        },
      };
    }

    case "done":
      return {
        ...job,
        title: data.series || job.title,
        status: "done",
        active: false,
        log: [
          ...job.log,
          { msg: `✓ Saved to ${data.directory}`, type: "info" },
        ],
      };

    case "error": {
      const chId = data.chapter_id ?? data.chapter;
      if (chId) {
        if (!job.chapters[chId]) return job;
        return {
          ...job,
          chapters: {
            ...job.chapters,
            [chId]: { ...job.chapters[chId], statusText: "✗" },
          },
          log: [...job.log, { msg: `✗ ${data.message}`, type: "error" }],
        };
      }
      return {
        ...job,
        status: "error",
        active: false,
        log: [...job.log, { msg: `✗ ${data.message}`, type: "error" }],
      };
    }

    case "process_exit":
      if (data.code === 0 || !job.active) return job;
      return {
        ...job,
        status: "error",
        active: false,
        log: [
          ...job.log,
          { msg: `Process exited (code ${data.code})`, type: "error" },
        ],
      };

    case "log":
      return { ...job, log: [...job.log, { msg: data.message, type: "info" }] };

    default:
      return job;
  }
}

function reducer(state, action) {
  switch (action.type) {
    case "OPEN":
      return {
        ...state,
        isOpen: true,
        isCollapsed: false,
        prefillUrl: action.url || "",
        prefillToken: state.prefillToken + 1,
      };
    case "CLOSE":
      return { ...state, isOpen: false, isCollapsed: false };
    case "COLLAPSE":
      return { ...state, isCollapsed: true };
    case "EXPAND":
      return { ...state, isCollapsed: false };
    case "TOGGLE_COLLAPSE":
      return { ...state, isCollapsed: !state.isCollapsed };

    case "START_JOB":
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [action.downloadId]: newJob(action.downloadId, action.url),
        },
        itemOrder: [{ type: "job", id: action.downloadId }, ...state.itemOrder],
      };

    case "DISMISS_JOB": {
      const jobs = { ...state.jobs };
      delete jobs[action.downloadId];
      return {
        ...state,
        jobs,
        itemOrder: state.itemOrder.filter(
          (i) => !(i.type === "job" && i.id === action.downloadId),
        ),
      };
    }

    case "SET_STATUS": {
      const job = state.jobs[action.downloadId];
      if (!job) return state;
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [action.downloadId]: { ...job, status: action.status, active: false },
        },
      };
    }

    case "PROGRESS": {
      const job = state.jobs[action.downloadId];
      if (!job) return state;
      const updated = applyProgress(job, action.data);
      if (updated === job) return state;
      return {
        ...state,
        jobs: { ...state.jobs, [action.downloadId]: updated },
      };
    }

    case "ENQUEUE":
      return {
        ...state,
        queue: {
          ...state.queue,
          [action.entry.queueId]: {
            url: action.entry.url,
            chapters: action.entry.chapters,
          },
        },
        itemOrder: [
          { type: "queued", id: action.entry.queueId },
          ...state.itemOrder,
        ],
      };

    case "PROMOTE_QUEUED": {
      const queue = { ...state.queue };
      delete queue[action.queueId];
      return {
        ...state,
        queue,
        itemOrder: state.itemOrder.map((item) =>
          item.type === "queued" && item.id === action.queueId
            ? { type: "job", id: action.downloadId }
            : item,
        ),
        jobs: {
          ...state.jobs,
          [action.downloadId]: newJob(action.downloadId, action.url),
        },
      };
    }

    case "DEQUEUE_ONLY": {
      const queue = { ...state.queue };
      delete queue[action.queueId];
      return {
        ...state,
        queue,
        itemOrder: state.itemOrder.filter(
          (i) => !(i.type === "queued" && i.id === action.queueId),
        ),
      };
    }

    default:
      return state;
  }
}

export function DownloadTrayProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { config } = useConfig();
  const { showToast } = useToast();

  // One subscription handles progress for every job by downloadId,
  // matching the old single window.strip.download.onProgress()
  // registration rather than one listener per job.
  useEffect(() => {
    function onProgress(data) {
      if (!data?.downloadId) return;
      dispatch({ type: "PROGRESS", downloadId: data.downloadId, data });
    }
    window.strip.download.onProgress(onProgress);
    return () => window.strip.download.offProgress(onProgress);
  }, []);

  const doStartJob = useCallback(
    async (url, chapters) => {
      try {
        return await window.strip.download.start({
          url,
          chapters: chapters || undefined,
          downloadDir: config?.downloadDir,
        });
      } catch (e) {
        showToast(`Failed to start download: ${e.message}`, "error");
        return null;
      }
    },
    [config, showToast],
  );

  const startJob = useCallback(
    async (url, chapters) => {
      const activeCount = Object.values(state.jobs).filter(
        (j) => j.active,
      ).length;
      const maxJobs = config?.maxConcurrentJobs ?? 2;

      if (activeCount < maxJobs) {
        const downloadId = await doStartJob(url, chapters);
        if (!downloadId) return false;
        dispatch({ type: "START_JOB", downloadId, url });
        return true;
      }

      dispatch({
        type: "ENQUEUE",
        entry: {
          queueId: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          url,
          chapters,
        },
      });
      showToast("Download queued — will start when a slot is free.", "info");
      return false;
    },
    [state.jobs, config, doStartJob, showToast],
  );

  // Auto-promotes the oldest queued entry whenever a slot frees up —
  // covers both "a job just finished" and "maxConcurrentJobs changed in
  // Settings" without scattering explicit start-next-queued calls through
  // every status-changing action, the way the old imperative code did.
  useEffect(() => {
    const activeCount = Object.values(state.jobs).filter(
      (j) => j.active,
    ).length;
    const maxJobs = config?.maxConcurrentJobs ?? 2;
    const queueIds = Object.keys(state.queue);
    if (queueIds.length === 0 || activeCount >= maxJobs) return;

    const queueId = queueIds[0];
    const { url, chapters } = state.queue[queueId];
    let cancelled = false;

    (async () => {
      const downloadId = await doStartJob(url, chapters);
      if (cancelled) return;
      if (!downloadId) {
        dispatch({ type: "DEQUEUE_ONLY", queueId });
        return;
      }
      dispatch({ type: "PROMOTE_QUEUED", queueId, downloadId, url });
    })();

    return () => {
      cancelled = true;
    };
  }, [state.jobs, state.queue, config, doStartJob]);

  const cancelJob = useCallback(async (downloadId) => {
    await window.strip.download.cancel(downloadId);
    dispatch({ type: "SET_STATUS", downloadId, status: "cancelled" });
  }, []);

  const dismissJob = useCallback((downloadId) => {
    dispatch({ type: "DISMISS_JOB", downloadId });
  }, []);

  const openTray = useCallback((url = "") => {
    dispatch({ type: "OPEN", url });
  }, []);

  const closeTray = useCallback(() => {
    const activeCount = Object.values(state.jobs).filter(
      (j) => j.active,
    ).length;
    dispatch({ type: activeCount > 0 ? "COLLAPSE" : "CLOSE" });
  }, [state.jobs]);

  const toggleCollapse = useCallback(() => {
    dispatch({ type: "TOGGLE_COLLAPSE" });
  }, []);

  const handleNavClick = useCallback(() => {
    if (!state.isOpen) dispatch({ type: "OPEN", url: "" });
    else if (state.isCollapsed) dispatch({ type: "EXPAND" });
    else dispatch({ type: "COLLAPSE" });
  }, [state.isOpen, state.isCollapsed]);

  const activeJobCount = useMemo(
    () => Object.values(state.jobs).filter((j) => j.active).length,
    [state.jobs],
  );

  const jobCountLabel = useMemo(() => {
    if (activeJobCount > 0) return `(${activeJobCount} active)`;
    const total = Object.keys(state.jobs).length;
    return total > 0 ? `(${total} done)` : "";
  }, [activeJobCount, state.jobs]);

  const value = {
    isOpen: state.isOpen,
    isCollapsed: state.isCollapsed,
    prefillUrl: state.prefillUrl,
    prefillToken: state.prefillToken,
    jobs: state.jobs,
    queue: state.queue,
    itemOrder: state.itemOrder,
    activeJobCount,
    jobCountLabel,
    openTray,
    closeTray,
    toggleCollapse,
    handleNavClick,
    startJob,
    cancelJob,
    dismissJob,
  };

  return (
    <DownloadTrayContext.Provider value={value}>
      {children}
    </DownloadTrayContext.Provider>
  );
}

export function useDownloadTray() {
  const ctx = useContext(DownloadTrayContext);
  if (!ctx)
    throw new Error(
      "useDownloadTray must be used within <DownloadTrayProvider>",
    );
  return ctx;
}
