"""
Stage 7 — Snapshot store + deltas.

Every run writes a full, timestamped copy of the week's dashboard to
`data/snapshots/<snapshot_id>.json`. This is the ONLY mechanism that makes
"vs last week" possible: to compute deltas we read the most recent *earlier*
snapshot and diff the headline counts.

On the first run (no earlier snapshot) deltas are `null` — we never fabricate a
change. Re-running the same date overwrites that date's snapshot and still compares
against the strictly-earlier one, so the pipeline stays idempotent.
"""

from __future__ import annotations

import glob
import json
import logging
import os
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


def find_previous_snapshot_id(snapshots_dir: str, current_id: str) -> Optional[str]:
    """Most recent snapshot id strictly earlier than current (ISO dates sort lexically)."""
    if not os.path.isdir(snapshots_dir):
        return None
    ids = sorted(
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(snapshots_dir, "*.json"))
    )
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
