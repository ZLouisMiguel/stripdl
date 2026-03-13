# strip ◈  v0.3.1

A webtoon downloader and reader. Two parts that work together:

- **Python CLI** (`stripdl`) — downloads webtoons from Webtoons.com to a clean local folder structure
- **Electron app** — reads your local library with a scrolling reader

> **Windows note:** The CLI is named `stripdl` to avoid conflicting with the GNU `strip` binary that ships with MinGW / Git for Windows.

---

## Quick start

### Python CLI

```bash
# Install
pip install -e .

# Download all chapters (oldest first)
stripdl download "https://www.webtoons.com/en/action/tower-of-god/list?title_no=95"

# Download from chapter 50 onwards
stripdl download "https://www.webtoons.com/en/..." --start 50

# Download a specific range
stripdl download "https://www.webtoons.com/en/..." --chapters 1-20

# Download specific chapters
stripdl download "https://www.webtoons.com/en/..." --chapters 1,5,10

# List available chapters without downloading
stripdl list "https://www.webtoons.com/en/..."

# Show your local library
stripdl library

# View / change config
stripdl config
stripdl config --set download_dir=/Users/you/Comics
stripdl config --set image_quality=90
```

### Electron reader app

```bash
cd electron-app
npm install
npm start
```

---

## Installation

### Requirements

- Python 3.9+
- Node.js 18+ (for Electron app)

### Python CLI

```bash
# Clone the repo
git clone https://github.com/yourname/strip.git
cd strip

# Install Python package (editable mode recommended during dev)
pip install -e .

# Or just install deps without the package
pip install -r requirements.txt
```

### Electron App

```bash
cd electron-app
npm install
npm start       # development
npm run build   # production build
```

---

## Folder structure

Downloads are saved to `~/strip-data/` by default (configurable):

```
~/strip-data/
└── Tower_of_God/
    ├── metadata.json         ← series: title, author, description, cover URL
    ├── cover.jpg
    ├── 001/
    │   ├── metadata.json     ← chapter: number, title, date
    │   ├── .complete         ← sentinel written when chapter finishes
    │   ├── 001_001.jpg
    │   ├── 001_002.jpg
    │   └── ...
    ├── 002/
    │   └── ...
    └── ...
```

Resuming works automatically — if a download is interrupted, only the missing images are re-fetched on the next run. Completed chapters (those with a `.complete` sentinel) are skipped entirely.

---

## Architecture

### How the two parts communicate

The Electron app spawns the Python CLI as a **child process** using Node's `child_process.spawn()`.

```
Electron renderer
    │  clicks "Start Download"
    ▼
Electron main process (index.js)
    │  spawn("stripdl", ["download", url, "--json-progress"])
    ▼
Python CLI (strip/cli.py)
    │  stdout → JSON lines
    ▼
Electron main process
    │  parses JSON, forwards via ipcRenderer
    ▼
Electron renderer
    └── updates progress bar, log
```

The `--json-progress` flag switches the CLI from Rich terminal output to machine-readable JSON lines:

```jsonc
{"status": "fetching_info",   "url": "https://www.webtoons.com/..."}
{"status": "series_info",     "title": "Tower of God", "author": "SIU"}
{"status": "fetching_chapters"}
{"status": "chapter_found",   "chapter": 1, "title": "Ch. 1", "count": 1}
{"status": "chapter_start",   "chapter": 1, "chapter_id": 1, "total_pages": 64, "to_download": 64}
{"status": "progress",        "chapter": 1, "chapter_id": 1, "page": 12, "total_pages": 64, "percent": 19}
{"status": "chapter_done",    "chapter": 1, "chapter_id": 1, "title": "Ch. 1", "pages_saved": 64}
{"status": "done",            "series": "Tower of God", "directory": "/Users/you/strip-data/Tower_of_God"}
```

The reader side (library browsing, chapter reading) talks directly to the filesystem — no server needed.

### Download pipeline

Fetching the chapter list and downloading images are pipelined — chapter 1 begins downloading as soon as the first page of the chapter list arrives, while the rest of the list is still being fetched in the background:

```
background thread                       download pool (3 workers)
─────────────────                       ─────────────────────────
iter_chapter_list()                     waiting on queue
  page 1 fetched  ──► sort & push ──►  chapter 1 starts
  page 2 fetched  ──► push        ──►  chapter 2 starts
  page 3 fetched  ──► push        ──►  chapter 3 starts
  ...
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
| `--chapter-concurrency N` | | Concurrent chapters (default: 3) |
| `--image-concurrency N` | | Concurrent images per chapter (default: 4) |
| `--rate-limit N` | | Max requests/sec across all threads (default: 8) |
| `--no-cache` | | Ignore cached series metadata; re-fetch from network |
| `--verify` | | Verify image integrity via SHA-256 after download |

`--chapters` and `--start` are mutually exclusive. Without either, all chapters are downloaded starting from chapter 1.

---

## Configuration

Config lives at `~/.strip/config.json`. View or edit with `stripdl config`:

| Key | Default | Description |
| --- | --- | --- |
| `download_dir` | `~/strip-data` | Where to save comics |
| `image_quality` | `85` | JPEG save quality (1–95) |
| `max_concurrent_chapters` | `3` | Chapters downloaded in parallel |
| `image_concurrency` | `4` | Images downloaded in parallel per chapter |
| `max_concurrent_jobs` | `2` | Simultaneous series jobs (Electron queue) |
| `rate_limit` | `8.0` | Max requests/sec across all threads (0 = unlimited) |
| `verify_integrity` | `false` | SHA-256 check every image after download |
| `cache_ttl_days` | `7` | Days to reuse cached series metadata (0 = always re-fetch) |
| `overwrite` | `false` | Re-download already completed chapters |
| `lazy_loading` | `true` | Lazy-load images in the reader |
| `preload_next_chapter` | `true` | Pre-fetch next chapter while reading |
| `theme` | `"system"` | Electron app colour theme |

---

## Adding support for new sites

1. Create `strip/parsers/mysite.py` subclassing `SiteParser`
2. Implement the required methods
3. Add to `PARSERS` in `strip/parsers/__init__.py`

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

Optionally implement `iter_chapter_list(url)` as a generator that yields `ChapterInfo` objects one page at a time. The downloader will use it to pipeline fetching and downloading. If omitted, `get_chapter_list` is used as a fallback.

---

## Building a distributable

### Bundle Python with PyInstaller

```bash
pip install pyinstaller
python build_cli.py
# Output: dist/stripdl (or dist/stripdl.exe on Windows)
# Also copies the binary to electron-app/resources/strip-cli/
```

### Build Electron app with bundled CLI

```bash
cd electron-app
npm run build
```

The `electron-builder` config in `package.json` includes the bundled `stripdl` binary as an `extraResource`. The main process looks for it at `resources/strip-cli/stripdl` when packaged.

---

## Known platform quirks

| Platform | Issue | Fix applied |
| --- | --- | --- |
| Windows | `strip` conflicts with GNU Binutils `strip.exe` | CLI renamed to `stripdl` |
| Windows | `file://` paths need forward slashes | `filePath.replace(/\\/g, "/")` in renderer |

---

## Changelog

### v0.3.1
- **fix:** Chapter-list pagination infinite loop — Webtoons echoes the last valid page for any out-of-range request instead of returning empty; pagination now stops via episode-number deduplication
- **fix:** Downloads were starting from the newest chapter — list is now sorted ascending before populating the download queue, so chapter 1 always downloads first
- **fix:** Connection timeouts — replaced bare `requests.get()` with a persistent `Session` + `HTTPAdapter(Retry(...))` for automatic retry on TCP failures and 5xx responses
- **fix:** Removed 0.3 s artificial sleep between chapter-list page requests
- **feat:** `--start N` / `-s N` — download from chapter N through the latest without needing to know the total count

### v0.3.0
- Concurrent chapter downloads (`max_concurrent_chapters`)
- Pipelined chapter-list fetch + download (fetching and downloading run simultaneously)
- Partial chapter resume — only missing images re-downloaded on retry
- Optional SHA-256 integrity verification (`--verify`)
- Series metadata cache (`cache_ttl_days`)
- Token-bucket rate limiter across all download threads
- Per-series file lock prevents duplicate concurrent downloads
- Lazy image loading and next-chapter preload in reader
- Right-click context menus, keyboard shortcuts, toast notifications in Electron app
- `--chapter-concurrency`, `--image-concurrency`, `--rate-limit`, `--no-cache`, `--verify` CLI flags

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

## License

MIT