# strip/downloader.py
# Orchestrates downloading a series or individual chapters.
# Emits JSON progress lines to stdout when --json-progress flag is set,
# so the Electron app can parse them as a child process.

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional, Callable

import requests
from PIL import Image
from io import BytesIO

from strip.config import config
from strip.parsers.base import SeriesInfo, ChapterInfo, SiteParser


# ------------------------------------------------------------------ sanitization

def _sanitize(name: str) -> str:
    """Make a string safe for use as a directory/file name."""
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = re.sub(r"\s+", "_", name.strip())
    return name[:100]  # cap length


# ------------------------------------------------------------------ JSON progress

def _emit(obj: dict):
    """Print a single JSON line to stdout. Electron reads these."""
    print(json.dumps(obj), flush=True)


# ------------------------------------------------------------------ image download

def _download_image(
    url: str,
    dest: Path,
    headers: dict,
    quality: int = 85,
) -> bool:
    """
    Download one image to *dest*.
    Converts to RGB JPEG at the configured quality.
    Returns True on success.
    """
    if dest.exists():
        return True  # already downloaded
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGB")
        img.save(dest, "JPEG", quality=quality, optimize=True)
        return True
    except Exception as e:
        _emit({"status": "error", "message": f"Failed to download {url}: {e}"})
        return False


# ------------------------------------------------------------------ chapter

def download_chapter(
    parser: SiteParser,
    chapter: ChapterInfo,
    series_dir: Path,
    quality: int = 85,
    overwrite: bool = False,
    progress_cb: Optional[Callable[[int, int], None]] = None,
    json_progress: bool = False,
) -> Path:
    """
    Download all images for a single chapter.

    Returns the chapter directory path.
    """
    # Folder name: zero-padded chapter number, e.g. "001" or "012"
    ch_num = int(chapter.number) if chapter.number == int(chapter.number) else chapter.number
    ch_dir_name = f"{int(chapter.number):03d}"
    ch_dir = series_dir / ch_dir_name
    ch_dir.mkdir(parents=True, exist_ok=True)

    # Write chapter metadata
    meta_path = ch_dir / "metadata.json"
    meta = {
        "number": chapter.number,
        "title": chapter.title,
        "url": chapter.url,
        "date": chapter.date,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    # Fetch image list
    image_urls = parser.get_chapter_images(chapter.url)
    headers = parser.get_image_headers()
    total = len(image_urls)

    if json_progress:
        _emit({
            "status": "chapter_start",
            "chapter": chapter.number,
            "title": chapter.title,
            "total_pages": total,
        })

    concurrency = config.get("concurrent_downloads", 4)
    completed = 0

    def _dl_one(args):
        idx, url = args
        page_num = f"{int(chapter.number):03d}_{idx:03d}"
        dest = ch_dir / f"{page_num}.jpg"
        ok = _download_image(url, dest, headers, quality)
        return ok

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(_dl_one, (i + 1, u)): i for i, u in enumerate(image_urls)}
        for future in as_completed(futures):
            completed += 1
            if json_progress:
                _emit({
                    "status": "progress",
                    "chapter": chapter.number,
                    "page": completed,
                    "total_pages": total,
                    "percent": round(completed / total * 100),
                })
            if progress_cb:
                progress_cb(completed, total)

    if json_progress:
        _emit({
            "status": "chapter_done",
            "chapter": chapter.number,
            "title": chapter.title,
            "pages_saved": total,
        })

    return ch_dir


# ------------------------------------------------------------------ series

def download_series(
    parser: SiteParser,
    url: str,
    chapter_range: Optional[tuple] = None,   # (start, end) inclusive, 1-based
    specific_chapters: Optional[List[int]] = None,
    json_progress: bool = False,
    console=None,   # rich Console, optional
) -> Path:
    """
    Full series download. Returns the series directory.

    *chapter_range*    – download chapters start..end (inclusive).
    *specific_chapters* – download only these chapter numbers.
    If neither is given, download everything.
    """
    # ---- series metadata
    if json_progress:
        _emit({"status": "fetching_info", "url": url})

    series_info = parser.get_series_info(url)

    if json_progress:
        _emit({"status": "series_info", "title": series_info.title, "author": series_info.author})
    elif console:
        console.print(f"[bold]{series_info.title}[/bold] by {series_info.author}")

    # ---- create series directory
    safe_title = _sanitize(series_info.title)
    series_dir = config.ensure_download_dir() / safe_title
    series_dir.mkdir(parents=True, exist_ok=True)

    # ---- save series metadata
    meta = {
        "title": series_info.title,
        "author": series_info.author,
        "description": series_info.description,
        "cover_url": series_info.cover_url,
        "url": series_info.url,
        "genre": series_info.genre,
        "status": series_info.status,
    }
    with open(series_dir / "metadata.json", "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    # ---- download cover
    _download_cover(series_info.cover_url, series_dir, parser.get_image_headers())

    # ---- chapter list
    if json_progress:
        _emit({"status": "fetching_chapters"})
    elif console:
        console.print("Fetching chapter list…")

    all_chapters = parser.get_chapter_list(url)
    total_chapters = len(all_chapters)

    if json_progress:
        _emit({"status": "chapter_list", "total": total_chapters})
    elif console:
        console.print(f"Found {total_chapters} chapters")

    # ---- filter chapters
    if specific_chapters:
        chapters = [c for c in all_chapters if int(c.number) in specific_chapters]
    elif chapter_range:
        start, end = chapter_range
        chapters = [c for c in all_chapters if start <= c.number <= end]
    else:
        chapters = all_chapters

    if not chapters:
        if json_progress:
            _emit({"status": "error", "message": "No chapters matched the given filter."})
        return series_dir

    if json_progress:
        _emit({"status": "downloading", "chapters_to_download": len(chapters)})

    # ---- download each chapter
    for i, chapter in enumerate(chapters, 1):
        if json_progress:
            _emit({
                "status": "chapter_progress",
                "current": i,
                "total": len(chapters),
                "chapter_number": chapter.number,
                "chapter_title": chapter.title,
            })

        # Check if already downloaded (and overwrite is off)
        ch_dir = series_dir / f"{int(chapter.number):03d}"
        if ch_dir.exists() and not config.get("overwrite", False):
            existing_images = list(ch_dir.glob("*.jpg"))
            if existing_images:
                if json_progress:
                    _emit({"status": "skipped", "chapter": chapter.number, "reason": "already_downloaded"})
                elif console:
                    console.print(f"  [dim]Chapter {chapter.number} – already downloaded, skipping[/dim]")
                continue

        download_chapter(
            parser=parser,
            chapter=chapter,
            series_dir=series_dir,
            quality=config.get("image_quality", 85),
            json_progress=json_progress,
        )

        # Be polite between chapters
        if i < len(chapters):
            time.sleep(config.get("chapter_delay", 1.0))

    if json_progress:
        _emit({"status": "done", "series": series_info.title, "directory": str(series_dir)})
    elif console:
        console.print(f"[green]✓[/green] Done! Saved to {series_dir}")

    return series_dir


# ------------------------------------------------------------------ helpers

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
        pass  # Missing cover is non-fatal
