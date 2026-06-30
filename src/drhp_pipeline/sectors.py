"""
Sector classification helper.

Keyword-based mapping from company name (and optional business text) to a
(sector, sub_sector) pair. Heuristic by design — good enough to power the Market
Heat grouping in Stage 1, and easy to sharpen later once we extract a proper
business description from the DRHP PDF. First matching keyword wins, so the list is
ordered most-specific first.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

# (keyword, sector, sub_sector) — scanned in order; first hit wins.
_RULES: List[Tuple[str, str, str]] = [
    # Healthcare
    ("hospital", "Healthcare", "Hospitals"),
    ("healthcare", "Healthcare", "Hospitals"),
    ("health", "Healthcare", "Healthcare Services"),
    ("pharma", "Healthcare", "Pharmaceuticals"),
    ("lifescience", "Healthcare", "Pharmaceuticals"),
    ("life science", "Healthcare", "Pharmaceuticals"),
    ("biotech", "Healthcare", "Biotechnology"),
    ("diagnostic", "Healthcare", "Diagnostics"),
    ("medical", "Healthcare", "Medical Devices"),
    ("nutrition", "Healthcare", "Nutrition"),
    # Financials
    ("fintech", "Financials", "Fintech"),
    ("stock exchange", "Financials", "Market Infrastructure"),
    ("securities", "Financials", "Broking"),
    ("broking", "Financials", "Broking"),
    ("capital", "Financials", "NBFC"),
    ("finance", "Financials", "NBFC"),
    ("financial", "Financials", "NBFC"),
    ("insurance", "Financials", "Insurance"),
    ("bank", "Financials", "Banking"),
    ("microfinance", "Financials", "Microfinance"),
    # Technology / Telecom
    ("fintech solutions", "Technology", "Software"),
    ("software", "Technology", "Software"),
    ("technolog", "Technology", "IT Services"),
    ("infotech", "Technology", "IT Services"),
    ("digital", "Technology", "Internet"),
    ("platform", "Technology", "Internet Platforms"),
    ("internet", "Technology", "Internet"),
    ("telecom", "Telecom", "Telecom Services"),
    ("communication", "Telecom", "Telecom Services"),
    # Consumer
    ("jewel", "Consumer", "Jewellery"),
    ("retail", "Consumer", "Retail"),
    ("food", "Consumer", "Food Products"),
    ("beverage", "Consumer", "Beverages"),
    ("consumer", "Consumer", "Consumer Goods"),
    ("apparel", "Consumer", "Apparel"),
    ("fashion", "Consumer", "Apparel"),
    ("hotel", "Consumer", "Hospitality"),
    ("hospitality", "Consumer", "Hospitality"),
    ("stays", "Consumer", "Hospitality"),
    # Materials
    ("granito", "Materials", "Ceramics & Tiles"),
    ("granite", "Materials", "Ceramics & Tiles"),
    ("ceramic", "Materials", "Ceramics & Tiles"),
    ("cement", "Materials", "Cement"),
    ("alloy", "Materials", "Metals"),
    ("steel", "Materials", "Metals"),
    ("stainless", "Materials", "Metals"),
    ("metal", "Materials", "Metals"),
    ("mining", "Materials", "Mining"),
    ("chemical", "Materials", "Chemicals"),
    ("polymer", "Materials", "Chemicals"),
    # Energy / Utilities
    ("renewable", "Energy", "Renewables"),
    ("solar", "Energy", "Renewables"),
    ("power", "Energy", "Power"),
    ("energy", "Energy", "Power"),
    ("oil", "Energy", "Oil & Gas"),
    ("gas", "Energy", "Oil & Gas"),
    # Industrials / Infra
    ("transmission", "Industrials", "Capital Goods"),
    ("engineering", "Industrials", "Engineering"),
    ("infrastructure", "Industrials", "Infrastructure"),
    ("construction", "Industrials", "Construction"),
    ("logistics", "Industrials", "Logistics"),
    ("industries", "Industrials", "Diversified Industrials"),
    ("manufactur", "Industrials", "Manufacturing"),
    # Auto
    ("automobile", "Auto", "Automobiles"),
    ("motors", "Auto", "Automobiles"),
    ("auto", "Auto", "Auto Components"),
    # Textiles
    ("spintex", "Textiles", "Textiles"),
    ("textile", "Textiles", "Textiles"),
    ("spinning", "Textiles", "Textiles"),
    ("cotton", "Textiles", "Textiles"),
    ("fabric", "Textiles", "Textiles"),
    # Real estate
    ("realty", "Real Estate", "Real Estate"),
    ("estate", "Real Estate", "Real Estate"),
    ("housing", "Real Estate", "Real Estate"),
    # Agriculture
    ("agro", "Agriculture", "Agriculture"),
    ("agri", "Agriculture", "Agriculture"),
    ("export", "Agriculture", "Agri Exports"),
]

UNCLASSIFIED = "Unclassified"


def _scan(text: str) -> Optional[Tuple[str, Optional[str]]]:
    low = text.lower()
    for keyword, sector, sub in _RULES:
        if keyword in low:
            return sector, sub
    return None


def classify(name: str, business_text: str = "") -> Tuple[str, Optional[str]]:
    """Return (sector, sub_sector).

    The company name is the strongest signal, so we match it FIRST; the business
    description is only a fallback. (Otherwise prose like "working capital" or
    "financial year" in the summary would wrongly pull a company into Financials.)
    """
    return _scan(name) or _scan(business_text) or (UNCLASSIFIED, None)
