from datetime import date

from drhp_pipeline.resolve import ResolvedFiling
from drhp_pipeline.weeklogic import compute_window, select_this_week


def rf(d):
    return ResolvedFiling(
        id="x", normalized_name="x", company_name="X", filing_date=d,
        filing_type="DRHP", stage="DRHP", sebi_url="http://x",
    )


def test_window_is_trailing_7_days_inclusive():
    w = compute_window(date(2026, 6, 30))
    assert w.week_end == date(2026, 6, 30)
    assert w.week_start == date(2026, 6, 24)  # 7-day inclusive window
    assert w.contains(date(2026, 6, 24))
    assert w.contains(date(2026, 6, 30))
    assert not w.contains(date(2026, 6, 23))


def test_select_tags_only_in_window():
    w = compute_window(date(2026, 6, 30))
    items = [rf(date(2026, 6, 26)), rf(date(2026, 6, 1)), rf(date(2026, 6, 30))]
    selected = select_this_week(items, w)
    assert len(selected) == 2
    assert all("FILED_THIS_WEEK" in r.stamps for r in selected)
    assert items[1].stamps == []  # out-of-window untouched
