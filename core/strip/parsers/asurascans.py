"""Parser for manga and manhwa hosted on asurascans.com."""

import html
import json
import re
from typing import Any, Dict, List
from urllib.parse import urlparse, urlunparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from strip.parsers.base import ChapterInfo, SeriesInfo, SiteParser


_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
_TIMEOUT = (10, 45)
_BASE_URL = "https://asurascans.com"


def _make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=5,
        connect=4,
        read=4,
        backoff_factor=1,
        status_forcelist={429, 500, 502, 503, 504},
        allowed_methods={"GET"},
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=20)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({
        "User-Agent": _UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    return session


def _decode_devalue(value: Any) -> Any:
    """Decode the small JSON-compatible value format emitted by Astro."""
    if isinstance(value, dict):
        return {key: _decode_devalue(item) for key, item in value.items()}
    if not isinstance(value, list):
        return value

    if len(value) == 2 and value[0] in {0, 1}:
        tag, payload = value
        if tag == 0:
            return _decode_devalue(payload)
        return [_decode_devalue(item) for item in payload]

    return [_decode_devalue(item) for item in value]


def _format_number(number: float) -> str:
    return f"{number:g}"


class AsuraScansParser(SiteParser):
    """Read Asura Scans' Astro-rendered series and chapter pages."""

    def __init__(self):
        self.session = _make_session()

    @classmethod
    def supports(cls, url: str) -> bool:
        try:
            parsed = urlparse(url)
        except ValueError:
            return False
        return (
            parsed.scheme == "https"
            and parsed.hostname in {"asurascans.com", "www.asurascans.com"}
            and parsed.path.startswith("/comics/")
        )

    @property
    def name(self) -> str:
        return "Asura Scans"

    def canonicalize_url(self, url: str) -> str:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/")
        match = re.match(r"^/comics/([^/]+)(?:/chapter/[^/]+)?$", path)
        if match:
            path = f"/comics/{match.group(1)}"
        return urlunparse(("https", "asurascans.com", path, "", "", ""))

    def _get_soup(self, url: str) -> BeautifulSoup:
        response = self.session.get(url, timeout=_TIMEOUT)
        response.raise_for_status()
        return BeautifulSoup(response.text, "html.parser")

    @staticmethod
    def _island_props(soup: BeautifulSoup, component_name: str) -> Dict[str, Any]:
        island = soup.find(
            "astro-island",
            attrs={"component-url": re.compile(re.escape(component_name))},
        )
        if not island or not island.get("props"):
            return {}
        try:
            encoded = html.unescape(island["props"])
            return _decode_devalue(json.loads(encoded))
        except (json.JSONDecodeError, TypeError, ValueError):
            return {}

    @staticmethod
    def _label_value(soup: BeautifulSoup, label: str) -> str:
        label_node = soup.find(string=lambda value: value and value.strip() == label)
        if not label_node:
            return ""

        for ancestor in label_node.parent.parents:
            text = " ".join(ancestor.stripped_strings)
            if not text.startswith(label) or len(text) > 240:
                continue
            value = text[len(label):].lstrip(" :|")
            if value:
                return value
        return ""

    def get_series_info(self, url: str) -> SeriesInfo:
        canonical_url = self.canonicalize_url(url)
        soup = self._get_soup(canonical_url)

        title_node = soup.find("h1")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        if not title:
            title_meta = soup.find("meta", property="og:title")
            title = title_meta.get("content", "") if title_meta else ""
        title = re.sub(r"\s*\|\s*Asura Scans$", "", title).strip()

        description_meta = soup.find("meta", property="og:description")
        description = description_meta.get("content", "") if description_meta else ""
        description = BeautifulSoup(description, "html.parser").get_text(" ", strip=True)

        cover_meta = soup.find("meta", property="og:image")
        cover_url = cover_meta.get("content", "") if cover_meta else ""

        chapters = self.get_chapter_list(canonical_url)
        status = self._label_value(soup, "Status").lower()
        artist = self._label_value(soup, "Artist")

        return SeriesInfo(
            title=title or "Unknown",
            author=artist,
            description=description,
            cover_url=cover_url,
            url=canonical_url,
            status=status,
            total_chapters=len(chapters),
            extra={"site": "asurascans.com"},
        )

    def get_chapter_list(self, url: str) -> List[ChapterInfo]:
        canonical_url = self.canonicalize_url(url)
        soup = self._get_soup(canonical_url)
        props = self._island_props(soup, "ChapterListReact")
        raw_chapters = props.get("chapters", [])
        chapters: List[ChapterInfo] = []

        for item in raw_chapters:
            if not isinstance(item, dict) or item.get("is_premium"):
                continue
            try:
                number = float(item["number"])
            except (KeyError, TypeError, ValueError):
                continue

            slug = str(item.get("slug") or f"chapter-{_format_number(number)}")
            date = str(item.get("published_at") or item.get("created_at") or "")
            chapters.append(
                ChapterInfo(
                    number=number,
                    title=str(item.get("title") or f"Chapter {_format_number(number)}"),
                    url=f"{canonical_url}/chapter/{slug}",
                    date=date,
                    extra={"chapter_id": item.get("id")},
                )
            )

        chapters.sort(key=lambda chapter: chapter.number)
        return chapters

    def get_chapter_images(self, chapter_url: str) -> List[str]:
        soup = self._get_soup(chapter_url)
        props = self._island_props(soup, "ChapterReader")
        pages = props.get("pages", [])
        images = [
            str(page["url"])
            for page in pages
            if isinstance(page, dict) and page.get("url")
        ]
        if images:
            return images

        return [
            src
            for image in soup.select("img[data-page-index]")
            if (src := image.get("src") or image.get("data-src"))
        ]

    def get_image_headers(self) -> dict:
        return {
            "User-Agent": _UA,
            "Referer": f"{_BASE_URL}/",
        }
