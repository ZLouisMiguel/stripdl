import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class ReleaseVersionTests(unittest.TestCase):
    def test_all_version_surfaces_use_release_version(self):
        expected = "0.4.0"
        self.assertEqual((ROOT / "VERSION").read_text(encoding="utf-8").strip(), expected)

        runtime = (ROOT / "core" / "strip" / "__init__.py").read_text(encoding="utf-8")
        setup = (ROOT / "core" / "setup.py").read_text(encoding="utf-8")
        self.assertIn(f'__version__ = "{expected}"', runtime)
        self.assertIn(f'version="{expected}"', setup)

        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        lockfile = json.loads((ROOT / "desktop" / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], expected)
        self.assertEqual(lockfile["version"], expected)
        self.assertEqual(lockfile["packages"][""]["version"], expected)

    def test_sync_version_check_accepts_current_tree(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "sync_version.py"), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_sync_version_rejects_invalid_version(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "sync_version.py"), "--version", "release"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(result.stderr, re.compile("semver", re.IGNORECASE))


if __name__ == "__main__":
    unittest.main()
