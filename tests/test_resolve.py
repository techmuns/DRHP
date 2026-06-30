from datetime import date

from drhp_pipeline.resolve import normalize_name, resolve, stable_id
from drhp_pipeline.scraper import ScrapedFiling


def sf(name, d, ftype, stage, pdf=None):
    return ScrapedFiling(
        company_name_raw=name, filing_date=d, filing_type=ftype, stage=stage,
        sebi_url="http://x", abridged_pdf_url=pdf,
    )


def test_normalize_name_strips_suffixes_and_punct():
    assert normalize_name("Ujin Pharma Ltd.") == "ujin pharma"
    assert normalize_name("Sky Alloys and Power Limited") == "sky alloys and power"
    assert normalize_name("ORAVEL STAYS LIMITED") == "oravel stays"
    assert normalize_name("Acme & Co. Private Limited") == "acme and co"


def test_stable_id_is_deterministic():
    assert stable_id("ujin pharma") == stable_id("ujin pharma")
    assert stable_id("ujin pharma") != stable_id("sky alloys")


def test_dedup_collapses_updates_and_sets_updated_stamp():
    rows = [
        sf("Acme Limited", date(2026, 6, 10), "DRHP", "DRHP"),
        sf("Acme Limited", date(2026, 6, 18), "Corrigendum", "DRHP"),
    ]
    out = resolve(rows)
    assert len(out) == 1
    rec = out[0]
    assert rec.filing_date == date(2026, 6, 18)  # keeps the latest
    assert "UPDATED" in rec.stamps
    assert "IPO_STAGE" not in rec.stamps


def test_cross_stage_sets_ipo_stage_stamp_and_collapses():
    rows = [
        sf("Beta Industries Limited", date(2026, 5, 1), "DRHP", "DRHP"),
        sf("Beta Industries Ltd", date(2026, 6, 20), "Prospectus", "IPO"),
    ]
    out = resolve(rows)
    assert len(out) == 1  # same entity across both pages
    rec = out[0]
    assert rec.stage == "IPO"  # representative is the most advanced/latest
    assert "IPO_STAGE" in rec.stamps


def test_display_name_titlecases_allcaps():
    out = resolve([sf("ORAVEL STAYS LIMITED", date(2026, 6, 30), "UDRHP", "DRHP")])
    assert out[0].company_name == "Oravel Stays Limited"
    assert "UPDATED" in out[0].stamps  # UDRHP is an update type
