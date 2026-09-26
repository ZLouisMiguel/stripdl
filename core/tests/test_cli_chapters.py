import unittest
from unittest.mock import patch

import strip.cli as cli_module
from click.testing import CliRunner

from strip.cli import cli, format_chapter_number
from strip.downloader import _passes_filter
from strip.parsers.base import ChapterInfo


class HalfChapterTests(unittest.TestCase):
    def test_exact_filter_does_not_conflate_half_chapter(self):
        chapter = ChapterInfo(12.5, "Half", "u")
        self.assertTrue(_passes_filter(chapter, None, [12.5]))
        self.assertFalse(_passes_filter(chapter, None, [12]))

    def test_formatter_keeps_half_chapter_distinct(self):
        self.assertEqual(format_chapter_number(12), "12")
        self.assertEqual(format_chapter_number(12.5), "12.5")

    def test_cli_parses_half_chapter_selector_as_float(self):
        with patch("strip.cli.get_parser", return_value=object()), \
             patch("strip.cli.download_series", return_value=None) as download:
            result = CliRunner().invoke(cli, [
                "download", "https://www.webtoons.com/en/x/list?title_no=1",
                "--chapters", "12.5", "--json-progress",
            ])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(download.call_args.kwargs["specific_chapters"], [12.5])


class TerminalProgressTests(unittest.TestCase):
    def test_compact_chapter_label_keeps_number_and_title(self):
        formatter = getattr(cli_module, "format_terminal_chapter_label", None)
        self.assertIsNotNone(formatter)
        self.assertEqual(formatter(12.5, "Interlude"), "Ch 12.5 · Interlude")

    def test_progress_state_focuses_active_chapter_and_keeps_last_completed(self):
        state_type = getattr(cli_module, "_TerminalProgressState", None)
        self.assertIsNotNone(state_type)
        state = state_type()

        state.chapter_found(1, "One")
        state.chapter_found(2, "Two")
        state.chapter_started(1, "One")
        self.assertEqual(state.focus_label(), "Ch 1 · One")

        state.chapter_started(2, "Two")
        self.assertEqual(state.focus_label(), "Ch 2 · Two")

        state.chapter_done(2)
        self.assertEqual(state.focus_label(), "Ch 1 · One")
        self.assertNotIn(2, state.active)
        self.assertEqual(state.completed, 1)

        state.chapter_done(1)
        self.assertEqual(state.focus_label(), "Ch 1 · One")
        self.assertEqual(state.completed, 2)

    def test_skipped_chapter_is_removed_from_overall_total(self):
        state_type = getattr(cli_module, "_TerminalProgressState", None)
        self.assertIsNotNone(state_type)
        state = state_type()

        state.chapter_found(1, "One")
        state.chapter_found(2, "Two")
        state.chapter_skipped()

        self.assertEqual(state.total, 1)
        self.assertEqual(state.status_label(), "0/1 done")
