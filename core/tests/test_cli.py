import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from click.testing import CliRunner

from strip.cli import cli
from strip.downloader import ChapterFailure, DownloadFailure


class CliFailureTests(unittest.TestCase):
    def test_library_renders_non_ascii_metadata_without_traceback(self):
        series = SimpleNamespace(
            title="Returned_by_the_Kingdom\u2014世界",
            author="Author\u2014名",
            chapter_count=2,
            directory=Path("C:/strip-data/Returned_by_the_Kingdom"),
        )
        with patch("strip.cli.scan_library", return_value=[series]):
            result = CliRunner().invoke(cli, ["library"])

        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Returned_by_the_Kingdom", result.output)
        self.assertNotIn("Traceback", result.output)

    def test_library_reports_scan_failures_without_traceback(self):
        with patch("strip.cli.scan_library", side_effect=RuntimeError("disk unavailable")):
            result = CliRunner().invoke(cli, ["library"])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("Failed to scan library", result.output)
        self.assertNotIn("Traceback", result.output)

    def test_list_reports_fetch_failures_without_traceback(self):
        class BrokenParser:
            def get_series_info(self, _url):
                raise RuntimeError("network down")

        with patch("strip.cli.get_parser", return_value=BrokenParser()):
            result = CliRunner().invoke(cli, [
                "list", "https://www.webtoons.com/en/x/list?title_no=1",
            ])

        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("Failed to fetch series info", result.output)
        self.assertNotIn("Traceback", result.output)

    def test_failed_download_returns_nonzero_and_json_error(self):
        failure = DownloadFailure([ChapterFailure(4, "timeout")])
        with patch("strip.cli.get_parser", return_value=object()), \
             patch("strip.cli.download_series", side_effect=failure):
            result = CliRunner().invoke(cli, [
                "download", "https://www.webtoons.com/en/x/list?title_no=1",
                "--json-progress",
            ])

        self.assertNotEqual(result.exit_code, 0)
        events = [json.loads(line) for line in result.output.splitlines()]
        self.assertTrue(any(
            event.get("status") == "chapter_error"
            and event.get("chapter") == 4
            and "timeout" in event.get("message", "")
            for event in events
        ))
        self.assertEqual(events[-1]["status"], "error")

    def test_successful_download_returns_zero(self):
        with patch("strip.cli.get_parser", return_value=object()), \
             patch("strip.cli.download_series", return_value=None):
            result = CliRunner().invoke(cli, [
                "download", "https://www.webtoons.com/en/x/list?title_no=1",
                "--json-progress",
            ])
        self.assertEqual(result.exit_code, 0, result.output)
