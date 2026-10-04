const MAX_LOG_LINES = 200;
const MAX_TRACKED_CHAPTERS = 60;

function appendLog(log, entry) {
  const next = [...log, entry];
  return next.length > MAX_LOG_LINES
    ? next.slice(next.length - MAX_LOG_LINES)
    : next;
}

function touchChapter(chapters, chapterOrder, id, title) {
  let nextChapters = chapters;
  let nextOrder = chapterOrder;

  if (!chapters[id]) {
    nextChapters = {
      ...chapters,
      [id]: { title: title || null, done: 0, total: 0, statusText: "" },
    };
    nextOrder = [...chapterOrder, id];
  }

  if (nextOrder.length > MAX_TRACKED_CHAPTERS) {
    const overflow = nextOrder.length - MAX_TRACKED_CHAPTERS;
    const dropped = nextOrder.slice(0, overflow);
    nextOrder = nextOrder.slice(overflow);
    if (nextChapters === chapters) nextChapters = { ...chapters };
    dropped.forEach((did) => delete nextChapters[did]);
  }

  return { chapters: nextChapters, chapterOrder: nextOrder };
}

export function applyProgress(job, data) {
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

    case "warning":
      return {
        ...job,
        log: appendLog(job.log, {
          msg: data.message || "Optional metadata is unavailable; continuing.",
          type: "warning",
        }),
      };

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
      const { chapters, chapterOrder } = touchChapter(
        job.chapters,
        job.chapterOrder,
        chId,
        data.title,
      );
      return { ...job, chapters, chapterOrder, status: "active", active: true };
    }

    case "progress": {
      const chId = data.chapter_id ?? data.chapter;
      const { chapters, chapterOrder } = touchChapter(
        job.chapters,
        job.chapterOrder,
        chId,
        null,
      );
      if (!chapters[chId]) return { ...job, chapterOrder };
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
      const chapters = job.chapters[chId]
        ? {
            ...job.chapters,
            [chId]: {
              ...job.chapters[chId],
              done: data.pages_saved,
              total: data.pages_saved,
              statusText: "✓",
            },
          }
        : job.chapters;
      return {
        ...job,
        chapters,
        chaptersCompleted: (job.chaptersCompleted || 0) + 1,
        log: appendLog(job.log, {
          msg: `✓ Ch.${chId} (${data.pages_saved} pages)`,
          type: "info",
        }),
      };
    }

    case "skipped": {
      const chId = data.chapter_id ?? data.chapter;
      return {
        ...job,
        chaptersCompleted: (job.chaptersCompleted || 0) + 1,
        log: appendLog(job.log, { msg: `– Ch.${chId} skipped`, type: "info" }),
      };
    }

    case "chapter_error": {
      const chId = data.chapter_id ?? data.chapter;
      const { chapters, chapterOrder } = touchChapter(
        job.chapters, job.chapterOrder, chId, data.title,
      );
      const chapter = chapters[chId];
      return {
        ...job,
        chapters: { ...chapters, [chId]: { ...chapter, statusText: "✗ failed" } },
        chapterOrder,
        failureMessage: data.failureMessage || data.message || job.failureMessage,
        log: appendLog(job.log, {
          msg: data.failureMessage || `Chapter ${chId} failed: ${data.message}`,
          type: "error",
        }),
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
      if (job.failureMessage) {
        return { ...job, status: "partial", active: false };
      }
      return {
        ...job,
        title: data.series || job.title,
        status: "done",
        active: false,
        log: appendLog(job.log, {
          msg: `✓ Saved to ${data.directory}`,
          type: "info",
        }),
      };

    case "partial":
      return {
        ...job,
        status: "partial",
        active: false,
        failureMessage: data.failureMessage || data.message || job.failureMessage,
        log: appendLog(job.log, {
          msg: data.failureMessage || data.message || "Some chapters failed. Retry to fetch the missing pages.",
          type: "error",
        }),
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
          log: appendLog(job.log, { msg: `✗ ${data.message}`, type: "error" }),
        };
      }
      return {
        ...job,
        status: "error",
        active: false,
        failureMessage: data.failureMessage || data.message || job.failureMessage,
        log: appendLog(job.log, { msg: `✗ ${data.message}`, type: "error" }),
      };
    }

    case "process_exit":
      if (!job.active) return job;
      if (data.code === 0) {
        return {
          ...job,
          status: "error",
          active: false,
          failureMessage: "stripdl exited without reporting a completed download.",
          log: appendLog(job.log, { msg: "Download ended without a completion result.", type: "error" }),
        };
      }
      return {
        ...job,
        status: job.failureMessage ? "partial" : "error",
        active: false,
        failureMessage: data.errorMessage || job.failureMessage,
        log: appendLog(job.log, {
          msg: data.errorMessage || `Process exited (code ${data.code})`,
          type: "error",
        }),
      };

    case "diagnostic":
      return {
        ...job,
        log: appendLog(job.log, { msg: data.message, type: "info" }),
      };

    case "log":
      return {
        ...job,
        log: appendLog(job.log, { msg: data.message, type: "info" }),
      };

    default:
      return job;
  }
}

