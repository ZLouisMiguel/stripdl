import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from strip.downloader import ImageDownloadError, download_chapter
from strip.parsers.base import ChapterInfo


class FailedImageTests(unittest.TestCase):
    @staticmethod
    def parser():
        return type("Parser", (), {
            "get_chapter_images": lambda self, url: ["page-1"],
            "get_image_headers": lambda self: {},
        })()

    def test_failed_image_does_not_finalize_or_emit_done(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch("strip.downloader._download_image", return_value=False), \
             patch("strip.downloader._emit") as emit:
            with self.assertRaises(ImageDownloadError):
                download_chapter(
                    self.parser(), ChapterInfo(1, "One", "url"), Path(tmp),
                    json_progress=True,
                )

            chapter_dir = Path(tmp) / "001"
            self.assertFalse((chapter_dir / ".complete").exists())
            self.assertFalse(any(
                call.args[0].get("status") == "chapter_done"
                for call in emit.call_args_list
            ))

    def test_successful_image_finalizes_chapter(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch("strip.downloader._download_image", return_value=True), \
             patch("strip.downloader._emit") as emit:
            result = download_chapter(
                self.parser(), ChapterInfo(1, "One", "url"), Path(tmp),
                json_progress=True,
            )

            self.assertEqual(result, Path(tmp) / "001")
            self.assertTrue((result / ".complete").exists())
            self.assertTrue(any(
                call.args[0].get("status") == "chapter_done"
                for call in emit.call_args_list
            ))
