"""
Groww — secondary enrichment source (SECONDARY to SEBI / NSE / BSE / company filings).

Official filings stay authoritative: this module only *fills gaps*. It never overwrites
a valid official-source value; where Groww and an official source disagree, the official
value is kept and the difference is recorded for review (see ``groww_enrich``).

Fetching: Groww server-renders the full page data as an embedded Next.js JSON blob
(``{"props":{"pageProps": ...}}``), so a plain HTTPS GET returns everything we need —
no headless browser, and no login / CAPTCHA / anti-bot circumvention. Responses are
cached on disk and rate-limited.

Page types (all parsed from the same embedded JSON):
  * stock page      https://groww.in/stocks/{slug}         → fundamentals, financials, holding
  * ipo detail      https://groww.in/ipo/{slug}            → dates, price band, subscription
  * ipo subscription https://groww.in/ipo/subscription     → live subscription for open IPOs
  * ipo closed      https://groww.in/ipo/closed            → final subscription / listing
  * search          /v1/api/search/v3/query/global/st_query → name → stock slug resolution
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import requests

from .resolve import normalize_name

log = logging.getLogger("drhp.groww")

BASE = "https://groww.in"
SEARCH_URL = BASE + "/v1/api/search/v3/query/global/st_query"
STOCK_URL = BASE + "/stocks/{slug}"
IPO_URL = BASE + "/ipo/{slug}"
IPO_SUBSCRIPTION_URL = BASE + "/ipo/subscription"
IPO_CLOSED_URL = BASE + "/ipo/closed"

SOURCE_NAME = "Groww"
USER_AGENT = "Mozilla/5.0 (compatible; DRHP-Intelligence/1.0; secondary-enrichment)"
DEFAULT_CACHE_DIR = "data/cache/groww"
DEFAULT_RATE_LIMIT = 1.5  # seconds between live network calls (conservative)
STRONG_MATCH_THRESHOLD = 0.72

# Alias map for renamed / shortened companies: normalized filing name -> Groww search term.
# Keep small and explicit; only add entries that are verified.
ALIASES: Dict[str, str] = {
    # Waterways Leisure Tourism operates the Cordelia Cruises brand; Groww lists it
    # under its own name, so no alias is required — this entry documents the pattern.
    # "old normalized name": "Correct Search Term",
}


# ---------------------------------------------------------------------------
# Value parsing — Groww renders human strings ("₹6,210Cr", "65.01%", "1.47")
# ---------------------------------------------------------------------------
_NUM_RE = re.compile(r"-?\d[\d,]*\.?\d*")


def _first_number(text: str) -> Optional[float]:
    if text is None:
        return None
    m = _NUM_RE.search(str(text).replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def parse_number(text) -> Optional[float]:
    """Plain numeric like '119.15' or '7.20' or 7.2 -> 119.15 / 7.2."""
    if isinstance(text, (int, float)):
        return float(text)
    return _first_number(text)


def parse_percent(text) -> Optional[float]:
    """'65.01%' -> 65.01 ; '0.00%' -> 0.0 ; already-numeric passes through."""
    return parse_number(text)


def parse_multiple(text) -> Optional[float]:
    """Subscription multiple: '1.44x' or 1.44 -> 1.44."""
    return parse_number(text)


def parse_money_cr(text) -> Optional[float]:
    """Money in ₹ crore.

    '₹6,210Cr' -> 6210.0 ; '₹9,812.91 Cr' -> 9812.91.
    A bare number with a lakh/thousand-crore suffix is scaled; a large absolute
    rupee integer (e.g. 98129100000) is converted to crore.
    """
    if text is None:
        return None
    if isinstance(text, (int, float)):
        v = float(text)
        # Heuristic: values this large are absolute rupees, not crore.
        return round(v / 1e7, 2) if abs(v) >= 1e6 else v
    s = str(text)
    n = _first_number(s)
    if n is None:
        return None
    low = s.lower()
    if "lakh cr" in low or "l cr" in low:
        return round(n * 100000, 2)
    return n


def rupees_to_cr(value) -> Optional[float]:
    """Absolute rupees -> crore (₹1 crore = 1e7)."""
    n = parse_number(value)
    return None if n is None else round(n / 1e7, 2)


def _iso_from_epoch_ms(ms) -> Optional[str]:
    n = parse_number(ms)
    if n is None:
        return None
    try:
        return datetime.fromtimestamp(n / 1000, tz=timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Company matching — strong-match gate (never match on a single shared keyword)
# ---------------------------------------------------------------------------
def match_confidence(query: str, candidate: str) -> float:
    """Confidence in [0,1] that ``candidate`` is the same company as ``query``.

    1.0 for an exact normalized match; otherwise a Jaccard-style token overlap that
    also requires the distinctive first token to align. Returns 0.0 for a weak match.
    """
    a, b = normalize_name(query), normalize_name(candidate)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = a.split(), b.split()
    sa, sb = set(ta), set(tb)
    shared = sa & sb
    if not shared:
        return 0.0
    # The leading token is the most identifying part of an Indian company name.
    if ta[0] != tb[0]:
        return 0.0
    # One name fully contained in the other (e.g. "sbi funds management" vs
    # "sbi funds management ipo") is a strong match.
    if sa <= sb or sb <= sa:
        return max(0.85, len(shared) / max(len(sa), len(sb)))
    jaccard = len(shared) / len(sa | sb)
    # A single shared common token is not enough.
    if len(shared) < 2:
        return 0.0
    return jaccard


def is_strong_match(query: str, candidate: str, threshold: float = STRONG_MATCH_THRESHOLD) -> bool:
    return match_confidence(query, candidate) >= threshold


# ---------------------------------------------------------------------------
# Embedded-JSON extraction
# ---------------------------------------------------------------------------
def extract_next_data(html: str) -> Optional[dict]:
    """Pull the ``{"props":{"pageProps": ...}}`` object out of a Groww HTML page."""
    if not html:
        return None
    marker = '{"props":{"pageProps":'
    i = html.find(marker)
    if i == -1:
        return None
    start = html.find("{", i)
    depth = 0
    in_str = False
    esc = False
    for j in range(start, len(html)):
        c = html[j]
        if esc:
            esc = False
            continue
        if c == "\\":
            esc = True
            continue
        if c == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[start : j + 1])
                except json.JSONDecodeError as e:
                    log.warning("Groww JSON parse failed: %s", e)
                    return None
    return None


def _page_props(html: str) -> dict:
    data = extract_next_data(html) or {}
    return (data.get("props") or {}).get("pageProps") or {}


# ---------------------------------------------------------------------------
# Page parsers (pure functions — unit-tested against saved fixtures)
# ---------------------------------------------------------------------------
_FUND_MAP = [
    ("market cap", "market_cap_cr", parse_money_cr),
    ("roe", "roe_pct", parse_percent),
    ("p/e ratio", "pe_ratio", parse_number),
    ("eps", "eps", parse_number),
    ("p/b ratio", "pb_ratio", parse_number),
    ("dividend yield", "dividend_yield_pct", parse_percent),
    ("industry p/e", "industry_pe", parse_number),
    ("book value", "book_value", parse_number),
    ("debt to equity", "debt_equity", parse_number),
    ("face value", "face_value", parse_number),
]


def _promoter_holding(shp: dict) -> Tuple[Optional[float], Optional[str]]:
    """Latest promoter holding % from a shareHoldingPattern block, with its period."""
    if not isinstance(shp, dict) or not shp:
        return None, None
    # Periods look like "Jun '26"; the most recent is the one we want.
    period = list(shp.keys())[0]
    block = shp.get(period) or {}
    prom = block.get("promoters") or {}
    total = 0.0
    seen = False
    for k in ("individual", "government", "corporation"):
        p = (prom.get(k) or {}).get("percent")
        if p is not None:
            total += float(p)
            seen = True
    return (round(total, 2) if seen else None), period


def parse_stock(html: str) -> Optional[dict]:
    """Parse a Groww stock page into fundamentals + financials + holding."""
    pp = _page_props(html)
    sd = pp.get("stockData")
    if not sd:
        return None
    header = sd.get("header") or {}
    out: dict = {
        "search_id": header.get("searchId"),
        "isin": header.get("isin"),
        "display_name": header.get("displayName"),
        "nse_code": header.get("nseScriptCode"),
        "bse_code": header.get("bseScriptCode"),
        "fundamentals": {},
        "financials_by_year": {},
        "promoter_hold_pct": None,
        "promoter_period": None,
    }
    for item in sd.get("fundamentals") or []:
        name = (item.get("name") or "").strip().lower()
        raw = item.get("value")
        for needle, key, fn in _FUND_MAP:
            if name.startswith(needle) or needle in name:
                val = fn(raw)
                if val is not None:
                    out["fundamentals"][key] = {"value": val, "raw": raw}
                break

    fs = sd.get("financialStatementV2") or {}
    rows = fs.get("CONSOLIDATED") or fs.get("STANDALONE") or []
    basis = "CONSOLIDATED" if fs.get("CONSOLIDATED") else ("STANDALONE" if fs.get("STANDALONE") else None)
    title_key = {"revenue": "revenue_cr", "profit": "pat_cr", "net worth": "net_worth_cr",
                 "ebitda": "ebitda_cr", "operating profit": "ebitda_cr"}
    for row in rows:
        key = title_key.get((row.get("title") or "").strip().lower())
        if not key:
            continue
        for year, val in (row.get("yearly") or {}).items():
            fy = f"FY{year}"
            out["financials_by_year"].setdefault(fy, {"fiscal_year": fy, "basis": basis})
            num = parse_number(val)
            if num is not None:
                out["financials_by_year"][fy][key] = round(num, 2)

    ph, period = _promoter_holding(sd.get("shareHoldingPattern") or {})
    out["promoter_hold_pct"] = ph
    out["promoter_period"] = period
    return out


def _subscription_from_rates(rates) -> dict:
    """subscriptionRates list -> {qib,nii,retail,employee,total}."""
    cat = {"QIB": "qib", "NII": "nii", "RETAIL": "retail", "EMPLOYEES": "employee",
           "EMPLOYEE": "employee", "TOTAL": "total", "OVERALL": "total"}
    out: dict = {}
    for r in rates or []:
        key = cat.get((r.get("category") or "").upper())
        if key:
            v = parse_multiple(r.get("subscriptionRate"))
            out[key] = round(v, 2) if v is not None else None
    return out


def _price_band(min_p, max_p) -> Optional[str]:
    lo, hi = parse_number(min_p), parse_number(max_p)
    if lo is None and hi is None:
        return None
    if lo is not None and hi is not None:
        return f"Rs.{lo:g} to Rs.{hi:g}"
    return f"Rs.{(lo or hi):g}"


def parse_ipo_detail(html: str) -> Optional[dict]:
    """Parse a Groww IPO detail page (/ipo/{slug})."""
    d = _page_props(html).get("ipoData")
    if not d:
        return None
    listing = d.get("listing") or {}
    lot = parse_number(d.get("lotSize"))
    max_p = parse_number(d.get("maxPrice"))
    out = {
        "company_name": d.get("companyName"),
        "symbol": d.get("symbol"),
        "board": "SME" if d.get("isSme") else "Mainboard",
        "open_date": d.get("startDate"),
        "close_date": d.get("endDate"),
        "listing_date": d.get("listedOn") and None,  # exact listing date not in this block
        "price_band": _price_band(d.get("minPrice"), d.get("maxPrice")),
        "issue_price": parse_number(d.get("issuePrice")),
        "lot_size": lot,
        "min_investment": (round(lot * max_p) if lot and max_p else None),
        "issue_size_cr": rupees_to_cr(d.get("issueSize")),
        "listing_price": parse_number(listing.get("listingPrice")),
        "subscription": _subscription_from_rates(d.get("subscriptionRates")),
        "subscription_as_of": d.get("subscriptionUpdatedAt"),
        "document_url": d.get("documentUrl"),
        "nse_code": listing.get("nseScripCode"),
        "bse_code": listing.get("bseScripCode"),
    }
    if out["issue_price"] and out["listing_price"]:
        out["listing_gain_pct"] = round(
            (out["listing_price"] - out["issue_price"]) / out["issue_price"] * 100, 2
        )
    else:
        out["listing_gain_pct"] = None
    return out


def _parse_ipo_list_item(item: dict) -> dict:
    cats = item.get("categories") or []
    min_p = min([c.get("minPrice") for c in cats if c.get("minPrice") is not None], default=None)
    max_p = max([c.get("maxPrice") for c in cats if c.get("maxPrice") is not None], default=None)
    lot = next((c.get("lotSize") for c in cats if c.get("lotSize")), None)
    return {
        "company_name": item.get("companyName"),
        "search_id": item.get("searchId"),
        "isin": item.get("isin"),
        "symbol": item.get("symbol"),
        "board": "SME" if item.get("isSme") else "Mainboard",
        "open_date": _iso_from_epoch_ms(item.get("bidStartTimestamp")),
        "close_date": _iso_from_epoch_ms(item.get("bidEndTimestamp")),
        "price_band": _price_band(min_p, max_p),
        "lot_size": parse_number(lot),
        "issue_size_cr": rupees_to_cr(item.get("issueSize")),
        "subscription": {
            "total": (lambda v: round(v, 2) if v is not None else None)(
                parse_multiple(item.get("overallSubscription"))
            ),
            **_subscription_from_rates(item.get("subscriptionRates")),
        },
        "subscription_as_of": item.get("subscriptionUpdatedAt"),
    }


def parse_ipo_subscription(html: str) -> List[dict]:
    """Parse the live IPO subscription board (/ipo/subscription)."""
    dl = _page_props(html).get("dataList") or []
    return [_parse_ipo_list_item(i) for i in dl if isinstance(i, dict)]


def parse_ipo_closed(html: str) -> List[dict]:
    """Parse the closed-IPO board (/ipo/closed) — final subscription / listing."""
    pp = _page_props(html)
    dl = pp.get("dataList") or pp.get("closedIpos") or pp.get("ipoList") or []
    return [_parse_ipo_list_item(i) for i in dl if isinstance(i, dict)]


def parse_search(payload: dict) -> List[dict]:
    """Groww search response -> candidate list [{title, slug, nse_code, label}]."""
    content = ((payload or {}).get("data") or {}).get("content") or []
    out = []
    for c in content:
        out.append({
            "title": c.get("title"),
            "slug": c.get("search_id"),
            "nse_code": c.get("nse_scrip_code"),
            "label": c.get("analytics_label"),
            "type": c.get("sub_entity_type") or c.get("underlying_asset_type"),
        })
    return out


# ---------------------------------------------------------------------------
# Networked client — cache + conservative rate limit
# ---------------------------------------------------------------------------
@dataclass
class GrowwClient:
    cache_dir: str = DEFAULT_CACHE_DIR
    rate_limit: float = DEFAULT_RATE_LIMIT
    timeout: int = 25
    session: requests.Session = field(default_factory=requests.Session)
    _last_call: float = 0.0
    fetches: int = 0
    cache_hits: int = 0
    failures: int = 0

    def __post_init__(self) -> None:
        os.makedirs(self.cache_dir, exist_ok=True)
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html,application/json"})

    def _cache_path(self, key: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9._-]", "_", key)[:180]
        return os.path.join(self.cache_dir, safe)

    def _get(self, url: str, cache_key: str, params: Optional[dict] = None) -> Optional[str]:
        path = self._cache_path(cache_key)
        if os.path.exists(path):
            self.cache_hits += 1
            with open(path, encoding="utf-8") as fh:
                return fh.read()
        # conservative rate limit
        wait = self.rate_limit - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            resp = self.session.get(url, params=params, timeout=self.timeout)
            self._last_call = time.monotonic()
            self.fetches += 1
            if resp.status_code != 200:
                log.warning("Groww %s -> HTTP %s", url, resp.status_code)
                self.failures += 1
                return None
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(resp.text)
            return resp.text
        except requests.RequestException as e:
            self._last_call = time.monotonic()
            self.failures += 1
            log.warning("Groww fetch failed %s: %s", url, e)
            return None

    # -- resolution -------------------------------------------------------
    def search(self, name: str) -> List[dict]:
        term = ALIASES.get(normalize_name(name), name)
        raw = self._get(SEARCH_URL, f"search__{normalize_name(term)}.json",
                        params={"query": term, "web": "true"})
        if not raw:
            return []
        try:
            return parse_search(json.loads(raw))
        except json.JSONDecodeError:
            return []

    def resolve_stock(self, name: str) -> Optional[dict]:
        """Return {slug, title, confidence, nse_code} for the best strong stock match."""
        best = None
        for cand in self.search(name):
            slug = cand.get("slug")
            # IPO-entity slugs end in "-ipo" and 404 under /stocks — those are
            # handled via the IPO board, so don't waste a stock fetch on them.
            if not slug or slug.endswith("-ipo"):
                continue
            conf = match_confidence(name, cand.get("title") or "")
            if cand.get("label") == "EXACT_QUERO":
                conf = max(conf, 0.95)
            if conf >= STRONG_MATCH_THRESHOLD and (best is None or conf > best["confidence"]):
                best = {"slug": cand["slug"], "title": cand["title"],
                        "confidence": round(conf, 3), "nse_code": cand.get("nse_code")}
        return best

    # -- pages ------------------------------------------------------------
    def stock(self, slug: str) -> Optional[dict]:
        html = self._get(STOCK_URL.format(slug=slug), f"stock__{slug}.html")
        if not html:
            return None
        parsed = parse_stock(html)
        if parsed is not None:
            parsed["url"] = STOCK_URL.format(slug=slug)
        return parsed

    def ipo_detail(self, slug: str) -> Optional[dict]:
        html = self._get(IPO_URL.format(slug=slug), f"ipo__{slug}.html")
        if not html:
            return None
        parsed = parse_ipo_detail(html)
        if parsed is not None:
            parsed["url"] = IPO_URL.format(slug=slug)
        return parsed

    def ipo_subscription_board(self) -> List[dict]:
        html = self._get(IPO_SUBSCRIPTION_URL, "ipo_subscription.html")
        rows = parse_ipo_subscription(html) if html else []
        for r in rows:
            r["url"] = IPO_SUBSCRIPTION_URL
        return rows

    def ipo_closed_board(self) -> List[dict]:
        html = self._get(IPO_CLOSED_URL, "ipo_closed.html")
        rows = parse_ipo_closed(html) if html else []
        for r in rows:
            r["url"] = IPO_CLOSED_URL
        return rows
