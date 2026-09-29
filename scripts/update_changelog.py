#!/usr/bin/env python3
"""Promote the current Unreleased changelog entries into a version section."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


SEMVER = re.compile(r"^v?(?P<version>\d+\.\d+\.\d+)$")
VERSION_HEADING = re.compile(r"^## v(?P<version>\d+\.\d+\.\d+)(?:\s|$)")
PLACEHOLDER = "_No unreleased changes yet._"


def update_changelog(path: Path, version: str) -> bool:
    match = SEMVER.fullmatch(version)
    if not match:
        raise ValueError("version must use MAJOR.MINOR.PATCH format")
    normalized_version = match.group("version")
    version_heading = f"## v{normalized_version}"

    lines = path.read_text(encoding="utf-8").splitlines()
    if any(
        VERSION_HEADING.match(line.strip())
        and VERSION_HEADING.match(line.strip()).group("version") == normalized_version
        for line in lines
    ):
        return False

    try:
        unreleased_index = next(
            index for index, line in enumerate(lines) if line.strip() == "## [Unreleased]"
        )
    except StopIteration as error:
        raise ValueError("CHANGELOG.md is missing the ## [Unreleased] section") from error

    next_section = next(
        (
            index
            for index in range(unreleased_index + 1, len(lines))
            if lines[index].startswith("## ")
        ),
        len(lines),
    )
    body = "\n".join(lines[unreleased_index + 1 : next_section]).strip()
    if not body or body == PLACEHOLDER:
        return False

    updated = (
        lines[: unreleased_index + 1]
        + ["", PLACEHOLDER, "", version_heading, ""]
        + body.splitlines()
        + [""]
        + lines[next_section:]
    )
    path.write_text("\n".join(updated).rstrip() + "\n", encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--file", type=Path, default=Path("CHANGELOG.md"))
    args = parser.parse_args()

    changed = update_changelog(args.file, args.version)
    if changed:
        print(f"Promoted Unreleased changes to v{SEMVER.fullmatch(args.version).group('version')}")
    else:
        print("Changelog already updated or has no unreleased changes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
