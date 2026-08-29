// desktop/renderer/src/views/SeriesDetailView.jsx
//
// Placeholder — full port (chapter list, schedule card, reader/context
// menu wiring) is a later migration pass.

import React from "react";

export default function SeriesDetailView({ series, onBack }) {
  return (
    <section id="view-series" className="view active">
      <button className="btn btn-ghost back-btn" onClick={onBack}>
        Library
      </button>
      <div className="empty-state">
        <div className="empty-icon">◈</div>
        <p>Series detail view is being ported to React next.</p>
        {series?.title && <p className="muted">({series.title})</p>}
      </div>
    </section>
  );
}
