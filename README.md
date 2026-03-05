# strip ◈

A webtoon downloader and reader. Two parts that work together:

- **Python CLI** – downloads webtoons from Webtoons.com to a clean local folder structure
- **Electron app** – reads your local library with a beautiful scrolling reader

---

## Quick start

### Python CLI

```bash
# Install
pip install -e .

# Download a series (all chapters)
strip download "https://www.webtoons.com/en/action/tower-of-god/list?title_no=95"

# Download a specific range
strip download "https://www.webtoons.com/en/..." --chapters 1-20

# Download specific chapters
strip download "https://www.webtoons.com/en/..." --chapters 1,5,10

# List available chapters without downloading
strip list "https://www.webtoons.com/en/..."

# Show your local library
strip library

# View / change config
strip config
strip config --set download_dir=/Users/you/Comics
strip config --set image_quality=90
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
    │   ├── 001_001.jpg
    │   ├── 001_002.jpg
    │   └── ...
    ├── 002/
    │   └── ...
    └── ...
```

---

## Architecture

### How the two parts communicate

The Electron app spawns the Python CLI as a **child process** using Node's `child_process.spawn()`.

```
Electron renderer
    │  clicks "Start Download"
    ▼
Electron main process (index.js)
    │  spawn("strip", ["download", url, "--json-progress"])
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
{"status": "series_info",    "title": "Tower of God", "author": "SIU"}
{"status": "chapter_start",  "chapter": 1, "total_pages": 64}
{"status": "progress",       "chapter": 1, "page": 12, "total_pages": 64, "percent": 19}
{"status": "chapter_done",   "chapter": 1, "pages_saved": 64}
{"status": "done",           "series": "Tower of God", "directory": "/Users/you/strip-data/Tower_of_God"}
```

The reader side (library browsing, chapter reading) talks directly to the filesystem — no server needed.

---

## Adding support for new sites

1. Create `strip/parsers/mysite.py` subclassing `SiteParser`
2. Implement `supports()`, `get_series_info()`, `get_chapter_list()`, `get_chapter_images()`
3. Add to `PARSERS` list in `strip/parsers/__init__.py`

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
```

---

## Configuration

Config lives at `~/.strip/config.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `download_dir` | `~/strip-data` | Where to save comics |
| `image_quality` | `85` | JPEG quality (1–95) |
| `concurrent_downloads` | `4` | Parallel image downloads per chapter |
| `chapter_delay` | `1.0` | Seconds between chapters (be polite) |
| `overwrite` | `false` | Re-download existing chapters |
| `theme` | `"system"` | Electron app theme |

---

## Building a distributable

### Bundle Python with PyInstaller

```bash
pip install pyinstaller
pyinstaller --onefile --name strip strip/cli.py
# Output: dist/strip (or dist/strip.exe on Windows)
```

### Build Electron app with bundled CLI

```bash
# Copy PyInstaller output into the right place
cp dist/strip electron-app/

# Build
cd electron-app
npm run build
```

The `electron-builder` config in `package.json` copies the bundled `strip` binary as an `extraResource`, and `main/index.js` looks for it at `resources/strip-cli/strip` when packaged.

---

## License

MIT
