"""
Stage 5 — Financial enrichment (provenance + derivation).

Turns raw PDF-extracted numbers into the contract `financials` block where every
field records WHERE it came from (`DRHP_PDF` | `WEB` | `derived`) and HOW MUCH to
trust it (`high` | `medium` | `low`). Rules:

  * Primary source is the DRHP PDF. Web fallback (see `websearch`) is off by default
    and only fills fields the PDF left null — never overwrites.
  * Derived fields (growth %, margins) are computed only when BOTH inputs exist.
    Ratios cancel the currency unit, so a derived growth/margin is trustworthy even
    when the absolute money figures carried a unit caveat.
  * Money figures are tagged `low` confidence when the document's currency unit could
    not be confirmed (the scale is uncertain); ratios/percentages are unit-independent
    and stay `high`.
  * Nothing is ever fabricated — a missing number stays null.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import List, Optional

from . import websearch
from .contract import Financials, Issue, MetricValue
from .pdf_extract import (
    RawPdfFinancials,
    download_pdf,
    extract_business_summary,
    extract_from_lines,
    extract_issue,
    pdf_to_lines,
)
from .resolve import ResolvedFiling

log = logging.getLogger("drhp.financials")


@dataclass
class Enrichment:
    financials: Financials
    issue: Issue
    business_summary: Optional[str]
    drhp_pdf_url: Optional[str]


def _growth(cur: Optional[float], prev: Optional[float]) -> Optional[float]:
    if cur is None or prev is None or prev <= 0:
        return None
    return round((cur - prev) / prev * 100, 2)


def build_financials(raw: RawPdfFinancials, company_name: str, normalized_name: str) -> Financials:
    factor = raw.currency_to_cr
    money_conf = "high" if raw.unit_detected else "low"

    def cr(v: Optional[float]) -> Optional[float]:
        return None if v is None else round(v * factor, 2)

    rev25, rev24 = cr(raw.revenue_fy25), cr(raw.revenue_fy24)
    pat25, pat24 = cr(raw.pat_fy25), cr(raw.pat_fy24)
    ebitda25 = cr(raw.ebitda_fy25)

    fin = Financials()

    def pdf_money(value: Optional[float]) -> MetricValue:
        return MetricValue(value=value, source="DRHP_PDF", confidence=money_conf) if value is not None else MetricValue.empty()

    def pdf_pct(value: Optional[float], conf: str = "high") -> MetricValue:
        return MetricValue(value=round(value, 2), source="DRHP_PDF", confidence=conf) if value is not None else MetricValue.empty()

    # --- Directly extracted ---
    fin.revenue_fy25 = pdf_money(rev25)
    fin.revenue_fy24 = pdf_money(rev24)
    fin.pat_fy25 = pdf_money(pat25)
    fin.pat_fy24 = pdf_money(pat24)
    fin.ebitda_fy25 = pdf_money(ebitda25)
    fin.roe_pct = pdf_pct(raw.roe_pct)
    fin.roce_pct = pdf_pct(raw.roce_pct)
    fin.debt_equity = pdf_pct(raw.debt_equity)
    fin.promoter_hold_pct = pdf_pct(raw.promoter_hold_pct, conf="medium")

    # --- Derived (ratios cancel the currency unit, so compute from the RAW
    #     original-unit numbers to avoid compounding the Cr rounding) ---
    rev_growth = _growth(raw.revenue_fy25, raw.revenue_fy24)
    if rev_growth is not None:
        fin.rev_growth_pct = MetricValue(value=rev_growth, source="derived", confidence="high")

    pat_growth = _growth(raw.pat_fy25, raw.pat_fy24)
    if pat_growth is not None:
        fin.pat_growth_pct = MetricValue(value=pat_growth, source="derived", confidence="high")

    denom = raw.total_income_fy25 if raw.total_income_fy25 not in (None, 0) else raw.revenue_fy25
    if raw.pat_fy25 is not None and denom not in (None, 0):
        fin.pat_margin_pct = MetricValue(
            value=round(raw.pat_fy25 / denom * 100, 2), source="derived", confidence="high"
        )

    if raw.ebitda_margin_pct is not None:
        fin.ebitda_margin_pct = pdf_pct(raw.ebitda_margin_pct)
    elif raw.ebitda_fy25 is not None and raw.revenue_fy25 not in (None, 0):
        fin.ebitda_margin_pct = MetricValue(
            value=round(raw.ebitda_fy25 / raw.revenue_fy25 * 100, 2), source="derived", confidence="high"
        )

    # --- Web fallback: only fills fields still null; never overwrites ---
    web = websearch.lookup(company_name, normalized_name)
    if web:
        for field, payload in web.items():
            if field in websearch.WEB_FILLABLE and getattr(fin, field).value is None:
                value, conf = payload
                setattr(fin, field, MetricValue(value=round(value, 2), source="WEB", confidence=conf))

    return fin


def enrich(resolved: ResolvedFiling, scratch_dir: str = "/tmp") -> Enrichment:
    """Download the filing's PDF once and build financials, issue, and summary."""
    url = resolved.abridged_pdf_url
    lines: List[str] = []
    raw = RawPdfFinancials(ok=False)

    if url:
        dest = os.path.join(scratch_dir, "drhp_" + re.sub(r"\W+", "_", url)[-80:] + ".pdf")
        if download_pdf(url, dest):
            lines = pdf_to_lines(dest)
            try:
                os.remove(dest)
            except OSError:
                pass
        if lines:
            raw = extract_from_lines(lines)
        else:
            log.warning("No text from PDF for %s; financials will fall back/stay null.", resolved.company_name)

    fin = build_financials(raw, resolved.company_name, resolved.normalized_name)

    info = extract_issue(lines) if lines else None
    issue = Issue(
        type=info.type if info else None,
        fresh_cr=info.fresh_cr if info else None,
        ofs_cr=info.ofs_cr if info else None,
        total_cr=info.total_cr if info else None,
        market_cap_cr=info.market_cap_cr if info else None,
        fresh_shares=info.fresh_shares if info else None,
        ofs_shares=info.ofs_shares if info else None,
        total_shares=info.total_shares if info else None,
        face_value=info.face_value if info else None,
    )

    summary = extract_business_summary(lines) if lines else None
    return Enrichment(financials=fin, issue=issue, business_summary=summary, drhp_pdf_url=url)
