from drhp_pipeline.pdf_extract import (
    detect_currency_to_cr, detect_stub, extract_from_lines, numeric_tokens,
    parse_number, pick_fy,
)

# A miniature financial-KPI table mimicking a real abridged prospectus:
# leading STUB column (Dec-25) then three fiscal years, values in ₹ million.
SAMPLE = [
    "Summary of Financial Information (₹ in million)",
    "Particulars unit Dec-25 Fiscal 2025 Fiscal 2024 Fiscal 2023",
    "Revenue from operation(2) ₹ 15,113.37 16,288.27 14,909.02 14,257.61",
    "Total Revenue(1) ₹ 15,231.12 16,360.63 14,973.27 14,351.96",
    "EBITDA(3) ₹ 399.74 354.46 296.20 130.90",
    "EBITDA Margin(4) % 2.64 2.18 1.99 0.92",
    "PAT (Profit for the ₹ 254.68 142.92 160.06 100.44",
    "Return on equity(8) % 18.21% 12.15% 15.85% 11.75%",
    "Return on capital % 12.68 12.54 14.05 14.44",
    "Debt equity ratio(9) Times 1.55 1.57 1.36 0.66",
    "Sub-total (A) 54,168,400 98.49 54,168,400 83.72",
]


def test_parse_number_handles_parens_commas_percent():
    assert parse_number("15,113.37") == 15113.37
    assert parse_number("(3,244.14)") == -3244.14
    assert parse_number("18.21%") == 18.21
    assert parse_number("₹ 399.74") == 399.74
    assert parse_number("[●]") is None


def test_numeric_tokens_strips_footnote_markers():
    # "(2)" is a footnote, not a value; the four data points remain
    toks = numeric_tokens("Revenue from operation(2) ₹ 15,113.37 16,288.27 14,909.02 14,257.61")
    assert toks == [15113.37, 16288.27, 14909.02, 14257.61]


def test_pick_fy_skips_leading_stub_column():
    # With a stub present, FY25/FY24 are columns 1 and 2 (NOT the stub at 0)
    assert pick_fy([15113.37, 16288.27, 14909.02, 14257.61], has_stub=True) == (16288.27, 14909.02)
    # Without a stub, first two are the latest full years
    assert pick_fy([16288.27, 14909.02, 14257.61], has_stub=False) == (16288.27, 14909.02)


def test_detect_stub_and_currency():
    text = "\n".join(SAMPLE)
    assert detect_stub(text) is True
    factor, ok = detect_currency_to_cr(text)
    assert ok is True
    assert factor == 0.1  # million -> crore


def test_extract_from_lines_full_table():
    raw = extract_from_lines(SAMPLE)
    assert raw.ok is True
    assert raw.unit_detected is True
    # Full-year values (stub skipped), still in original unit (million)
    assert raw.revenue_fy25 == 16288.27
    assert raw.revenue_fy24 == 14909.02
    assert raw.pat_fy25 == 142.92
    assert raw.ebitda_margin_pct == 2.18
    assert raw.roe_pct == 12.15
    assert raw.roce_pct == 12.54
    assert raw.debt_equity == 1.57
    assert raw.promoter_hold_pct == 98.49


def test_extract_handles_no_financials():
    raw = extract_from_lines(["Just some prose with no table.", "Nothing here."])
    assert raw.ok is False
    assert raw.revenue_fy25 is None


# --- issue structure extraction -------------------------------------------
from drhp_pipeline.pdf_extract import extract_issue


def test_extract_issue_masked_amount_stays_none_but_shares_captured():
    lines = [
        "The Offer comprises of a Fresh Issue of up to 16,084,000 Equity Shares,",
        "aggregating up to ₹ [●] million by our Company and an Offer for Sale of",
        "up to 1,807,000 Equity Shares, aggregating up to ₹ [●] million by the",
        "Promoter Selling Shareholders of face value ₹ 10 each.",
    ]
    info = extract_issue(lines)
    assert info.type == "Both"
    assert info.fresh_cr is None and info.ofs_cr is None  # masked, never guessed
    assert info.fresh_shares == 16_084_000
    assert info.ofs_shares == 1_807_000
    assert info.total_shares == 17_891_000
    assert info.face_value == 10.0


def test_extract_issue_priced_amount_is_captured():
    lines = [
        "The Offer comprises of a Fresh Issue of up to 10,000,000 Equity Shares,",
        "aggregating up to ₹ 1,500.00 million by our Company and an Offer for Sale",
        "aggregating up to ₹ 500.00 million by the Selling Shareholders.",
    ]
    info = extract_issue(lines)
    assert info.fresh_cr == 150.0   # 1500 million = 150 Cr
    assert info.ofs_cr == 50.0
    assert info.total_cr == 200.0
