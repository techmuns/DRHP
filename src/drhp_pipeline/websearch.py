"""
Web-search fallback for financials (pluggable, off by default).

Per the project decisions, financials come from the official DRHP PDF FIRST and only
fall back to web search when the PDF isn't available yet — and a web-sourced number
is never fully trusted, so it must be labelled `source="WEB"` with an honest
confidence and flagged for the team to double-check.

The default provider here is a deliberate NO-OP: it returns `None`, so an
unconfigured pipeline leaves the field `null` rather than fabricating a value. A real
provider (search API / internal data service) can be wired in later by replacing
`lookup` — it should return a dict of {contract_field: (value, confidence)} for only
the fields it can actually verify.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, Optional, Tuple

log = logging.getLogger("drhp.web")

# Fields a web provider is allowed to fill (mirrors the contract financials block).
WEB_FILLABLE = {
    "revenue_fy25", "revenue_fy24", "pat_fy25", "pat_fy24",
    "ebitda_fy25", "roe_pct", "roce_pct", "debt_equity",
    "asset_base_cr", "promoter_hold_pct",
}


def is_enabled() -> bool:
    """Web fallback only runs if a provider has been explicitly configured."""
    return bool(os.environ.get("DRHP_WEB_SEARCH_PROVIDER"))


def lookup(company_name: str, normalized_name: str) -> Optional[Dict[str, Tuple[float, str]]]:
    """Return verified web figures, or None when unconfigured (the default).

    A real implementation returns e.g. {"roe_pct": (14.2, "low"), ...} using only
    values it could actually source. Returning None (or omitting a field) keeps that
    field null — we never guess.
    """
    if not is_enabled():
        return None
    # Placeholder for a future provider; intentionally returns nothing for now so we
    # never emit an unverified number.
    log.info("Web fallback configured but no provider implemented; skipping %s.", company_name)
    return None
