// desktop/renderer/src/views/LibraryView.jsx
//
// Placeholder — full port (search/sort, series cards, download tray
// integration) is the next migration pass. Not yet wired to
// window.strip.library.scan().

import React from "react";

export default function LibraryView() {
  return (
    <section id="view-library" className="view active">
      <header className="view-header">
        <h1>Library</h1>
      </header>
      <div className="empty-state">
        <div className="empty-icon">◈</div>
        <p>Library is being ported to React next.</p>
        <p className="muted">
          Your existing downloads are untouched — this view just isn't wired up
          yet.
        </p>
      </div>
    </section>
  );
}
