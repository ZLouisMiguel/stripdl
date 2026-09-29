import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_changelog import PLACEHOLDER, update_changelog


class UpdateChangelogTests(unittest.TestCase):
    def test_promotes_unreleased_entries_and_leaves_future_section_intact(self):
        contents = """# Changelog

## [Unreleased]

- **feat:** A new feature.
- **fix:** A bug fix.

## v0.3.2

- Previous release.
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "CHANGELOG.md"
            path.write_text(contents, encoding="utf-8")

            self.assertTrue(update_changelog(path, "v0.4.0"))
            updated = path.read_text(encoding="utf-8")

        self.assertIn(f"## [Unreleased]\n\n{PLACEHOLDER}", updated)
        self.assertIn("## v0.4.0\n\n- **feat:** A new feature.", updated)
        self.assertLess(updated.index("## v0.4.0"), updated.index("## v0.3.2"))

    def test_is_idempotent_for_a_version_that_was_already_promoted(self):
        contents = f"# Changelog\n\n## [Unreleased]\n\n{PLACEHOLDER}\n\n## v0.4.0\n\n- Existing.\n"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "CHANGELOG.md"
            path.write_text(contents, encoding="utf-8")

            self.assertFalse(update_changelog(path, "0.4.0"))
            self.assertEqual(path.read_text(encoding="utf-8"), contents)


if __name__ == "__main__":
    unittest.main()
