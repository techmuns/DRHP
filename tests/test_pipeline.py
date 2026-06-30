"""End-to-end pipeline tests that run fully OFFLINE.

Prescraped filings carry no PDF URL, so financial enrichment makes no network calls
(financials stay null -> INSUFFICIENT). This lets us test scraping->resolve->week->
summary->snapshot->emit wiring, deltas, and idempotency without hitting SEBI.
"""

import json
from datetime import date

from drhp_pipeline.pipeline import run
from drhp_pipeline.scraper import ScrapedFiling


def sf(name, d, ftype, stage):
    return ScrapedFiling(
        company_name_raw=name, filing_date=d, filing_type=ftype, stage=stage,
        sebi_url="http://sebi/x", abridged_pdf_url=None,
    )


def week_one():
    return [
        sf("Acme Steel Limited", date(2026, 6, 25), "DRHP", "DRHP"),
        sf("Beta Pharma Limited", date(2026, 6, 26), "DRHP", "DRHP"),
        sf("Gamma Jewels Limited", date(2026, 6, 24), "Prospectus", "IPO"),
        sf("Old News Limited", date(2026, 1, 1), "DRHP", "DRHP"),  # out of window
    ]


def test_end_to_end_offline(tmp_path):
    d = run(
        run_date=date(2026, 6, 30),
        snapshots_dir=str(tmp_path / "snaps"),
        output_path=str(tmp_path / "latest.json"),
        appendix_path=str(tmp_path / "appendix.xlsx"),
        prescraped=week_one(),
    )
    assert d.summary.new_drhp_count == 2
    assert d.summary.new_ipo_count == 1
    assert d.meta.week_start == "2026-06-24"
    assert d.summary.deltas is None  # first snapshot
    # Out-of-window filing excluded
    assert all(f.company_name != "Old News Limited" for f in d.filings)
    # No PDF -> everything INSUFFICIENT, but nothing fabricated
    assert all(f.score.bucket == "INSUFFICIENT" for f in d.filings)
    obj = json.load(open(tmp_path / "latest.json"))
    assert len(obj["filings"]) == 3


def test_deltas_appear_on_second_run(tmp_path):
    snaps = str(tmp_path / "snaps")
    # Week 1: 2 DRHPs
    run(run_date=date(2026, 6, 23), snapshots_dir=snaps,
        output_path=str(tmp_path / "a.json"), appendix_path=None,
        prescraped=[sf("Acme Steel Limited", date(2026, 6, 20), "DRHP", "DRHP"),
                    sf("Beta Pharma Limited", date(2026, 6, 21), "DRHP", "DRHP")])
    # Week 2: 3 DRHPs -> delta +1
    d2 = run(run_date=date(2026, 6, 30), snapshots_dir=snaps,
             output_path=str(tmp_path / "b.json"), appendix_path=None,
             prescraped=[sf("C One Limited", date(2026, 6, 25), "DRHP", "DRHP"),
                         sf("C Two Limited", date(2026, 6, 26), "DRHP", "DRHP"),
                         sf("C Three Limited", date(2026, 6, 27), "DRHP", "DRHP")])
    assert d2.meta.previous_snapshot_id == "2026-06-23"
    assert d2.summary.deltas is not None
    assert d2.summary.deltas.new_drhp == "+1"


def test_idempotent_same_date(tmp_path):
    snaps = str(tmp_path / "snaps")
    out = str(tmp_path / "latest.json")
    kw = dict(run_date=date(2026, 6, 30), snapshots_dir=snaps, output_path=out,
              appendix_path=None, prescraped=week_one())
    run(**kw)
    first = open(out).read()
    run(**kw)
    assert open(out).read() == first  # re-running the same date is stable
