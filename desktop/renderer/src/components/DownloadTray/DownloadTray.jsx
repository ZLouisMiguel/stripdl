// desktop/renderer/src/components/DownloadTray/DownloadTray.jsx
//
// The tray shell itself: header (collapse/close controls), URL+chapters
// form, and the combined job/queue list rendered in itemOrder. Rendered
// once at the App root — visibility is entirely CSS-driven via the
// is-open/is-collapsed classes (see .download-tray in main.css), same as
// the original.

import React, { useEffect, useRef, useState } from "react";
import { useDownloadTray } from "../../context/DownloadTrayContext.jsx";
import JobRow from "./JobRow.jsx";
import QueuedJobRow from "./QueuedJobRow.jsx";

export default function DownloadTray() {
  const {
    isOpen,
    isCollapsed,
    prefillUrl,
    prefillToken,
    itemOrder,
    jobs,
    queue,
    jobCountLabel,
    startJob,
    cancelJob,
    dismissJob,
    closeTray,
    toggleCollapse,
  } = useDownloadTray();

  const [urlInput, setUrlInput] = useState("");
  const [chaptersInput, setChaptersInput] = useState("");
  const urlRef = useRef(null);

  // Fires whenever openTray(url) is called elsewhere in the app (Library
  // "Add Comic", SeriesDetailView "Download more") — prefillToken changes
  // on every call even if the URL is identical to last time, so this
  // effect reliably re-runs and re-focuses the input.
  useEffect(() => {
    if (prefillToken === 0) return;
    setUrlInput(prefillUrl || "");
    setChaptersInput("");
    const t = setTimeout(() => urlRef.current?.focus(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillToken]);

  async function handleStart() {
    const url = urlInput.trim();
    const chapters = chaptersInput.trim();
    if (!url) {
      urlRef.current?.focus();
      return;
    }
    const started = await startJob(url, chapters);
    if (started) {
      setUrlInput("");
      setChaptersInput("");
    }
  }

  function handleHeaderClick(e) {
    if (e.target.closest("button")) return;
    if (isOpen) toggleCollapse();
  }

  return (
    <div
      className={`download-tray ${isOpen ? "is-open" : ""} ${isCollapsed ? "is-collapsed" : ""}`}
      aria-label="Download tray"
    >
      <div className="tray-header" onClick={handleHeaderClick}>
        <div className="tray-header-left">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="tray-icon"
          >
            <path d="M12 3v13M7 11l5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
          <span className="tray-title">Downloads</span>
          <span className="tray-job-count">{jobCountLabel}</span>
        </div>
        <div className="tray-header-right">
          <button
            className="btn btn-ghost icon-btn tray-collapse-btn"
            title="Collapse"
            onClick={(e) => {
              e.stopPropagation();
              if (isOpen) toggleCollapse();
            }}
          >
            {isCollapsed ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ width: 14, height: 14 }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ width: 14, height: 14 }}
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            )}
          </button>
          <button
            className="btn btn-ghost icon-btn"
            title="Close tray"
            onClick={(e) => {
              e.stopPropagation();
              closeTray();
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: 14, height: 14 }}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="tray-body">
        <div className="tray-form">
          <div className="tray-form-row">
            <input
              ref={urlRef}
              type="url"
              className="input tray-input"
              placeholder="https://www.webtoons.com/en/…"
              aria-label="Webtoon URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleStart();
              }}
            />
            <input
              type="text"
              className="input tray-input tray-chapters-input"
              placeholder="Chapters: 1-20 or 1,3,5 (optional)"
              aria-label="Chapter range"
              value={chaptersInput}
              onChange={(e) => setChaptersInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleStart();
              }}
            />
            <button
              className="btn btn-primary tray-start-btn"
              onClick={handleStart}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                style={{ width: 14, height: 14 }}
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start
            </button>
          </div>
        </div>
        <div className="tray-jobs">
          {itemOrder.map((item) => {
            if (item.type === "job" && jobs[item.id]) {
              return (
                <JobRow
                  key={item.id}
                  job={jobs[item.id]}
                  onCancel={cancelJob}
                  onDismiss={dismissJob}
                />
              );
            }
            if (item.type === "queued" && queue[item.id]) {
              return <QueuedJobRow key={item.id} entry={queue[item.id]} />;
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
