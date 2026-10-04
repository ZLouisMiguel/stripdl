import tempfile
import unittest
from pathlib import Path

from strip.library import scan_library


class LibraryScanTests(unittest.TestCase):
    def test_invalid_utf8_series_metadata_does_not_abort_scan(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            series_dir = root / "Unreadable Series"
            series_dir.mkdir()
            (series_dir / "metadata.json").write_bytes(b'{"title":"Bad\x93"}')

            series = scan_library(root)

        self.assertEqual(len(series), 1)
        self.assertEqual(series[0].title, "Unreadable Series")
