"""
Pipeline orchestrator.

Runs the eight stages end-to-end and writes `public/data/latest.json` plus a
timestamped snapshot. Designed to be idempotent: a given `--run-date` against
unchanged SEBI data produces the same output every time.

    python -m drhp_pipeline.pipeline --run-date 2026-06-30
"""

from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from datetime import date, datetime
from typing import List, Optional

from .contract import (
    Buckets,
    Dashboard,
    Filing,
    Meta,
    SectorConcentration,
    Sources,
    Summary,
)
from .financials import enrich
from .resolve import ResolvedFiling, resolve
from .scoring import score_financials
from .scraper import ScrapedFiling, scrape_all
from .sectors import classify
from .snapshot import compute_deltas, find_previous_snapshot_id, load_snapshot, save_snapshot
from . import emit, ipo_market
from .contract import IpoMarket
from .weeklogic import compute_window, select_this_week

log = logging.getLogger("drhp.pipeline")

DEFAULT_SNAPSHOTS_DIR = "data/snapshots"


def build_filing(resolved: ResolvedFiling, scratch_dir: str) -> Filing:
    enrichment = enrich(resolved, scratch_dir=scratch_dir)
    sector, sub_sector = classify(resolved.company_name, enrichment.business_summary or "")
    score = score_financials(enrichment.financials)

    issue = enrichment.issue
    if issue.total_cr is not None and issue.market_cap_cr not in (None, 0):
        issue.issue_to_mktcap_pct = round(issue.total_cr / issue.market_cap_cr * 100, 2)

    return Filing(
        id=resolved.id,
        company_name=resolved.company_name,
        company_name_normalized=resolved.normalized_name,
        filing_date=resolved.filing_date.isoformat(),
        filing_type=resolved.filing_type,
        stage=resolved.stage,
        sector=sector,
        sub_sector=sub_sector,
        business_summary=enrichment.business_summary,
        issue=enrichment.issue,
        financials=enrichment.financials,
        score=score,
        lead_managers=[],  # Stage 1: not yet parsed from the PDF
        stamps=resolved.stamps,
        sources=Sources(sebi_url=resolved.sebi_url, drhp_pdf_url=enrichment.drhp_pdf_url),
    )


def build_summary(filings: List[Filing]) -> Summary:
    buckets = Buckets(
        dig_deeper=sum(1 for f in filings if f.score.bucket == "DIG DEEPER"),
        monitor=sum(1 for f in filings if f.score.bucket == "MONITOR"),
        watch=sum(1 for f in filings if f.score.bucket == "WATCH"),
    )

    by_sector: dict[str, dict] = defaultdict(lambda: {"count": 0, "total_issue_cr": 0.0})
    for f in filings:
        key = f.sector or "Unclassified"
        by_sector[key]["count"] += 1
        by_sector[key]["total_issue_cr"] += f.issue.total_cr or 0.0
    concentration = [
        SectorConcentration(sector=s, count=v["count"], total_issue_cr=round(v["total_issue_cr"], 2))
        for s, v in by_sector.items()
    ]
    concentration.sort(key=lambda s: (-s.count, s.sector))

    return Summary(
        new_drhp_count=sum(1 for f in filings if f.stage == "DRHP"),
        new_ipo_count=sum(1 for f in filings if f.stage == "IPO"),
        buckets=buckets,
        deltas=None,  # filled in by the snapshot stage
        sector_concentration=concentration,
    )


def apply_lifecycle(filings: List[Filing], market: IpoMarket) -> None:
    """Set board / current_stage / listing_outcome on each filing.

    Stage defaults from the SEBI filing itself; if NSE lists the company in its
    open/upcoming/listed feed (matched by normalized name), that more-advanced stage
    and the board (Mainboard/SME) override it. Listing outcome stays 'Pending' because
    listing price (hence gain/loss) is not available.
    """
    idx = ipo_market.index_by_name(market) if market and market.available else {}
    for f in filings:
        stamps = set(f.stamps)
        if f.stage == "IPO" or "IPO_STAGE" in stamps:
            stage = "Listed"
        elif "UPDATED" in stamps:
            stage = "Updated/Corrected"
        else:
            stage = "DRHP Filed"
        row = idx.get(f.company_name_normalized)
        if row is not None:
            stage = row.stage or stage
            f.board = row.board
            if row.stage == "Listed":
                f.listing_outcome = "Pending"
        f.current_stage = stage


def run(
    run_date: date,
    snapshots_dir: str = DEFAULT_SNAPSHOTS_DIR,
    output_path: str = emit.LATEST_PATH,
    appendix_path: Optional[str] = emit.APPENDIX_PATH,
    scratch_dir: str = "/tmp",
    prescraped: Optional[List[ScrapedFiling]] = None,
    fetch_ipo: bool = True,
    nse_raw: Optional[dict] = None,
) -> Dashboard:
    """Execute the full pipeline and return the emitted Dashboard."""
    window = compute_window(run_date)
    log.info("Run date %s — week %s..%s", run_date, window.week_start, window.week_end)

    scraped = prescraped if prescraped is not None else scrape_all()
    resolved = resolve(scraped)
    selected = select_this_week(resolved, window)
    log.info("Resolved %d entities; %d new this week.", len(resolved), len(selected))

    filings = [build_filing(r, scratch_dir) for r in selected]
    # Order the memo most-interesting first: score desc, then newest.
    filings.sort(key=lambda f: ((f.score.total or -1), f.filing_date), reverse=True)

    summary = build_summary(filings)

    snapshot_id = run_date.isoformat()
    prev_id = find_previous_snapshot_id(snapshots_dir, snapshot_id)
    prev = load_snapshot(snapshots_dir, prev_id) if prev_id else None
    if prev and prev.get("summary"):
        summary.deltas = compute_deltas(summary, prev["summary"])

    # IPO market layer (NSE) — best-effort. If NSE is unreachable (e.g. it blocks the
    # CI host), carry forward the last good data (clearly dated by its own as_of)
    # instead of blanking the IPO modules.
    sector_by_norm = {f.company_name_normalized: f.sector for f in filings if f.sector}
    if nse_raw is not None:
        raw = nse_raw
    elif fetch_ipo:
        raw = ipo_market.fetch_raw()
    else:
        raw = None
    market = ipo_market.build_market(raw, run_date, sector_by_norm)
    if not market.available and prev and (prev.get("ipo_market") or {}).get("available"):
        market = IpoMarket(**prev["ipo_market"])
        log.info("NSE unreachable — carried forward IPO data as of %s.", market.as_of)
    apply_lifecycle(filings, market)
    market.pulse.drhp_filed = sum(1 for f in filings if f.stage == "DRHP")
    market.pulse.updated = sum(1 for f in filings if "UPDATED" in f.stamps)

    meta = Meta(
        run_date=run_date.isoformat(),
        week_start=window.week_start.isoformat(),
        week_end=window.week_end.isoformat(),
        data_as_of=window.data_as_of.isoformat(),
        snapshot_id=snapshot_id,
        previous_snapshot_id=prev_id,
    )

    dashboard = Dashboard(meta=meta, summary=summary, filings=filings, ipo_market=market)

    save_snapshot(dashboard, snapshots_dir)
    emit.write_latest(dashboard, output_path)
    if appendix_path:
        emit.write_excel_appendix(dashboard, appendix_path)

    _log_run_summary(dashboard)
    return dashboard


def _log_run_summary(dashboard: Dashboard) -> None:
    s = dashboard.summary
    from .contract import Financials

    web_filings, null_fields = [], 0
    fin_fields = list(Financials.model_fields)
    for f in dashboard.filings:
        used_web = any(getattr(f.financials, n).source == "WEB" for n in fin_fields)
        if used_web:
            web_filings.append(f.company_name)
        null_fields += sum(1 for n in fin_fields if getattr(f.financials, n).value is None)

    log.info("──────── RUN SUMMARY ────────")
    log.info("New DRHPs: %d | New IPOs/Prospects: %d", s.new_drhp_count, s.new_ipo_count)
    log.info("DIG DEEPER: %d | MONITOR: %d | WATCH: %d",
             s.buckets.dig_deeper, s.buckets.monitor, s.buckets.watch)
    insufficient = sum(1 for f in dashboard.filings if f.score.bucket == "INSUFFICIENT")
    log.info("INSUFFICIENT (not enough data to score): %d", insufficient)
    if web_filings:
        log.info("Used WEB fallback for: %s", ", ".join(web_filings))
    log.info("Financial cells left null (need verification/Stage 2): %d", null_fields)
    if s.deltas is None:
        log.info("Deltas: none (first snapshot or no earlier snapshot found).")
    else:
        log.info("Deltas vs last week — DRHP %s, IPO %s, DIG DEEPER %s",
                 s.deltas.new_drhp, s.deltas.new_ipo, s.deltas.dig_deeper)
    mk = dashboard.ipo_market
    if mk and mk.available:
        log.info("NSE IPO data: OK — %d open/upcoming, %d recent listings (gain/loss pending: no price feed).",
                 len(mk.open_upcoming), len(mk.recent_listings))
    else:
        log.info("NSE IPO data: unavailable this run (blocked/unreachable) — IPO modules show 'pending source'.")
    log.info("─────────────────────────────")


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="DRHP/IPO weekly investment-monitor pipeline.")
    p.add_argument("--run-date", help="YYYY-MM-DD (default: today)")
    p.add_argument("--snapshots-dir", default=DEFAULT_SNAPSHOTS_DIR)
    p.add_argument("--output", default=emit.LATEST_PATH)
    p.add_argument("--appendix", default=emit.APPENDIX_PATH)
    p.add_argument("--no-excel", action="store_true", help="Skip the Excel appendix")
    p.add_argument("--scratch-dir", default="/tmp")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run_date = (
        datetime.strptime(args.run_date, "%Y-%m-%d").date() if args.run_date else date.today()
    )
    run(
        run_date=run_date,
        snapshots_dir=args.snapshots_dir,
        output_path=args.output,
        appendix_path=None if args.no_excel else args.appendix,
        scratch_dir=args.scratch_dir,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
