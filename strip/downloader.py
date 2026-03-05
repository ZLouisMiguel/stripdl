# strip/downloader.py
# Orchestrates downloading a series or individual chapters.
#
# Two execution modes:
#   - CLI mode   : passes a RichProgress callback so the CLI can render a live display
#   - Electron mode (--json-progress): emits JSON lines to stdout for the Electron subprocess
#
# Concurrency model:
#   - Images within a chapter   → ThreadPoolExecutor (concurrent_downloads workers)
#   - Chapters within a series  → ThreadPoolExecutor (concurrent_chapters workers)
#   Both pools run simultaneously — we're downloading pages from chapter N+1 while
#   chapter N is still finishing its tail images.

import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
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
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
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
    status: str = "downloading"   # "downloading" | "done" | "skipped" | "error"


ProgressCallback = Callable[[ChapterProgress], None]


# ─────────────────────────────────────────────────────────────────────
#  Image download
# ─────────────────────────────────────────────────────────────────────

def _download_image(url: str, dest: Path, headers: dict, quality: int = 85) -> bool:
    if dest.exists():
        return True
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGB")
        img.save(dest, "JPEG", quality=quality, optimize=True)
        return True
    except Exception:
        return False


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

    with open(ch_dir / "metadata.json", "w") as f:
        json.dump({"number": chapter.number, "title": chapter.title,
                   "url": chapter.url, "date": chapter.date}, f, indent=2)

    image_urls = parser.get_chapter_images(chapter.url)
    headers = parser.get_image_headers()
    total = len(image_urls)

    if json_progress:
        _emit({"status": "chapter_start", "chapter": chapter.number,
               "title": chapter.title, "total_pages": total})
    if progress_cb:
        progress_cb(ChapterProgress(chapter.number, chapter.title, 0, total))

    completed = 0
    lock = threading.Lock()

    def _dl_one(args):
        nonlocal completed
        idx, url = args
        dest = ch_dir / f"{int(chapter.number):03d}_{idx:03d}.jpg"
        _download_image(url, dest, headers, quality)
        with lock:
            completed += 1
            done = completed
        if json_progress:
            _emit({"status": "progress", "chapter": chapter.number,
                   "page": done, "total_pages": total,
                   "percent": round(done / total * 100)})
        if progress_cb:
            progress_cb(ChapterProgress(chapter.number, chapter.title, done, total))

    concurrency = config.get("concurrent_downloads", 4)
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(_dl_one, enumerate(image_urls, start=1)))

    if json_progress:
        _emit({"status": "chapter_done", "chapter": chapter.number,
               "title": chapter.title, "pages_saved": total})
    if progress_cb:
        progress_cb(ChapterProgress(chapter.number, chapter.title, total, total, status="done"))

    return ch_dir


# ─────────────────────────────────────────────────────────────────────
#  Cover
# ─────────────────────────────────────────────────────────────────────

def _download_cover(cover_url: str, series_dir: Path, headers: dict):
    if not cover_url:
        return
    dest = series_dir / "cover.jpg"
    if dest.exists():
        return
    try:
        resp = requests.get(cover_url, headers=headers, timeout=20)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGB")
        img.save(dest, "JPEG", quality=90, optimize=True)
    except Exception:
        pass


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

    Chapters are downloaded concurrently (concurrent_chapters workers, default 3).
    Each chapter also downloads its images concurrently (concurrent_downloads workers).
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

    with open(series_dir / "metadata.json", "w") as f:
        json.dump({"title": series_info.title, "author": series_info.author,
                   "description": series_info.description, "cover_url": series_info.cover_url,
                   "url": series_info.url, "genre": series_info.genre,
                   "status": series_info.status}, f, indent=2, ensure_ascii=False)

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

    # Separate already-downloaded from pending
    to_download: List[ChapterInfo] = []
    for chapter in chapters:
        ch_dir = series_dir / f"{int(chapter.number):03d}"
        if ch_dir.exists() and not config.get("overwrite", False):
            existing = list(ch_dir.glob("*.jpg"))
            if existing:
                if json_progress:
                    _emit({"status": "skipped", "chapter": chapter.number,
                           "reason": "already_downloaded"})
                if progress_cb:
                    progress_cb(ChapterProgress(
                        chapter.number, chapter.title,
                        len(existing), len(existing), status="skipped"))
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

    # Concurrent chapter downloads
    # Keep concurrent_chapters low (2-4): each chapter already parallelises
    # its page downloads, so we don't want to overwhelm the CDN.
    concurrent_chapters = config.get("concurrent_chapters", 3)
    completed_chapters = 0
    total_to_download = len(to_download)
    ch_lock = threading.Lock()

    def _dl_chapter(chapter: ChapterInfo):
        nonlocal completed_chapters
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
                _emit({"status": "error", "chapter": chapter.number, "message": str(e)})
        finally:
            with ch_lock:
                completed_chapters += 1
                done = completed_chapters
            if json_progress:
                _emit({"status": "chapter_progress",
                       "current": done, "total": total_to_download,
                       "chapter_number": chapter.number, "chapter_title": chapter.title})

    with ThreadPoolExecutor(max_workers=concurrent_chapters) as pool:
        list(pool.map(_dl_chapter, to_download))

    if json_progress:
        _emit({"status": "done", "series": series_info.title,
               "directory": str(series_dir)})

    return series_dir