// desktop/renderer/src/hooks/useLibrary.js
//
// Loads the library (cache-first, like the old app.js), then enriches
// each series with its reading progress and "last read" timestamp in one
// batched Promise.all pass — this is where the two-IPC-calls-per-series
// savings from readingProgress.js's computeSeriesProgress() split pays
// off, versus doing it per-card as each SeriesCard mounts.

import { useCallback, useEffect, useState } from "react";
import {
  getCachedLibrary,
  setCachedLibrary,
  invalidateLibraryCache,
} from "../lib/libraryCache.js";
import {
  getLastReadPosition,
  getRecentlyReadTs,
  computeSeriesProgress,
} from "../lib/readingProgress.js";

async function enrichLibrary(rawSeries) {
  return Promise.all(
    rawSeries.map(async (s) => {
      const [lastRead, lastReadTs] = await Promise.all([
        getLastReadPosition(s.title),
        getRecentlyReadTs(s.title),
      ]);
      return {
        ...s,
        lastRead,
        progress: computeSeriesProgress(s, lastRead),
        lastReadTs: lastReadTs || 0,
      };
    }),
  );
}

export function useLibrary() {
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      let raw = forceRefresh ? null : getCachedLibrary();
      if (!raw) {
        raw = await window.strip.library.scan();
        setCachedLibrary(raw);
      }
      setLibrary(await enrichLibrary(raw));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(
    (forceRefresh = true) => {
      if (forceRefresh) invalidateLibraryCache();
      return load(forceRefresh);
    },
    [load],
  );

  /**
   * Remove a series from local state immediately, without a full
   * re-scan — mirrors the old app.js pattern of splicing a deleted
   * series out of state.library directly rather than re-fetching.
   */
  const removeSeries = useCallback((directory) => {
    invalidateLibraryCache();
    setLibrary((prev) => prev.filter((s) => s.directory !== directory));
  }, []);

  return { library, loading, error, refresh, removeSeries };
}
