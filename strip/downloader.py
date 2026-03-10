# strip/downloader.py
# Orchestrates downloading a series or individual chapters.
#
# v2 changes:
#   - Global token-bucket rate limiter shared across all download threads.
#   - Chapters downloaded concurrently within a series (ThreadPoolExecutor).
#   - Partial chapter resume: keeps already-downloaded images, fetches only missing ones.
#   - Optional SHA-256 integrity check per image (manifest.json in chapter dir).
#   - Metadata caching: reads local metadata.json if younger than cache_ttl_days.
#   - Progress events carry chapter_id so Electron can track multiple active chapters.

import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional
from io import BytesIO

import requests
from PIL import Image

from strip.config import config
from strip.parsers.base import ChapterInfo, SeriesInfo, SiteParser


# ─────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────

def _sanitize(name: str) -> str:
    name = re.sub(r'[<>:\"/\\|?*]', "_", name)
    name = re.sub(r"\s+", "_", name.strip())
    return name[:100]


def _emit(obj: dict):
    """Print one JSON line to stdout (Electron subprocess mode)."""
    print(json.dumps(obj), flush=True)


# ─────────────────────────────────────────────────────────────────────
#  Token-bucket rate limiter
# ─────────────────────────────────────────────────────────────────────

class TokenBucket:
    """
    Thread-safe token bucket.  Each `acquire()` call blocks until a token
    is available, then consumes one token.  Set rate=0 to disable limiting.
    """

    def __init__(self, rate: float):
        self._rate = rate          # tokens per second; 0 = unlimited
        self._tokens = rate        # start full
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def update_rate(self, rate: float):
        with self._lock:
            self._rate = rate

    def acquire(self, tokens: float = 1.0):
        """Block until *tokens* tokens are available."""
        if self._rate <= 0:
            return
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last
            self._tokens = min(self._rate, self._tokens + elapsed * self._rate)
            self._last = now
            if self._tokens >= tokens:
                self._tokens -= tokens
                return
            # Need to wait
            deficit = tokens - self._tokens
            wait = deficit / self._rate
            self._tokens = 0
            self._last = now + wait
        # Sleep outside the lock so other threads can be refilled
        time.sleep(wait)

    def penalize(self, seconds: float):
        """Drain the bucket by the equivalent of *seconds* worth of tokens."""
        with self._lock:
            self._tokens = max(0.0, self._tokens - seconds * self._rate)


# Process-global bucket (one per `download_series` call; recreated each time)
_bucket: Optional[TokenBucket] = None
_bucket_lock = threading.Lock()


def _get_bucket() -> TokenBucket:
    global _bucket
    with _bucket_lock:
        if _bucket is None:
            _bucket = TokenBucket(config.get("rate_limit", 8.0))
        return _bucket


def _reset_bucket():
    global _bucket
    with _bucket_lock:
        _bucket = TokenBucket(config.get("rate_limit", 8.0))


# ─────────────────────────────────────────────────────────────────────
#  Progress callback dataclass
# ─────────────────────────────────────────────────────────────────────

@dataclass
class ChapterProgress:
    chapter_number: float
    chapter_title:  str
    pages_done:     int
    pages_total:    int
    status: str = "downloading"
    # status values:
    #   "downloading" | "done" | "skipped" | "error"
    #   "rate_limited:<secs>" | "retrying"

    @property
    def chapter_id(self) -> float:
        """Alias used in JSON / Electron IPC."""
        return self.chapter_number


ProgressCallback = Callable[[ChapterProgress], None]


# ─────────────────────────────────────────────────────────────────────
#  Per-series lock
# ─────────────────────────────────────────────────────────────────────

_LOCK_DIR = Path.home() / ".strip" / "locks"


class SeriesLock:
    """File-based lock scoped to a series directory name."""

    def __init__(self, safe_title: str):
        _LOCK_DIR.mkdir(parents=True, exist_ok=True)
        self._path = _LOCK_DIR / f"{safe_title}.lock"
        self._acquired = False

    def acquire(self) -> bool:
        try:
            fd = os.open(str(self._path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            self._acquired = True
            return True
        except FileExistsError:
            try:
                pid = int(self._path.read_text().strip())
                os.kill(pid, 0)
                return False
            except (ProcessLookupError, ValueError, OSError):
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
                f"Lock: {self._path}"
            )
        return self

    def __exit__(self, *_):
        self.release()


# ─────────────────────────────────────────────────────────────────────
#  Image download with retry + token-bucket + back-off
# ─────────────────────────────────────────────────────────────────────

_RETRY_STATUSES   = {429, 503, 502, 500}
_MAX_IMG_RETRIES  = 4


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _download_image(
    url: str,
    dest: Path,
    headers: dict,
    quality: int = 85,
    rate_limited_cb: Optional[Callable[[int], None]] = None,
    expected_hash: Optional[str] = None,
) -> bool:
    """
    Download a single image.

    - Acquires a token-bucket token before every HTTP request.
    - Retries on 429/5xx with exponential back-off.
    - If *expected_hash* is provided, verifies SHA-256 after download.
    - Skips download if dest exists, is non-empty, and hash matches (or no hash given).
    """
    bucket = _get_bucket()

    # Skip if already downloaded and hash matches
    if dest.exists() and dest.stat().st_size > 0:
        if expected_hash is None:
            return True
        if _sha256_file(dest) == expected_hash:
            return True
        # Hash mismatch — re-download below
        dest.unlink(missing_ok=True)

    delay = 2.0
    for attempt in range(_MAX_IMG_RETRIES):
        try:
            bucket.acquire()
            resp = requests.get(url, headers=headers, timeout=30)

            if resp.status_code in _RETRY_STATUSES:
                # Honour Retry-After if server provides it
                retry_after = resp.headers.get("Retry-After")
                wait: float
                if retry_after:
                    try:
                        wait = float(retry_after)
                    except ValueError:
                        wait = delay * (2 ** attempt)
                else:
                    wait = delay * (2 ** attempt)

                bucket.penalize(wait)
                if rate_limited_cb:
                    rate_limited_cb(int(wait))
                time.sleep(wait)
                continue

            resp.raise_for_status()

            img = Image.open(BytesIO(resp.content)).convert("RGB")
            img.save(dest, "JPEG", quality=quality, optimize=True)
            return True

        except requests.exceptions.RequestException:
            if attempt < _MAX_IMG_RETRIES - 1:
                time.sleep(delay * (2 ** attempt))
        except Exception:
            return False

    return False


# ─────────────────────────────────────────────────────────────────────
#  Resume / integrity helpers
# ─────────────────────────────────────────────────────────────────────

_SENTINEL = ".complete"
_MANIFEST = "manifest.json"


def _load_manifest(ch_dir: Path) -> Dict[str, str]:
    """Load {filename: sha256} manifest from chapter dir, if it exists."""
    m = ch_dir / _MANIFEST
    if m.exists():
        try:
            return json.loads(m.read_text())
        except Exception:
            pass
    return {}


def _save_manifest(ch_dir: Path, hashes: Dict[str, str], total_pages: int):
    m = ch_dir / _MANIFEST
    m.write_text(json.dumps({"pages": total_pages, "hashes": hashes,
                             "timestamp": time.time()}))


def _chapter_is_complete(ch_dir: Path, expected_pages: int) -> bool:
    sentinel = ch_dir / _SENTINEL
    if not sentinel.exists():
        return False
    existing = len(list(ch_dir.glob("*.jpg")))
    return existing >= expected_pages


def _missing_images(
    ch_dir: Path,
    image_urls: List[str],
    chapter: ChapterInfo,
    verify: bool,
) -> List[tuple]:
    """
    Return list of (index, url, dest, expected_hash) for images that still need
    downloading.  With partial-resume: only missing or hash-failed images are returned.
    """
    manifest = _load_manifest(ch_dir) if verify else {}
    missing = []
    for i, url in enumerate(image_urls, start=1):
        fname = f"{int(chapter.number):03d}_{i:03d}.jpg"
        dest  = ch_dir / fname
        expected_hash = manifest.get("hashes", {}).get(fname) if verify else None

        if dest.exists() and dest.stat().st_size > 0:
            if not verify:
                continue   # already downloaded, skip
            if expected_hash and _sha256_file(dest) == expected_hash:
                continue   # verified, skip
        missing.append((i, url, dest, expected_hash))
    return missing


# ─────────────────────────────────────────────────────────────────────
#  Cover download
# ─────────────────────────────────────────────────────────────────────

def _download_cover(cover_url: str, series_dir: Path, headers: dict):
    if not cover_url:
        return
    dest = series_dir / "cover.jpg"
    if dest.exists() and dest.stat().st_size > 0:
        return
    bucket = _get_bucket()
    try:
        bucket.acquire()
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
    parser:        SiteParser,
    chapter:       ChapterInfo,
    series_dir:    Path,
    quality:       int  = 85,
    json_progress: bool = False,
    progress_cb:   Optional[ProgressCallback] = None,
    verify:        bool = False,
) -> Path:
    ch_dir = series_dir / f"{int(chapter.number):03d}"
    ch_dir.mkdir(parents=True, exist_ok=True)

    with open(ch_dir / "metadata.json", "w") as f:
        json.dump(
            {"number": chapter.number, "title": chapter.title,
             "url": chapter.url, "date": chapter.date},
            f, indent=2,
        )

    # Fetch image list (costs one token-bucket token via the parser's _get)
    image_urls = parser.get_chapter_images(chapter.url)
    headers    = parser.get_image_headers()
    total      = len(image_urls)

    # ── Resume: skip if sentinel exists and all images are present ────
    if _chapter_is_complete(ch_dir, total):
        if json_progress:
            _emit({"status": "skipped", "chapter": chapter.number,
                   "chapter_id": chapter.number, "reason": "already_downloaded"})
        if progress_cb:
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, total, total, status="skipped"))
        return ch_dir

    # ── Partial resume: find only missing / bad images ────────────────
    missing = _missing_images(ch_dir, image_urls, chapter, verify)

    if json_progress:
        _emit({"status": "chapter_start", "chapter": chapter.number,
               "chapter_id": chapter.number,
               "title": chapter.title, "total_pages": total,
               "to_download": len(missing)})
    if progress_cb:
        already_done = total - len(missing)
        progress_cb(ChapterProgress(chapter.number, chapter.title, already_done, total))

    if not missing:
        # All images present — just write sentinel and finish
        _finalize_chapter(ch_dir, image_urls, chapter, verify)
        if json_progress:
            _emit({"status": "chapter_done", "chapter": chapter.number,
                   "chapter_id": chapter.number,
                   "title": chapter.title, "pages_saved": total})
        if progress_cb:
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, total, total, status="done"))
        return ch_dir

    completed    = total - len(missing)
    done_lock    = threading.Lock()
    hashes: Dict[str, str] = _load_manifest(ch_dir).get("hashes", {}) if verify else {}
    _rate_lim_until = [0.0]

    def _on_rate_limited(wait_secs: int):
        _rate_lim_until[0] = time.time() + wait_secs
        if progress_cb:
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, completed, total,
                status=f"rate_limited:{wait_secs}",
            ))
        if json_progress:
            _emit({"status": "rate_limited", "chapter": chapter.number,
                   "chapter_id": chapter.number, "wait_seconds": wait_secs})

    def _dl_one(args):
        nonlocal completed
        idx, url, dest, expected_hash = args
        fname = dest.name
        ok = _download_image(url, dest, headers, quality, _on_rate_limited, expected_hash)
        if ok and verify:
            hashes[fname] = _sha256_file(dest)
        with done_lock:
            completed += 1
            done = completed
        if json_progress:
            _emit({"status": "progress", "chapter": chapter.number,
                   "chapter_id": chapter.number,
                   "page": done, "total_pages": total,
                   "percent": round(done / total * 100)})
        if progress_cb and _rate_lim_until[0] < time.time():
            progress_cb(ChapterProgress(chapter.number, chapter.title, done, total))

    concurrency = config.get("image_concurrency", 4)
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(_dl_one, args) for args in missing]
        for fut in as_completed(futures):
            fut.result()

    _finalize_chapter(ch_dir, image_urls, chapter, verify, hashes)

    if json_progress:
        _emit({"status": "chapter_done", "chapter": chapter.number,
               "chapter_id": chapter.number,
               "title": chapter.title, "pages_saved": total})
    if progress_cb:
        progress_cb(ChapterProgress(
            chapter.number, chapter.title, total, total, status="done"))

    return ch_dir


def _finalize_chapter(ch_dir, image_urls, chapter, verify, hashes=None):
    """Write sentinel and optionally update manifest."""
    total = len(image_urls)
    (ch_dir / _SENTINEL).write_text(
        json.dumps({"pages": total, "timestamp": time.time()}))
    if verify and hashes is not None:
        _save_manifest(ch_dir, hashes, total)


# ─────────────────────────────────────────────────────────────────────
#  Series download
# ─────────────────────────────────────────────────────────────────────

def download_series(
    parser:            SiteParser,
    url:               str,
    chapter_range:     Optional[tuple]     = None,
    specific_chapters: Optional[List[int]] = None,
    json_progress:     bool                = False,
    progress_cb:       Optional[ProgressCallback] = None,
) -> Path:
    """
    Download a full series or filtered subset.

    Chapters are downloaded **concurrently** (max_concurrent_chapters workers).
    Images within each chapter use their own image thread pool.
    A global token-bucket rate limiter keeps total request rate sane.
    A file-based lock prevents two processes from hitting the same series.
    """
    _reset_bucket()

    if json_progress:
        _emit({"status": "fetching_info", "url": url})

    # ── Metadata cache ────────────────────────────────────────────────
    # Try to re-use cached series info rather than fetching from network.
    series_info = _try_load_cached_series_info(url)
    if series_info is None:
        series_info = parser.get_series_info(url)

    if json_progress:
        _emit({"status": "series_info",
               "title": series_info.title, "author": series_info.author})

    safe_title = _sanitize(series_info.title)
    series_dir = config.ensure_download_dir() / safe_title
    series_dir.mkdir(parents=True, exist_ok=True)

    lock = SeriesLock(safe_title)
    if not lock.acquire():
        msg = (
            f"Series '{series_info.title}' is already being downloaded "
            f"by another stripdl process.  Lock: {lock._path}"
        )
        if json_progress:
            _emit({"status": "error", "message": msg})
        else:
            raise RuntimeError(msg)
        return series_dir

    try:
        return _do_download(
            parser=parser, url=url,
            series_info=series_info, series_dir=series_dir,
            chapter_range=chapter_range, specific_chapters=specific_chapters,
            json_progress=json_progress, progress_cb=progress_cb,
        )
    finally:
        lock.release()


# ── Metadata cache helpers ─────────────────────────────────────────────

def _try_load_cached_series_info(url: str) -> Optional[SeriesInfo]:
    """
    Return cached SeriesInfo if a local metadata.json exists and is fresh.
    Returns None if cache is missing, stale, or disabled.
    """
    ttl_days = config.get("cache_ttl_days", 7)
    if ttl_days <= 0:
        return None

    # Derive safe_title by extracting from URL (best-effort)
    # We need the download_dir to find the metadata file, but we don't know
    # the title yet.  Strategy: scan download_dir for metadata.json files
    # whose "url" field matches.
    root = config.download_dir
    if not root.exists():
        return None

    ttl_secs = ttl_days * 86400
    now = time.time()

    for series_dir in root.iterdir():
        if not series_dir.is_dir():
            continue
        meta_path = series_dir / "metadata.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            continue
        # Match on URL
        if meta.get("url", "") != url and not url.startswith(meta.get("url", "!!!")):
            continue
        last_fetched = meta.get("last_fetched", 0)
        if now - last_fetched > ttl_secs:
            return None   # stale
        from strip.parsers.base import SeriesInfo as SI
        return SI(
            title=meta.get("title", ""),
            author=meta.get("author", ""),
            description=meta.get("description", ""),
            cover_url=meta.get("cover_url", ""),
            url=meta.get("url", url),
            genre=meta.get("genre", ""),
            status=meta.get("status", ""),
        )
    return None


def _do_download(
    parser, url, series_info, series_dir,
    chapter_range, specific_chapters,
    json_progress, progress_cb,
):
    verify = config.get("verify_integrity", False)

    # Write / refresh series metadata (including last_fetched timestamp)
    meta_out = {
        "title":        series_info.title,
        "author":       series_info.author,
        "description":  series_info.description,
        "cover_url":    series_info.cover_url,
        "url":          series_info.url,
        "genre":        series_info.genre,
        "status":       series_info.status,
        "last_fetched": time.time(),
    }
    with open(series_dir / "metadata.json", "w") as f:
        json.dump(meta_out, f, indent=2, ensure_ascii=False)

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

    # Emit skipped chapters immediately; build to_download list
    to_download: List[ChapterInfo] = []
    for chapter in chapters:
        ch_dir   = series_dir / f"{int(chapter.number):03d}"
        sentinel = ch_dir / _SENTINEL
        if sentinel.exists() and not config.get("overwrite", False):
            existing = len(list(ch_dir.glob("*.jpg")))
            if json_progress:
                _emit({"status": "skipped", "chapter": chapter.number,
                       "chapter_id": chapter.number, "reason": "already_downloaded"})
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

    max_ch = max(1, config.get("max_concurrent_chapters", 3))

    with ThreadPoolExecutor(max_workers=max_ch) as pool:
        future_to_ch = {
            pool.submit(
                download_chapter,
                parser=parser,
                chapter=chapter,
                series_dir=series_dir,
                quality=config.get("image_quality", 85),
                json_progress=json_progress,
                progress_cb=progress_cb,
                verify=verify,
            ): chapter
            for chapter in to_download
        }

        for fut in as_completed(future_to_ch):
            chapter = future_to_ch[fut]
            try:
                fut.result()
            except Exception as e:
                if json_progress:
                    _emit({"status": "error", "chapter": chapter.number,
                           "chapter_id": chapter.number, "message": str(e)})
                if progress_cb:
                    progress_cb(ChapterProgress(
                        chapter.number, chapter.title, 0, 0, status="error"))

    if json_progress:
        _emit({"status": "done", "series": series_info.title,
               "directory": str(series_dir)})

    return series_dir
