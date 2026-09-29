"""Parser for manga hosted on mangakakalot.gg."""

import re
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin, urlparse, urlunparse

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
_BASE_URL = "https://www.mangakakalot.gg"
_SERIES_PATH = re.compile(r"^/manga/([^/]+)(?:/chapter-[^/]+)?/?$")
_CHAPTER_NUMBER = re.compile(r"(?:chapter|ch)[-_\s:]*(\d+(?:\.\d+)?)", re.I)


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


def _format_number(number: float) -> str:
    return f"{number:g}"


def _chapter_path(number: float) -> str:
    return f"chapter-{_format_number(number).replace('.', '-')}"


def _chapter_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    match = _CHAPTER_NUMBER.search(str(value))
    if match:
        return float(match.group(1))
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


class MangaKakalotParser(SiteParser):
    """Read MangaKakalot series pages, chapter lists, and reader images."""

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
            and parsed.hostname in {"mangakakalot.gg", "www.mangakakalot.gg"}
            and _SERIES_PATH.fullmatch(parsed.path) is not None
        )

    @property
    def name(self) -> str:
        return "MangaKakalot"

    def canonicalize_url(self, url: str) -> str:
        parsed = urlparse(url)
        match = _SERIES_PATH.fullmatch(parsed.path)
        if not match:
            return url
        return urlunparse(("https", "www.mangakakalot.gg", f"/manga/{match.group(1)}", "", "", ""))

    def _get_soup(self, url: str) -> BeautifulSoup:
        response = self.session.get(url, timeout=_TIMEOUT)
        response.raise_for_status()
        return BeautifulSoup(response.text, "html.parser")

    @staticmethod
    def _label_value(soup: BeautifulSoup, label: str) -> str:
        pattern = re.compile(rf"^{re.escape(label)}\s*:\s*(.+)$", re.I)
        for node in soup.find_all("li"):
            text = " ".join(node.stripped_strings)
            match = pattern.match(text)
            if match:
                return match.group(1).strip()
        return ""

    @staticmethod
    def _unique_chapters(chapters: Iterable[ChapterInfo]) -> List[ChapterInfo]:
        unique: Dict[tuple[float, str], ChapterInfo] = {}
        for chapter in chapters:
            unique[(chapter.number, chapter.url)] = chapter
        return sorted(unique.values(), key=lambda chapter: chapter.number)

    def get_series_info(self, url: str) -> SeriesInfo:
        canonical_url = self.canonicalize_url(url)
        soup = self._get_soup(canonical_url)

        title_node = soup.find("h1")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        if not title:
            title_meta = soup.find("meta", property="og:title")
            title = title_meta.get("content", "") if title_meta else ""
        title = re.sub(r"^Read\s+|\s+Latest Chapter.*$", "", title, flags=re.I).strip()

        description_meta = soup.find("meta", property="og:description")
        description = description_meta.get("content", "") if description_meta else ""
        cover_meta = soup.find("meta", property="og:image")
        cover_url = cover_meta.get("content", "") if cover_meta else ""

        chapters = self.get_chapter_list(canonical_url)
        genres = [
            link.get_text(" ", strip=True)
            for link in soup.select("li.genres a[href*='/genre/']")
        ]

        return SeriesInfo(
            title=title or "Unknown",
            author=self._label_value(soup, "Author(s)"),
            description=description,
            cover_url=cover_url,
            url=canonical_url,
            genre=", ".join(dict.fromkeys(genres)),
            status=self._label_value(soup, "Status").lower(),
            total_chapters=len(chapters),
            extra={"site": "mangakakalot.gg"},
        )

    def get_chapter_list(self, url: str) -> List[ChapterInfo]:
        canonical_url = self.canonicalize_url(url)
        soup = self._get_soup(canonical_url)
        chapters = self._parse_html_chapters(soup, canonical_url)
        if chapters:
            chapters = self._unique_chapters(chapters)
            if len(chapters) >= 50:
                newest = max(chapters, key=lambda chapter: chapter.number)
                try:
                    reader_soup = self._get_soup(newest.url)
                except requests.RequestException:
                    return chapters
                reader_chapters = self._parse_reader_chapters(reader_soup, canonical_url)
                if len(reader_chapters) > len(chapters):
                    return self._unique_chapters(reader_chapters)
            return chapters

        container = soup.select_one("#chapter-list-container")
        api_template = container.get("data-api-url") if container else None
        if not api_template:
            return []

        slug = urlparse(canonical_url).path.rstrip("/").rsplit("/", 1)[-1]
        api_url = api_template.replace("__SLUG__", slug)
        response = self.session.get(api_url, timeout=_TIMEOUT)
        response.raise_for_status()

        try:
            payload = response.json()
        except ValueError:
            return self._unique_chapters(
                self._parse_html_chapters(BeautifulSoup(response.text, "html.parser"), canonical_url)
            )
        return self._unique_chapters(self._parse_json_chapters(payload, canonical_url))

    def _parse_reader_chapters(self, soup: BeautifulSoup, canonical_url: str) -> List[ChapterInfo]:
        options = soup.select("#chapter-dropdown option, #chapter-dropdown-bottom option")
        chapters = []
        seen = set()
        for option in options:
            title = option.get_text(" ", strip=True)
            value = option.get("value", "").strip()
            if not title or title.lower().startswith("loading"):
                continue
            number = _chapter_number(title) or _chapter_number(value)
            if number is None or number in seen:
                continue
            seen.add(number)
            if value.startswith("http"):
                chapter_url = value
            else:
                chapter_url = f"{canonical_url.rstrip('/')}/{value.lstrip('/')}"
            chapters.append(ChapterInfo(number, title, chapter_url))
        return chapters

    def _parse_html_chapters(self, soup: BeautifulSoup, canonical_url: str) -> List[ChapterInfo]:
        chapters = []
        rows = soup.select("#chapter-list-container .chapter-list .row")
        for row in rows:
            link = row.find("a", href=True)
            if not link:
                continue
            title = link.get_text(" ", strip=True)
            number = _chapter_number(title) or _chapter_number(link.get("href"))
            if number is None:
                continue
            spans = row.find_all("span")
            date = spans[-1].get_text(" ", strip=True) if len(spans) >= 3 else ""
            chapters.append(ChapterInfo(
                number=number,
                title=title or f"Chapter {_format_number(number)}",
                url=urljoin(canonical_url, link["href"]),
                date=date,
            ))
        return chapters

    def _parse_json_chapters(self, payload: Any, canonical_url: str) -> List[ChapterInfo]:
        if isinstance(payload, dict):
            for key in ("chapters", "data", "results", "items"):
                if key in payload:
                    return self._parse_json_chapters(payload[key], canonical_url)
            return []
        if not isinstance(payload, list):
            return []

        chapters = []
        for item in payload:
            if isinstance(item, str):
                number = _chapter_number(item)
                if number is not None:
                    chapters.append(ChapterInfo(
                        number=number,
                        title=item,
                        url=f"{canonical_url}/{_chapter_path(number)}",
                    ))
                continue
            if not isinstance(item, dict):
                continue
            number = next((
                _chapter_number(item.get(key))
                for key in ("chapter", "number", "chapter_number", "name", "title", "slug")
                if item.get(key) is not None and _chapter_number(item.get(key)) is not None
            ), None)
            if number is None:
                continue
            title = str(
                item.get("title")
                or item.get("chapter_title")
                or item.get("name")
                or item.get("chapter_name")
                or f"Chapter {_format_number(number)}"
            )
            raw_url = (
                item.get("url")
                or item.get("chapter_url")
                or item.get("link")
                or item.get("href")
            )
            chapter_url = (
                urljoin(canonical_url, str(raw_url))
                if raw_url else f"{canonical_url}/{_chapter_path(number)}"
            )
            date = str(
                item.get("date")
                or item.get("uploaded_at")
                or item.get("upload_date")
                or item.get("published_at")
                or ""
            )
            chapters.append(ChapterInfo(number, title, chapter_url, date=date))
        return chapters

    def get_chapter_images(self, chapter_url: str) -> List[str]:
        soup = self._get_soup(chapter_url)
        image_nodes = soup.select(".container-chapter-reader img")
        if not image_nodes:
            image_nodes = [
                image for image in soup.find_all("img")
                if "chapter" in (image.get("alt") or "").lower()
            ]

        images = []
        seen = set()
        for image in image_nodes:
            source = image.get("src") or image.get("data-src") or image.get("data-original")
            if not source or source.startswith(("#", "data:")):
                continue
            source = urljoin(chapter_url, source)
            if source not in seen:
                seen.add(source)
                images.append(source)
        return images

    def get_image_headers(self) -> dict:
        return {
            "User-Agent": _UA,
            "Referer": f"{_BASE_URL}/",
        }
