"""
Stage 6 — Composite scoring.

Formula (weights are FROZEN per the source email):

    Composite = Rev Growth (20) + PAT Margin (20) + ROE (15)
              + ROCE (15) + PAT Growth (15) + Revenue Scale (15)   →  max 100

Buckets:  >= 25 DIG DEEPER · 10–25 MONITOR · < 10 WATCH · missing inputs INSUFFICIENT.

Each metric is mapped onto its weight by a transparent linear band: 0 at the floor,
full weight at the saturation point, clamped in between. The WEIGHTS are exact; the
BANDS (saturation points) are standard screening thresholds collected in one place so
they can be tuned without touching the logic. A component whose input is missing stays
`null` and contributes nothing — we never guess a value to fill it.
"""

from __future__ import annotations

from typing import Optional

from .contract import Financials, Score, ScoreComponents

# Exact component weights (sum = 100). Do not change without the source email.
WEIGHTS = {
    "rev_growth": 20,
    "pat_margin": 20,
    "roe": 15,
    "roce": 15,
    "pat_growth": 15,
    "revenue_scale": 15,
}

# Saturation point for each metric = the value at which full weight is awarded.
# (Floor is 0 for all; values at/below 0 score 0.) Tunable screening thresholds.
BANDS = {
    "rev_growth": 30.0,       # % YoY revenue growth
    "pat_margin": 20.0,       # % net profit margin
    "roe": 25.0,              # % return on equity
    "roce": 25.0,             # % return on capital employed
    "pat_growth": 40.0,       # % YoY PAT growth
    "revenue_scale": 5000.0,  # revenue in ₹ Cr (scale proxy)
}

# Minimum weight of available components needed to trust a composite. Below this we
# mark INSUFFICIENT rather than bucket on a thinly-supported number. Chosen so that
# revenue-scale + one profitability measure (e.g. PAT margin) clears the bar.
MIN_COVERAGE_WEIGHT = 30


def _band_score(value: Optional[float], key: str) -> Optional[float]:
    """Map a raw metric to [0, weight] via its linear band; None passes through."""
    if value is None:
        return None
    frac = value / BANDS[key]
    frac = max(0.0, min(1.0, frac))
    return round(frac * WEIGHTS[key], 2)


def score_financials(fin: Financials) -> Score:
    comp = ScoreComponents(
        rev_growth=_band_score(fin.rev_growth_pct.value, "rev_growth"),
        pat_margin=_band_score(fin.pat_margin_pct.value, "pat_margin"),
        roe=_band_score(fin.roe_pct.value, "roe"),
        roce=_band_score(fin.roce_pct.value, "roce"),
        pat_growth=_band_score(fin.pat_growth_pct.value, "pat_growth"),
        revenue_scale=_band_score(fin.revenue_fy25.value, "revenue_scale"),
    )

    present = {k: v for k, v in comp.model_dump().items() if v is not None}
    coverage = sum(WEIGHTS[k] for k in present)

    if coverage < MIN_COVERAGE_WEIGHT:
        return Score(total=None, components=comp, bucket="INSUFFICIENT")

    total = round(sum(present.values()), 1)
    if total >= 25:
        bucket = "DIG DEEPER"
    elif total >= 10:
        bucket = "MONITOR"
    else:
        bucket = "WATCH"
    return Score(total=total, components=comp, bucket=bucket)
