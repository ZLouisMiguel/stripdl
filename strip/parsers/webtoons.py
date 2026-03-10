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

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_BASE_HEADERS = {
    "User-Agent": _UA,
    "Accept-Language": "en-US,en;q=0.9",
}

_DELAY = 0.8


def _get(url: str, headers: dict = None, **kwargs) -> requests.Response:
    h = {**_BASE_HEADERS, **(headers or {})}
    resp = requests.get(url, headers=h, timeout=20, **kwargs)
    resp.raise_for_status()
    time.sleep(_DELAY)
    return resp


def _soup(url: str, headers: dict = None) -> BeautifulSoup:
    return BeautifulSoup(_get(url, headers).text, "lxml")


def _normalize_url(url: str) -> str:
    if "viewer" in url:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        title_no = qs.get("title_no", [""])[0]
        parts = parsed.path.rstrip("/").split("/")
        parts[-1] = "list"
        new_path = "/".join(parts)
        new_query = urlencode({"title_no": title_no})
        return urlunparse(parsed._replace(path=new_path, query=new_query))
    return url


def _extract_cover_url(soup: BeautifulSoup) -> str:
    """
    Extract the series cover image URL from the /list page.

    Priority order (most to least reliable):
      1.  .detail_header .thmb img            – main series art banner
      2.  .detail_header img                  – alternate variant
      3.  .info_img img                       – another layout variant
      4.  .thmb_wrap img                      – fallback
      5.  og:image meta tag                   – OpenGraph last resort

    Explicitly ignores any <img> inside #_listUl or .detail_lst
    (those are per-episode thumbnails, not the series cover).
    """
    candidate_selectors = [
        ".detail_header .thmb img",
        ".detail_header img",
        ".info_img img",
        ".thmb_wrap img",
    ]

    for sel in candidate_selectors:
        for el in soup.select(sel):
            if el.find_parent(id="_listUl") or el.find_parent(class_="detail_lst"):
                continue
            src = el.get("src") or el.get("data-src") or ""
            if src.startswith("http") and "pstatic.net" in src:
                return src

    og = soup.select_one("meta[property='og:image']")
    if og:
        return og.get("content", "")

    return ""


class WebtoonsParser(SiteParser):
    """Parser for www.webtoons.com (English)."""

    @classmethod
    def supports(cls, url: str) -> bool:
        return "webtoons.com" in url

    @property
    def name(self) -> str:
        return "Webtoons.com"

    def get_series_info(self, url: str) -> SeriesInfo:
        list_url = _normalize_url(url)
        soup = _soup(list_url)

        title_el = soup.select_one("h1.subj") or soup.select_one(".info .subj")
        title = title_el.get_text(strip=True) if title_el else "Unknown"

        author_el = (
            soup.select_one(".author_area .author")
            or soup.select_one(".author")
        )
        author = author_el.get_text(strip=True) if author_el else ""
        author = re.sub(r"\s+author info.*", "", author, flags=re.I).strip()

        desc_el = soup.select_one(".summary") or soup.select_one(".desc")
        description = desc_el.get_text(strip=True) if desc_el else ""

        # Series cover – NOT episode thumbnails
        cover_url = _extract_cover_url(soup)

        parsed = urlparse(list_url)
        path_parts = parsed.path.strip("/").split("/")
        genre = path_parts[1] if len(path_parts) > 1 else ""

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
            items = soup.select("#_listUl li") or soup.select(".detail_lst li")
            if not items:
                break

            for li in items:
                if li.select_one(".ico_lock"):
                    continue

                a_el = li.select_one("a")
                if not a_el:
                    continue

                chapter_url = a_el.get("href", "")
                if not chapter_url.startswith("http"):
                    chapter_url = "https://www.webtoons.com" + chapter_url

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

            if len(items) < 10:
                break
            page += 1

        chapters.sort(key=lambda c: c.number)
        return chapters

    def get_chapter_images(self, chapter_url: str) -> List[str]:
        soup = _soup(chapter_url)

        images = []
        for img in soup.select("#_imageList img"):
            src = img.get("data-url") or img.get("src") or ""
            if src and src.startswith("http"):
                images.append(src)

        if not images:
            for img in soup.select(".viewer_lst img"):
                src = img.get("data-url") or img.get("src") or ""
                if src and src.startswith("http"):
                    images.append(src)

        return images

    def get_image_headers(self) -> dict:
        return {
            "Referer": "https://www.webtoons.com/",
            "User-Agent": _UA,
        }