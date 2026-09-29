#!/usr/bin/env python3
"""Validate a release tag against the synchronized project version."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", default=None)
    parser.add_argument("--print-version", action="store_true")
    args = parser.parse_args()

    tag = args.tag or ""
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not SEMVER.fullmatch(version):
        print(f"invalid project version: {version}", file=sys.stderr)
        return 1
    if tag != f"v{version}":
        print(f"release tag {tag!r} does not match v{version}", file=sys.stderr)
        return 1
    if args.print_version:
        print(version)
    else:
        print(f"release tag {tag} matches project version {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
