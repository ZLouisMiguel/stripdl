// desktop/renderer/src/App.jsx
//
// View router — wraps the app in ToastProvider/ConfirmProvider so every
// descendant can call useToast()/useConfirm(), and renders whichever view
// is active.

import React, { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import LibraryView from "./views/LibraryView.jsx";
import SeriesDetailView from "./views/SeriesDetailView.jsx";
import ReaderView from "./views/ReaderView.jsx";
import SettingsView from "./views/SettingsView.jsx";
import { ToastProvider, useToast } from "./context/ToastContext.jsx";
import { ConfirmProvider } from "./context/ConfirmContext.jsx";
import { applyTheme } from "./lib/theme.js";

function AppShell() {
  const { showToast } = useToast();
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

  // Shared placeholder for anything that needs the (not-yet-ported)
  // Download tray — the Sidebar's Download nav item and Library's "Add
  // Comic" both use this until that view exists.
  function notifyTrayNotReady() {
    showToast(
      "Download tray isn't wired up yet — coming in the next pass.",
      "info",
    );
  }

  return (
    <>
      <Sidebar
        currentView={view}
        onNavigate={setView}
        onOpenDownloadTray={notifyTrayNotReady}
      />
      <main id="main">
        {view === "library" && (
          <LibraryView
            onOpenSeries={openSeries}
            onAddComic={notifyTrayNotReady}
          />
        )}
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

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell />
      </ConfirmProvider>
    </ToastProvider>
  );
}
