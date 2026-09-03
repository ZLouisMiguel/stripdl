// desktop/renderer/src/views/LibraryView.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useLibrary } from "../hooks/useLibrary.js";
import { useToast } from "../context/ToastContext.jsx";
import { useConfirm } from "../context/ConfirmContext.jsx";
import { useDownloadTray } from "../context/DownloadTrayContext.jsx";
import SeriesCard from "../components/SeriesCard.jsx";

export default function LibraryView({ onOpenSeries, onContinue }) {
  const { library, loading, error, refresh, removeSeries } = useLibrary();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { openTray } = useDownloadTray();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("title");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (error) showToast(`Library error: ${error}`, "error");
  }, [error, showToast]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? library.filter((s) => s.title?.toLowerCase().includes(q))
      : library;

    const sorted = [...filtered];
    if (sort === "title") {
      sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else if (sort === "last_read") {
      sorted.sort((a, b) => (b.lastReadTs || 0) - (a.lastReadTs || 0));
    } else if (sort === "chapters") {
      sorted.sort(
        (a, b) => (b.chapters?.length || 0) - (a.chapters?.length || 0),
      );
    }
    return sorted;
  }, [library, search, sort]);

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelected(new Set());
  }

  function toggleSelect(directory) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(directory) ? next.delete(directory) : next.add(directory);
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0 || deleting) return;
    const targets = visible.filter((s) => selected.has(s.directory));
    const confirmed = await confirm(
      "Delete series",
      `Permanently delete ${selected.size} series from disk? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    const results = await Promise.all(
      targets.map((s) => window.strip.fs.deleteSeries(s.directory)),
    );

    let successCount = 0;
    results.forEach((result, i) => {
      if (result?.success) {
        removeSeries(targets[i].directory);
        successCount++;
      }
    });

    setDeleting(false);
    setSelected(new Set());
    setSelectMode(false);

    if (successCount === targets.length) {
      showToast(`${successCount} series deleted.`, "success");
    } else {
      showToast(
        `${successCount}/${targets.length} deleted — some failed.`,
        successCount > 0 ? "info" : "error",
      );
    }
  }

  return (
    <section id="view-library" className="view active">
      <header className="view-header">
        <h1>Library</h1>
        <div className="header-actions">
          {!selectMode && (
            <>
              <div className="search-wrap">
                <svg
                  className="search-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  className="input search-input"
                  placeholder="Search…"
                  aria-label="Search library"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="select sort-select"
                aria-label="Sort by"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="title">A – Z</option>
                <option value="last_read">Last Read</option>
                <option value="chapters">Most Chapters</option>
              </select>
              <button className="btn btn-primary" onClick={() => openTray()}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Comic
              </button>
              <button
                className="btn btn-ghost"
                title="Refresh library"
                onClick={() => refresh(true)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.36" />
                </svg>
              </button>
              {library.length > 0 && (
                <button className="btn btn-ghost" onClick={toggleSelectMode}>
                  Select
                </button>
              )}
            </>
          )}

          {selectMode && (
            <>
              <span className="select-count">{selected.size} selected</span>
              <button
                className="btn btn-danger"
                disabled={selected.size === 0 || deleting}
                onClick={deleteSelected}
              >
                Delete{selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
              <button className="btn btn-ghost" onClick={toggleSelectMode}>
                Cancel
              </button>
            </>
          )}
        </div>
      </header>

      <div className="series-grid">
        {loading && (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p style={{ color: "var(--text-muted)" }}>Loading…</p>
          </div>
        )}

        {!loading && !error && library.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p>Your library is empty.</p>
            <p className="muted">Download a webtoon to get started.</p>
            <button className="btn btn-primary" onClick={() => openTray()}>
              Download something
            </button>
          </div>
        )}

        {!loading && !error && library.length > 0 && visible.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p>
              No results for "<em>{search}</em>"
            </p>
          </div>
        )}

        {!loading &&
          visible.map((series) => (
            <SeriesCard
              key={series.directory}
              series={series}
              onOpen={onOpenSeries}
              onContinue={onContinue}
              onDeleted={removeSeries}
              selectMode={selectMode}
              selected={selected.has(series.directory)}
              onToggleSelect={toggleSelect}
            />
          ))}
      </div>
    </section>
  );
}
