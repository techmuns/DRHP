"""
Stage 4 — Week logic.

Defines "this week" as the trailing 7-day window ending at the run-date and selects
the entities whose latest filing falls inside it. Those get the `FILED_THIS_WEEK`
stamp and are the only ones we enrich (financials) and score — the weekly memo is
about what is new.

Cross-stage history (a DRHP filed weeks ago + a Prospectus this week) is already
captured upstream in resolution, so an entity that *progressed* this week is correctly
included with its `IPO_STAGE` stamp intact.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import List

from .resolve import ResolvedFiling

WINDOW_DAYS = 7


@dataclass
class WeekWindow:
    run_date: date
    week_start: date
    week_end: date
    data_as_of: date

    def contains(self, d: date) -> bool:
        return self.week_start <= d <= self.week_end


def compute_window(run_date: date) -> WeekWindow:
    """Trailing 7-day window *ending* at run_date (inclusive)."""
    week_end = run_date
    week_start = run_date - timedelta(days=WINDOW_DAYS - 1)
    return WeekWindow(
        run_date=run_date,
        week_start=week_start,
        week_end=week_end,
        data_as_of=run_date,
    )


def select_this_week(
    resolved: List[ResolvedFiling], window: WeekWindow
) -> List[ResolvedFiling]:
    """Keep entities whose representative filing is in-window; tag FILED_THIS_WEEK."""
    selected: List[ResolvedFiling] = []
    for r in resolved:
        if window.contains(r.filing_date):
            if "FILED_THIS_WEEK" not in r.stamps:
                r.stamps.insert(0, "FILED_THIS_WEEK")
            selected.append(r)
    return selected
