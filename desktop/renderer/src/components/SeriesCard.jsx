// desktop/renderer/src/components/SeriesCard.jsx
//
// Port of app.js's buildSeriesCard(). The "Continue" badge now calls the
// new onContinue prop (jumps straight into the Reader at the last-read
// chapter/page) rather than falling through to onOpen (series detail) —
// matching the old vanilla-JS behavior, which the placeholder-Reader
// version of this component couldn't yet replicate.

import React from "react";
import { useToast } from "../context/ToastContext.jsx";
import { useConfirm } from "../context/ConfirmContext.jsx";

export default function SeriesCard({ series, onOpen, onContinue, onDeleted }) {
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
              if (onContinue) onContinue(series);
              else onOpen(series);
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
