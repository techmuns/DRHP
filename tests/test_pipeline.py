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
        prescraped=week_one(), fetch_ipo=False,
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
                    sf("Beta Pharma Limited", date(2026, 6, 21), "DRHP", "DRHP")], fetch_ipo=False)
    # Week 2: 3 DRHPs -> delta +1
    d2 = run(run_date=date(2026, 6, 30), snapshots_dir=snaps,
             output_path=str(tmp_path / "b.json"), appendix_path=None,
             prescraped=[sf("C One Limited", date(2026, 6, 25), "DRHP", "DRHP"),
                         sf("C Two Limited", date(2026, 6, 26), "DRHP", "DRHP"),
                         sf("C Three Limited", date(2026, 6, 27), "DRHP", "DRHP")], fetch_ipo=False)
    # Snapshots are anchored to their week's Monday, so 2026-06-23 (Tue) is stored
    # under 2026-06-22 and 2026-06-30 (Tue) compares back to it: "vs last week".
    assert d2.meta.snapshot_id == "2026-06-29"
    assert d2.meta.previous_snapshot_id == "2026-06-22"
    assert d2.summary.deltas is not None
    assert d2.summary.deltas.new_drhp == "+1"


def test_daily_runs_same_week_share_one_snapshot(tmp_path):
    """Running every day within a week overwrites one weekly snapshot (no daily
    pile-up) and keeps comparing against the previous week, not yesterday."""
    import glob, os
    snaps = str(tmp_path / "snaps")
    # Last week's baseline: Monday 2026-08-24, one DRHP filed in-window.
    run(run_date=date(2026, 8, 24), snapshots_dir=snaps,
        output_path=str(tmp_path / "base.json"), appendix_path=None,
        prescraped=[sf("Base Steel Limited", date(2026, 8, 20), "DRHP", "DRHP")],
        fetch_ipo=False)
    # This week, two daily runs (Wed + Fri) — both anchor to Monday 2026-08-31.
    this_week = [sf("Fresh One Limited", date(2026, 9, 1), "DRHP", "DRHP"),
                 sf("Fresh Two Limited", date(2026, 9, 1), "DRHP", "DRHP")]
    d_wed = run(run_date=date(2026, 9, 2), snapshots_dir=snaps,
                output_path=str(tmp_path / "wed.json"), appendix_path=None,
                prescraped=this_week, fetch_ipo=False)
    d_fri = run(run_date=date(2026, 9, 4), snapshots_dir=snaps,
                output_path=str(tmp_path / "fri.json"), appendix_path=None,
                prescraped=this_week, fetch_ipo=False)

    # Both daily runs land on the same weekly snapshot id and the same baseline.
    assert d_wed.meta.snapshot_id == "2026-08-31"
    assert d_fri.meta.snapshot_id == "2026-08-31"
    assert d_fri.meta.previous_snapshot_id == "2026-08-24"
    # ...but the live view still moves daily (window end tracks the run date).
    assert d_wed.meta.week_end == "2026-09-02"
    assert d_fri.meta.week_end == "2026-09-04"
    # Delta is "vs last week" (2 this week - 1 last week), not "vs yesterday".
    assert d_fri.summary.deltas.new_drhp == "+1"
    # Exactly two snapshot files on disk (last week + this week) — no per-day files.
    ids = sorted(os.path.splitext(os.path.basename(p))[0]
                 for p in glob.glob(os.path.join(snaps, "*.json")))
    assert ids == ["2026-08-24", "2026-08-31"]


def test_idempotent_same_date(tmp_path):
    snaps = str(tmp_path / "snaps")
    out = str(tmp_path / "latest.json")
    kw = dict(run_date=date(2026, 6, 30), snapshots_dir=snaps, output_path=out,
              appendix_path=None, prescraped=week_one(), fetch_ipo=False)
    run(**kw)
    first = open(out).read()
    run(**kw)
    assert open(out).read() == first  # re-running the same date is stable
