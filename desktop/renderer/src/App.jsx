// desktop/renderer/src/App.jsx
//
// View router, wrapped in the three context providers every descendant
// needs: Toast, Confirm, and (new this round) DownloadTray. The tray
// itself renders once here — its visibility is entirely CSS-driven, so
// it's always mounted regardless of which view is active.

import React, { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import LibraryView from "./views/LibraryView.jsx";
import SeriesDetailView from "./views/SeriesDetailView.jsx";
import ReaderView from "./views/ReaderView.jsx";
import SettingsView from "./views/SettingsView.jsx";
import DownloadTray from "./components/DownloadTray/DownloadTray.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { ConfirmProvider } from "./context/ConfirmContext.jsx";
import { DownloadTrayProvider } from "./context/DownloadTrayContext.jsx";
import { applyTheme } from "./lib/theme.js";

function AppShell() {
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
      <Sidebar currentView={view} onNavigate={setView} />
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
      <DownloadTray />
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <DownloadTrayProvider>
          <AppShell />
        </DownloadTrayProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
