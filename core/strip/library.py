# strip/library.py
# Scans the download directory and returns a structured view of what's locally available.

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from strip.config import config


@dataclass
class LocalChapter:
    number: float
    title: str
    directory: Path
    page_count: int
    metadata: dict = field(default_factory=dict)

    @property
    def is_complete(self) -> bool:
        """Heuristic: at least one image present."""
        return self.page_count > 0


@dataclass
class LocalSeries:
    title: str
    author: str
    directory: Path
    cover_path: Optional[Path]
    chapters: List[LocalChapter]
    metadata: dict = field(default_factory=dict)

    @property
    def chapter_count(self) -> int:
        return len(self.chapters)


# Matches chapter directory names produced by downloader._chapter_dirname():
#   "012"   -> whole chapter 12
#   "012_5" -> half chapter 12.5
_CHAPTER_DIR_RE = re.compile(r"^(\d+)(?:_(\d))?$")


def _number_from_dirname(name: str) -> Optional[float]:
    """
    Parse a chapter number back out of a directory name produced by
    downloader._chapter_dirname(), e.g. "012" -> 12.0, "012_5" -> 12.5.
    Returns None if *name* doesn't match the expected pattern (i.e. it's
    not a chapter directory at all).

    This replaces a plain `name.isdigit()` check, which stopped matching
    half-chapter folders once downloader.py started distinguishing "012"
    from "012_5" instead of silently colliding them.
    """
    m = _CHAPTER_DIR_RE.match(name)
    if not m:
        return None
    whole = int(m.group(1))
    tenths = int(m.group(2)) if m.group(2) else 0
    return whole + tenths / 10


def scan_library(download_dir: Optional[Path] = None) -> List[LocalSeries]:
    """
    Walk *download_dir* and return a list of LocalSeries objects.
    Each subdirectory that contains a metadata.json is treated as a series.
    """
    root = download_dir or config.download_dir
    if not root.exists():
        return []

    series_list: List[LocalSeries] = []

    for series_dir in sorted(root.iterdir()):
        if not series_dir.is_dir():
            continue

        meta_file = series_dir / "metadata.json"
        if not meta_file.exists():
            continue

        try:
            with open(meta_file) as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            meta = {}

        cover = series_dir / "cover.jpg"

        # Scan chapters (subdirs matching the chapter-directory naming scheme)
        chapters: List[LocalChapter] = []
        for ch_dir in sorted(series_dir.iterdir()):
            if not ch_dir.is_dir():
                continue
            dirname_number = _number_from_dirname(ch_dir.name)
            if dirname_number is None:
                continue

            ch_meta_file = ch_dir / "metadata.json"
            ch_meta = {}
            if ch_meta_file.exists():
                try:
                    with open(ch_meta_file) as f:
                        ch_meta = json.load(f)
                except Exception:
                    pass

            page_count = len(list(ch_dir.glob("*.jpg")))
            chapters.append(
                LocalChapter(
                    number=ch_meta.get("number", dirname_number),
                    title=ch_meta.get("title", f"Chapter {dirname_number:g}"),
                    directory=ch_dir,
                    page_count=page_count,
                    metadata=ch_meta,
                )
            )

        series_list.append(
            LocalSeries(
                title=meta.get("title", series_dir.name),
                author=meta.get("author", ""),
                directory=series_dir,
                cover_path=cover if cover.exists() else None,
                chapters=chapters,
                metadata=meta,
            )
        )

    return series_list


def get_series(title_or_dir: str) -> Optional[LocalSeries]:
    """Look up a series by title (case-insensitive substring) or exact directory name."""
    for series in scan_library():
        if (
            title_or_dir.lower() in series.title.lower()
            or series.directory.name == title_or_dir
        ):
            return series
    return None