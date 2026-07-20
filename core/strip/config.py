# strip/config.py
# Manages user configuration stored in ~/.strip/config.json

import json
import os
from pathlib import Path
from typing import Any


_CONFIG_DIR  = Path.home() / ".strip"
_CONFIG_FILE = _CONFIG_DIR / "config.json"

_DEFAULTS: dict = {
    # ── Download location ─────────────────────────────────────────
    "download_dir": str(Path.home() / "strip-data"),

    # ── Concurrency ───────────────────────────────────────────────
    # Chapters downloaded in parallel within a single series download.
    "max_concurrent_chapters": 3,
    # Images downloaded in parallel within a single chapter.
    "image_concurrency": 4,
    # Maximum simultaneous series download jobs (Electron queue).
    "max_concurrent_jobs": 2,

    # ── Rate limiting ─────────────────────────────────────────────
    # Target requests per second across ALL download threads combined.
    # A token-bucket enforces this globally. Set to 0 to disable.
    "rate_limit": 8.0,
    # Seconds to wait between chapters when NOT using concurrent mode
    # (kept for backward compat; ignored when max_concurrent_chapters > 1).
    "chapter_delay": 0.0,

    # ── Image quality ─────────────────────────────────────────────
    "image_quality": 85,

    # ── Resume / integrity ────────────────────────────────────────
    "overwrite": False,
    # When true, compute SHA-256 of each downloaded image and store in
    # chapter manifest.json. On resume, re-download if hash mismatches.
    "verify_integrity": False,

    # ── Metadata cache ────────────────────────────────────────────
    # Re-use cached series metadata (title, author, etc.) if younger
    # than this many days.  Set to 0 to always re-fetch.
    "cache_ttl_days": 7,

    # ── Reader ────────────────────────────────────────────────────
    "lazy_loading": True,
    "preload_next_chapter": True,

    # ── Appearance ────────────────────────────────────────────────
    "theme": "system",
}


class Config:
    """Thin wrapper around a JSON config file.  Access like a dict."""

    def __init__(self):
        self._data: dict = {}
        self._load()

    # ------------------------------------------------------------------ I/O

    def _load(self):
        if _CONFIG_FILE.exists():
            try:
                with open(_CONFIG_FILE) as f:
                    self._data = json.load(f)
            except (json.JSONDecodeError, OSError):
                self._data = {}
        for k, v in _DEFAULTS.items():
            self._data.setdefault(k, v)

    def save(self):
        _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(_CONFIG_FILE, "w") as f:
            json.dump(self._data, f, indent=2)

    # ------------------------------------------------------------------ access

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __setitem__(self, key: str, value: Any):
        self._data[key] = value

    def get(self, key: str, default=None) -> Any:
        return self._data.get(key, default)

    def all(self) -> dict:
        return dict(self._data)

    # ------------------------------------------------------------------ helpers

    @property
    def download_dir(self) -> Path:
        return Path(self._data["download_dir"])

    def ensure_download_dir(self) -> Path:
        p = self.download_dir
        p.mkdir(parents=True, exist_ok=True)
        return p


# Module-level singleton
config = Config()
