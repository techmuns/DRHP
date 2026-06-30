# Data Contract (frozen)

`public/data/latest.json` is the **only** interface between this pipeline and the
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

## UI rules the contract implies

- Where a financial `value` is `null`, show **"—"**, not `0`.
- Where a value's `confidence` is `low` (or `source` is `WEB`), show a small "verify"
  indicator — these are the figures to double-check.
- Render **week-change pills** only when `summary.deltas` is non-null (first run is null).
- **Tab 4 Competitor Watch** and the `PORTFOLIO_WATCH` stamp depend on
  `competitor_impact`, which is `null` in Stage 1 → render a clean empty state.
