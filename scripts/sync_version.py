#!/usr/bin/env python3
"""Validate and synchronize Strip's shared release version."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def read_version() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def validate_version(version: str) -> str:
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError(f"version must use semver MAJOR.MINOR.PATCH format: {version}")
    return version


def surface_versions() -> dict[str, str]:
    package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
    lockfile = json.loads((ROOT / "desktop" / "package-lock.json").read_text(encoding="utf-8"))
    runtime = (ROOT / "core" / "strip" / "__init__.py").read_text(encoding="utf-8")
    setup = (ROOT / "core" / "setup.py").read_text(encoding="utf-8")

    runtime_match = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', runtime)
    setup_match = re.search(r'version\s*=\s*["\']([^"\']+)["\']', setup)
    if not runtime_match or not setup_match:
        raise ValueError("could not find Python version metadata")

    return {
        "VERSION": read_version(),
        "core/strip/__init__.py": runtime_match.group(1),
        "core/setup.py": setup_match.group(1),
        "desktop/package.json": package["version"],
        "desktop/package-lock.json": lockfile["version"],
        "desktop/package-lock.json:root": lockfile["packages"][""]["version"],
    }


def replace_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"could not update version in {path}")
    path.write_text(updated, encoding="utf-8")


def synchronize(version: str) -> None:
    version = validate_version(version)
    (ROOT / "VERSION").write_text(version + "\n", encoding="utf-8")
    replace_once(
        ROOT / "core" / "strip" / "__init__.py",
        r'(__version__\s*=\s*["\'])[^"\']+(["\'])',
        rf"\g<1>{version}\g<2>",
    )
    replace_once(
        ROOT / "core" / "setup.py",
        r'(version\s*=\s*["\'])[^"\']+(["\'])',
        rf"\g<1>{version}\g<2>",
    )
    replace_once(
        ROOT / "desktop" / "package.json",
        r'("version"\s*:\s*")[^"]+(")',
        rf"\g<1>{version}\g<2>",
    )
    replace_once(
        ROOT / "desktop" / "package-lock.json",
        r'("version"\s*:\s*")[^"]+(")',
        rf"\g<1>{version}\g<2>",
    )
    replace_once(
        ROOT / "desktop" / "package-lock.json",
        r'("packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*")[^"]+(")',
        rf"\g<1>{version}\g<2>",
    )


def check() -> int:
    expected = validate_version(read_version())
    mismatches = {
        path: value for path, value in surface_versions().items() if value != expected
    }
    if mismatches:
        for path, value in mismatches.items():
            print(f"{path}: {value} (expected {expected})", file=sys.stderr)
        return 1
    print(f"Strip version metadata is synchronized at {expected}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--version")
    args = parser.parse_args()

    try:
        if args.version:
            synchronize(args.version)
        if args.check or not args.version:
            return check()
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
