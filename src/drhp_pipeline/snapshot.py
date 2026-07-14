"""
Stage 7 — Snapshot store + deltas.

Every run writes a full, timestamped copy of the week's dashboard to
`data/snapshots/<snapshot_id>.json`. This is the ONLY mechanism that makes
"vs last week" possible: to compute deltas we read the snapshot from about a
week earlier and diff the headline counts. Comparing a week back (rather than
the immediately previous run) keeps the delta a true week-over-week figure even
when the pipeline runs daily and there are six fresher snapshots in between.

On the first run (no earlier snapshot) deltas are `null` — we never fabricate a
change. Re-running the same date overwrites that date's snapshot and still compares
against the strictly-earlier one, so the pipeline stays idempotent.
"""

from __future__ import annotations

import glob
import json
import logging
import os
from datetime import date, timedelta
from typing import Optional

from .contract import Dashboard, Deltas, Summary

log = logging.getLogger("drhp.snapshot")


def snapshot_path(snapshots_dir: str, snapshot_id: str) -> str:
    return os.path.join(snapshots_dir, f"{snapshot_id}.json")


def save_snapshot(dashboard: Dashboard, snapshots_dir: str) -> str:
    os.makedirs(snapshots_dir, exist_ok=True)
    path = snapshot_path(snapshots_dir, dashboard.meta.snapshot_id)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(dashboard.to_json())
    log.info("Saved snapshot %s", path)
    return path


# Delta comparison window. Matches the 7-day "this week" window in weeklogic so the
# "vs last week" pill stays a true week-over-week comparison even when the pipeline
# runs daily (many snapshots sit between now and a week ago).
COMPARISON_WINDOW_DAYS = 7


def find_previous_snapshot_id(snapshots_dir: str, current_id: str) -> Optional[str]:
    """Most recent snapshot id at least COMPARISON_WINDOW_DAYS days before current.

    "vs last week" must remain a week-over-week comparison no matter how often the
    pipeline runs, so we skip snapshots newer than a week ago and pick the most recent
    one on or before (current_date - 7 days). ISO dates sort lexically, so once we have
    that cutoff string we can compare ids directly. Returns None when no snapshot is old
    enough yet (e.g. the first week of history) — we never fabricate a delta.

    Falls back to "most recent strictly earlier" if current_id isn't a plain ISO date.
    """
    if not os.path.isdir(snapshots_dir):
        return None
    ids = sorted(
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(snapshots_dir, "*.json"))
    )
    try:
        cutoff = (
            date.fromisoformat(current_id) - timedelta(days=COMPARISON_WINDOW_DAYS)
        ).isoformat()
        earlier = [i for i in ids if i <= cutoff]
    except ValueError:
        earlier = [i for i in ids if i < current_id]
    return earlier[-1] if earlier else None


def load_snapshot(snapshots_dir: str, snapshot_id: str) -> Optional[dict]:
    path = snapshot_path(snapshots_dir, snapshot_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read previous snapshot %s: %s", path, exc)
        return None


def _delta(cur: int, prev: int) -> str:
    diff = cur - prev
    if diff > 0:
        return f"+{diff}"
    if diff < 0:
        return str(diff)  # already carries the minus sign
    return "flat"


def compute_deltas(current: Summary, previous_summary: dict) -> Deltas:
    """Diff headline counts against a previous snapshot's summary dict."""
    p_buckets = previous_summary.get("buckets", {}) or {}
    c = current
    return Deltas(
        new_drhp=_delta(c.new_drhp_count, previous_summary.get("new_drhp_count", 0)),
        new_ipo=_delta(c.new_ipo_count, previous_summary.get("new_ipo_count", 0)),
        dig_deeper=_delta(c.buckets.dig_deeper, p_buckets.get("dig_deeper", 0)),
        monitor=_delta(c.buckets.monitor, p_buckets.get("monitor", 0)),
        watch=_delta(c.buckets.watch, p_buckets.get("watch", 0)),
    )
