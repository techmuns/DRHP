from drhp_pipeline.financials import build_financials
from drhp_pipeline.pdf_extract import RawPdfFinancials


def make_raw(**kw):
    base = dict(currency_to_cr=0.1, unit_detected=True, ok=True)
    base.update(kw)
    return RawPdfFinancials(**base)


def test_money_converted_to_cr_with_high_confidence():
    raw = make_raw(revenue_fy25=16288.27, revenue_fy24=14909.02)
    fin = build_financials(raw, "Ujin Pharma", "ujin pharma")
    assert fin.revenue_fy25.value == 1628.83  # million -> Cr
    assert fin.revenue_fy25.source == "DRHP_PDF"
    assert fin.revenue_fy25.confidence == "high"


def test_money_low_confidence_when_unit_undetected():
    raw = make_raw(revenue_fy25=5000.0, unit_detected=False)
    fin = build_financials(raw, "X", "x")
    assert fin.revenue_fy25.confidence == "low"


def test_derived_growth_and_margin_are_marked_derived():
    raw = make_raw(revenue_fy25=16288.27, revenue_fy24=14909.02,
                   total_income_fy25=16360.63, pat_fy25=142.92, pat_fy24=160.06)
    fin = build_financials(raw, "X", "x")
    assert fin.rev_growth_pct.source == "derived"
    assert fin.rev_growth_pct.value == 9.25
    # PAT fell -> negative growth, still computed honestly
    assert fin.pat_growth_pct.value == round((142.92 - 160.06) / 160.06 * 100, 2)
    assert fin.pat_margin_pct.source == "derived"


def test_derived_skipped_when_prior_not_positive():
    raw = make_raw(revenue_fy25=100.0)  # no prior year
    fin = build_financials(raw, "X", "x")
    assert fin.rev_growth_pct.value is None


def test_nothing_fabricated_when_pdf_empty():
    fin = build_financials(RawPdfFinancials(ok=False), "X", "x")
    dumped = fin.model_dump()
    assert all(v["value"] is None for v in dumped.values())


def test_web_fallback_off_by_default(monkeypatch):
    # Default provider returns None -> fields stay null, never fabricated
    raw = RawPdfFinancials(ok=False)
    fin = build_financials(raw, "X", "x")
    assert fin.roe_pct.value is None
