#!/usr/bin/env python3
"""Generate deterministic Strip icons and installer artwork."""

from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "strip-logo.png"
OUTPUT = ROOT / "desktop" / "installer" / "assets"
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
STEEL = "#6194b2"
STEEL_DARK = "#4a7a99"
PARCHMENT = "#f5f1e6"
INK = "#141210"


def resized_logo(size: int, padding: float = 0.08) -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    inner = max(1, int(size * (1 - padding * 2)))
    source.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(source, ((size - source.width) // 2, (size - source.height) // 2))
    return canvas


def save_png_icon(size: int) -> None:
    path = OUTPUT / "icons" / f"{size}x{size}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    resized_logo(size).save(path, "PNG", optimize=True)


def save_ico() -> None:
    icon = resized_logo(1024)
    icon.save(OUTPUT / "strip.ico", "ICO", sizes=[(size, size) for size in ICON_SIZES])


def save_icns() -> None:
    chunks = []
    for chunk_type, size in ((b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)):
        buffer = io.BytesIO()
        resized_logo(size).save(buffer, "PNG", optimize=True)
        payload = buffer.getvalue()
        chunks.append(chunk_type + struct.pack(">I", len(payload) + 8) + payload)
    data = b"".join(chunks)
    (OUTPUT / "strip.icns").write_bytes(b"icns" + struct.pack(">I", len(data) + 8) + data)


def compose_artwork(size: tuple[int, int], *, background: str, logo_size: int, accent: bool) -> Image.Image:
    image = Image.new("RGB", size, background)
    draw = ImageDraw.Draw(image)
    if accent:
        draw.rectangle((0, 0, max(1, size[0] // 3), size[1]), fill=STEEL)
        draw.rectangle((max(1, size[0] // 3), 0, max(1, size[0] // 3 + 3), size[1]), fill=STEEL_DARK)
    logo = resized_logo(logo_size)
    if logo.mode != "RGBA":
        logo = logo.convert("RGBA")
    position = ((size[0] - logo.width) // 2, (size[1] - logo.height) // 2)
    image.paste(logo, position, logo)
    return image


def save_artwork() -> None:
    windows = OUTPUT / "windows"
    macos = OUTPUT / "macos"
    windows.mkdir(parents=True, exist_ok=True)
    macos.mkdir(parents=True, exist_ok=True)
    compose_artwork((164, 314), background=INK, logo_size=118, accent=True).save(
        windows / "sidebar.bmp", "BMP"
    )
    compose_artwork((150, 57), background=PARCHMENT, logo_size=42, accent=False).save(
        windows / "header.bmp", "BMP"
    )
    compose_artwork((164, 314), background=INK, logo_size=92, accent=True).save(
        windows / "uninstaller-sidebar.bmp", "BMP"
    )
    compose_artwork((900, 600), background=PARCHMENT, logo_size=250, accent=True).save(
        macos / "dmg-background.png", "PNG", optimize=True
    )


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"canonical logo not found: {SOURCE}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for size in ICON_SIZES:
        save_png_icon(size)
    save_ico()
    save_icns()
    save_artwork()
    print(f"Generated Strip release assets in {OUTPUT}")


if __name__ == "__main__":
    main()
