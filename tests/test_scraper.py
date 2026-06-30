import os

from drhp_pipeline.scraper import (
    classify_filing_type, extract_company_name, parse_listing_html,
)

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def test_classify_filing_type():
    assert classify_filing_type("ORAVEL STAYS LIMITED UDRHP-I", "DRHP") == "UDRHP"
    assert classify_filing_type("Ujin Pharma Ltd. - DRHP", "DRHP") == "DRHP"
    assert classify_filing_type("Varmora Granito Limited - Addendum to DRHP", "DRHP") == "Addendum"
    assert classify_filing_type("Pioneer Fil-Med Limited - Corrigendum to DRHP", "DRHP") == "Corrigendum"
    assert classify_filing_type("Advit Jewels Limited - Prospectus", "IPO") == "Prospectus"
    # No keyword -> falls back to the page's natural type
    assert classify_filing_type("Some Company Limited", "IPO") == "Prospectus"
    assert classify_filing_type("Some Company Limited", "DRHP") == "DRHP"


def test_extract_company_name_strips_suffix_keeps_periods():
    assert extract_company_name("Ujin Pharma Ltd. - DRHP") == "Ujin Pharma Ltd."
    assert extract_company_name("Sky Alloys and Power Limited- DRHP") == "Sky Alloys and Power Limited"
    assert extract_company_name("ORAVEL STAYS LIMITED UDRHP-I") == "ORAVEL STAYS LIMITED"
    assert extract_company_name("Varmora Granito Limited - Addendum to DRHP") == "Varmora Granito Limited"


def test_parse_real_drhp_fixture():
    html = open(os.path.join(FIX, "sebi_drhp_sample.html"), encoding="utf-8").read()
    rows = parse_listing_html(html, "DRHP", "http://listing")
    assert len(rows) == 25
    names = [r.company_name_raw for r in rows]
    assert "ORAVEL STAYS LIMITED" in names
    assert any(r.abridged_pdf_url and r.abridged_pdf_url.endswith(".pdf") for r in rows)
    assert all(r.stage == "DRHP" for r in rows)


def test_parse_real_ipo_fixture():
    html = open(os.path.join(FIX, "sebi_ipo_sample.html"), encoding="utf-8").read()
    rows = parse_listing_html(html, "IPO", "http://listing")
    assert len(rows) == 25
    assert all(r.stage == "IPO" for r in rows)
    assert all(r.filing_type == "Prospectus" for r in rows)


def test_parse_handles_garbage_without_crashing():
    assert parse_listing_html("<html>no table here</html>", "DRHP", "http://x") == []
