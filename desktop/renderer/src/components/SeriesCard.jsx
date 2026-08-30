// desktop/renderer/src/components/SeriesCard.jsx
//
// Ported from app.js's buildSeriesCard(). `series` is expected to already
// be enriched (lastRead, progress) by useLibrary.js — this component does
// no progress-related IPC calls itself, only the delete flow.

import React from "react";
import { useToast } from "../context/ToastContext.jsx";
import { useConfirm } from "../context/ConfirmContext.jsx";

export default function SeriesCard({ series, onOpen, onDeleted }) {
  const { showToast } = useToast();
  const confirm = useConfirm();

  const coverSrc = series.coverPath
    ? `file:///${series.coverPath.replace(/\\/g, "/")}`
    : null;

  async function handleContextMenu(e) {
    e.preventDefault();
    const action = await window.strip.menu.seriesContext({
      seriesDir: series.directory,
      seriesTitle: series.title,
    });
    if (action !== "delete") return;

    const confirmed = await confirm(
      "Delete series",
      `Permanently delete "${series.title}" from disk? This cannot be undone.`,
    );
    if (!confirmed) return;

    const result = await window.strip.fs.deleteSeries(series.directory);
    if (result?.success) {
      onDeleted(series.directory);
      showToast(`"${series.title}" deleted.`, "success");
    } else {
      showToast(`Delete failed: ${result?.error || "Unknown error"}`, "error");
    }
  }

  return (
    <div
      className="series-card"
      onClick={() => onOpen(series)}
      onContextMenu={handleContextMenu}
    >
      <div className="series-cover-wrap">
        {coverSrc ? (
          <img
            className="series-cover"
            src={coverSrc}
            alt={series.title}
            loading="lazy"
          />
        ) : (
          <div className="series-cover-placeholder">◈</div>
        )}
        <span className="series-card-badge">
          {series.chapters?.length ?? 0} ch
        </span>
        {series.lastRead && (
          <div
            className="series-card-continue-badge"
            onClick={(e) => {
              e.stopPropagation();
              // The Reader view isn't ported yet, so "Continue" opens the
              // series detail page for now, same destination as clicking
              // the card itself — this will jump straight into the last
              // chapter/page once ReaderView is real.
              onOpen(series);
            }}
          >
            Continue
          </div>
        )}
        {series.progress > 0 && (
          <div className="series-card-progress">
            <div
              className="series-card-progress-fill"
              style={{ width: `${series.progress}%` }}
            />
          </div>
        )}
      </div>
      <div className="series-card-title">{series.title}</div>
      <div className="series-card-meta">{series.author || ""}</div>
    </div>
  );
}
