"""Tests for the Groww secondary-enrichment source.

Parser tests run against real page captures saved under tests/fixtures/groww/.
The enrichment tests assert the two invariants that matter most:
  * official values are never overwritten (Groww is fill-only), and
  * a material difference vs a present official value is logged as a conflict.
"""

import json
import os

import pytest

from drhp_pipeline import groww as g
from drhp_pipeline import groww_enrich as ge
from drhp_pipeline.contract import (
    Filing,
    Financials,
    GrowwEnrichment,
    GrowwFundamentals,
    GrowwIpo,
    Issue,
    IpoRow,
    MetricValue,
)

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "groww")


def _read(name):
    with open(os.path.join(FIX, name), encoding="utf-8", errors="replace") as fh:
        return fh.read()


# --------------------------------------------------------------------------- #
# value parsers
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("raw,expected", [
    ("₹6,210Cr", 6210.0),
    ("₹9,812.91 Cr", 9812.91),
    (98129100000, 9812.91),   # absolute rupees -> crore
    (585.0, 585.0),
])
def test_parse_money_cr(raw, expected):
    assert g.parse_money_cr(raw) == expected


def test_parse_percent_and_number():
    assert g.parse_percent("65.01%") == 65.01
    assert g.parse_percent("0.00%") == 0.0
    assert g.parse_number("119.15") == 119.15
    assert g.parse_multiple("1.44x") == 1.44
    assert g.rupees_to_cr(98129100000) == 9812.91


def test_missing_value_is_none_not_zero():
    assert g.parse_number(None) is None
    assert g.parse_money_cr(None) is None
    assert g.parse_percent("") is None


# --------------------------------------------------------------------------- #
# company matching — strong-match gate
# --------------------------------------------------------------------------- #
def test_strong_match_accepts_suffix_variants():
    assert g.is_strong_match("Waterways Leisure Tourism Limited", "Waterways Leisure Tourism Ltd.")
    assert g.is_strong_match("SBI Funds Management Limited", "SBI Funds Management")


def test_strong_match_rejects_unrelated_and_keyword_only():
    assert not g.is_strong_match("Tata Capital Limited", "Reliance Power Limited")
    # shares only the common word "steel" -> must not match
    assert not g.is_strong_match("Happy Steels Limited", "Steel Authority of India Limited")
    assert g.match_confidence("Innoterra Limited", "Innova Captab Limited") == 0.0


# --------------------------------------------------------------------------- #
# page parsers (real fixtures)
# --------------------------------------------------------------------------- #
def test_parse_stock_waterways():
    s = g.parse_stock(_read("stock_waterways.html"))
    assert s["isin"] == "INE0LZF01013"
    f = {k: v["value"] for k, v in s["fundamentals"].items()}
    assert f["market_cap_cr"] == 6210.0
    assert f["roe_pct"] == 65.01
    assert f["debt_equity"] == 1.47
    assert f["pe_ratio"] == 119.15
    assert f["book_value"] == 91.89
    assert s["promoter_hold_pct"] == 89.35
    assert s["financials_by_year"]["FY2025"]["revenue_cr"] == 597.68
    assert s["financials_by_year"]["FY2025"]["pat_cr"] == 168.19


def test_parse_ipo_subscription_board():
    rows = g.parse_ipo_subscription(_read("ipo_subscription.html"))
    assert len(rows) >= 1
    sbi = next(r for r in rows if "sbi funds" in g.normalize_name(r["company_name"]))
    assert sbi["price_band"] and sbi["issue_size_cr"] and sbi["subscription"]["total"] is not None
    # multiples are numeric, rounded, never the "x" string
    assert isinstance(sbi["subscription"]["qib"], float)


def test_parse_ipo_detail_sbifunds():
    d = g.parse_ipo_detail(_read("ipo_detail_sbifunds.html"))
    assert d["board"] == "Mainboard"
    assert d["price_band"] == "Rs.545 to Rs.574"
    assert d["issue_price"] == 574.0
    assert d["lot_size"] == 26.0
    assert d["issue_size_cr"] == 9812.91
    assert d["subscription"]["retail"] is not None


def test_parse_search():
    hits = g.parse_search(json.load(open(os.path.join(FIX, "search_waterways.json"))))
    assert hits[0]["slug"] == "waterways-leisure-tourism-ltd"
    assert hits[0]["label"] == "EXACT_QUERO"


def test_extract_next_data_none_on_garbage():
    assert g.extract_next_data("<html>no data here</html>") is None


# --------------------------------------------------------------------------- #
# fill-only enrichment + conflict detection (no network)
# --------------------------------------------------------------------------- #
def _filing(**fin):
    financials = Financials()
    for k, v in fin.items():
        setattr(financials, k, MetricValue(value=v, source="DRHP_PDF", confidence="high"))
    return Filing(
        id="x", company_name="Acme Ltd", company_name_normalized="acme",
        filing_date="2026-07-01", filing_type="DRHP", stage="DRHP",
        financials=financials, issue=Issue(),
    )


def test_conflict_logged_and_official_kept():
    f = _filing(roe_pct=40.0)   # official says 40%
    enr = GrowwEnrichment(fundamentals=GrowwFundamentals(roe_pct=65.01))
    conflicts = ge.detect_conflicts("Acme Ltd", f, enr)
    fields = [c.field for c in conflicts]
    assert "financials.roe_pct" in fields
    c = next(c for c in conflicts if c.field == "financials.roe_pct")
    assert c.official_value == 40.0 and c.groww_value == 65.01
    # official value is untouched by enrichment
    f.groww = enr
    assert f.financials.roe_pct.value == 40.0
    assert f.financials.roe_pct.source == "DRHP_PDF"


def test_no_conflict_when_official_missing():
    f = _filing()   # all official financials null
    enr = GrowwEnrichment(fundamentals=GrowwFundamentals(roe_pct=65.01, market_cap_cr=6210.0))
    assert ge.detect_conflicts("Acme Ltd", f, enr) == []


def test_no_conflict_within_tolerance():
    f = _filing(debt_equity=1.47)
    enr = GrowwEnrichment(fundamentals=GrowwFundamentals(debt_equity=1.475))  # <2% diff
    assert ge.detect_conflicts("Acme Ltd", f, enr) == []


def test_iporow_conflict_on_subscription():
    row = IpoRow(company_name="Acme Ltd", subscription_x=2.0, issue_size_cr=500.0)
    enr = GrowwEnrichment(ipo=GrowwIpo(issue_size_cr=500.0))
    enr.subscription = __import__(
        "drhp_pipeline.contract", fromlist=["GrowwSubscription"]
    ).GrowwSubscription(total=3.5)
    conflicts = ge.detect_conflicts("Acme Ltd", row, enr)
    assert any(c.field == "subscription_x" for c in conflicts)
    # issue_size matches -> not flagged
    assert not any(c.field == "issue_size_cr" for c in conflicts)


def test_differs_helper():
    assert ge._differs(100, 105)          # 5% -> differs
    assert not ge._differs(100, 101)      # 1% -> within tolerance
    assert not ge._differs(None, 5)       # missing -> never a conflict
    assert not ge._differs(5, None)
