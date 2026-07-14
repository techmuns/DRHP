# Data Contract (frozen)

`data/latest.json` is the **only** interface between this pipeline and the
dashboard. Field names and shape are frozen — the UI is built to expect exactly this.
The authoritative implementation is `src/drhp_pipeline/contract.py` (typed models that
reject unknown fields). Stage-2 fields are present but always `null` for now.

```jsonc
{
  "meta": {
    "run_date": "2026-06-30",
    "week_start": "2026-06-24",          // trailing 7-day window, inclusive
    "week_end": "2026-06-30",
    "data_as_of": "2026-06-30",
    "snapshot_id": "2026-06-30",
    "previous_snapshot_id": null         // null on the first run
  },
  "summary": {
    "new_drhp_count": 0,
    "new_ipo_count": 0,
    "buckets": { "dig_deeper": 0, "monitor": 0, "watch": 0 },
    "deltas": null,                      // null until a previous snapshot exists
    "sector_concentration": [
      { "sector": "Healthcare", "count": 0, "total_issue_cr": 0 }
    ]
  },
  "filings": [
    {
      "id": "string-stable-hash",        // stable across weeks & stage changes
      "company_name": "Oravel Stays Limited",
      "company_name_normalized": "oravel stays",
      "filing_date": "2026-06-30",
      "filing_type": "DRHP",             // DRHP | Corrigendum | Addendum | UDRHP | Prospectus
      "stage": "DRHP",                   // DRHP | IPO
      "sector": "Consumer",
      "sub_sector": "Hospitality",
      "business_summary": "string|null",
      "issue": {
        "type": "Both",                  // Fresh | OFS | Both | null
        "fresh_cr": null, "ofs_cr": null, "total_cr": null,
        "market_cap_cr": null, "issue_to_mktcap_pct": null
      },
      "financials": {
        // every metric: value + source + confidence
        "revenue_fy25": { "value": 6252.83, "source": "DRHP_PDF", "confidence": "high" },
        "revenue_fy24": { "value": 5388.79, "source": "DRHP_PDF", "confidence": "high" },
        "rev_growth_pct": { "value": 16.03, "source": "derived", "confidence": "high" },
        "ebitda_fy25": { "value": null, "source": null, "confidence": null },
        "ebitda_margin_pct": { "value": null, "source": null, "confidence": null },
        "pat_fy25": { "value": 244.82, "source": "DRHP_PDF", "confidence": "high" },
        "pat_fy24": { "value": 229.58, "source": "DRHP_PDF", "confidence": "high" },
        "pat_growth_pct": { "value": 6.64, "source": "derived", "confidence": "high" },
        "pat_margin_pct": { "value": 3.87, "source": "derived", "confidence": "high" },
        "roe_pct": { "value": null, "source": null, "confidence": null },
        "roce_pct": { "value": null, "source": null, "confidence": null },
        "debt_equity": { "value": null, "source": null, "confidence": null },
        "asset_base_cr": { "value": null, "source": null, "confidence": null },
        "promoter_hold_pct": { "value": null, "source": null, "confidence": null }
      },
      "score": {
        "total": 32.0,
        "components": {
          "rev_growth": 10.69, "pat_margin": 3.87, "roe": null,
          "roce": null, "pat_growth": 2.49, "revenue_scale": 15.0
        },
        "bucket": "DIG DEEPER"           // DIG DEEPER | MONITOR | WATCH | INSUFFICIENT
      },
      "lead_managers": [],
      "stamps": ["FILED_THIS_WEEK", "UPDATED"], // FILED_THIS_WEEK | UPDATED | IPO_STAGE | PORTFOLIO_WATCH
      "sources": {
        "sebi_url": "https://www.sebi.gov.in/...",
        "drhp_pdf_url": "https://www.sebi.gov.in/...pdf"  // null if not yet available
      },

      // ----- STAGE 2 (always null now; UI must tolerate null) -----
      "competitor_impact": null,         // { "portfolio_company": "...", "relation": "...", "note": "..." }
      "risk_factors": null,              // [ "string", ... ]
      "sector_kpis": null                // { "arpob_fy25": null, ... }
    }
  ]
}
```

## Vocabularies

| Field | Allowed values |
|-------|----------------|
| `financials.*.source` | `DRHP_PDF` · `WEB` · `derived` · `null` |
| `financials.*.confidence` | `high` · `medium` · `low` · `null` |
| `filing_type` | `DRHP` · `Corrigendum` · `Addendum` · `UDRHP` · `Prospectus` |
| `stage` | `DRHP` · `IPO` |
| `issue.type` | `Fresh` · `OFS` · `Both` · `null` |
| `score.bucket` | `DIG DEEPER` · `MONITOR` · `WATCH` · `INSUFFICIENT` |
| `stamps[]` | `FILED_THIS_WEEK` · `UPDATED` · `IPO_STAGE` · `PORTFOLIO_WATCH` |

## IPO market layer (additive, from NSE)

These fields were added on top of the frozen core. They are **nullable / best-effort**:
NSE blocks datacenter IPs, so `ipo_market.available` may be `false` (UI shows a
"pending source" state). Listing **gain/loss is always null** for now — NSE's quote API
is blocked, so there is no current price to compute it from (never fabricated).

Per-filing additions:
```jsonc
"board": "Mainboard",                 // Mainboard | SME | null
"current_stage": "Listed",            // DRHP Filed | Updated/Corrected | IPO Open | Listing Soon | Listed | Withdrawn
"listing_outcome": "Pending"          // Positive | Negative | Pending | null
```

Top-level `ipo_market`:
```jsonc
"ipo_market": {
  "available": true,                  // false -> show "pending source"
  "as_of": "2026-06-30", "source": "NSE",
  "pulse": { "drhp_filed": 3, "updated": 1, "ipo_open": 3, "listing_soon": 1,
             "listed": 22, "positive_listing": null, "negative_listing": null },
  "by_board": { "mainboard": 3, "sme": 3 },
  "open_upcoming": [ { "company_name": "...", "board": "SME", "symbol": "...",
      "issue_open": "...", "issue_close": "...", "price_band": "Rs.125 to Rs.136",
      "issue_size_cr": 184.96, "subscription_x": 1.11, "status": "Active", "stage": "IPO Open" } ],
  "recent_listings": [ { "company_name": "...", "board": "Mainboard", "listing_date": "...",
      "issue_price": null, "current_price": null, "gain_pct": null, "stage": "Listed" } ]
}
```

## Groww enrichment layer (additive, SECONDARY)

Official filings (SEBI / NSE / BSE) stay **primary**. Groww is a *fill-only* secondary
source: it never overwrites a present official value, and every difference is recorded
in `groww_conflicts`. All Groww-derived data lives in an additive `groww` namespace on
each `filing` / `ipo_market` row so the official fields stay pristine.

```jsonc
"groww": {
  "match": { "matched_name": "...", "confidence": 1.0,
             "stock_url": "https://groww.in/stocks/...", "ipo_url": "https://groww.in/ipo/...",
             "isin": "INE...", "nse_code": "..." },
  "provenance": { "source_name": "Groww", "source_url": "...", "fetched_at": "...",
                  "data_period": "Jun '26", "status": "Live|Final|Historical" },
  "fundamentals": { "market_cap_cr": 6210.0, "roe_pct": 65.01, "debt_equity": 1.47,
                    "pe_ratio": 119.15, "pb_ratio": 9.34, "eps": 7.20, "book_value": 91.89,
                    "dividend_yield_pct": 0.0, "industry_pe": 39.54, "promoter_hold_pct": 89.35,
                    "face_value": 10.0 },
  "subscription": { "qib": 0.69, "nii": 1.17, "retail": 4.12, "employee": null,
                    "total": 1.44, "as_of": "...", "source_url": "...", "status": "Final" },
  "ipo": { "board": "Mainboard", "open_date": "...", "close_date": "...", "listing_date": "...",
           "price_band": "Rs.769 to Rs.808", "issue_price": 808.0, "lot_size": 18.0,
           "min_investment": 14544.0, "issue_size_cr": 585.0, "listing_price": 681.0,
           "listing_gain_pct": -15.72 },
  "financials_by_year": { "FY2025": { "revenue_cr": 597.68, "pat_cr": 168.19, "basis": "CONSOLIDATED" } }
}
```

Top-level `groww_conflicts` is a list of `{ company, field, official_value, official_source,
groww_value, groww_url, note }` (official kept, difference flagged). `groww_summary` carries
the run counts. Missing Groww values stay `null` — never zero. Subscription multiples are
numeric (1.44× → `1.44`); the "×" is UI formatting only.

## UI rules the contract implies

- Where a financial `value` is `null`, show **"—"**, not `0`.
- Where a value's `confidence` is `low` (or `source` is `WEB`), show a small "verify"
  indicator — these are the figures to double-check.
- Render **week-change pills** only when `summary.deltas` is non-null (first run is null).
- **Tab 4 Competitor Watch** and the `PORTFOLIO_WATCH` stamp depend on
  `competitor_impact`, which is `null` in Stage 1 → render a clean empty state.
