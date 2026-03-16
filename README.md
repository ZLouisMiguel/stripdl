# stripdl ◈

**A webtoon downloader and reader from URL to offline library in one command.**

<p align="center">
  <img src="https://skillicons.dev/icons?i=python,electron,js,html,css,nodejs" />
</p>

`v0.3.1` &nbsp;·&nbsp; MIT &nbsp;·&nbsp; Windows · macOS · Linux

</div>

---

## What it is

Strip is two things that work together:

- **`stripdl`** — a Python CLI that downloads entire webtoon series from Webtoons.com, saving each chapter as a folder of images with full resume support
- **Strip Reader** — an Electron desktop app that reads your local library with a smooth, scrolling reader interface

Downloads are stored in a clean folder structure on your machine. No account, no DRM, no internet connection needed to read.

---

## The app

Strip Reader is a three-panel desktop app built on Electron:

**Library** — a card grid of every series you have downloaded. Search by title, sort by name, last read, or chapter count, and right-click any series for quick actions (open folder, delete, mark read). Clicking a series opens its chapter list.

**Reader** — a vertical scrolling reader, identical to reading on the web. Images lazy-load as you scroll and the next chapter is preloaded in the background so chapter transitions are instant. Navigate with the toolbar or keyboard shortcuts (`j` / `k`, `n` / `p`, `b` to go back, `g` to jump to a chapter).

**Settings** — grouped configuration cards:
- *Storage* — download directory
- *Downloads* — concurrent chapters, concurrent images per chapter, request rate limit
- *Reader* — lazy loading toggle, preload next chapter toggle
- *Appearance* — light / dark / system theme

**Download tray** — a persistent bottom drawer that handles downloads without navigating away from what you're reading. Paste a URL, hit start, and a live progress card appears showing per-chapter progress bars with page counts. Multiple jobs queue automatically. The tray stays open across navigation and collapses to a badge when minimised.

---

## Quick start

### CLI

```bash
pip install -e .

# Full series — oldest chapter first
stripdl download "https://www.webtoons.com/en/action/tower-of-god/list?title_no=95"

# From chapter 50 onwards
stripdl download "https://www.webtoons.com/en/..." --start 50

# Specific range or episodes
stripdl download "https://www.webtoons.com/en/..." --chapters 1-20
stripdl download "https://www.webtoons.com/en/..." --chapters 1,5,10

# Browse what's available without downloading
stripdl list "https://www.webtoons.com/en/..."

# Your local library
stripdl library

# Configuration
stripdl config
stripdl config --set download_dir=D:\Comics
stripdl config --set image_quality=90
```

### Reader app

```bash
cd electron-app
npm install
npm start
```

---

## Installation

**Requirements:** Python 3.9+, Node.js 18+

```bash
git clone https://github.com/yourname/strip.git
cd strip

# CLI
pip install -e .

# Reader
cd electron-app
npm install
npm start
```

---

## How it works

### Download pipeline

The CLI fetches the chapter list and downloads images concurrently in a pipeline — chapter 1 starts downloading as soon as the first page of the chapter list arrives, without waiting for the full list:

```
background thread                       download pool (3 workers)
─────────────────                       ─────────────────────────
iter_chapter_list()
  page 1 fetched  ──► sort ascending ──►  chapter  1 starts
  page 2 fetched  ──► push to queue  ──►  chapter  2 starts
  page 3 fetched  ──► push to queue  ──►  chapter  3 starts
  ...
```

Within each chapter, images are downloaded concurrently (4 threads by default) through a shared session with automatic connection retry and exponential backoff.

### Resume

Interrupted downloads resume cleanly. Each chapter directory gets a `.complete` sentinel once all images are saved. On the next run, complete chapters are skipped entirely and only missing images within partial chapters are re-fetched.

### Electron ↔ CLI communication

The reader spawns the CLI as a child process for downloads and reads the library directly from disk — no server required:

```
Electron renderer  →  main process  →  spawn stripdl --json-progress
                                              ↓ stdout JSON lines
                       main process  →  ipcRenderer  →  Electron renderer
```

JSON event stream (subset):

```jsonc
{"status": "series_info",   "title": "Tower of God", "author": "SIU"}
{"status": "chapter_found", "chapter": 1, "title": "Ch. 1", "count": 1}
{"status": "chapter_start", "chapter": 1, "total_pages": 64}
{"status": "progress",      "chapter": 1, "page": 12, "percent": 19}
{"status": "chapter_done",  "chapter": 1, "pages_saved": 64}
{"status": "done",          "series": "Tower of God", "directory": "..."}
```

---

## Folder structure

```
~/strip-data/
└── Tower_of_God/
    ├── metadata.json         ← title, author, description, cover URL
    ├── cover.jpg
    ├── 001/
    │   ├── metadata.json     ← chapter number, title, date
    │   ├── .complete         ← written when chapter finishes (resume sentinel)
    │   ├── 001_001.jpg
    │   ├── 001_002.jpg
    │   └── ...
    └── 002/
        └── ...
```

---

## Download options

```
stripdl download [OPTIONS] URL
```

| Option | Short | Description |
| --- | --- | --- |
| `--chapters RANGE` | `-c` | Range `1-20` or comma list `1,3,5` |
| `--start N` | `-s` | Download from chapter N through the latest |
| `--output PATH` | `-o` | Override download directory for this run |
| `--chapter-concurrency N` | | Parallel chapters (default: 3) |
| `--image-concurrency N` | | Parallel images per chapter (default: 4) |
| `--rate-limit N` | | Max requests/sec across all threads (default: 8) |
| `--no-cache` | | Ignore cached series metadata |
| `--verify` | | SHA-256 integrity check after each image |

`--chapters` and `--start` are mutually exclusive. Without either, all chapters download from chapter 1.

---

## Configuration

`~/.strip/config.json` — view and edit with `stripdl config`:

| Key | Default | Description |
| --- | --- | --- |
| `download_dir` | `~/strip-data` | Where to save comics |
| `image_quality` | `85` | JPEG save quality (1–95) |
| `max_concurrent_chapters` | `3` | Chapters downloaded in parallel |
| `image_concurrency` | `4` | Images downloaded in parallel per chapter |
| `max_concurrent_jobs` | `2` | Simultaneous series jobs in the Electron queue |
| `rate_limit` | `8.0` | Max requests/sec across all threads (0 = unlimited) |
| `verify_integrity` | `false` | SHA-256 verify every image on download |
| `cache_ttl_days` | `7` | Days to reuse cached series metadata (0 = always re-fetch) |
| `overwrite` | `false` | Re-download already completed chapters |
| `lazy_loading` | `true` | Lazy-load images in the reader |
| `preload_next_chapter` | `true` | Pre-fetch next chapter images while reading |
| `theme` | `"system"` | `"light"` / `"dark"` / `"system"` |

---

## Adding support for new sites

1. Create `strip/parsers/mysite.py` subclassing `SiteParser`
2. Implement the required methods
3. Register in `strip/parsers/__init__.py`

```python
from strip.parsers.base import SiteParser, SeriesInfo, ChapterInfo

class MySiteParser(SiteParser):
    @classmethod
    def supports(cls, url: str) -> bool:
        return "mysite.com" in url

    @property
    def name(self) -> str:
        return "MySite"

    def get_series_info(self, url: str) -> SeriesInfo: ...
    def get_chapter_list(self, url: str) -> list[ChapterInfo]: ...
    def get_chapter_images(self, chapter_url: str) -> list[str]: ...
    def get_image_headers(self) -> dict: ...
```

Optionally add `iter_chapter_list(url)` as a generator that yields `ChapterInfo` objects one page at a time. The downloader uses it to pipeline list fetching with downloading. Falls back to `get_chapter_list` if not implemented.

---

## Building a distributable

```bash
# Bundle the CLI into a single executable (auto-installs PyInstaller if needed)
python build_cli.py
# → dist/stripdl.exe  (Windows)
# → dist/stripdl      (macOS / Linux)
# → also copied to electron-app/resources/strip-cli/

# Package the full desktop app
cd electron-app
npm run build        # current platform
npm run build:win    # Windows  (.exe installer)
npm run build:mac    # macOS    (.dmg)
npm run build:linux  # Linux    (.AppImage)
```

---

## Platform notes

| Platform | Note |
| --- | --- |
| Windows | CLI named `stripdl` to avoid conflict with GNU Binutils `strip.exe` |
| Windows | `file://` image paths use forward slashes (`filePath.replace(/\\/g, "/")`) |

---

## Changelog

### v0.3.1
- **fix:** Chapter-list pagination infinite loop — Webtoons echoes the last valid page for out-of-range requests; pagination now terminates via episode-number deduplication
- **fix:** Downloads were starting from the newest chapter — list sorted ascending before the download queue is populated so chapter 1 always downloads first
- **fix:** Connection timeouts — persistent `Session` + `HTTPAdapter(Retry(...))` replaces bare `requests.get()` for automatic retry on TCP failures and 5xx responses
- **fix:** Removed 0.3 s artificial sleep between chapter-list page requests
- **fix:** `build_cli.py` now auto-installs PyInstaller if not present instead of crashing
- **feat:** `--start N` / `-s N` — download from chapter N through the latest

### v0.3.0
- Concurrent chapter downloads with configurable worker count
- Pipelined chapter-list fetch and image download
- Partial chapter resume — only missing images re-downloaded
- Optional SHA-256 integrity verification (`--verify`)
- Series metadata cache with configurable TTL
- Token-bucket rate limiter shared across all download threads
- Per-series file lock prevents duplicate concurrent downloads
- Lazy image loading and next-chapter preload in the reader
- Right-click context menus, keyboard shortcuts, toast notifications in Electron app

### v0.2.1
- Fixed frozen "Fetching chapter list…" progress spinner

### v0.2.0
- Sequential chapter downloads (fixed ThreadPoolExecutor ordering bug)
- Rate-limit backoff on 429/503
- Correct cover image extraction
- Persistent download tray in Electron app

### v0.1.0
- Initial release

---

## Contributing

Contributions are welcome — bug fixes, new site parsers, Electron UX improvements, and documentation all count.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for:
- Development setup (Python CLI + Electron app)
- How to write a new site parser
- Code conventions and commit message format
- How to submit a pull request

---

## License

MIT