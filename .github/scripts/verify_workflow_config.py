#!/usr/bin/env python3
"""Validate the contributor CI workflow's required safety contract."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def main() -> int:
    if not WORKFLOW.is_file():
        print(f"missing workflow: {WORKFLOW}", file=sys.stderr)
        return 1
    content = WORKFLOW.read_text(encoding="utf-8")
    required = (
        "push:",
        "pull_request:",
        "workflow_dispatch:",
        "contents: read",
        "python -m unittest discover",
        "npm test",
        "npm run build",
        "python scripts/generate_release_assets.py",
        "python scripts/verify_release_assets.py",
        "python build_cli.py",
    )
    missing = [value for value in required if value not in content]
    if missing:
        print("missing workflow entries: " + ", ".join(missing), file=sys.stderr)
        return 1
    if "contents: write" in content:
        print("CI must not request write permissions", file=sys.stderr)
        return 1
    if re.search(r"(?i)(download_dir|downloadDir|strip-data)", content):
        print("CI must not depend on a library directory", file=sys.stderr)
        return 1
    print("CI workflow contract is valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
