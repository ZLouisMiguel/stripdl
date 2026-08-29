// desktop/renderer/src/hooks/useConfig.js
//
// Thin React wrapper around window.strip.config.get/set. Optimistically
// applies patches to local state immediately (so inputs feel instant),
// then persists via IPC; on failure, re-fetches from main to reconcile
// rather than leaving the UI showing an unsaved value.

import { useCallback, useEffect, useState } from "react";

export function useConfig() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.strip.config.get().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateConfig = useCallback(async (patch) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    try {
      await window.strip.config.set(patch);
    } catch (e) {
      console.error("Failed to save setting:", e);
      const fresh = await window.strip.config.get();
      setConfig(fresh);
    }
  }, []);

  return { config, updateConfig };
}
