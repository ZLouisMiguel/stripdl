# strip/library.py
# Scans the download directory and returns a structured view of what's locally available.

import json
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

        # Scan chapters (subdirs with 3-digit names)
        chapters: List[LocalChapter] = []
        for ch_dir in sorted(series_dir.iterdir()):
            if not ch_dir.is_dir():
                continue
            if not ch_dir.name.isdigit():
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
                    number=ch_meta.get("number", float(ch_dir.name)),
                    title=ch_meta.get("title", f"Chapter {ch_dir.name}"),
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
