# strip/downloader.py  — patched
#
# What changed and why:
#
#   PROBLEM: _do_download() called parser.get_chapter_list() which blocked
#            until every chapter-list page was fetched before a single
#            download could start.  The CLI also pre-fetched the same list
#            in _fetch_chapters_live, so every page was fetched twice.
#
#   FIX: _do_download() now runs a background "fetcher" thread that calls
#        parser.iter_chapter_list() and pushes each ChapterInfo into a
#        queue.Queue as it arrives.  A ThreadPoolExecutor pulls from the
#        queue and starts download_chapter() immediately — chapter 1 starts
#        downloading while pages 2, 3, 4 … of the chapter list are still
#        being fetched.  The chapter list is fetched exactly ONCE.
#
#   PROBLEM: download_series() was called by the CLI *after* the CLI already
#            fetched the full list, meaning two full scans per run.
#   FIX: The CLI's download command now calls download_series() directly
#        without pre-fetching, relying on progress callbacks that fire for
#        each discovered chapter (status="chapter_found") and when discovery
#        is complete (status="fetch_done").  cli.py updated accordingly.
#
#   PROBLEM: Image downloads used bare requests.get() — no connection-level
#            retry.  One dropped TCP connection = permanent failure.
#   FIX: A dedicated _img_session with HTTPAdapter(Retry(...)) is used for
#        all image and cover downloads.

import hashlib
import json
import os
import queue
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional
from io import BytesIO

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
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
    print(json.dumps(obj), flush=True)


# ─────────────────────────────────────────────────────────────────────
#  Dedicated image-download session  (CDN, separate from parser session)
# ─────────────────────────────────────────────────────────────────────

_img_retry = Retry(
    total=5,
    connect=3,
    read=3,
    backoff_factor=1,
    status_forcelist={429, 500, 502, 503, 504},
    raise_on_status=False,
    respect_retry_after_header=True,
)
_img_session = requests.Session()
_img_session.mount("https://", HTTPAdapter(max_retries=_img_retry))
_img_session.mount("http://",  HTTPAdapter(max_retries=_img_retry))


# ─────────────────────────────────────────────────────────────────────
#  Token-bucket rate limiter  (CDN image downloads only)
# ─────────────────────────────────────────────────────────────────────

class TokenBucket:
    def __init__(self, rate: float):
        self._rate   = rate
        self._tokens = float(rate)
        self._last   = time.monotonic()
        self._lock   = threading.Lock()

    def acquire(self, tokens: float = 1.0):
        if self._rate <= 0:
            return
        with self._lock:
            now = time.monotonic()
            self._tokens = min(self._rate,
                               self._tokens + (now - self._last) * self._rate)
            self._last = now
            if self._tokens >= tokens:
                self._tokens -= tokens
                return
            deficit = tokens - self._tokens
            wait = deficit / self._rate
            self._tokens = 0
            self._last = now + wait
        time.sleep(wait)

    def penalize(self, seconds: float):
        with self._lock:
            self._tokens = max(0.0, self._tokens - seconds * self._rate)


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
#  Progress callback
# ─────────────────────────────────────────────────────────────────────

@dataclass
class ChapterProgress:
    chapter_number: float
    chapter_title:  str
    pages_done:     int
    pages_total:    int
    status: str = "downloading"
    # status values used by the CLI / Electron:
    #   "downloading"    — normal image-download tick
    #   "done"           — chapter finished
    #   "skipped"        — already downloaded
    #   "error"          — download failed
    #   "rate_limited:N" — waiting N seconds
    #   "chapter_found"  — discovery: a new chapter arrived from the list fetcher
    #                      pages_done = running discovery count so far
    #   "fetch_done"     — all chapter-list pages have been fetched
    #                      pages_done = total chapters discovered

    @property
    def chapter_id(self) -> float:
        return self.chapter_number


ProgressCallback = Callable[[ChapterProgress], None]


# ─────────────────────────────────────────────────────────────────────
#  Per-series file lock
# ─────────────────────────────────────────────────────────────────────

_LOCK_DIR = Path.home() / ".strip" / "locks"


class SeriesLock:
    def __init__(self, safe_title: str):
        _LOCK_DIR.mkdir(parents=True, exist_ok=True)
        self._path     = _LOCK_DIR / f"{safe_title}.lock"
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
                f"Lock: {self._path}")
        return self

    def __exit__(self, *_):
        self.release()


# ─────────────────────────────────────────────────────────────────────
#  Image download
# ─────────────────────────────────────────────────────────────────────

_RETRY_STATUSES  = {429, 503, 502, 500}
_MAX_IMG_RETRIES = 4


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _download_image(url, dest, headers, quality=85,
                    rate_limited_cb=None, expected_hash=None) -> bool:
    bucket = _get_bucket()

    if dest.exists() and dest.stat().st_size > 0:
        if expected_hash is None:
            return True
        if _sha256_file(dest) == expected_hash:
            return True
        dest.unlink(missing_ok=True)

    delay = 2.0
    for attempt in range(_MAX_IMG_RETRIES):
        try:
            bucket.acquire()
            resp = _img_session.get(url, headers=headers, timeout=(10, 45))

            if resp.status_code in _RETRY_STATUSES:
                raw = resp.headers.get("Retry-After")
                try:
                    wait = float(raw) if raw else delay * (2 ** attempt)
                except (ValueError, TypeError):
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


def _load_manifest(ch_dir: Path) -> dict:
    m = ch_dir / _MANIFEST
    if m.exists():
        try:
            return json.loads(m.read_text())
        except Exception:
            pass
    return {}


def _save_manifest(ch_dir, hashes, total_pages):
    (ch_dir / _MANIFEST).write_text(json.dumps(
        {"pages": total_pages, "hashes": hashes, "timestamp": time.time()}))


def _chapter_is_complete(ch_dir: Path, expected_pages: int) -> bool:
    if not (ch_dir / _SENTINEL).exists():
        return False
    return len(list(ch_dir.glob("*.jpg"))) >= expected_pages


def _missing_images(ch_dir, image_urls, chapter, verify):
    manifest = _load_manifest(ch_dir) if verify else {}
    missing = []
    for i, url in enumerate(image_urls, start=1):
        fname = f"{int(chapter.number):03d}_{i:03d}.jpg"
        dest  = ch_dir / fname
        expected_hash = manifest.get("hashes", {}).get(fname) if verify else None
        if dest.exists() and dest.stat().st_size > 0:
            if not verify:
                continue
            if expected_hash and _sha256_file(dest) == expected_hash:
                continue
        missing.append((i, url, dest, expected_hash))
    return missing


# ─────────────────────────────────────────────────────────────────────
#  Cover download
# ─────────────────────────────────────────────────────────────────────

def _download_cover(cover_url, series_dir, headers):
    if not cover_url:
        return
    dest = series_dir / "cover.jpg"
    if dest.exists() and dest.stat().st_size > 0:
        return
    try:
        resp = _img_session.get(cover_url, headers=headers, timeout=(10, 30))
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGB")
        img.save(dest, "JPEG", quality=90, optimize=True)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────
#  Chapter download
# ─────────────────────────────────────────────────────────────────────

def download_chapter(
    parser, chapter, series_dir, quality=85,
    json_progress=False, progress_cb=None, verify=False,
) -> Path:
    ch_dir = series_dir / f"{int(chapter.number):03d}"
    ch_dir.mkdir(parents=True, exist_ok=True)

    with open(ch_dir / "metadata.json", "w") as f:
        json.dump({"number": chapter.number, "title": chapter.title,
                   "url": chapter.url, "date": chapter.date}, f, indent=2)

    image_urls = parser.get_chapter_images(chapter.url)
    headers    = parser.get_image_headers()
    total      = len(image_urls)

    if _chapter_is_complete(ch_dir, total):
        if json_progress:
            _emit({"status": "skipped", "chapter": chapter.number,
                   "chapter_id": chapter.number, "reason": "already_downloaded"})
        if progress_cb:
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, total, total, status="skipped"))
        return ch_dir

    missing = _missing_images(ch_dir, image_urls, chapter, verify)

    if json_progress:
        _emit({"status": "chapter_start", "chapter": chapter.number,
               "chapter_id": chapter.number, "title": chapter.title,
               "total_pages": total, "to_download": len(missing)})
    if progress_cb:
        progress_cb(ChapterProgress(
            chapter.number, chapter.title, total - len(missing), total))

    if not missing:
        _finalize_chapter(ch_dir, total, verify)
        if json_progress:
            _emit({"status": "chapter_done", "chapter": chapter.number,
                   "chapter_id": chapter.number,
                   "title": chapter.title, "pages_saved": total})
        if progress_cb:
            progress_cb(ChapterProgress(
                chapter.number, chapter.title, total, total, status="done"))
        return ch_dir

    completed = total - len(missing)
    done_lock = threading.Lock()
    hashes: Dict[str, str] = _load_manifest(ch_dir).get("hashes", {}) if verify else {}
    _rl_until = [0.0]

    def _on_rate_limited(wait_secs):
        _rl_until[0] = time.time() + wait_secs
        if progress_cb:
            progress_cb(ChapterProgress(chapter.number, chapter.title,
                                        completed, total,
                                        status=f"rate_limited:{wait_secs}"))
        if json_progress:
            _emit({"status": "rate_limited", "chapter": chapter.number,
                   "chapter_id": chapter.number, "wait_seconds": wait_secs})

    def _dl_one(args):
        nonlocal completed
        _, url, dest, expected_hash = args
        ok = _download_image(url, dest, headers, quality,
                             _on_rate_limited, expected_hash)
        if ok and verify:
            hashes[dest.name] = _sha256_file(dest)
        with done_lock:
            completed += 1
            done = completed
        if json_progress:
            _emit({"status": "progress", "chapter": chapter.number,
                   "chapter_id": chapter.number,
                   "page": done, "total_pages": total,
                   "percent": round(done / total * 100)})
        if progress_cb and _rl_until[0] < time.time():
            progress_cb(ChapterProgress(chapter.number, chapter.title, done, total))

    concurrency = config.get("image_concurrency", 4)
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for fut in as_completed([pool.submit(_dl_one, a) for a in missing]):
            fut.result()

    _finalize_chapter(ch_dir, total, verify, hashes)

    if json_progress:
        _emit({"status": "chapter_done", "chapter": chapter.number,
               "chapter_id": chapter.number,
               "title": chapter.title, "pages_saved": total})
    if progress_cb:
        progress_cb(ChapterProgress(
            chapter.number, chapter.title, total, total, status="done"))
    return ch_dir


def _finalize_chapter(ch_dir, total, verify, hashes=None):
    (ch_dir / _SENTINEL).write_text(
        json.dumps({"pages": total, "timestamp": time.time()}))
    if verify and hashes:
        _save_manifest(ch_dir, hashes, total)


# ─────────────────────────────────────────────────────────────────────
#  Series download  —  pipelined: fetch + download run concurrently
# ─────────────────────────────────────────────────────────────────────

def download_series(
    parser,
    url:               str,
    chapter_range:     Optional[tuple]     = None,
    specific_chapters: Optional[List[int]] = None,
    json_progress:     bool                = False,
    progress_cb:       Optional[ProgressCallback] = None,
) -> Path:
    """
    Download a full series or filtered subset.

    The chapter-list fetcher runs on a background thread and pushes
    ChapterInfo objects into a queue as each page arrives.  The download
    thread pool reads from that queue and starts work immediately.
    Chapter 1 begins downloading as soon as the first list page is done —
    no waiting for the entire chapter list to finish.

    The chapter list is fetched exactly ONCE, even when called from the CLI.
    """
    _reset_bucket()

    if json_progress:
        _emit({"status": "fetching_info", "url": url})

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
        msg = (f"Series '{series_info.title}' is already being downloaded "
               f"by another stripdl process.  Lock: {lock._path}")
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


# ── Metadata cache ─────────────────────────────────────────────────────────────

def _try_load_cached_series_info(url: str) -> Optional[SeriesInfo]:
    ttl_days = config.get("cache_ttl_days", 7)
    if ttl_days <= 0:
        return None
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
        if meta.get("url", "") != url:
            continue
        if now - meta.get("last_fetched", 0) > ttl_secs:
            return None
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


# ── Pipeline implementation ────────────────────────────────────────────────────

def _passes_filter(ch, chapter_range, specific_chapters) -> bool:
    if specific_chapters:
        return int(ch.number) in specific_chapters
    if chapter_range:
        s, e = chapter_range
        return s <= ch.number <= e
    return True


def _do_download(parser, url, series_info, series_dir,
                 chapter_range, specific_chapters, json_progress, progress_cb):
    verify = config.get("verify_integrity", False)

    # Write / refresh series metadata
    with open(series_dir / "metadata.json", "w") as f:
        json.dump({
            "title": series_info.title, "author": series_info.author,
            "description": series_info.description, "cover_url": series_info.cover_url,
            "url": series_info.url, "genre": series_info.genre,
            "status": series_info.status, "last_fetched": time.time(),
        }, f, indent=2, ensure_ascii=False)

    _download_cover(series_info.cover_url, series_dir, parser.get_image_headers())

    if json_progress:
        _emit({"status": "fetching_chapters"})

    # ── Background fetcher → queue → download pool ────────────────────────────
    #
    # The fetcher thread calls iter_chapter_list() (which yields one page at a
    # time) and puts each ChapterInfo onto ch_queue.  The main thread reads from
    # ch_queue and submits download tasks immediately.  Downloads start as soon
    # as the first page of chapter metadata arrives — no waiting for the full
    # list to finish.

    ch_queue    = queue.Queue(maxsize=500)
    fetch_error = [None]
    total_found = [0]

    def _fetcher():
        try:
            # Use iter_chapter_list if the parser supports it (WebtoonsParser does);
            # fall back to get_chapter_list wrapped as a generator for others.
            if hasattr(parser, "iter_chapter_list"):
                source = parser.iter_chapter_list(url)
            else:
                source = iter(parser.get_chapter_list(url))

            for ch in source:
                total_found[0] += 1
                if json_progress:
                    _emit({"status": "chapter_found", "chapter": ch.number,
                           "title": ch.title, "count": total_found[0]})
                if progress_cb:
                    progress_cb(ChapterProgress(
                        ch.number, ch.title, total_found[0], 0,
                        status="chapter_found"))
                ch_queue.put(ch)
        except Exception as exc:
            fetch_error[0] = exc
        finally:
            ch_queue.put(None)   # sentinel — always sent

    threading.Thread(target=_fetcher, daemon=True, name="chapter-fetcher").start()

    max_ch = max(1, config.get("max_concurrent_chapters", 3))
    submitted: Dict = {}

    with ThreadPoolExecutor(max_workers=max_ch) as pool:
        while True:
            try:
                ch = ch_queue.get(timeout=120)
            except queue.Empty:
                fetch_error[0] = fetch_error[0] or TimeoutError(
                    "Chapter list fetch stalled for 120 s with no new chapters.")
                break

            if ch is None:
                break  # fetcher finished

            if not _passes_filter(ch, chapter_range, specific_chapters):
                continue

            ch_dir   = series_dir / f"{int(ch.number):03d}"
            sentinel = ch_dir / _SENTINEL
            if sentinel.exists() and not config.get("overwrite", False):
                existing = len(list(ch_dir.glob("*.jpg")))
                if json_progress:
                    _emit({"status": "skipped", "chapter": ch.number,
                           "chapter_id": ch.number, "reason": "already_downloaded"})
                if progress_cb:
                    progress_cb(ChapterProgress(
                        ch.number, ch.title, existing, existing, status="skipped"))
                continue

            fut = pool.submit(
                download_chapter,
                parser=parser, chapter=ch, series_dir=series_dir,
                quality=config.get("image_quality", 85),
                json_progress=json_progress, progress_cb=progress_cb,
                verify=verify,
            )
            submitted[fut] = ch

        # Fetcher is done; wait for all remaining downloads
        for fut in as_completed(submitted):
            ch = submitted[fut]
            try:
                fut.result()
            except Exception as exc:
                if json_progress:
                    _emit({"status": "error", "chapter": ch.number,
                           "chapter_id": ch.number, "message": str(exc)})
                if progress_cb:
                    progress_cb(ChapterProgress(
                        ch.number, ch.title, 0, 0, status="error"))

    # Notify that chapter-list discovery is complete
    if progress_cb:
        progress_cb(ChapterProgress(
            0, "", total_found[0], total_found[0], status="fetch_done"))

    if fetch_error[0]:
        if json_progress:
            _emit({"status": "error",
                   "message": f"Chapter list error: {fetch_error[0]}"})
        # Don't abort — partial download is still saved

    if json_progress:
        _emit({"status": "chapter_list", "total": total_found[0]})
        _emit({"status": "done", "series": series_info.title,
               "directory": str(series_dir)})

    return series_dir
