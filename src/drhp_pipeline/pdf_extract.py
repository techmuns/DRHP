"""
PDF financial-table extraction.

SEBI "abridged prospectus" PDFs carry a clean financial-summary / KPI table. Its
columns are laid out latest-first and almost always LEAD WITH A STUB PERIOD
(e.g. "Nine months ended Dec-25") followed by full fiscal years:

    Particulars   unit   Dec-25   Fiscal 2025   Fiscal 2024   Fiscal 2023

We must therefore *skip the stub column* and read the latest full year as "FY25" and
the prior full year as "FY24" (these contract field names denote latest / prior full
year, not literally the year 2025). Monetary rows are converted to ₹ Crore using the
unit declared in the document.

All parsing works on a list of text lines so it can be unit-tested against a small
fixture without any network or real PDF.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import List, Optional

log = logging.getLogger("drhp.pdf")

MAX_PDF_BYTES = 25 * 1024 * 1024  # safety cap on download size
MAX_PAGES = 60  # abridged prospectuses are short; cap scanning for safety

# Currency unit -> factor that converts a raw value into ₹ Crore.
_UNIT_TO_CR = {
    "crore": 1.0,
    "crores": 1.0,
    "million": 0.1,   # 10 million = 1 crore
    "millions": 0.1,
    "lakh": 0.01,     # 100 lakh = 1 crore
    "lakhs": 0.01,
    "lac": 0.01,
    "lacs": 0.01,
    "thousand": 0.0001,
}


@dataclass
class RawPdfFinancials:
    """Raw numbers in the document's *original* unit (money not yet → Cr)."""

    revenue_fy25: Optional[float] = None
    revenue_fy24: Optional[float] = None
    total_income_fy25: Optional[float] = None
    pat_fy25: Optional[float] = None
    pat_fy24: Optional[float] = None
    ebitda_fy25: Optional[float] = None
    ebitda_margin_pct: Optional[float] = None
    roe_pct: Optional[float] = None
    roce_pct: Optional[float] = None
    debt_equity: Optional[float] = None
    promoter_hold_pct: Optional[float] = None
    currency_to_cr: float = 0.1  # default assume "million" if undetected
    unit_detected: bool = False
    ok: bool = False  # found a usable financial table


# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------
_FOOTNOTE = re.compile(r"\((\d{1,2})\)")  # e.g. "(1)", "(20)" — NOT "(12,865.18)"
_NUM = re.compile(r"\(?₹?\s?-?[\d,]+(?:\.\d+)?\)?%?")


def parse_number(token: str) -> Optional[float]:
    """Parse one numeric token. Parentheses => negative; strips ₹, %, commas."""
    t = token.strip()
    if not t:
        return None
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()").replace("₹", "").replace("%", "").replace(",", "").strip()
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", t):
        return None
    val = float(t)
    return -val if neg else val


def numeric_tokens(line: str) -> List[float]:
    """All numeric values on a line, after removing footnote markers and units."""
    cleaned = _FOOTNOTE.sub(" ", line)
    out: List[float] = []
    for m in _NUM.finditer(cleaned):
        v = parse_number(m.group(0))
        if v is not None:
            out.append(v)
    return out


# ---------------------------------------------------------------------------
# Column selection (skip the leading stub period when present)
# ---------------------------------------------------------------------------
def detect_stub(text: str) -> bool:
    low = text.lower()
    return any(
        k in low
        for k in ("nine month", "nine-month", "six month", "months ended",
                  "period ended", "dec-25", "dec-24", "interim", "stub period")
    )


def pick_fy(tokens: List[float], has_stub: bool) -> tuple[Optional[float], Optional[float]]:
    """Return (latest_full_year, prior_full_year) from a row's numeric tokens."""
    if has_stub and len(tokens) >= 4:
        return tokens[1], tokens[2]
    if len(tokens) >= 2:
        return tokens[0], tokens[1]
    if len(tokens) == 1:
        return tokens[0], None
    return None, None


# ---------------------------------------------------------------------------
# Currency unit
# ---------------------------------------------------------------------------
_UNIT_RE = re.compile(
    r"(?:₹|rs\.?|inr)?\s*(?:in|\(in)\s*₹?\s*(million|millions|lakhs?|lacs?|crores?|thousand)",
    re.I,
)


def detect_currency_to_cr(text: str) -> tuple[float, bool]:
    m = _UNIT_RE.search(text)
    if m:
        return _UNIT_TO_CR[m.group(1).lower()], True
    return 0.1, False  # default: assume million (most common), flagged as undetected


# ---------------------------------------------------------------------------
# Row matching
# ---------------------------------------------------------------------------
# Each metric: ordered list of start-anchored label patterns. First value-row
# (>=2 numeric tokens) whose start matches wins.
_LABELS = {
    "revenue": [r"revenue from operation", r"revenue from", r"total income", r"total revenue"],
    "total_income": [r"total income", r"total revenue"],
    "pat": [r"profit after tax", r"restated profit", r"pat\b", r"profit for the",
            r"profit/\(loss\) for the", r"net profit"],
    "ebitda": [r"ebitda\s+(?:₹\s*)?\(?\d"],  # absolute EBITDA only (number right after)
    "ebitda_margin": [r"ebitda margin"],
    "roe": [r"return on equity", r"return on net worth"],
    "roce": [r"return on capital"],
    "debt_equity": [r"debt[\s/-]*equity"],
}


def _find_row(value_rows: List[str], patterns: List[str]) -> Optional[List[float]]:
    for pat in patterns:
        rx = re.compile(r"^\s*" + pat, re.I)
        for line in value_rows:
            stripped = _FOOTNOTE.sub(" ", line)
            if rx.match(stripped):
                toks = numeric_tokens(line)
                if len(toks) >= 1:
                    return toks
    return None


def _find_promoter_holding(lines: List[str]) -> Optional[float]:
    """Pre-issue promoter holding % from a 'Sub-total (A)' / promoter total row.

    Layout is "<share count> <pre-issue %> <share count> <post-issue %> ...", so the
    first token in the (0, 100] range is the pre-issue promoter holding.
    """
    for line in lines:
        low = line.lower()
        if "sub-total (a)" in low or low.strip().startswith("total promoter") or (
            "total (a)" in low and "promoter" in low
        ):
            for v in numeric_tokens(line):
                if 0 < v <= 100:
                    return round(v, 2)
    return None


# ---------------------------------------------------------------------------
# Top-level extraction from text lines
# ---------------------------------------------------------------------------
def extract_from_lines(lines: List[str]) -> RawPdfFinancials:
    text = "\n".join(lines)
    has_stub = detect_stub(text)
    factor, unit_ok = detect_currency_to_cr(text)
    value_rows = [ln for ln in lines if len(numeric_tokens(ln)) >= 2]

    raw = RawPdfFinancials(currency_to_cr=factor, unit_detected=unit_ok)

    def fy(metric: str):
        toks = _find_row(value_rows, _LABELS[metric])
        return pick_fy(toks, has_stub) if toks else (None, None)

    raw.revenue_fy25, raw.revenue_fy24 = fy("revenue")
    raw.total_income_fy25, _ = fy("total_income")
    raw.pat_fy25, raw.pat_fy24 = fy("pat")
    raw.ebitda_fy25, _ = fy("ebitda")
    raw.ebitda_margin_pct, _ = fy("ebitda_margin")
    raw.roe_pct, _ = fy("roe")
    raw.roce_pct, _ = fy("roce")
    raw.debt_equity, _ = fy("debt_equity")
    raw.promoter_hold_pct = _find_promoter_holding(lines)

    raw.ok = raw.revenue_fy25 is not None or raw.pat_fy25 is not None
    return raw


# ---------------------------------------------------------------------------
# Business summary & issue structure (best-effort, from the same text lines)
# ---------------------------------------------------------------------------
_SUMMARY_STARTS = ("our company is", "we are ", "our company was", "the company is",
                   "our business", "we operate")


def extract_business_summary(lines: List[str], max_len: int = 240) -> Optional[str]:
    for ln in lines:
        low = ln.strip().lower()
        if low.startswith(_SUMMARY_STARTS) and len(ln.strip()) > 40:
            text = re.sub(r"\s+", " ", ln.strip())
            return text[:max_len].rsplit(" ", 1)[0] + ("…" if len(text) > max_len else "")
    return None


_FRESH_RE = re.compile(
    r"fresh issue[^₹]{0,80}?₹?\s*([\d,]+(?:\.\d+)?)\s*(million|millions|crores?|lakhs?)", re.I)
_OFS_RE = re.compile(
    r"offer for sale[^₹]{0,80}?₹?\s*([\d,]+(?:\.\d+)?)\s*(million|millions|crores?|lakhs?)", re.I)


def extract_issue(lines: List[str]) -> tuple[Optional[str], Optional[float], Optional[float]]:
    """Return (issue_type, fresh_cr, ofs_cr). Amounts are often masked in a DRHP."""
    text = "\n".join(lines)
    low = text.lower()
    has_fresh = "fresh issue" in low
    has_ofs = "offer for sale" in low

    def amt(m):
        if not m:
            return None
        val = float(m.group(1).replace(",", ""))
        return round(val * _UNIT_TO_CR.get(m.group(2).lower(), 0.1), 2)

    fresh_cr = amt(_FRESH_RE.search(text))
    ofs_cr = amt(_OFS_RE.search(text))

    if has_fresh and has_ofs:
        itype = "Both"
    elif has_fresh:
        itype = "Fresh"
    elif has_ofs:
        itype = "OFS"
    else:
        itype = None
    return itype, fresh_cr, ofs_cr


# ---------------------------------------------------------------------------
# PDF download + text extraction (network side; kept thin for testability)
# ---------------------------------------------------------------------------
def download_pdf(url: str, dest: str, timeout: int = 60) -> Optional[str]:
    import requests

    headers = {"User-Agent": "Mozilla/5.0 (compatible; DRHP-Monitor/1.0)"}
    try:
        with requests.get(url, headers=headers, timeout=timeout, stream=True) as r:
            r.raise_for_status()
            size = 0
            with open(dest, "wb") as fh:
                for chunk in r.iter_content(chunk_size=65536):
                    size += len(chunk)
                    if size > MAX_PDF_BYTES:
                        log.warning("PDF %s exceeds size cap — aborting download.", url)
                        return None
                    fh.write(chunk)
        return dest
    except Exception as exc:  # noqa: BLE001 — never crash the run on a bad PDF
        log.warning("PDF download failed for %s: %s", url, exc)
        return None


def pdf_to_lines(path: str, max_pages: int = MAX_PAGES) -> List[str]:
    import pdfplumber

    lines: List[str] = []
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages[:max_pages]:
                text = page.extract_text() or ""
                lines.extend(text.split("\n"))
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not read PDF %s: %s", path, exc)
    return lines


def extract_from_pdf_url(url: str, scratch_dir: str = "/tmp") -> RawPdfFinancials:
    import os

    dest = os.path.join(scratch_dir, "drhp_" + re.sub(r"\W+", "_", url)[-80:] + ".pdf")
    if download_pdf(url, dest) is None:
        return RawPdfFinancials(ok=False)
    lines = pdf_to_lines(dest)
    try:
        os.remove(dest)
    except OSError:
        pass
    if not lines:
        return RawPdfFinancials(ok=False)
    return extract_from_lines(lines)
