// desktop/renderer/src/views/SeriesDetailView.jsx

import React, { useEffect, useState } from "react";
import { useToast } from "../context/ToastContext.jsx";
import { useConfirm } from "../context/ConfirmContext.jsx";
import { useDownloadTray } from "../context/DownloadTrayContext.jsx";
import { updateLastReadPosition } from "../lib/readingProgress.js";
import { invalidateLibraryCache } from "../lib/libraryCache.js";
import { toFileUrl } from "../lib/fileUrl.js";
import ScheduleCard from "../components/ScheduleCard.jsx";

export default function SeriesDetailView({
  series: initialSeries,
  onBack,
  onOpenChapter,
  onContinue,
}) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { openTray } = useDownloadTray();

  const [series, setSeries] = useState(initialSeries);
  const [chapterProgress, setChapterProgress] = useState({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setSeries(initialSeries);
    setSelectMode(false);
    setSelectedChapters(new Set());
  }, [initialSeries]);

  useEffect(() => {
    let cancelled = false;
    if (!series?.chapters?.length) return;
    Promise.all(
      series.chapters.map((ch) =>
        window.strip.progress
          .get(`${series.title}/${ch.number}`)
          .catch(() => 0),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map = {};
      series.chapters.forEach((ch, i) => {
        map[ch.number] = results[i];
      });
      setChapterProgress(map);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series?.directory]);

  if (!series) {
    return (
      <section id="view-series" className="view active">
        <button className="btn btn-ghost back-btn" onClick={onBack}>
          Library
        </button>
        <p className="muted">No series selected.</p>
      </section>
    );
  }

  const lastRead = series.lastRead;
  const lastReadCh = lastRead
    ? series.chapters?.find((ch) => ch.number == lastRead.chapterNumber)
    : null;
  const coverSrc = toFileUrl(series.coverPath);
  const tags = [series.genre, series.status].filter(Boolean);

  async function deleteChapter(chapter) {
    const confirmed = await confirm(
      "Delete chapter",
      `Permanently delete Chapter ${chapter.number}? This cannot be undone.`,
    );
    if (!confirmed) return;

    const result = await window.strip.fs.deleteChapter(chapter.directory);
    if (result?.success) {
      setSeries((prev) => ({
        ...prev,
        chapters: prev.chapters.filter(
          (c) => c.directory !== chapter.directory,
        ),
      }));
      invalidateLibraryCache();
      showToast(`Chapter ${chapter.number} deleted.`, "success");
    } else {
      showToast(`Delete failed: ${result?.error || "Unknown error"}`, "error");
    }
  }

  async function handleChapterContextMenu(e, chapter) {
    e.preventDefault();
    if (selectMode) return;
    const action = await window.strip.menu.chapterContext({
      chapterDir: chapter.directory,
      chapterNumber: chapter.number,
    });

    if (action === "mark_read") {
      const lastPage = (chapter.pageCount || 1) - 1;
      await window.strip.progress.set(
        `${series.title}/${chapter.number}`,
        lastPage,
      );
      await updateLastReadPosition(
        series.title,
        chapter.number,
        lastPage,
        chapter.pageCount,
      );
      setChapterProgress((prev) => ({ ...prev, [chapter.number]: lastPage }));
      showToast(`Ch.${chapter.number} marked as read.`, "success");
    } else if (action === "delete") {
      deleteChapter(chapter);
    }
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedChapters(new Set());
  }

  function toggleSelectChapter(directory) {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      next.has(directory) ? next.delete(directory) : next.add(directory);
      return next;
    });
  }

  async function deleteSelectedChapters() {
    if (selectedChapters.size === 0 || deleting) return;
    const targets = series.chapters.filter((c) =>
      selectedChapters.has(c.directory),
    );
    const confirmed = await confirm(
      "Delete chapters",
      `Permanently delete ${selectedChapters.size} chapters? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    const results = await Promise.all(
      targets.map((c) => window.strip.fs.deleteChapter(c.directory)),
    );

    const deletedDirs = new Set(
      targets.filter((_, i) => results[i]?.success).map((c) => c.directory),
    );
    const successCount = deletedDirs.size;

    if (successCount > 0) {
      setSeries((prev) => ({
        ...prev,
        chapters: prev.chapters.filter((c) => !deletedDirs.has(c.directory)),
      }));
      invalidateLibraryCache();
    }

    setDeleting(false);
    setSelectedChapters(new Set());
    setSelectMode(false);

    if (successCount === targets.length) {
      showToast(`${successCount} chapters deleted.`, "success");
    } else {
      showToast(
        `${successCount}/${targets.length} deleted — some failed.`,
        successCount > 0 ? "info" : "error",
      );
    }
  }

  return (
    <section id="view-series" className="view active">
      <button className="btn btn-ghost back-btn" onClick={onBack}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Library
      </button>

      <div className="series-detail-hero">
        {coverSrc ? (
          <img className="detail-cover" src={coverSrc} alt={series.title} />
        ) : (
          <div className="detail-cover-placeholder">◈</div>
        )}
        <div className="detail-info">
          <h1>{series.title}</h1>
          <div className="detail-author">
            {series.author || "Unknown author"}
          </div>
          {tags.length > 0 && (
            <div className="detail-tags">
              {tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="detail-desc">{series.description || ""}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={!series.chapters?.length}
              onClick={() => onOpenChapter(series.chapters[0], 0)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ width: 15, height: 15 }}
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {lastRead ? "Start Over" : "Read"}
            </button>
            {lastRead && (
              <button className="btn btn-secondary" onClick={onContinue}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ width: 15, height: 15 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" />
                </svg>
                Continue Reading
                {lastReadCh && (
                  <span className="last-read-indicator">
                    Ch.{lastRead.chapterNumber}
                  </span>
                )}
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => openTray(series.url ?? series.metadata?.url ?? "")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ width: 15, height: 15 }}
              >
                <path d="M12 3v13M7 11l5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
              Download more
            </button>
          </div>
        </div>
      </div>

      <ScheduleCard series={series} />

      <div className="chapter-list-header">
        <h2>
          Chapters{" "}
          <span
            className="muted"
            style={{ fontSize: 14, fontFamily: "var(--font-body)" }}
          >
            {series.chapters?.length ?? 0}
          </span>
        </h2>
        <div className="header-actions">
          {!selectMode && series.chapters?.length > 0 && (
            <button className="btn btn-ghost" onClick={toggleSelectMode}>
              Select
            </button>
          )}
          {selectMode && (
            <>
              <span className="select-count">
                {selectedChapters.size} selected
              </span>
              <button
                className="btn btn-danger"
                disabled={selectedChapters.size === 0 || deleting}
                onClick={deleteSelectedChapters}
              >
                Delete
                {selectedChapters.size > 0 ? ` (${selectedChapters.size})` : ""}
              </button>
              <button className="btn btn-ghost" onClick={toggleSelectMode}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      <div className="chapter-list">
        {!series.chapters?.length && (
          <p className="muted" style={{ padding: 20 }}>
            No chapters downloaded.
          </p>
        )}
        {series.chapters?.map((ch) => {
          const hasProgress = (chapterProgress[ch.number] || 0) > 0;
          const isLastRead = lastRead && lastRead.chapterNumber == ch.number;
          const isSelected = selectedChapters.has(ch.directory);
          return (
            <div
              key={ch.directory}
              className={`chapter-row ${hasProgress ? "has-progress" : ""} ${
                isLastRead ? "last-read" : ""
              } ${selectMode ? "select-mode" : ""} ${isSelected ? "is-selected" : ""}`}
              onClick={() =>
                selectMode
                  ? toggleSelectChapter(ch.directory)
                  : onOpenChapter(ch, 0)
              }
              onContextMenu={(e) => handleChapterContextMenu(e, ch)}
            >
              {selectMode && (
                <label
                  className="chapter-row-checkbox"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelectChapter(ch.directory)}
                  />
                </label>
              )}
              <span className="chapter-num">{ch.number}</span>
              <span className="chapter-title">{ch.title}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="chapter-date">{ch.date ?? ""}</span>
                <div className="chapter-progress-dot" title="In progress" />
                {!selectMode && (
                  <button
                    className="chapter-row-delete-btn"
                    title="Delete chapter"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChapter(ch);
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
