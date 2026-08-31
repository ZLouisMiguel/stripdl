// desktop/renderer/src/App.jsx
//
// View router, wrapped in the context providers every descendant needs.
// New this round: currentChapter/readerScrollToPage state and the three
// navigation helpers the Reader needs (openChapter, continueReading,
// navigateChapter) — these replace the "Reader isn't wired up yet"
// placeholder that every entry point into reading previously showed.

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
  const [currentChapter, setCurrentChapter] = useState(null);
  const [readerScrollToPage, setReaderScrollToPage] = useState(0);

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

  function openChapter(series, chapter, scrollToPage = 0) {
    setCurrentSeries(series);
    setCurrentChapter(chapter);
    setReaderScrollToPage(scrollToPage);
    setView("reader");
  }

  function continueReading(series) {
    if (!series?.chapters?.length) return;
    const lastRead = series.lastRead;
    const ch = lastRead
      ? series.chapters.find((c) => c.number == lastRead.chapterNumber)
      : null;
    const target = ch || series.chapters[0];
    openChapter(series, target, lastRead ? lastRead.pageIndex : 0);
  }

  function navigateChapter(direction) {
    if (!currentSeries || !currentChapter) return;
    const idx = currentSeries.chapters.findIndex(
      (c) => c.number === currentChapter.number,
    );
    if (idx === -1) return;
    const target = idx + direction;
    if (target < 0 || target >= currentSeries.chapters.length) return;
    openChapter(currentSeries, currentSeries.chapters[target], 0);
  }

  function backFromReader() {
    setView(currentSeries ? "series" : "library");
  }

  return (
    <>
      <Sidebar currentView={view} onNavigate={setView} />
      <main id="main">
        {view === "library" && (
          <LibraryView onOpenSeries={openSeries} onContinue={continueReading} />
        )}
        {view === "series" && (
          <SeriesDetailView
            series={currentSeries}
            onBack={() => setView("library")}
            onOpenChapter={(chapter, scrollToPage) =>
              openChapter(currentSeries, chapter, scrollToPage)
            }
            onContinue={() => continueReading(currentSeries)}
          />
        )}
        {view === "reader" && (
          <ReaderView
            series={currentSeries}
            chapter={currentChapter}
            scrollToPage={readerScrollToPage}
            onBack={backFromReader}
            onExitToLibrary={() => setView("library")}
            onNavigateChapter={navigateChapter}
          />
        )}
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
