import json
import unittest
from html import escape

from strip.parsers.asurascans import AsuraScansParser
from strip.parsers import get_parser


SERIES_URL = "https://asurascans.com/comics/sample-series-abc123"
CHAPTER_URL = f"{SERIES_URL}/chapter/chapter-20"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


class FakeSession:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return FakeResponse(self.pages[url])


def wrapped(value):
    return [0, value]


def chapter(number, slug, *, premium=False, published_at="2026-09-24T00:00:00Z"):
    return {
        "id": wrapped(int(number * 100)),
        "series_id": wrapped(42),
        "number": wrapped(number),
        "slug": wrapped(slug),
        "page_count": wrapped(2),
        "is_premium": wrapped(premium),
        "published_at": wrapped(published_at),
    }


def island(component, props):
    encoded = escape(json.dumps(props), quote=True)
    return f'<astro-island component-url="{component}" props="{encoded}"></astro-island>'


def series_html(chapters):
    chapter_props = {"chapters": [1, [[0, item] for item in chapters]]}
    return f"""
    <html><head>
      <meta property="og:title" content="Sample Series | Asura Scans">
      <meta property="og:description" content="A sample description.">
      <meta property="og:image" content="https://cdn.asurascans.com/cover.webp">
    </head><body>
      <h1>Sample Series</h1>
      <div><span>Status</span><span>ongoing</span></div>
      <div><span>Artist</span><span>Sample Artist</span></div>
      {island("/_astro/ChapterListReact.test.js", chapter_props)}
    </body></html>
    """


def chapter_html(page_urls):
    pages = {"pages": [1, [[0, {"url": wrapped(url)}] for url in page_urls]]}
    return island("/_astro/ChapterReader.test.js", pages)


class AsuraScansParserTests(unittest.TestCase):
    def test_supports_only_asura_https_hosts(self):
        self.assertTrue(AsuraScansParser.supports(SERIES_URL))
        self.assertTrue(AsuraScansParser.supports(SERIES_URL.replace("asurascans.com", "www.asurascans.com")))
        for url in (
            "http://asurascans.com/comics/sample-series-abc123",
            "https://asurascans.com.evil.test/comics/sample-series-abc123",
            "https://evil.test/asurascans.com/comics/sample-series-abc123",
        ):
            self.assertFalse(AsuraScansParser.supports(url), url)

    def test_canonicalizes_chapter_urls_to_series_urls(self):
        parser = AsuraScansParser()
        self.assertEqual(parser.canonicalize_url(CHAPTER_URL + "?page=2#reader"), SERIES_URL)
        self.assertEqual(parser.canonicalize_url(SERIES_URL + "/"), SERIES_URL)

    def test_parses_series_metadata_and_free_chapter_count(self):
        parser = AsuraScansParser()
        parser.session = FakeSession({
            SERIES_URL: series_html([
                chapter(2, "chapter-2"),
                chapter(1, "chapter-1", premium=True),
            ])
        })

        info = parser.get_series_info(SERIES_URL)

        self.assertEqual(info.title, "Sample Series")
        self.assertEqual(info.description, "A sample description.")
        self.assertEqual(info.cover_url, "https://cdn.asurascans.com/cover.webp")
        self.assertEqual(info.author, "Sample Artist")
        self.assertEqual(info.status, "ongoing")
        self.assertEqual(info.total_chapters, 1)

    def test_parses_chapters_ascending_and_skips_premium(self):
        parser = AsuraScansParser()
        parser.session = FakeSession({
            SERIES_URL: series_html([
                chapter(2, "chapter-2"),
                chapter(1, "chapter-1", premium=True),
                chapter(1.5, "chapter-1-5"),
            ])
        })

        chapters = parser.get_chapter_list(SERIES_URL)

        self.assertEqual([item.number for item in chapters], [1.5, 2.0])
        self.assertEqual(chapters[0].url, f"{SERIES_URL}/chapter/chapter-1-5")
        self.assertEqual(chapters[1].date, "2026-09-24T00:00:00Z")

    def test_extracts_reader_page_urls_and_sets_referer(self):
        page_urls = [
            "https://cdn.asurascans.com/page-1.webp",
            "https://cdn.asurascans.com/page-2.webp",
        ]
        parser = AsuraScansParser()
        parser.session = FakeSession({CHAPTER_URL: chapter_html(page_urls)})

        self.assertEqual(parser.get_chapter_images(CHAPTER_URL), page_urls)
        self.assertEqual(parser.get_image_headers()["Referer"], "https://asurascans.com/")

    def test_registry_selects_asura_parser(self):
        parser = get_parser(SERIES_URL)
        self.assertIsInstance(parser, AsuraScansParser)


if __name__ == "__main__":
    unittest.main()
