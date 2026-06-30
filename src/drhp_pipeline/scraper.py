"""
Stage 2 — Scraper.

Fetch the two SEBI listing pages and extract the raw filings (company name, filing
date, filing type, links). Strategy:

  1. Direct HTTP fetch + tolerant HTML parse (SEBI serves server-rendered HTML, but
     it is malformed — the title cell's <td> is never closed — so we parse defensively).
  2. If a page fails or looks empty/JS-blocked, fall back to a headless browser
     (Playwright, imported lazily so it is never a hard dependency).

A page failure prints a clear warning and returns an empty list — it never crashes
the whole run.
"""

from __future__ import annotations

import html as html_lib
import logging
import re
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional

import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

log = logging.getLogger("drhp.scraper")

# SEBI listing pages (from the source email)
DRHP_URL = "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=10"
IPO_URL = "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=12"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

# Order matters: most specific keyword first. Used both to classify the filing type
# and to locate where the company name ends in the title string.
_TYPE_KEYWORDS = [
    ("corrigendum", "Corrigendum"),
    ("addendum", "Addendum"),
    ("udrhp", "UDRHP"),
    ("prospectus", "Prospectus"),
    ("drhp", "DRHP"),
    ("draft red herring", "DRHP"),
    ("draft offer", "DRHP"),
]


@dataclass
class ScrapedFiling:
    """Raw filing as read off a listing page, before resolution/enrichment."""

    company_name_raw: str
    filing_date: date
    filing_type: str  # one of the contract FilingType values
    stage: str  # "DRHP" | "IPO"
    sebi_url: str  # detail (.html) page on SEBI, or the listing page as fallback
    abridged_pdf_url: Optional[str] = None  # small "abridged prospectus" PDF if linked
    title_raw: str = ""
    lead_managers: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Title parsing
# ---------------------------------------------------------------------------
def classify_filing_type(title: str, default_stage: str) -> str:
    low = title.lower()
    for needle, value in _TYPE_KEYWORDS:
        if needle in low:
            return value
    # No keyword found — fall back to the page's natural type.
    return "Prospectus" if default_stage == "IPO" else "DRHP"


def extract_company_name(title: str) -> str:
    """Strip the filing-type suffix from a listing title to get the company name.

    Cuts the title at the earliest filing-type keyword, then trims trailing
    separators. Periods are preserved so "Ujin Pharma Ltd." stays intact.
    """
    low = title.lower()
    cut = len(title)
    for needle, _ in _TYPE_KEYWORDS:
        idx = low.find(needle)
        if idx != -1:
            cut = min(cut, idx)
    name = title[:cut]
    # Trim trailing separators/whitespace, but keep internal periods.
    name = re.sub(r"[\s\-–—:,]+$", "", name).strip()
    return name


# ---------------------------------------------------------------------------
# HTML parsing (tolerant of SEBI's unclosed <td> in the title cell)
# ---------------------------------------------------------------------------
def parse_listing_html(html: str, stage: str, listing_url: str) -> List[ScrapedFiling]:
    out: List[ScrapedFiling] = []
    soup = BeautifulSoup(html, "lxml")

    table = soup.find("table", id="sample_1") or soup.find("table")
    if table is None:
        log.warning("No table found on %s listing page — page may have changed.", stage)
        return out

    tbody = table.find("tbody") or table
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        date_text = cells[0].get_text(strip=True)
        if not date_text:
            continue
        try:
            filing_date = date_parser.parse(date_text, dayfirst=False).date()
        except (ValueError, OverflowError):
            log.warning("Unparseable date %r on %s page — skipping row.", date_text, stage)
            continue

        title_cell = cells[1]
        # The anchor's `title` attribute holds "<COMPANY TYPE><br><a ...pdf>...</a>".
        anchor = title_cell.find("a")
        title_attr = anchor.get("title", "") if anchor else ""
        # Company + type live before the <br>; unescape HTML entities.
        title_main = html_lib.unescape(re.split(r"<br\s*/?>", title_attr, maxsplit=1)[0]).strip()
        if not title_main:
            title_main = anchor.get_text(strip=True) if anchor else title_cell.get_text(strip=True)

        detail_url = anchor.get("href", "").strip() if anchor else ""
        # The abridged-prospectus PDF is embedded inside the title attribute.
        pdf_match = re.search(r"href=\s*['\"]([^'\"]+\.pdf)['\"]", title_attr, re.I)
        abridged_pdf = html_lib.unescape(pdf_match.group(1)) if pdf_match else None

        filing_type = classify_filing_type(title_main, stage)
        company = extract_company_name(title_main)
        if not company:
            continue

        out.append(
            ScrapedFiling(
                company_name_raw=company,
                filing_date=filing_date,
                filing_type=filing_type,
                stage=stage,
                sebi_url=detail_url or listing_url,
                abridged_pdf_url=abridged_pdf,
                title_raw=title_main,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Fetching (direct, with headless fallback)
# ---------------------------------------------------------------------------
def _looks_empty(html: str) -> bool:
    """A page that returned 200 but has no usable table (JS gate / block page)."""
    if not html or len(html) < 1000:
        return True
    low = html.lower()
    return "<table" not in low and "sample_1" not in low


def fetch_page(url: str, timeout: int = 30) -> Optional[str]:
    """Direct HTTP fetch. Returns HTML or None on failure (logged, never raised)."""
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as exc:  # network, timeout, HTTP error
        log.warning("Direct fetch failed for %s: %s", url, exc)
        return None


def _fetch_with_browser(url: str, timeout: int = 45) -> Optional[str]:
    """Lazy Playwright fallback. Returns None if Playwright isn't installed."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.warning(
            "Headless fallback unavailable (Playwright not installed); skipping %s.", url
        )
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent=_HEADERS["User-Agent"])
            page.goto(url, timeout=timeout * 1000, wait_until="networkidle")
            content = page.content()
            browser.close()
            return content
    except Exception as exc:  # noqa: BLE001 — fallback must never crash the run
        log.warning("Headless fetch failed for %s: %s", url, exc)
        return None


def scrape(stage: str) -> List[ScrapedFiling]:
    """Scrape one stage's listing page. Always returns a list (possibly empty)."""
    url = DRHP_URL if stage == "DRHP" else IPO_URL
    html = fetch_page(url)
    if html is None or _looks_empty(html):
        log.info("Falling back to headless browser for %s page.", stage)
        html = _fetch_with_browser(url)
    if html is None or _looks_empty(html):
        log.warning("Could not retrieve usable %s listing — continuing with 0 rows.", stage)
        return []
    filings = parse_listing_html(html, stage, url)
    log.info("Scraped %d %s filings.", len(filings), stage)
    return filings


def scrape_all() -> List[ScrapedFiling]:
    """Scrape both pages. A failure on one page does not affect the other."""
    return scrape("DRHP") + scrape("IPO")
