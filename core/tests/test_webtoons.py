import unittest
from unittest.mock import patch

from strip.parsers.base import ChapterInfo
from strip.parsers.webtoons import ChapterListError, WebtoonsParser


URL = "https://www.webtoons.com/en/x/list?title_no=1"


class PaginationFailureTests(unittest.TestCase):
    def test_retries_then_returns_page(self):
        parser = WebtoonsParser()
        with patch.object(
            parser, "_fetch_chapter_page",
            side_effect=[TimeoutError(), [ChapterInfo(1, "One", "u")]],
        ) as fetch, patch("strip.parsers.webtoons.time.sleep"):
            chapters = parser._fetch_page_with_retry(URL, 2)
        self.assertEqual(chapters[0].number, 1)
        self.assertEqual(fetch.call_count, 2)

    def test_exhaustion_raises_page_error_with_number(self):
        parser = WebtoonsParser()
        with patch.object(parser, "_fetch_chapter_page", side_effect=TimeoutError("offline")), \
             patch("strip.parsers.webtoons.time.sleep"):
            with self.assertRaisesRegex(ChapterListError, "2"):
                parser._fetch_page_with_retry(URL, 2)
