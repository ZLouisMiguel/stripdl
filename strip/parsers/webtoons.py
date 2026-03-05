# strip/parsers/webtoons.py
# Parser for https://www.webtoons.com
#
# How Webtoons works (as of 2024-2025):
#   - Series pages:  /en/<genre>/<slug>/list?title_no=<id>
#   - Chapter pages: /en/<genre>/<slug>/ep-<n>/viewer?title_no=<id>&episode_no=<n>
#   - Images live on webtoon-phinf.pstatic.net CDN and REQUIRE a Referer header
#     pointing to the episode viewer URL – without it you get a 403.
#   - The chapter list is paginated; each page holds up to 10 episodes.
#     Query param: ?title_no=<id>&page=<n>
#   - All images are inside  #_imageList img  (data-url attribute, not src).

import re
import time
from typing import List
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import requests
from bs4 import BeautifulSoup

from strip.parsers.base import SiteParser, SeriesInfo, ChapterInfo

# Webtoons blocks requests without a realistic browser UA
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_BASE_HEADERS = {
    "User-Agent": _UA,
    "Accept-Language": "en-US,en;q=0.9",
}

# Polite delay between requests to avoid rate-limiting
_DELAY = 0.5


def _get(url: str, headers: dict = None, **kwargs) -> requests.Response:
    h = {**_BASE_HEADERS, **(headers or {})}
    resp = requests.get(url, headers=h, timeout=20, **kwargs)
    resp.raise_for_status()
    time.sleep(_DELAY)
    return resp


def _soup(url: str, headers: dict = None) -> BeautifulSoup:
    return BeautifulSoup(_get(url, headers).text, "lxml")


def _normalize_url(url: str) -> str:
    """
    Accept both the /list?title_no=… URL and the /viewer URL and
    always return the canonical list URL.
    """
    if "viewer" in url:
        # Strip episode-specific parts, keep title_no
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        title_no = qs.get("title_no", [""])[0]
        # Rebuild path: /en/<genre>/<slug>/list
        parts = parsed.path.rstrip("/").split("/")
        # parts = ['', 'en', genre, slug, 'ep-n']  -> replace last with 'list'
        parts[-1] = "list"
        new_path = "/".join(parts)
        new_query = urlencode({"title_no": title_no})
        return urlunparse(parsed._replace(path=new_path, query=new_query))
    return url


class WebtoonsParser(SiteParser):
    """Parser for www.webtoons.com (English)."""

    @classmethod
    def supports(cls, url: str) -> bool:
        return "webtoons.com" in url

    @property
    def name(self) -> str:
        return "Webtoons.com"

    # ------------------------------------------------------------------ series

    def get_series_info(self, url: str) -> SeriesInfo:
        list_url = _normalize_url(url)
        soup = _soup(list_url)

        # ---- title
        title_el = soup.select_one("h1.subj") or soup.select_one(".info .subj")
        title = title_el.get_text(strip=True) if title_el else "Unknown"

        # ---- author
        author_el = (
            soup.select_one(".author_area .author")
            or soup.select_one(".author")
        )
        author = author_el.get_text(strip=True) if author_el else ""
        # Remove "author info" button text that sometimes bleeds in
        author = re.sub(r"\s+author info.*", "", author, flags=re.I).strip()

        # ---- description
        desc_el = soup.select_one(".summary") or soup.select_one(".desc")
        description = desc_el.get_text(strip=True) if desc_el else ""

        # ---- cover image
        cover_el = soup.select_one(".detail_body .thmb img") or soup.select_one(
            "img#thumbnail"
        )
        cover_url = ""
        if cover_el:
            cover_url = cover_el.get("src") or cover_el.get("data-src", "")

        # ---- genre (from URL path)
        parsed = urlparse(list_url)
        path_parts = parsed.path.strip("/").split("/")
        genre = path_parts[1] if len(path_parts) > 1 else ""

        # ---- status badge
        status_el = soup.select_one(".comic_info .day_info") or soup.select_one(
            ".info .day_info"
        )
        status = status_el.get_text(strip=True).lower() if status_el else ""

        return SeriesInfo(
            title=title,
            author=author,
            description=description,
            cover_url=cover_url,
            url=list_url,
            genre=genre,
            status=status,
        )

    # ------------------------------------------------------------------ chapter list

    def get_chapter_list(self, url: str) -> List[ChapterInfo]:
        list_url = _normalize_url(url)
        chapters: List[ChapterInfo] = []

        page = 1
        while True:
            parsed = urlparse(list_url)
            qs = parse_qs(parsed.query)
            qs["page"] = [str(page)]
            page_url = urlunparse(
                parsed._replace(query=urlencode({k: v[0] for k, v in qs.items()}))
            )

            soup = _soup(page_url)

            # Episode list lives in  #_listUl  >  li
            items = soup.select("#_listUl li") or soup.select(".detail_lst li")
            if not items:
                break

            for li in items:
                # Skip "locked" episodes (require coins)
                if li.select_one(".ico_lock"):
                    continue

                a_el = li.select_one("a")
                if not a_el:
                    continue

                chapter_url = a_el.get("href", "")
                if not chapter_url.startswith("http"):
                    chapter_url = "https://www.webtoons.com" + chapter_url

                # Episode number from URL query param episode_no
                ep_qs = parse_qs(urlparse(chapter_url).query)
                ep_no = float(ep_qs.get("episode_no", ["0"])[0])

                title_el = li.select_one(".subj span") or li.select_one(".subj")
                title = title_el.get_text(strip=True) if title_el else f"Episode {ep_no}"

                date_el = li.select_one(".date")
                date = date_el.get_text(strip=True) if date_el else ""

                thumb_el = li.select_one("img")
                thumbnail_url = ""
                if thumb_el:
                    thumbnail_url = (
                        thumb_el.get("data-url")
                        or thumb_el.get("src")
                        or ""
                    )

                chapters.append(
                    ChapterInfo(
                        number=ep_no,
                        title=title,
                        url=chapter_url,
                        date=date,
                        thumbnail_url=thumbnail_url,
                    )
                )

            # If we got fewer than 10 items we've hit the last page
            if len(items) < 10:
                break
            page += 1

        # Sort ascending so chapter 1 comes first
        chapters.sort(key=lambda c: c.number)
        return chapters

    # ------------------------------------------------------------------ images

    def get_chapter_images(self, chapter_url: str) -> List[str]:
        """
        Images are inside  #_imageList img  with the real URL in data-url.
        The CDN requires Referer = the chapter viewer URL.
        """
        soup = _soup(chapter_url)

        images = []
        for img in soup.select("#_imageList img"):
            src = img.get("data-url") or img.get("src") or ""
            if src and src.startswith("http"):
                images.append(src)

        # Fallback: some layouts use a different container
        if not images:
            for img in soup.select(".viewer_lst img"):
                src = img.get("data-url") or img.get("src") or ""
                if src and src.startswith("http"):
                    images.append(src)

        return images

    def get_image_headers(self) -> dict:
        # The CDN will 403 without a webtoons.com Referer
        return {
            "Referer": "https://www.webtoons.com/",
            "User-Agent": _UA,
        }
