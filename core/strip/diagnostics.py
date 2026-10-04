"""Shared diagnostics helpers for optional metadata and terminal output."""

import sys
from typing import Optional


def safe_terminal_text(value, encoding: Optional[str] = None) -> str:
    """Return text that is safe to write to a terminal stream.

    Metadata is preserved as-is in the downloader. This helper is only for
    presentation: C0/C1 control characters are removed and characters that
    the target terminal encoding cannot represent are replaced.
    """
    text = "" if value is None else str(value)
    text = "".join(
        char
        for char in text
        if char in "\t\n\r" or not (ord(char) < 0x20 or 0x7F <= ord(char) <= 0x9F)
    )
    target_encoding = encoding or getattr(sys.stdout, "encoding", None)
    if target_encoding:
        text = text.encode(target_encoding, errors="replace").decode(target_encoding)
    return text


def optional_metadata_warnings(series_info) -> list[str]:
    """Return user-facing warnings for optional metadata that is unavailable."""
    warnings = []
    if not str(getattr(series_info, "author", "") or "").strip():
        warnings.append("Author metadata is unavailable; continuing without it.")
    return warnings
