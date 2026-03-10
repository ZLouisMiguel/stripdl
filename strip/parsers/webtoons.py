# strip/parsers/webtoons.py
# Parser for https://www.webtoons.com
#
# v2 changes:
#   - _fetch_chapter_page() unchanged (single page fetch).
#   - get_chapter_list() now fetches pages concurrently (wave strategy):
#       1. Fetch page 1 serially to determine whether more pages exist.
#       2. Speculatively fetch pages 2, 3, 4… in batches of CONCURRENT_PAGES.
#       3. Stop when a batch page returns fewer than 10 items.
#   - Minimum inter-request delay still enforced via the global token bucket
#     (set in config.rate_limit), so no separate _DELAY is needed here.

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional
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

# Minimum seconds between page-list requests on the same thread.
# The global token bucket handles cross-thread rate limiting;
# this is an additional per-thread floor.
_PAGE_DELAY = 0.3

# Pages to fetch concurrently when paginating the chapter list.
_CONCURRENT_PAGES = 3


def _get(url: str, headers: dict = None, **kwargs) -> requests.Response:
    h = {**_BASE_HEADERS, **(headers or {})}
    resp = requests.get(url, headers=h, timeout=20, **kwargs)
    resp.raise_for_status()
    return resp


def _soup(url: str, headers: dict = None) -> BeautifulSoup:
    time.sleep(_PAGE_DELAY)   # polite per-thread delay
    return BeautifulSoup(_get(url, headers).text, "lxml")


def _normalize_url(url: str) -> str:
    """Accept /viewer or /list URLs and return the canonical /list URL."""
    if "viewer" in url:
        parsed  = urlparse(url)
        qs      = parse_qs(parsed.query)
        title_no = qs.get("title_no", [""])[0]
        parts   = parsed.path.rstrip("/").split("/")
        parts[-1] = "list"
        new_path  = "/".join(parts)
        new_query = urlencode({"title_no": title_no})
        return urlunparse(parsed._replace(path=new_path, query=new_query))
    return url


def _extract_cover_url(soup: BeautifulSoup) -> str:
    """Extract series cover; avoids episode-thumbnail false positives."""
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


def _page_url(list_url: str, page: int) -> str:
    parsed = urlparse(list_url)
    qs = parse_qs(parsed.query)
    qs["page"] = [str(page)]
    return urlunparse(parsed._replace(query=urlencode({k: v[0] for k, v in qs.items()})))


def _parse_items(soup: BeautifulSoup) -> List[ChapterInfo]:
    """Parse chapter items from a /list page soup."""
    items = soup.select("#_listUl li") or soup.select(".detail_lst li")
    chapters = []
    for li in items:
        if li.select_one(".ico_lock"):
            continue
        a_el = li.select_one("a")
        if not a_el:
            continue
        chapter_url = a_el.get("href", "")
        if not chapter_url.startswith("http"):
            chapter_url = "https://www.webtoons.com" + chapter_url

        ep_qs  = parse_qs(urlparse(chapter_url).query)
        ep_no  = float(ep_qs.get("episode_no", ["0"])[0])

        title_el = li.select_one(".subj span") or li.select_one(".subj")
        title    = title_el.get_text(strip=True) if title_el else f"Episode {ep_no}"

        date_el  = li.select_one(".date")
        date     = date_el.get_text(strip=True) if date_el else ""

        thumb_el      = li.select_one("img")
        thumbnail_url = ""
        if thumb_el:
            thumbnail_url = thumb_el.get("data-url") or thumb_el.get("src") or ""

        chapters.append(ChapterInfo(
            number=ep_no, title=title,
            url=chapter_url, date=date,
            thumbnail_url=thumbnail_url,
        ))
    return chapters


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
        soup     = _soup(list_url)

        title_el  = soup.select_one("h1.subj") or soup.select_one(".info .subj")
        title     = title_el.get_text(strip=True) if title_el else "Unknown"

        author_el = (soup.select_one(".author_area .author")
                     or soup.select_one(".author"))
        author    = author_el.get_text(strip=True) if author_el else ""
        author    = re.sub(r"\s+author info.*", "", author, flags=re.I).strip()

        desc_el   = soup.select_one(".summary") or soup.select_one(".desc")
        description = desc_el.get_text(strip=True) if desc_el else ""

        cover_url = _extract_cover_url(soup)

        parsed     = urlparse(list_url)
        path_parts = parsed.path.strip("/").split("/")
        genre      = path_parts[1] if len(path_parts) > 1 else ""

        status_el = (soup.select_one(".comic_info .day_info")
                     or soup.select_one(".info .day_info"))
        status    = status_el.get_text(strip=True).lower() if status_el else ""

        return SeriesInfo(
            title=title, author=author, description=description,
            cover_url=cover_url, url=list_url, genre=genre, status=status,
        )

    # ------------------------------------------------------------------ chapter list

    def _fetch_chapter_page(self, url: str, page: int) -> List[ChapterInfo]:
        """
        Fetch one pagination page of the chapter list.
        Returns an empty list when there are no more pages.
        Called by the CLI to power live per-page progress display.
        """
        list_url = _normalize_url(url)
        soup     = _soup(_page_url(list_url, page))
        return _parse_items(soup)

    def get_chapter_list(self, url: str) -> List[ChapterInfo]:
        """
        Return full sorted chapter list, fetching pages concurrently.

        Strategy (wave-based):
          1. Fetch page 1 (serial) — establishes whether more pages exist.
          2. While last batch had any full pages (10 items), concurrently
             fetch the next CONCURRENT_PAGES pages.
          3. Merge results, sort ascending by chapter number.
        """
        list_url  = _normalize_url(url)
        all_chaps: List[ChapterInfo] = []

        # Page 1 — serial, to check if series has more pages at all
        p1_items = self._fetch_chapter_page(url, 1)
        all_chaps.extend(p1_items)

        if len(p1_items) < 10:
            # Single page series — done
            all_chaps.sort(key=lambda c: c.number)
            return all_chaps

        # Multi-page series — fetch remaining pages in batches
        next_page = 2
        with ThreadPoolExecutor(max_workers=_CONCURRENT_PAGES) as pool:
            while True:
                batch = list(range(next_page, next_page + _CONCURRENT_PAGES))
                next_page += _CONCURRENT_PAGES

                futures = {
                    pool.submit(self._fetch_chapter_page, url, p): p
                    for p in batch
                }

                batch_results: dict = {}
                for fut in as_completed(futures):
                    p = futures[fut]
                    try:
                        batch_results[p] = fut.result()
                    except Exception:
                        batch_results[p] = []

                # Process pages in order so we can stop cleanly
                done = False
                for p in sorted(batch_results.keys()):
                    items = batch_results[p]
                    all_chaps.extend(items)
                    if len(items) < 10:
                        done = True
                        break

                if done:
                    break

        all_chaps.sort(key=lambda c: c.number)
        return all_chaps

    # ------------------------------------------------------------------ images

    def get_chapter_images(self, chapter_url: str) -> List[str]:
        soup   = _soup(chapter_url)
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
            "Referer":    "https://www.webtoons.com/",
            "User-Agent": _UA,
        }
