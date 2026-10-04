# stripdl Features

This document describes the currently implemented features of the core CLI
and the desktop reader. Status is based on the current source tree and the
verification run recorded at the end of this file.

Status labels:

- **Implemented** — present in the current code; verification coverage is
  summarized below.
- **Partial** — present, but limited or dependent on an unresolved behavior.
- **Planned** — listed in the project tracker but not implemented.

## Desktop reader

### Application shell and navigation

- **Implemented:** Electron desktop application with Library, Download, and
  Settings navigation.
- **Implemented:** Light, dark, and system theme modes.
- **Implemented:** Runtime version display in the About section.
- **Implemented:** Native app window lifecycle and tray/download navigation.

### Library

- **Implemented:** Scan the configured local library asynchronously.
- **Implemented:** Cache-first library loading with manual refresh.
- **Implemented:** Enrich library entries with reading progress and recently
  read timestamps.
- **Implemented:** Search series by title.
- **Implemented:** Sort by title, last read, or chapter count.
- **Implemented:** Open a series detail view.
- **Implemented:** Add a comic by opening the download tray.
- **Implemented:** Delete a series from its card, context menu, or bulk-select
  mode, with confirmation and success/failure feedback.
- **Implemented:** Display covers, authors, chapter counts, latest-read
  badges, and progress bars.
- **Implemented:** Empty-library, empty-search-result, loading, and error
  states.

### Series details and chapters

- **Implemented:** Display cover, title, author, description, status, and
  genre metadata.
- **Implemented:** List downloaded chapters with dates and progress markers.
- **Implemented:** Start reading from the first chapter.
- **Implemented:** Continue from the saved chapter and page.
- **Implemented:** Download more chapters for an existing series.
- **Implemented:** Open a chapter from the chapter list.
- **Implemented:** Mark a chapter as read from its context menu.
- **Implemented:** Delete an individual chapter with confirmation.
- **Partial:** Auto-download scheduling is available for series with a saved
  source URL; series without one cannot be scheduled.

### Reader

- **Implemented:** Load local chapter pages through the secure Electron IPC
  bridge and `strip-file://` URLs.
- **Implemented:** Loading, empty, page-error, and ready states.
- **Implemented:** Lazy-load pages using intersection visibility.
- **Implemented:** Window large chapters so only nearby pages remain mounted,
  while spacer heights preserve scroll position.
- **Implemented:** Track the visible page and save reading progress with a
  debounce.
- **Implemented:** Resume at the saved page when reopening a chapter.
- **Implemented:** Flush pending reading progress when leaving a chapter.
- **Implemented:** Previous/next chapter navigation.
- **Implemented:** Chapter-end overlay with Previous, Chapter list, and Next
  actions.
- **Implemented:** Preload the first pages of the next chapter.
- **Implemented:** Keyboard navigation:
  - `N`/`J` — next chapter
  - `P`/`K` — previous chapter
  - `Escape`/`G` — back to series
  - `B` — return to library
  - Arrow keys — scroll
- **Implemented:** Zoom from 50% to 300%, 25% steps, reset, lock, and
  trackpad pinch zoom.

### Download tray

- **Implemented:** Start a download from a URL with an optional chapter range
  or chapter list.
- **Implemented:** Multiple simultaneous download jobs with a configurable
  maximum job count.
- **Implemented:** Queue jobs when the active-job limit is reached.
- **Implemented:** Live job status, overall progress, per-chapter progress,
  warnings, and failure messages.
- **Implemented:** Cancel active downloads and dismiss finished jobs.
- **Implemented:** Expand/collapse chapter details and collapse/close the tray.
- **Implemented:** Active-download badge in the sidebar.

### Settings

- **Implemented:** Change the download folder.
- **Implemented:** Configure concurrent chapters and images.
- **Implemented:** Configure request rate limit.
- **Implemented:** Configure metadata cache duration.
- **Implemented:** Enable image-integrity verification.
- **Implemented:** Enable overwrite of completed chapters.
- **Implemented:** Configure maximum simultaneous download jobs.
- **Implemented:** Enable/disable reader lazy loading.
- **Implemented:** Enable/disable next-chapter preloading.
- **Implemented:** Select system, light, or dark theme.

### Desktop safety and background behavior

- **Implemented:** Restrict local-file access to the configured library root.
- **Implemented:** Reject traversal, sibling-prefix, symlink escape, and
  invalid library paths.
- **Implemented:** Background per-series weekday scheduler with connectivity
  checks and result notifications.
- **Partial:** The underlying library, path-safety, and reader logic are
  automated-tested, but full React/Electron interaction coverage for every
  button and menu is still missing.

## Core CLI tool

### Supported providers

| Provider | Status | Current behavior |
| --- | --- | --- |
| Webtoon | Implemented | Direct parser. |
| WeebCentral | Implemented | Direct parser. |
| Asura Scans | Implemented | Direct parser. |
| MangaKakalot | Implemented | Direct parser. |
| Comix | Partial | Registered adapter that currently searches WeebCentral. |

### Commands

#### `stripdl download <url>`

- **Implemented:** Download a complete series when no filter is supplied.
- **Implemented:** `--chapters 1-20` range selection.
- **Implemented:** `--chapters 1,3,5` specific-chapter selection.
- **Implemented:** `--start N` download from chapter `N` through the latest.
- **Implemented:** `--output` custom destination.
- **Implemented:** Configurable chapter and image concurrency.
- **Implemented:** Global request rate limiting.
- **Implemented:** Metadata cache control with `--cache-ttl` and `--no-cache`.
- **Implemented:** Resume behavior that skips completed chapters.
- **Implemented:** `--overwrite` to redownload completed chapters.
- **Implemented:** `--verify` SHA-256 image-integrity verification.
- **Implemented:** Interactive Rich progress display with stall status.
- **Implemented:** JSON progress events for the desktop application.
- **Implemented:** Cover and metadata persistence.
- **Implemented:** Chapter manifests, missing-image resume, and half-chapter
  directory names such as `002_5`.
- **Implemented:** Per-chapter failures and partial-download reporting.
- **Implemented:** Persist failed series URLs and chapter errors in
  `.failed-downloads.json` under the configured download directory.

#### `stripdl list <url>`

- **Implemented:** Fetch and display series title, author, status, and genre.
- **Implemented:** List chapter number, title, and date.
- **Implemented:** Display the total chapter count.
- **Implemented:** Configure CLI stdout/stderr for UTF-8 and sanitize dynamic
  metadata before rendering on Windows consoles.

#### `stripdl library`

- **Implemented:** Scan the configured local library.
- **Implemented:** Display title, author, chapter count, and location.
- **Implemented:** Invalid series metadata is ignored during scanning so one
  damaged file does not abort the library command.

#### `stripdl config`

- **Implemented:** Display all configuration values.
- **Implemented:** Read one value with `--get KEY`.
- **Implemented:** Set a value with `--set KEY=VALUE`.
- **Implemented:** Restore defaults with `--reset`.

### CLI infrastructure

- **Implemented:** `stripdl --version` reports the package version.
- **Implemented:** Parser registry selects the correct provider from a URL.
- **Implemented:** Canonicalize provider URLs for cache reuse.
- **Implemented:** Friendly validation for unsupported URLs and malformed
  chapter filters.
- **Implemented:** UTF-8 metadata writes for downloaded series metadata.
- **Implemented:** Concurrent chapter discovery and download pipeline.
- **Implemented:** Configurable persistent defaults in `~/.strip/config.json`.
- **Planned:** `stripdl show providers` to list providers from the CLI.
- **Planned:** Native Comix parsing without a WeebCentral dependency.

## Verification record

The following checks were run against the current tree:

| Area | Check | Result |
| --- | --- | --- |
| Core | `py -m pytest -q` from `core` | **42 passed** |
| Desktop logic | `npm test` from `desktop` | **32 passed** |
| Desktop build | `npm run build` from `desktop` | **Passed**; Vite emitted a CJS API deprecation warning. |
| CLI version | `stripdl --version` | **Passed** — reports `0.4.0`. |
| CLI command help | Root plus `download`, `list`, `library`, and `config` help | **Passed** on the Windows console. |
| CLI config | `stripdl config` and `config --get download_dir` | **Passed**. |
| CLI list | Live Asura Scans URL | **Passed** with 7 chapters and no replacement characters after UTF-8 stream configuration. |
| CLI library | Existing library containing damaged metadata | **Passed**; scan and rendering complete without a traceback. |
| CLI validation | Unsupported provider and invalid chapter list | **Passed** with non-zero exits and explanatory messages. |
| Provider registry | Five representative provider URLs | **Passed** — all five select the expected parser. |
| Failed-download persistence | Disposable failure record | **Passed** — URL, outcome, chapter, and message are stored. |
| Library load/delete contract | Disposable library fixture | **Passed** — scan, chapter delete, series delete, page count, and path validation. |
| Reader logic | State, windowing, progress, zoom, and file-URL tests | **Passed** through the desktop suite. |

The full Electron UI was built successfully. A live click-through of every
React view was not completed because the current Windows Computer Use surface
did not expose the running Electron window; this remains a test-coverage gap,
not a claim that every UI interaction has been manually verified.
