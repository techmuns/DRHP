from drhp_pipeline.contract import Buckets, Dashboard, Meta, Summary
from drhp_pipeline.snapshot import (
    compute_deltas, find_previous_snapshot_id, load_snapshot, save_snapshot,
)


def make_dashboard(snap_id, drhp=0, ipo=0, dig=0):
    return Dashboard(
        meta=Meta(run_date=snap_id, week_start=snap_id, week_end=snap_id,
                  data_as_of=snap_id, snapshot_id=snap_id),
        summary=Summary(new_drhp_count=drhp, new_ipo_count=ipo,
                        buckets=Buckets(dig_deeper=dig)),
        filings=[],
    )


def test_save_and_load_roundtrip(tmp_path):
    d = make_dashboard("2026-06-30", drhp=3)
    save_snapshot(d, str(tmp_path))
    loaded = load_snapshot(str(tmp_path), "2026-06-30")
    assert loaded["summary"]["new_drhp_count"] == 3


def test_find_previous_picks_most_recent_earlier(tmp_path):
    for sid in ["2026-06-09", "2026-06-16", "2026-06-23"]:
        save_snapshot(make_dashboard(sid), str(tmp_path))
    assert find_previous_snapshot_id(str(tmp_path), "2026-06-30") == "2026-06-23"
    # Re-running the same date must NOT pick itself
    assert find_previous_snapshot_id(str(tmp_path), "2026-06-23") == "2026-06-16"
    # No earlier snapshot -> None (first run)
    assert find_previous_snapshot_id(str(tmp_path), "2026-06-01") is None


def test_compute_deltas_strings():
    cur = make_dashboard("2026-06-30", drhp=5, ipo=2, dig=4).summary
    prev = make_dashboard("2026-06-23", drhp=3, ipo=2, dig=6).summary.model_dump()
    deltas = compute_deltas(cur, prev)
    assert deltas.new_drhp == "+2"
    assert deltas.new_ipo == "flat"
    assert deltas.dig_deeper == "-2"
