<p align="center">
  <img src="assets/strip-logo.png" alt="Strip logo" width="96" />
</p>

<h1 align="center">Strip</h1>

<p align="center">
  Download manga and webtoons for offline reading, then browse them in a focused desktop reader.
</p>

<p align="center">
  MIT ·
  Python CLI · Electron reader · Windows · macOS · Linux
</p>

## What Strip does

Strip combines two tools:

- **`stripdl`** — downloads series, chapters, and page images from supported sites.
- **Strip Reader** — organizes the local library and provides a scrollable desktop reading experience.

Downloads are saved locally, resume after interruptions, and remain available for offline reading.

## Features

- Resume incomplete downloads and skip completed chapters.
- Download chapters and images concurrently with a shared request rate limit.
- Track reading progress and continue where you left off.
- Lazy-load reader pages and optionally preload the next chapter.
- Queue multiple downloads from the desktop app.
- Use light, dark, or system theme settings.

## Supported sites

| Site | URL pattern |
| --- | --- |
| Webtoon | `webtoons.com` |
| WeebCentral | `weebcentral.com` |
| Comix | `comix.to` |

## Quick start

### CLI

Requirements: Python 3.9+

```bash
git clone https://github.com/ZLouisMiguel/stripdl.git
cd stripdl/core
python -m pip install -e .

# Download a full series
stripdl download "https://www.webtoons.com/en/action/tower-of-god/list?title_no=95"

# Download from a chapter onward or select specific chapters
stripdl download "https://www.webtoons.com/en/..." --start 50
stripdl download "https://www.webtoons.com/en/..." --chapters 1-20
stripdl download "https://www.webtoons.com/en/..." --chapters 1,5,10
```

Useful commands:

```bash
stripdl list "https://www.webtoons.com/en/..."
stripdl library
stripdl config
stripdl config --set download_dir="D:\Comics"
```

### Desktop reader

Requirements: Node.js 18+

```bash
cd desktop
npm install
npm run dev
```

Paste a supported series URL into the download tray. Once the download finishes, it appears in the library and can be read offline.

## Downloads and configuration

By default, downloads are stored in `~/strip-data`. Each series contains metadata, a cover image, and one folder per chapter. Half-chapters such as `12.5` keep their own distinct folder.

Configuration is stored in `~/.strip/config.json` and can be viewed or changed with `stripdl config`:

```bash
stripdl config --set download_dir="D:\Comics"
stripdl config --set image_quality=90
stripdl config --set theme=dark
```

Use `stripdl download --help` for all download options, including chapter ranges, concurrency, caching, overwriting, and integrity verification.

## Development

Install the CLI in editable mode and install the desktop dependencies:

```bash
python -m pip install -e core
npm install --prefix desktop
```

Run the checks before opening a pull request:

```bash
python -m unittest discover -s core/tests -v
npm test --prefix desktop
npm run build --prefix desktop
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project structure, parser guide, coding conventions, and pull request workflow.

## License

MIT