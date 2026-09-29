#!/usr/bin/env python3
"""Package a PyInstaller CLI output with an explicit platform and architecture."""

from __future__ import annotations

import argparse
import re
import shutil
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--platform", choices=("windows", "macos", "linux"), required=True)
    parser.add_argument("--arch", choices=("x64", "arm64"), required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "release-cli")
    args = parser.parse_args()

    if not SEMVER.fullmatch(args.version):
        parser.error("--version must use semver MAJOR.MINOR.PATCH format")
    source = args.source or (ROOT / "dist" / ("stripdl.exe" if args.platform == "windows" else "stripdl"))
    if not source.is_file():
        parser.error(f"CLI executable not found: {source}")
    args.output.mkdir(parents=True, exist_ok=True)

    stem = f"stripdl-{args.version}-{args.platform}-{args.arch}"
    if args.platform == "windows":
        destination = args.output / f"{stem}.exe"
        shutil.copy2(source, destination)
    else:
        destination = args.output / f"{stem}.tar.gz"
        with tarfile.open(destination, "w:gz") as archive:
            archive.add(source, arcname="stripdl")
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
