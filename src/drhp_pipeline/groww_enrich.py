"""
Groww enrichment orchestration — attach a fill-only ``groww`` block to each record
and log conflicts against official values.

Rules enforced here (SEBI / NSE / BSE / company filings are PRIMARY):
  * Groww only *fills gaps*. Official ``issue.*`` / ``financials.*`` values are never
    modified — Groww data lives entirely in the additive ``groww`` namespace.
  * Where Groww materially differs from a present official value, the official value
    is kept and the difference is appended to ``Dashboard.groww_conflicts`` for review.
  * Missing values stay ``None`` — never coerced to zero.
  * A record is only enriched when a strong company-name match is found.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from .contract import (
    Dashboard,
    Filing,
    GrowwConflict,
    GrowwEnrichment,
    GrowwFundamentals,
    GrowwIpo,
    GrowwMatch,
    GrowwProvenance,
    GrowwSubscription,
    IpoRow,
)
from .groww import GrowwClient, normalize_name

log = logging.getLogger("drhp.groww.enrich")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _differs(a, b, rel: float = 0.02, abs_min: float = 0.0) -> bool:
    """True if two numbers differ materially (default: >2% relative)."""
    if a is None or b is None:
        return False
    a, b = float(a), float(b)
    if abs(a - b) <= abs_min:
        return False
    return abs(a - b) / max(abs(a), abs(b), 1.0) > rel


# ---------------------------------------------------------------------------
# IPO board index (bulk) — subscription (Live) overlaid by closed (Final)
# ---------------------------------------------------------------------------
def build_ipo_index(client: GrowwClient) -> Dict[str, dict]:
    index: Dict[str, dict] = {}
    for row in client.ipo_subscription_board():
        if row.get("company_name"):
            row["status"] = "Live"
            index[normalize_name(row["company_name"])] = row
    for row in client.ipo_closed_board():  # Final replaces an earlier Live snapshot
        if row.get("company_name"):
            row["status"] = "Final"
            index[normalize_name(row["company_name"])] = row
    return index


# ---------------------------------------------------------------------------
# Build the groww block for one company (network) — cached per normalized name
# ---------------------------------------------------------------------------
def build_enrichment(name: str, client: GrowwClient, ipo_index: Dict[str, dict]) -> Optional[GrowwEnrichment]:
    enr = GrowwEnrichment(fetched_at=_now())
    matched = False

    # -- listed-company stock page: fundamentals + financials + holding --
    stock_match = client.resolve_stock(name)
    stock = client.stock(stock_match["slug"]) if stock_match else None
    if stock:
        matched = True
        enr.match = GrowwMatch(
            matched_name=stock_match["title"],
            confidence=stock_match["confidence"],
            stock_slug=stock_match["slug"],
            stock_url=stock.get("url"),
            isin=stock.get("isin"),
            nse_code=stock.get("nse_code"),
        )
        enr.fundamentals = GrowwFundamentals(
            **{k: v["value"] for k, v in (stock.get("fundamentals") or {}).items()}
        )
        if stock.get("promoter_hold_pct") is not None:
            enr.fundamentals.promoter_hold_pct = stock["promoter_hold_pct"]
        enr.financials_by_year = stock.get("financials_by_year") or {}
        enr.provenance = GrowwProvenance(
            source_url=stock.get("url"),
            fetched_at=enr.fetched_at,
            data_period=stock.get("promoter_period"),
            status="Live",
        )

    # -- IPO board (subscription / dates / band) + optional detail page --
    row = ipo_index.get(normalize_name(name))
    if row:
        matched = True
        detail = client.ipo_detail(row["search_id"]) if row.get("search_id") else None
        merged = dict(row)
        for k, v in (detail or {}).items():
            if v is not None:
                merged[k] = v
        sub = merged.get("subscription") or {}
        enr.subscription = GrowwSubscription(
            qib=sub.get("qib"), nii=sub.get("nii"), retail=sub.get("retail"),
            employee=sub.get("employee"), total=sub.get("total"),
            as_of=merged.get("subscription_as_of"),
            source_url=merged.get("url"),
            status=merged.get("status") or "Live",
        )
        enr.ipo = GrowwIpo(
            board=merged.get("board"), open_date=merged.get("open_date"),
            close_date=merged.get("close_date"), listing_date=merged.get("listing_date"),
            price_band=merged.get("price_band"), issue_price=merged.get("issue_price"),
            lot_size=merged.get("lot_size"), min_investment=merged.get("min_investment"),
            issue_size_cr=merged.get("issue_size_cr"), listing_price=merged.get("listing_price"),
            listing_gain_pct=merged.get("listing_gain_pct"),
        )
        if not enr.match.matched_name:
            enr.match = GrowwMatch(
                matched_name=merged.get("company_name"), confidence=1.0,
                ipo_slug=row.get("search_id"), ipo_url=merged.get("url"),
                isin=merged.get("isin"),
            )
        else:
            enr.match.ipo_slug = row.get("search_id")
            enr.match.ipo_url = merged.get("url")
        if not enr.provenance.source_url:
            enr.provenance = GrowwProvenance(
                source_url=merged.get("url"), fetched_at=enr.fetched_at,
                data_period=merged.get("subscription_as_of"),
                status=merged.get("status") or "Live",
            )

    return enr if matched else None


# ---------------------------------------------------------------------------
# Conflict detection — compare official (kept) vs Groww (logged)
# ---------------------------------------------------------------------------
def _mv(fin, name):
    mv = getattr(fin, name, None)
    return (mv.value, mv.source) if mv is not None else (None, None)


def detect_conflicts(company: str, obj, enr: GrowwEnrichment) -> List[GrowwConflict]:
    out: List[GrowwConflict] = []
    url = enr.match.stock_url or enr.match.ipo_url or enr.provenance.source_url
    fund = enr.fundamentals
    fy25 = enr.financials_by_year.get("FY2025") or {}

    def add(field, official_value, official_source, groww_value, rel=0.02, abs_min=0.0, note=None):
        if _differs(official_value, groww_value, rel=rel, abs_min=abs_min):
            out.append(GrowwConflict(
                company=company, field=field,
                official_value=round(float(official_value), 4),
                official_source=official_source,
                groww_value=round(float(groww_value), 4),
                groww_url=url, note=note,
            ))

    if isinstance(obj, Filing):
        add("issue.market_cap_cr", obj.issue.market_cap_cr, "SEBI/filing", fund.market_cap_cr)
        add("issue.total_cr", obj.issue.total_cr, "SEBI/filing",
            enr.ipo.issue_size_cr if enr.ipo else None)
        rv, rs = _mv(obj.financials, "roe_pct")
        add("financials.roe_pct", rv, rs, fund.roe_pct, abs_min=0.5)
        dv, ds = _mv(obj.financials, "debt_equity")
        add("financials.debt_equity", dv, ds, fund.debt_equity)
        pv, ps = _mv(obj.financials, "promoter_hold_pct")
        add("financials.promoter_hold_pct", pv, ps, fund.promoter_hold_pct, abs_min=0.5)
        rev, revs = _mv(obj.financials, "revenue_fy25")
        add("financials.revenue_fy25", rev, revs, fy25.get("revenue_cr"),
            note="Groww FY2025 (consolidated) vs filing figure")
        pat, pats = _mv(obj.financials, "pat_fy25")
        add("financials.pat_fy25", pat, pats, fy25.get("pat_cr"),
            note="Groww FY2025 (consolidated) vs filing figure")
    elif isinstance(obj, IpoRow):
        add("issue_size_cr", obj.issue_size_cr, "NSE", enr.ipo.issue_size_cr if enr.ipo else None)
        add("issue_price", obj.issue_price, "NSE", enr.ipo.issue_price if enr.ipo else None)
        add("subscription_x", obj.subscription_x, "NSE",
            enr.subscription.total if enr.subscription else None, abs_min=0.05)
    return out


# ---------------------------------------------------------------------------
# Dashboard-level enrichment
# ---------------------------------------------------------------------------
def enrich_dashboard(
    dashboard: Dashboard,
    client: Optional[GrowwClient] = None,
    only: Optional[str] = None,
    limit: Optional[int] = None,
) -> dict:
    """Enrich every record in the dashboard in place. Returns a run summary dict.

    ``only`` restricts to companies whose normalized name contains the given text;
    ``limit`` caps how many distinct companies are resolved (useful for a smoke test).
    """
    client = client or GrowwClient()
    ipo_index = build_ipo_index(client)

    targets: List[Tuple[str, object]] = []
    for f in dashboard.filings:
        targets.append((f.company_name, f))
    if dashboard.ipo_market:
        for r in dashboard.ipo_market.open_upcoming:
            targets.append((r.company_name, r))
        for r in dashboard.ipo_market.recent_listings:
            targets.append((r.company_name, r))

    if only:
        needle = normalize_name(only)
        targets = [t for t in targets if needle in normalize_name(t[0])]

    conflicts: List[GrowwConflict] = []
    cache: Dict[str, Optional[GrowwEnrichment]] = {}
    stats = {
        "companies_seen": 0, "distinct_companies": 0, "matched": 0,
        "stock_pages": 0, "ipo_pages": 0, "records_enriched": 0,
        "fields_populated": 0, "conflicts": 0, "unmatched": [], "fetch_failures": 0,
    }
    resolved_count = 0

    for name, obj in targets:
        stats["companies_seen"] += 1
        norm = normalize_name(name)
        if norm not in cache:
            if limit is not None and resolved_count >= limit:
                continue
            resolved_count += 1
            stats["distinct_companies"] += 1
            try:
                cache[norm] = build_enrichment(name, client, ipo_index)
            except Exception as e:  # never let one company abort the run
                log.warning("Groww enrichment error for %s: %s", name, e)
                cache[norm] = None
            if cache[norm] is None:
                stats["unmatched"].append(name)
            else:
                stats["matched"] += 1
                if cache[norm].match.stock_url:
                    stats["stock_pages"] += 1
                if cache[norm].match.ipo_url:
                    stats["ipo_pages"] += 1

        enr = cache.get(norm)
        if enr is None:
            continue
        obj.groww = enr
        stats["records_enriched"] += 1
        stats["fields_populated"] += _count_fields(enr)
        c = detect_conflicts(name, obj, enr)
        conflicts.extend(c)

    stats["conflicts"] = len(conflicts)
    stats["fetch_failures"] = client.failures
    stats["network_fetches"] = client.fetches
    stats["cache_hits"] = client.cache_hits
    dashboard.groww_conflicts = conflicts or None
    dashboard.groww_summary = {k: v for k, v in stats.items() if k != "unmatched"}
    dashboard.groww_summary["unmatched_count"] = len(stats["unmatched"])
    return stats


def _count_fields(enr: GrowwEnrichment) -> int:
    n = sum(1 for v in enr.fundamentals.model_dump().values() if v is not None)
    if enr.subscription:
        n += sum(1 for v in enr.subscription.model_dump().values() if isinstance(v, (int, float)))
    if enr.ipo:
        n += sum(1 for v in enr.ipo.model_dump().values() if v is not None)
    n += len(enr.financials_by_year)
    return n


# ---------------------------------------------------------------------------
# CLI — enrich the committed data/latest.json in place (fill-only) and re-emit.
#   python -m drhp_pipeline.groww_enrich --only "Waterways"   # validation
#   python -m drhp_pipeline.groww_enrich                       # full run
# ---------------------------------------------------------------------------
CONFLICT_LOG = "data/groww_conflicts.json"


def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    import json
    from . import emit

    p = argparse.ArgumentParser(description="Enrich latest.json with Groww (fill-only, secondary).")
    p.add_argument("--input", default=emit.LATEST_PATH)
    p.add_argument("--only", help="Restrict to companies whose name contains this text")
    p.add_argument("--limit", type=int, help="Cap distinct companies resolved (smoke test)")
    p.add_argument("--dry-run", action="store_true", help="Do not write latest.json / Excel")
    p.add_argument("--cache-dir", default="data/cache/groww")
    p.add_argument("--rate-limit", type=float, default=1.5)
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")

    dashboard = Dashboard(**json.load(open(args.input, encoding="utf-8")))
    client = GrowwClient(cache_dir=args.cache_dir, rate_limit=args.rate_limit)
    stats = enrich_dashboard(dashboard, client=client, only=args.only, limit=args.limit)

    if not args.dry_run:
        emit.write_latest(dashboard, args.input)
        emit.write_excel_appendix(dashboard)
        with open(CONFLICT_LOG, "w", encoding="utf-8") as fh:
            json.dump([c.model_dump() for c in (dashboard.groww_conflicts or [])], fh, indent=2)

    print("\n──────── GROWW ENRICHMENT SUMMARY ────────")
    print(f"Companies seen (records):     {stats['companies_seen']}")
    print(f"Distinct companies resolved:  {stats['distinct_companies']}")
    print(f"Matched on Groww:             {stats['matched']}")
    print(f"  · stock pages matched:      {stats['stock_pages']}")
    print(f"  · IPO pages matched:        {stats['ipo_pages']}")
    print(f"Records enriched:             {stats['records_enriched']}")
    print(f"Fields newly populated:       {stats['fields_populated']}")
    print(f"Conflicts with official data: {stats['conflicts']}")
    print(f"Unmatched companies:          {len(stats['unmatched'])}")
    for nm in stats["unmatched"]:
        print(f"    – {nm}")
    print(f"Network fetches / cache hits: {stats.get('network_fetches')} / {stats.get('cache_hits')}")
    print(f"Fetch failures:               {stats['fetch_failures']}")
    print("──────────────────────────────────────────")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
