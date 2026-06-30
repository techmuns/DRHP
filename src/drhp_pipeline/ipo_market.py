"""
IPO market layer — primary-issuance lifecycle data from NSE.

SEBI gives us the *filing* side (DRHP / prospectus). NSE's public IPO endpoints give
the *issuance* side: open / upcoming / closed issues, Mainboard vs SME board, issue
dates, price band, subscription, and listing dates. We join the two by normalized
company name so a DRHP filing can show where it is in the lifecycle:

    DRHP Filed -> Updated -> IPO Open -> Listing Soon -> Listed

Honest limits (do not fabricate): NSE's quote API is blocked (403), so we have NO
current price and therefore CANNOT compute listing gain/loss — those stay null
("Pending listing"). Merchant banker and city are not in NSE's IPO feed either.

NSE also blocks datacenter IPs aggressively, so the weekly CI run may not reach it.
Every fetch is best-effort: on any failure we return `available=False` and the UI
shows a "pending source" state rather than crashing or inventing data.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from dateutil import parser as date_parser

from .contract import IpoMarket, IpoPulse, IpoRow
from .resolve import normalize_name

log = logging.getLogger("drhp.ipo")

NSE_HOME = "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
EP_UPCOMING = "https://www.nseindia.com/api/all-upcoming-issues?category=ipo"
EP_CURRENT = "https://www.nseindia.com/api/ipo-current-issue"
EP_PAST = "https://www.nseindia.com/api/public-past-issues"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE_HOME,
}

RECENT_LISTING_DAYS = 120     # window for "recent listings"
LISTED_PULSE_DAYS = 30        # window counted as "Listed" in the pulse
MAX_LISTINGS = 30

# Status flags that mean an issue was pulled.
_WITHDRAWN_RE = re.compile(r"[-–]\s*(issue\s+)?(withdraw\w*|special withdrawal|withdrawal\s+\w+|postpon\w*)",
                           re.I)


# ---------------------------------------------------------------------------
# Pure parsers (operate on already-fetched JSON lists; unit-tested via fixtures)
# ---------------------------------------------------------------------------
def parse_date(s: Optional[str]) -> Optional[str]:
    if not s or s.strip() in ("-", ""):
        return None
    try:
        return date_parser.parse(s.strip(), dayfirst=True).date().isoformat()
    except (ValueError, OverflowError):
        return None


def clean_company(name: str) -> Tuple[str, bool]:
    """Return (clean_name, withdrawn). NSE appends status notes after a dash."""
    withdrawn = bool(_WITHDRAWN_RE.search(name or ""))
    clean = _WITHDRAWN_RE.split(name or "")[0]
    clean = re.sub(r"\s*[-–]\s*$", "", clean).strip()
    return clean, withdrawn


def board_from_series(series: Optional[str]) -> str:
    return "SME" if (series or "").strip().upper() == "SME" else "Mainboard"


def parse_price_band(s: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    if not s:
        return None, None
    nums = re.findall(r"[\d,]+(?:\.\d+)?", s.replace(",", ""))
    vals = [float(n) for n in nums if n]
    if not vals:
        return None, None
    return (vals[0], vals[-1])


def issue_size_cr(shares: Optional[str], high_price: Optional[float]) -> Optional[float]:
    if not shares or high_price is None:
        return None
    try:
        n = float(str(shares).replace(",", ""))
    except ValueError:
        return None
    if n <= 0:
        return None
    return round(n * high_price / 1e7, 2)  # shares * ₹ -> ₹ Crore


def parse_subscription(v) -> Optional[float]:
    if v in (None, "", "-"):
        return None
    try:
        return round(float(v), 2)
    except (ValueError, TypeError):
        return None


def _stage_from_status(status: Optional[str], withdrawn: bool) -> str:
    if withdrawn:
        return "Withdrawn"
    st = (status or "").strip().lower()
    if st == "active":
        return "IPO Open"
    if st == "forthcoming":
        return "Upcoming"
    if st == "closed":
        return "Listing Soon"
    return "IPO Open" if st else "Upcoming"


# ---------------------------------------------------------------------------
# Assemble the market view from raw NSE lists
# ---------------------------------------------------------------------------
def build_open_upcoming(upcoming: List[dict], current: List[dict]) -> List[IpoRow]:
    # subscription comes from the current-issue feed (one "Total" row per symbol)
    subs: Dict[str, float] = {}
    for r in current or []:
        if str(r.get("category", "Total")).lower() in ("total", ""):
            sym = r.get("symbol")
            if sym and sym not in subs:
                s = parse_subscription(r.get("noOfTime"))
                if s is not None:
                    subs[sym] = s

    seen, rows = set(), []
    for r in (upcoming or []) + (current or []):
        sym = r.get("symbol")
        key = sym or r.get("companyName")
        if not key or key in seen:
            continue
        seen.add(key)
        name, withdrawn = clean_company(r.get("companyName") or "")
        low, high = parse_price_band(r.get("issuePrice") or r.get("priceRange"))
        rows.append(IpoRow(
            company_name=name,
            board=board_from_series(r.get("series")),
            symbol=sym,
            issue_open=parse_date(r.get("issueStartDate")),
            issue_close=parse_date(r.get("issueEndDate")),
            price_band=(r.get("issuePrice") or r.get("priceRange") or "").strip() or None,
            issue_size_cr=issue_size_cr(r.get("issueSize"), high),
            subscription_x=subs.get(sym),
            issue_price=high,
            status=(r.get("status") or "").strip() or None,
            stage=_stage_from_status(r.get("status"), withdrawn),
        ))
    # Most relevant first: open, then upcoming, then closed/listing-soon
    order = {"IPO Open": 0, "Upcoming": 1, "Listing Soon": 2, "Withdrawn": 3}
    rows.sort(key=lambda x: order.get(x.stage, 9))
    return rows


def build_recent_listings(past: List[dict], run_date: date) -> List[IpoRow]:
    cutoff = run_date - timedelta(days=RECENT_LISTING_DAYS)
    rows = []
    for r in past or []:
        ld = parse_date(r.get("listingDate"))
        if not ld:
            continue
        if date.fromisoformat(ld) < cutoff:
            continue
        name, withdrawn = clean_company(r.get("companyName") or r.get("company") or "")
        if withdrawn:
            continue
        low, high = parse_price_band(r.get("priceRange") or r.get("issuePrice"))
        ip = None
        if r.get("issuePrice") and r["issuePrice"].strip() not in ("-", ""):
            _, ip = parse_price_band(r.get("issuePrice"))
        rows.append(IpoRow(
            company_name=name,
            board=board_from_series(r.get("securityType")),
            symbol=r.get("symbol"),
            issue_open=parse_date(r.get("ipoStartDate")),
            issue_close=parse_date(r.get("ipoEndDate")),
            listing_date=ld,
            price_band=(r.get("priceRange") or "").strip() or None,
            issue_price=ip or high,
            current_price=None,   # NSE quote API blocked -> unknown
            gain_pct=None,        # therefore listing gain/loss is unknown
            status="Listed",
            stage="Listed",
        ))
    rows.sort(key=lambda x: x.listing_date or "", reverse=True)
    return rows[:MAX_LISTINGS]


def build_market(raw: Optional[dict], run_date: date,
                 sector_by_norm: Optional[Dict[str, str]] = None) -> IpoMarket:
    """Assemble the contract IpoMarket from raw NSE lists (or unavailable)."""
    if not raw:
        return IpoMarket(available=False, as_of=run_date.isoformat(), source="NSE")

    sector_by_norm = sector_by_norm or {}
    open_upcoming = build_open_upcoming(raw.get("upcoming", []), raw.get("current", []))
    recent_listings = build_recent_listings(raw.get("past", []), run_date)

    for row in open_upcoming + recent_listings:
        row.sector = sector_by_norm.get(normalize_name(row.company_name))

    listed_cut = run_date - timedelta(days=LISTED_PULSE_DAYS)
    listed_recent = sum(
        1 for r in recent_listings
        if r.listing_date and date.fromisoformat(r.listing_date) >= listed_cut
    )
    pulse = IpoPulse(
        ipo_open=sum(1 for r in open_upcoming if r.stage == "IPO Open"),
        listing_soon=sum(1 for r in open_upcoming if r.stage == "Listing Soon"),
        listed=listed_recent,
        positive_listing=None,   # needs listing price — not available
        negative_listing=None,
    )
    by_board = {
        "mainboard": sum(1 for r in open_upcoming if r.board == "Mainboard"),
        "sme": sum(1 for r in open_upcoming if r.board == "SME"),
    }
    return IpoMarket(
        available=True, as_of=run_date.isoformat(), source="NSE",
        pulse=pulse, by_board=by_board,
        open_upcoming=open_upcoming, recent_listings=recent_listings,
    )


def index_by_name(market: IpoMarket) -> Dict[str, IpoRow]:
    """normalized_name -> best IpoRow, for enriching DRHP filings with lifecycle."""
    idx: Dict[str, IpoRow] = {}
    for row in (market.open_upcoming or []) + (market.recent_listings or []):
        idx.setdefault(normalize_name(row.company_name), row)
    return idx


# ---------------------------------------------------------------------------
# Network (best-effort; never raises)
# ---------------------------------------------------------------------------
def fetch_raw(timeout: int = 25) -> Optional[dict]:
    import requests

    try:
        s = requests.Session()
        s.headers.update(_HEADERS)
        s.get(NSE_HOME, timeout=timeout)  # prime cookies
        out = {}
        for key, url in (("upcoming", EP_UPCOMING), ("current", EP_CURRENT), ("past", EP_PAST)):
            r = s.get(url, timeout=timeout)
            if r.status_code != 200:
                log.warning("NSE %s returned HTTP %s", key, r.status_code)
                out[key] = []
                continue
            try:
                out[key] = r.json()
            except ValueError:
                log.warning("NSE %s did not return JSON (likely blocked).", key)
                out[key] = []
        if not any(out.values()):
            log.warning("NSE returned no usable IPO data (likely blocked from this host).")
            return None
        return out
    except Exception as exc:  # noqa: BLE001 — network/parse must never crash the run
        log.warning("NSE IPO fetch failed: %s", exc)
        return None
