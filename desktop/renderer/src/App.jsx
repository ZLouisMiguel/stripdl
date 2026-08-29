// desktop/renderer/src/App.jsx
//
// View router — replaces the old showView()/document.querySelectorAll
// pattern with React state. Sidebar and the active view are the only two
// children of #root's grid (see styles/main.css: #root now owns the
// two-column grid that used to live on <body>).

import React, { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import LibraryView from "./views/LibraryView.jsx";
import SeriesDetailView from "./views/SeriesDetailView.jsx";
import ReaderView from "./views/ReaderView.jsx";
import SettingsView from "./views/SettingsView.jsx";
import { applyTheme } from "./lib/theme.js";

export default function App() {
  const [view, setView] = useState("library");
  const [currentSeries, setCurrentSeries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.strip.config.get().then((cfg) => {
      if (!cancelled) applyTheme(cfg.theme ?? "system");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function openSeries(series) {
    setCurrentSeries(series);
    setView("series");
  }

  return (
    <>
      <Sidebar
        currentView={view}
        onNavigate={setView}
        onOpenDownloadTray={() => {
          // Placeholder until the Download tray is ported — see
          // views/LibraryView.jsx and the migration notes for why it's
          // saved for a later pass.
          console.log("Download tray: not yet ported to React.");
        }}
      />
      <main id="main">
        {view === "library" && <LibraryView onOpenSeries={openSeries} />}
        {view === "series" && (
          <SeriesDetailView
            series={currentSeries}
            onBack={() => setView("library")}
          />
        )}
        {view === "reader" && <ReaderView />}
        {view === "settings" && <SettingsView />}
      </main>
    </>
  );
}
