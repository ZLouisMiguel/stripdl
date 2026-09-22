import json
import unittest
from unittest.mock import patch

from click.testing import CliRunner

from strip.cli import cli
from strip.downloader import ChapterFailure, DownloadFailure


class CliFailureTests(unittest.TestCase):
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
