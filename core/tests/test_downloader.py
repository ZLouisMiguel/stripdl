import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import threading

from strip.downloader import ImageDownloadError, _do_download, download_chapter
from strip.parsers.base import ChapterInfo, SeriesInfo


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


class StreamingTests(unittest.TestCase):
    def test_worker_starts_before_fetcher_advances_to_next_page(self):
        started = threading.Event()
        events = []

        def chapters():
            yield ChapterInfo(1, "One", "url-1")
            if started.wait(2):
                events.append("next-page")
                yield ChapterInfo(2, "Two", "url-2")
            else:
                events.append("discovery-continued-before-download")

        parser = type("Parser", (), {
            "iter_chapter_list": lambda self, url: chapters(),
            "get_image_headers": lambda self: {},
        })()
        config_values = {
            "verify_integrity": False,
            "max_concurrent_chapters": 1,
            "overwrite": False,
            "image_quality": 85,
        }

        def fake_start(**kwargs):
            events.append(("started", kwargs["chapter"].number))
            started.set()

        with tempfile.TemporaryDirectory() as tmp:
            series_dir = Path(tmp) / "Series"
            series_dir.mkdir()
            with patch("strip.downloader.config.get", side_effect=lambda key, default=None: config_values.get(key, default)), \
                 patch("strip.downloader._download_cover"), \
                 patch("strip.downloader.download_chapter", side_effect=fake_start):
                _do_download(
                    parser, "url", SeriesInfo("Series", "", "", "", "url"),
                    series_dir, None, None, False, None,
                )

        self.assertNotIn("discovery-continued-before-download", events)
        self.assertLess(events.index(("started", 1)), events.index("next-page"))
