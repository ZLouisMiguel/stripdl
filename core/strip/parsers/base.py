# strip/parsers/base.py
# Abstract base class for all site parsers.
# Adding a new site = subclass SiteParser, implement three methods, register in __init__.py

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class SeriesInfo:
    """Metadata for a webtoon series."""
    title: str
    author: str
    description: str
    cover_url: str
    url: str
    genre: str = ""
    status: str = ""          # "ongoing" | "completed" | "hiatus"
    total_chapters: int = 0
    extra: dict = field(default_factory=dict)  # site-specific extras


@dataclass
class ChapterInfo:
    """Metadata for a single chapter."""
    number: float             # float to support .5 chapters
    title: str
    url: str
    date: str = ""
    thumbnail_url: str = ""
    extra: dict = field(default_factory=dict)


class SiteParser(ABC):
    """
    Contract that every parser must fulfil.

    Parsers are stateless – each method is a pure function of its arguments.
    The downloader in strip/downloader.py orchestrates calls across parsers.
    """

    # ------------------------------------------------------------------ identity

    @classmethod
    @abstractmethod
    def supports(cls, url: str) -> bool:
        """Return True if this parser can handle *url*."""
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name, e.g. 'Webtoons.com'"""
        ...

    # ------------------------------------------------------------------ data

    @abstractmethod
    def get_series_info(self, url: str) -> SeriesInfo:
        """
        Fetch and return series-level metadata from the series landing page.
        *url* is the URL the user provided (chapter list page or canonical URL).
        """
        ...

    @abstractmethod
    def get_chapter_list(self, url: str) -> List[ChapterInfo]:
        """
        Return a list of ChapterInfo objects, sorted ascending by chapter number.
        Must handle pagination transparently.
        """
        ...

    @abstractmethod
    def get_chapter_images(self, chapter_url: str) -> List[str]:
        """
        Return a list of full image URLs for every page in the chapter.
        Must set any required request headers (Referer, etc.) in get_image_headers().
        """
        ...

    def get_image_headers(self) -> dict:
        """
        Optional HTTP headers to use when downloading individual page images.
        Override if the CDN requires a Referer or custom User-Agent.
        """
        return {}
