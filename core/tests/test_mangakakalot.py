import json
import unittest
from html import escape

from strip.parsers import get_parser

try:
    from strip.parsers.mangakakalot import MangaKakalotParser
except ModuleNotFoundError:
    MangaKakalotParser = None


SERIES_URL = "https://www.mangakakalot.gg/manga/the-life-of-a-returning-officer"
CHAPTER_URL = f"{SERIES_URL}/chapter-171"


class FakeResponse:
    def __init__(self, text="", payload=None):
        self.text = text
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        if self._payload is None:
            raise ValueError("not JSON")
        return self._payload


class FakeSession:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.pages[url]


def series_html(chapters):
    rows = "".join(
        f'<div class="row"><span><a href="{url}">{title}</a></span>'
        f'<span>{views}</span><span>{date}</span></div>'
        for number, title, url, views, date in chapters
    )
    return f"""
    <html>
      <head>
        <meta property="og:title" content="Read The Life of a Returning Officer Latest Chapter Manga Online Free | MangaKakalot">
        <meta property="og:description" content="A test description.">
        <meta property="og:image" content="https://img-r2.2xstorage.com/thumb/the-life-of-a-returning-officer.webp">
      </head>
      <body>
        <h1>The Life of a Returning Officer</h1>
        <ul>
          <li>Author(s) : Hangil</li>
          <li>Status : Ongoing</li>
          <li class="genres">Genres:
            <a href="https://www.mangakakalot.gg/genre/drama">Drama</a>,
            <a href="https://www.mangakakalot.gg/genre/action">Action</a>
          </li>
        </ul>
        <div id="chapter-list-container">
          <div class="chapter-list">{rows}</div>
        </div>
      </body>
    </html>
    """


def chapter_html(image_urls):
    images = "".join(
        f'<img src="{escape(url)}" alt="page {index} - MangaKakalot">'
        for index, url in enumerate(image_urls, start=1)
    )
    return f'<div class="container-chapter-reader">{images}</div>'


def reader_chapter_list_html(numbers):
    options = "".join(
        f'<option value="chapter-{str(number).replace(".", "-")}">Chapter {number}</option>'
        for number in numbers
    )
    return f'<select id="chapter-dropdown">{options}</select>'


class MangaKakalotParserTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(MangaKakalotParser, "MangaKakalotParser is not implemented")

    def test_supports_only_mangakakalot_https_manga_urls(self):
        parser = MangaKakalotParser()
        self.assertTrue(parser.supports(SERIES_URL))
        self.assertTrue(parser.supports(CHAPTER_URL))
        for url in (
            "http://www.mangakakalot.gg/manga/example",
            "https://mangakakalot.gg.evil.test/manga/example",
            "https://www.mangakakalot.gg/not-manga/example",
            "https://www.mangakakalot.gg/manga/example/other",
            "https://www.mangakakalot.gg@evil.test/manga/example",
        ):
            self.assertFalse(parser.supports(url), url)

    def test_canonicalizes_chapter_urls_to_series_urls(self):
        parser = MangaKakalotParser()
        self.assertEqual(parser.canonicalize_url(CHAPTER_URL + "?page=2#reader"), SERIES_URL)
        self.assertEqual(parser.canonicalize_url(SERIES_URL + "/"), SERIES_URL)

    def test_parses_series_metadata_and_chapters(self):
        chapters = [
            (2.0, "Chapter 2", f"{SERIES_URL}/chapter-2", "20", "09-02-2026"),
            (1.5, "Chapter 1.5", f"{SERIES_URL}/chapter-1.5", "10", "09-01-2026"),
        ]
        parser = MangaKakalotParser()
        parser.session = FakeSession({
            SERIES_URL: FakeResponse(series_html(chapters)),
        })

        info = parser.get_series_info(SERIES_URL)

        self.assertEqual(info.title, "The Life of a Returning Officer")
        self.assertEqual(info.author, "Hangil")
        self.assertEqual(info.status, "ongoing")
        self.assertEqual(info.genre, "Drama, Action")
        self.assertEqual(info.total_chapters, 2)
        self.assertEqual(info.cover_url, "https://img-r2.2xstorage.com/thumb/the-life-of-a-returning-officer.webp")

    def test_parses_chapters_in_ascending_order_with_dates(self):
        chapters = [
            (2.0, "Chapter 2", f"{SERIES_URL}/chapter-2", "20", "09-02-2026"),
            (1.5, "Chapter 1.5", f"{SERIES_URL}/chapter-1.5", "10", "09-01-2026"),
        ]
        parser = MangaKakalotParser()
        parser.session = FakeSession({
            SERIES_URL: FakeResponse(series_html(chapters)),
        })

        result = parser.get_chapter_list(SERIES_URL)

        self.assertEqual([chapter.number for chapter in result], [1.5, 2.0])
        self.assertEqual(result[0].title, "Chapter 1.5")
        self.assertEqual(result[1].date, "09-02-2026")

    def test_parses_json_chapter_api_payload(self):
        api_url = "https://www.mangakakalot.gg/api/manga/the-life-of-a-returning-officer/chapters"
        parser = MangaKakalotParser()
        parser.session = FakeSession({
            SERIES_URL: FakeResponse(
                '<div id="chapter-list-container" '
                'data-api-url="https://www.mangakakalot.gg/api/manga/__SLUG__/chapters"></div>'
            ),
            api_url: FakeResponse(payload={
                "chapters": [
                    {"chapter": "2", "title": "Chapter 2", "url": f"{SERIES_URL}/chapter-2", "date": "09-02-2026"},
                    {"chapter_number": "1.5", "chapter_title": "Interlude 1.5", "upload_date": "09-01-2026"},
                ],
            }),
        })

        result = parser.get_chapter_list(SERIES_URL)

        self.assertEqual([chapter.number for chapter in result], [1.5, 2.0])
        self.assertEqual(result[0].title, "Interlude 1.5")
        self.assertEqual(result[0].date, "09-01-2026")
        self.assertEqual(result[0].url, f"{SERIES_URL}/chapter-1-5")
        self.assertEqual(parser.session.calls[1][0], api_url)

    def test_reader_selector_expands_a_truncated_fifty_chapter_list(self):
        rows = [
            (float(number), f"Chapter {number}", f"{SERIES_URL}/chapter-{number}", "0", "09-01-2026")
            for number in range(50, 0, -1)
        ]
        newest_reader_url = f"{SERIES_URL}/chapter-50"
        parser = MangaKakalotParser()
        parser.session = FakeSession({
            SERIES_URL: FakeResponse(series_html(rows)),
            newest_reader_url: FakeResponse(reader_chapter_list_html(range(51, -1, -1))),
        })

        result = parser.get_chapter_list(SERIES_URL)

        self.assertEqual(len(result), 52)
        self.assertEqual(result[0].number, 0.0)
        self.assertEqual(result[-1].number, 51.0)
        self.assertEqual(parser.session.calls[1][0], newest_reader_url)

    def test_extracts_reader_images_in_document_order(self):
        image_urls = [
            "https://img-r1.2xstorage.com/the-life-of-a-returning-officer/171/0.webp",
            "https://img-r1.2xstorage.com/the-life-of-a-returning-officer/171/1.webp",
        ]
        parser = MangaKakalotParser()
        parser.session = FakeSession({
            CHAPTER_URL: FakeResponse(chapter_html(image_urls)),
        })

        self.assertEqual(parser.get_chapter_images(CHAPTER_URL), image_urls)
        self.assertEqual(parser.get_image_headers()["Referer"], "https://www.mangakakalot.gg/")

    def test_registry_selects_mangakakalot_parser(self):
        self.assertIsInstance(get_parser(SERIES_URL), MangaKakalotParser)


if __name__ == "__main__":
    unittest.main()
