# strip/config.py
# Manages user configuration stored in ~/.strip/config.json

import json
import os
from pathlib import Path
from typing import Any


_CONFIG_DIR = Path.home() / ".strip"
_CONFIG_FILE = _CONFIG_DIR / "config.json"

_DEFAULTS: dict = {
    # Where to save downloaded comics
    "download_dir": str(Path.home() / "strip-data"),
    # Image quality for JPEG conversion (1-95)
    "image_quality": 85,
    # Maximum concurrent image downloads per chapter
    # (keep moderate – too high triggers CDN rate-limits)
    "concurrent_downloads": 4,
    # Seconds to wait between chapters – polite crawling and rate-limit avoidance.
    # Increase if you encounter frequent 429 responses.
    "chapter_delay": 1.5,
    # Whether to overwrite already-downloaded chapters
    # (false = resume / skip completed chapters)
    "overwrite": False,
    # Theme preference for Electron app ("light" | "dark" | "system")
    "theme": "system",
}


class Config:
    """
    Thin wrapper around a JSON config file.
    Access like a dict: cfg["download_dir"]
    """

    def __init__(self):
        self._data: dict = {}
        self._load()

    def _load(self):
        if _CONFIG_FILE.exists():
            try:
                with open(_CONFIG_FILE) as f:
                    self._data = json.load(f)
            except json.JSONDecodeError:
                self._data = {}
        for k, v in _DEFAULTS.items():
            self._data.setdefault(k, v)

    def save(self):
        _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(_CONFIG_FILE, "w") as f:
            json.dump(self._data, f, indent=2)

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __setitem__(self, key: str, value: Any):
        self._data[key] = value

    def get(self, key: str, default=None) -> Any:
        return self._data.get(key, default)

    def all(self) -> dict:
        return dict(self._data)

    @property
    def download_dir(self) -> Path:
        return Path(self._data["download_dir"])

    def ensure_download_dir(self) -> Path:
        p = self.download_dir
        p.mkdir(parents=True, exist_ok=True)
        return p


config = Config()