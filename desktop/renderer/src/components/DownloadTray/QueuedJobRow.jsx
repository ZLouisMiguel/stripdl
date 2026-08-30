// desktop/renderer/src/components/DownloadTray/QueuedJobRow.jsx
//
// Placeholder card for a queued (not-yet-started) download. No actions —
// same as the old version, which didn't provide a way to cancel a queued
// entry either.

import React from "react";

export default function QueuedJobRow({ entry }) {
  const displayUrl =
    entry.url.length > 55 ? entry.url.slice(0, 52) + "…" : entry.url;
  return (
    <div className="tray-job tray-job-queued">
      <div className="tray-job-header">
        <span className="tray-job-title">{displayUrl}</span>
        <span className="tray-job-status-badge status-queued">queued</span>
      </div>
    </div>
  );
}
