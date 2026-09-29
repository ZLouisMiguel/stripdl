#!/usr/bin/env python3
"""Verify the generated Strip release assets before packaging."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "desktop" / "installer" / "assets"
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
ARTWORK = {
    "windows/sidebar.bmp": (164, 314),
    "windows/header.bmp": (150, 57),
    "windows/uninstaller-sidebar.bmp": (164, 314),
    "macos/dmg-background.png": (900, 600),
}


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def verify() -> None:
    if not (ROOT / "assets" / "strip-logo.png").is_file():
        fail("canonical Strip logo is missing")
    for size in ICON_SIZES:
        path = ASSETS / "icons" / f"{size}x{size}.png"
        if not path.is_file():
            fail(f"missing Linux icon: {path}")
        if image_size(path) != (size, size):
            fail(f"wrong Linux icon dimensions: {path}")

    ico = ASSETS / "strip.ico"
    if not ico.is_file() or ico.read_bytes()[:4] != b"\x00\x00\x01\x00":
        fail("missing or invalid Windows ICO")

    icns = ASSETS / "strip.icns"
    icns_data = icns.read_bytes() if icns.is_file() else b""
    if icns_data[:4] != b"icns" or len(icns_data) < 8:
        fail("missing or invalid macOS ICNS")
    if struct.unpack(">I", icns_data[4:8])[0] != len(icns_data):
        fail("macOS ICNS length header is invalid")

    for relative, dimensions in ARTWORK.items():
        path = ASSETS / relative
        if not path.is_file():
            fail(f"missing installer artwork: {path}")
        if image_size(path) != dimensions:
            fail(f"wrong installer artwork dimensions: {path}")

    print("Strip release assets are valid")


if __name__ == "__main__":
    verify()
