# strip/downloader.py
# Orchestrates downloading a series or individual chapters.
#
# Two execution modes:
#   - CLI mode   : passes a RichProgress callback so the CLI can render a live display
#   - Electron mode (--json-progress): emits JSON lines to stdout for the Electron subprocess
#
# Concurrency model:
#   - Images within a chapter   → ThreadPoolExecutor (concurrent_downloads workers)
#   - Chapters within a series  → sequential (one at a time) to respect rate limits
#     and avoid lock-file conflicts when running multiple terminals.
#
# Resume support:
#   - A chapter is considered complete when a .complete sentinel file exists
#     alongside the expected number of images. Partially downloaded chapters
#     are re-downloaded from scratch (partial files are purged first).
#
# Rate-limit defence:
#   - A configurable inter-chapter delay is applied after every chapter.
#   - If a 429 / 503 is detected, an exponential back-off is triggered and the
#     progress display shows a "rate-limited – waiting Xs" status so the user
#     knows the tool is still alive.
#
# Lock file:
#   - A per-series lock file (~/.strip/locks/<safe_title>.lock) prevents two
#     simultaneous terminals from downloading the same series.

import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Callable
from io import BytesIO

import requests
from PIL import Image

from strip.config import config
from strip.parsers.base import ChapterInfo, SiteParser


# ─────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────

def _sanitize(name: str) -> str:
    name = re.sub(r'[<>:\"/\\\\|?*]', "_", name)
    name = re.sub(r"\s+", "_", name.strip())
    return name[:100]


def _emit(obj: dict):
    """Print one JSON line to stdout. Electron reads these."""
    print(json.dumps(obj), flush=True)


# ─────────────────────────────────────────────────────────────────────
#  Progress callback dataclass
# ─────────────────────────────────────────────────────────────────────

@dataclass
class ChapterProgress:
    chapter_number: float
    chapter_title: str
    pages_done: int
    pages_total: int
    status: str = "downloading"   # "downloading" | "done" | "skipped" | "error" | "rate_limited" | "retrying"


ProgressCallback = Callable[[ChapterProgress], None]


# ─────────────────────────────────────────────────────────────────────
#  Per-series lock (prevents two terminals hitting the same series)
# ─────────────────────────────────────────────────────────────────────

_LOCK_DIR = Path.home() / ".strip" / "locks"


class SeriesLock:
    """File-based lock scoped to a series directory name."""

    def __init__(self, safe_title: str):
        _LOCK_DIR.mkdir(parents=True, exist_ok=True)
        self._path = _LOCK_DIR / f"{safe_title}.lock"
        self._acquired = False

    def acquire(self) -> bool:
        """Try to acquire. Returns False if already locked by another process."""
        try:
            # Exclusive creation – atomic on POSIX and Windows
            fd = os.open(str(self._path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            self._acquired = True
            return True
        except FileExistsError:
            # Check if the owning PID is still alive
            try:
                pid = int(self._path.read_text().strip())
                os.kill(pid, 0)   # signal 0 = just check existence
                return False      # process alive → locked
            except (ProcessLookupError, ValueError, OSError):
                # Stale lock – steal it
                self._path.write_text(str(os.getpid()))
                self._acquired = True
                return True

    def release(self):
        if self._acquired and self._path.exists():
            try:
                self._path.unlink()
            except OSError:
                pass

    def __enter__(self):
        if not self.acquire():
            raise RuntimeError(
                f"Another stripdl process is already downloading this series. "
                f"Lock file: {self._path}"
            )
        return self

    def __exit__(self, *_):
        self.release()


# ─────────────────────────────────────────────────────────────────────
#  Image download with retry + back-off
# ─────────────────────────────────────────────────────────────────────

_RETRY_STATUSES = {429, 503, 502, 500}
_MAX_IMAGE_RETRIES = 4


def _download_image(
    url: str,
    dest: Path,
    headers: dict,
    quality: int = 85,
    rate_limited_cb: Optional[Callable[[int], None]] = None,
) -> bool:
    """Download a single image with exponential back-off on rate-limit errors."""
    if dest.exists() and dest.stat().st_size > 0:
        return True

    delay = 2.0
    for attempt in range(_MAX_IMAGE_RETRIES):
        try:
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code in _RETRY_STATUSES:
                wait = delay * (2 ** attempt)
                if rate_limited_cb:
                    rate_limited_cb(int(wait))
                time.sleep(wait)
                continue
            resp.raise_for_status()
            img = Image.open(BytesIO(resp.content)).convert("RGB")
            img.save(dest, "JPEG", quality=quality, optimize=True)
            return True
        except requests.exceptions.RequestException:
            if attempt < _MAX_IMAGE_RETRIES - 1:
                time.sleep(delay * (2 ** attempt))
        except Exception:
            return False

    return False


# ─────────────────────────────────────────────────────────────────────
#  Resume helpers
# ─────────────────────────────────────────────────────────────────────

_SENTINEL = ".complete"


def _chapter_is_complete(ch_dir: Path, expected_pages: int) -> bool:
    """A chapter is complete iff the sentinel file exists and page count matches."""
    sentinel = ch_dir / _SENTINEL
    if not sentinel.exists():
        return False
    existing = len(list(ch_dir.glob("*.jpg")))
    return existing >= expected_pages


def _purge_partial_chapter(ch_dir: Path):
    """Remove partial image files before a fresh attempt."""
    for f in ch_dir.glob("*.jpg"):
        try:
            f.unlink()
        except OSError:
            pass
    sentinel = ch_dir / _SENTINEL
    if sentinel.exists():
        sentinel.unlink()


# ─────────────────────────────────────────────────────────────────────
#  Cover download – uses the series-level cover_url from SeriesInfo
# ─────────────────────────────────────────────────────────────────────

def _download_cover(cover_url: str, series_dir: Path, headers: dict):
    """
    Download the series cover image.

    The cover_url is extracted by the parser from the series listing page
    (e.g. the <img> inside .detail_header .thmb), NOT from individual episode
    thumbnails.  We skip if cover.jpg already exists (resume-safe).
    """
    if not cover_url:
        return
    dest = series_dir / "cover.jpg"
    if dest.exists() and dest.stat().st_size > 0:
        return
    try:
        resp = requests.get(cover_url, headers=headers, timeout=20)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGB")
        img.save(dest, "JPEG", quality=90, optimize=True)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────
#  Chapter download
# ─────────────────────────────────────────────────────────────────────

def download_chapter(
    parser: SiteParser,
    chapter: ChapterInfo,
    series_dir: Path,
    quality: int = 85,
    json_progress: bool = False,
    progress_cb: Optional[ProgressCallback] = None,
) -> Path:
    ch_dir = series_dir / f"{int(chapter.number):03d}"
    ch_dir.mkdir(parents=True, exist_ok=True)

    # Write / overwrite chapter metadata (lightweight, always safe)
    with open(ch_dir / "metadata.json", "w") as f:
        json.dump(
            {"number": chapter.number, "title": chapter.title,
             "url": chapter.url, "date": chapter.date},
            f, indent=2,
        )

    image_urls = parser.get_chapter_images(chapter.url)
    headers = parser.get_image_headers()
    total = len(image_urls)

    # ── Resume: skip if already fully downloaded ──────────────────────
    if _chapter_is_complete(ch_dir, total):
        if json_progress:
            _emit({"status": "skipped", "chapter": chapter.number,
                   "reason": "already_downloaded"})
        if progress_cb:
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, total, total, status="skipped"))
        return ch_dir

    # Purge any partial images from a previous interrupted run
    _purge_partial_chapter(ch_dir)

    if json_progress:
        _emit({"status": "chapter_start", "chapter": chapter.number,
               "title": chapter.title, "total_pages": total})
    if progress_cb:
        progress_cb(ChapterProgress(chapter.number, chapter.title, 0, total))

    completed = 0
    lock = threading.Lock()

    # Rate-limit signal passed from image threads back to the progress display
    _rate_limited_until = [0.0]

    def _on_rate_limited(wait_secs: int):
        _rate_limited_until[0] = time.time() + wait_secs
        if progress_cb:
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, completed, total,
                status=f"rate_limited:{wait_secs}",
            ))
        if json_progress:
            _emit({"status": "rate_limited", "chapter": chapter.number,
                   "wait_seconds": wait_secs})

    def _dl_one(args):
        nonlocal completed
        idx, url = args
        dest = ch_dir / f"{int(chapter.number):03d}_{idx:03d}.jpg"
        ok = _download_image(url, dest, headers, quality, _on_rate_limited)
        with lock:
            completed += 1
            done = completed
        if json_progress:
            _emit({"status": "progress", "chapter": chapter.number,
                   "page": done, "total_pages": total,
                   "percent": round(done / total * 100)})
        if progress_cb and _rate_limited_until[0] < time.time():
            # Only send normal progress updates when not in a rate-limit wait
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, done, total))

    concurrency = config.get("concurrent_downloads", 4)
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(_dl_one, (i, u))
                   for i, u in enumerate(image_urls, start=1)]
        for fut in as_completed(futures):
            fut.result()   # re-raise any unhandled exception

    # Mark chapter complete
    (ch_dir / _SENTINEL).write_text(
        json.dumps({"pages": total, "timestamp": time.time()}))

    if json_progress:
        _emit({"status": "chapter_done", "chapter": chapter.number,
               "title": chapter.title, "pages_saved": total})
    if progress_cb:
        progress_cb(ChapterProgress(
            chapter.number, chapter.title, total, total, status="done"))

    return ch_dir


# ─────────────────────────────────────────────────────────────────────
#  Series download
# ─────────────────────────────────────────────────────────────────────

def download_series(
    parser: SiteParser,
    url: str,
    chapter_range: Optional[tuple] = None,
    specific_chapters: Optional[List[int]] = None,
    json_progress: bool = False,
    progress_cb: Optional[ProgressCallback] = None,
) -> Path:
    """
    Download a full series or a filtered subset.

    Chapters are downloaded **sequentially** (one at a time) to respect
    rate limits and avoid two terminals stomping over each other.
    Images within each chapter are still downloaded concurrently.

    A file-based lock prevents two terminals from downloading the same
    series simultaneously.
    """
    if json_progress:
        _emit({"status": "fetching_info", "url": url})

    series_info = parser.get_series_info(url)

    if json_progress:
        _emit({"status": "series_info",
               "title": series_info.title, "author": series_info.author})

    safe_title = _sanitize(series_info.title)
    series_dir = config.ensure_download_dir() / safe_title
    series_dir.mkdir(parents=True, exist_ok=True)

    # Acquire per-series lock ─────────────────────────────────────────
    lock = SeriesLock(safe_title)
    if not lock.acquire():
        msg = (
            f"Series '{series_info.title}' is already being downloaded by "
            f"another stripdl process. "
            f"If you believe this is wrong, delete: {lock._path}"
        )
        if json_progress:
            _emit({"status": "error", "message": msg})
        else:
            raise RuntimeError(msg)
        return series_dir

    try:
        return _do_download(
            parser=parser,
            url=url,
            series_info=series_info,
            series_dir=series_dir,
            chapter_range=chapter_range,
            specific_chapters=specific_chapters,
            json_progress=json_progress,
            progress_cb=progress_cb,
        )
    finally:
        lock.release()


def _do_download(
    parser,
    url,
    series_info,
    series_dir,
    chapter_range,
    specific_chapters,
    json_progress,
    progress_cb,
):
    # Write / refresh series metadata
    with open(series_dir / "metadata.json", "w") as f:
        json.dump(
            {"title": series_info.title, "author": series_info.author,
             "description": series_info.description,
             "cover_url": series_info.cover_url,
             "url": series_info.url, "genre": series_info.genre,
             "status": series_info.status},
            f, indent=2, ensure_ascii=False,
        )

    # Download cover using the series-level URL (NOT episode thumbnails)
    _download_cover(series_info.cover_url, series_dir, parser.get_image_headers())

    if json_progress:
        _emit({"status": "fetching_chapters"})

    all_chapters = parser.get_chapter_list(url)

    if json_progress:
        _emit({"status": "chapter_list", "total": len(all_chapters)})

    # Filter
    if specific_chapters:
        chapters = [c for c in all_chapters if int(c.number) in specific_chapters]
    elif chapter_range:
        start, end = chapter_range
        chapters = [c for c in all_chapters if start <= c.number <= end]
    else:
        chapters = all_chapters

    if not chapters:
        if json_progress:
            _emit({"status": "error", "message": "No chapters matched the filter."})
        return series_dir

    # Identify which chapters actually need downloading (resume logic)
    to_download: List[ChapterInfo] = []
    for chapter in chapters:
        ch_dir = series_dir / f"{int(chapter.number):03d}"
        sentinel = ch_dir / _SENTINEL
        if sentinel.exists() and not config.get("overwrite", False):
            # Already fully downloaded – emit skipped immediately
            existing = len(list(ch_dir.glob("*.jpg")))
            if json_progress:
                _emit({"status": "skipped", "chapter": chapter.number,
                       "reason": "already_downloaded"})
            if progress_cb:
                progress_cb(ChapterProgress(
                    chapter.number, chapter.title,
                    existing, existing, status="skipped"))
            continue
        to_download.append(chapter)

    if json_progress:
        _emit({"status": "downloading",
               "chapters_to_download": len(to_download),
               "chapters_skipped": len(chapters) - len(to_download)})

    if not to_download:
        if json_progress:
            _emit({"status": "done", "series": series_info.title,
                   "directory": str(series_dir)})
        return series_dir

    # Inter-chapter delay (rate-limit courtesy)
    chapter_delay = config.get("chapter_delay", 1.5)

    for idx, chapter in enumerate(to_download):
        try:
            download_chapter(
                parser=parser,
                chapter=chapter,
                series_dir=series_dir,
                quality=config.get("image_quality", 85),
                json_progress=json_progress,
                progress_cb=progress_cb,
            )
        except Exception as e:
            if json_progress:
                _emit({"status": "error", "chapter": chapter.number,
                       "message": str(e)})
            if progress_cb:
                progress_cb(ChapterProgress(
                    chapter.number, chapter.title, 0, 0, status="error"))

        # Polite inter-chapter delay (skip after last chapter)
        if idx < len(to_download) - 1 and chapter_delay > 0:
            if json_progress:
                _emit({"status": "chapter_delay", "seconds": chapter_delay})
            time.sleep(chapter_delay)

    if json_progress:
        _emit({"status": "done", "series": series_info.title,
               "directory": str(series_dir)})

    return series_dir
