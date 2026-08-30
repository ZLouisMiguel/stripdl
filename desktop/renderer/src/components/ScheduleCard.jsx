// desktop/renderer/src/components/ScheduleCard.jsx
//
// Port of the auto-download weekday scheduler UI from the earlier
// vanilla-JS pass (Sun–Sat day pills + enable toggle + status line),
// now driven by window.strip.schedule.get()/set().

import React, { useEffect, useState } from "react";
import { useToast } from "../context/ToastContext.jsx";

const SCHEDULE_DAYS = [
  { code: "sun", label: "Sun" },
  { code: "mon", label: "Mon" },
  { code: "tue", label: "Tue" },
  { code: "wed", label: "Wed" },
  { code: "thu", label: "Thu" },
  { code: "fri", label: "Fri" },
  { code: "sat", label: "Sat" },
];

function statusText(entry) {
  if (!entry?.lastCheckedAt) return "Not checked yet.";
  const when = new Date(entry.lastCheckedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (entry.lastResult === "error") {
    return `Last check failed (${when}): ${entry.lastError || "unknown error"}`;
  }
  if (entry.lastDownloadedCount > 0) {
    return `Last checked ${when} — ${entry.lastDownloadedCount} new chapter${
      entry.lastDownloadedCount > 1 ? "s" : ""
    }.`;
  }
  return `Last checked ${when} — no new chapters.`;
}

export default function ScheduleCard({ series }) {
  const { showToast } = useToast();
  const [entry, setEntry] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    window.strip.schedule.get().then((all) => {
      if (cancelled) return;
      setEntry(all?.[series.directory] ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [series.directory]);

  const url = series.url || series.metadata?.url || "";

  if (!url) {
    return (
      <div className="settings-group card schedule-card">
        <h2 className="settings-group-title">Auto-download</h2>
        <p className="muted">
          This series is missing its saved source URL, so it can't be
          auto-checked. Use "Download more" once to re-save it, then this will
          become available.
        </p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="settings-group card schedule-card">
        <h2 className="settings-group-title">Auto-download</h2>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const enabled = entry?.enabled ?? false;
  const days = entry?.days ?? [];

  async function persist(patch) {
    try {
      const updated = await window.strip.schedule.set(series.directory, {
        url,
        title: series.title,
        enabled,
        days,
        ...patch,
      });
      setEntry(updated);
    } catch (e) {
      showToast(`Failed to save schedule: ${e.message}`, "error");
    }
  }

  function toggleDay(code) {
    const next = days.includes(code)
      ? days.filter((d) => d !== code)
      : [...days, code];
    persist({ days: next });
  }

  return (
    <div className="settings-group card schedule-card">
      <h2 className="settings-group-title">Auto-download</h2>
      <div className="setting-row">
        <div>
          <div className="setting-label">
            Check for new chapters automatically
          </div>
          <div className="setting-desc muted">
            Runs in the background on the days below, only while you're online.
          </div>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => persist({ enabled: e.target.checked })}
          />
          <span className="toggle-slider" />
        </label>
      </div>
      <div className="schedule-days">
        {SCHEDULE_DAYS.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            className={`day-pill ${days.includes(code) ? "active" : ""}`}
            onClick={() => toggleDay(code)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="schedule-status muted">{statusText(entry)}</div>
    </div>
  );
}
