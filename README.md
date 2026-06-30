# DRHP / IPO Weekly Investment Monitor — Data Pipeline (Phase 0)

This is the **research worker** behind the DRHP Intelligence Dashboard. Once a week,
with nobody pressing anything, it:

1. checks SEBI's two public listing pages for newly filed DRHPs and IPO prospectuses,
2. removes duplicates and links a company's draft → final filing,
3. pulls each company's financials from the **official filing PDF** (web search only as
   a labelled fallback),
4. scores every filing on a fixed 100-point formula and sorts it into a recommendation
   bucket,
5. saves a weekly **snapshot** (so the dashboard can later say "+2 vs last week"), and
6. writes one clean data file, **`public/data/latest.json`**, that the dashboard reads.

The dashboard (Phase 1, built separately) only ever reads that one file. The two are
connected by a **frozen data contract** — see [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md).

> **Plain-language summary for the team:** every number on the dashboard is labelled
> with *where it came from* (the official PDF, the web, or a calculation) and *how much
> to trust it* (high / medium / low). Anything we couldn't verify is left blank — never
> guessed. Two features (competitor impact and industry-specific metrics like ARPOB)
> are intentionally left empty until we have the source data for them (Stage 2).

---

## How it runs automatically (the important part)

A GitHub Action (`.github/workflows/weekly-pipeline.yml`) runs the pipeline **every
Monday morning**, commits the refreshed data to `main`, and the connected Cloudflare
Pages site redeploys itself. After the one-time setup below, **no manual steps are ever
needed again.**

You can also trigger it by hand anytime: GitHub → **Actions** → *Weekly DRHP/IPO
Monitor* → **Run workflow**.

### One-time setup: connect the repo to Cloudflare Pages

You only do this once. (It needs a Cloudflare account — free tier is fine.)

1. Push this repository to GitHub (the dashboard and the pipeline live in the same repo).
2. In **Cloudflare → Workers & Pages → Create → Pages → Connect to Git**, choose this repo.
3. Build settings — it's a plain static site, so:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
   - **Production branch:** `main`
4. Click **Save and Deploy**. Cloudflare now watches the `main` branch.
5. Done. From now on, every weekly data commit to `main` makes Cloudflare redeploy the
   dashboard automatically.

The dashboard is at `public/index.html`; it reads `public/data/latest.json` at load
time, so a new data commit is all it takes to refresh the live site.

Nothing else to wire up — the weekly Action already commits to `main`, and Cloudflare
takes it from there.

---

## The dashboard (Phase 1)

A print-ready, static dashboard at `public/index.html` (`public/assets/` holds the
styles and logic). It's deliberately framework-free — plain HTML/CSS/JS — so there's
no build step and Cloudflare serves the `public/` folder as-is. It reads
`public/data/latest.json` and renders five tabs: **Weekly Snapshot, Market Heat, Score
Watchlist, Competitor Watch, Tracker Appendix**. A **Print / Save PDF** button (and the
print stylesheet) lay every tab out in order across A4 pages, with the wide appendix on
its own landscape page.

### What's driven by live data vs. waiting on Stage 2

| Live now (from `latest.json`) | Waiting on Stage 2 |
|---|---|
| KPI counts, buckets, sector concentration | Week-over-week delta pills *(light up automatically once a 2nd snapshot exists)* |
| Top-3 by score, full Score Watchlist | **Competitor Watch** tab → shown as a clean "coming in Stage 2" state |
| Market Heat charts + recommendation donut | `PORTFOLIO WATCH` stamp *(hidden while `competitor_impact` is null)* |
| This week's filings, Tracker Appendix | Industry KPIs like ARPOB (`sector_kpis`) |
| Filing stamps, source/confidence verify dots | Extracted risk factors (`risk_factors`) |

Honest-data handling, as required: a `null` financial shows **"—"** (never `0`); an
`INSUFFICIENT` score shows a calm **"not enough data"** tag; `low`-confidence or
web-sourced figures get a small verify dot; and delta pills stay hidden until there's a
prior snapshot to compare against.

## What it produces

| File | Purpose |
|------|---------|
| `public/data/latest.json` | The single file the dashboard reads. Follows the frozen contract. |
| `data/snapshots/<date>.json` | A full copy of each week's data. Powers "vs last week". **Kept in git on purpose.** |
| `public/data/tracker_appendix.xlsx` | Excel mirror of the week's filings for the appendix view, with a column flagging any figures to double-check. |

---

## Running it locally (for developers)

```bash
pip install -r requirements.txt

# Run for today's date (default):
PYTHONPATH=src python -m drhp_pipeline.pipeline

# Or for a specific week-ending date:
PYTHONPATH=src python -m drhp_pipeline.pipeline --run-date 2026-06-30

# Run the tests:
python -m pytest -q
```

Useful flags: `--no-excel`, `--snapshots-dir`, `--output`, `--scratch-dir`, `-v`.

---

## How it's built (the eight stages)

Each stage is a small, independently testable module under `src/drhp_pipeline/`:

| # | Module | Job |
|---|--------|-----|
| 1 | `contract.py` | The frozen JSON contract as typed models. Everything writes through it. |
| 2 | `scraper.py` | Fetches both SEBI pages (HTTP first, optional headless-browser fallback). Tolerant of SEBI's malformed HTML; warns and continues on failure. |
| 3 | `resolve.py` | Normalizes company names, collapses a company's duplicate/updated filings into one record, links DRHP→IPO. |
| 4 | `weeklogic.py` | Defines "this week" as the trailing 7 days ending on the run-date. |
| 5 | `financials.py` + `pdf_extract.py` | Pulls financials from the filing PDF, labelling every number with source + confidence; computes growth/margins only when inputs exist. `websearch.py` is the (off-by-default) web fallback. |
| 6 | `scoring.py` | The exact 100-point composite and the recommendation buckets. |
| 7 | `snapshot.py` | Saves the weekly snapshot and computes "vs last week" deltas. |
| 8 | `emit.py` | Writes `latest.json` and the Excel appendix. |
| — | `pipeline.py` | Orchestrates all of the above; the command-line entry point. |
| — | `sectors.py` | Keyword sector classification for the Market Heat grouping. |

### The scoring formula (fixed)

```
Composite = Rev Growth (20) + PAT Margin (20) + ROE (15)
          + ROCE (15) + PAT Growth (15) + Revenue Scale (15)   = max 100
```

Buckets: **≥ 25 DIG DEEPER · 10–25 MONITOR · < 10 WATCH · missing inputs INSUFFICIENT.**

The *weights* are fixed by the source brief. Each metric is mapped to its weight by a
transparent linear band (e.g. revenue growth hits full marks at 30%); those saturation
points live in one place — `scoring.py` `BANDS` — and can be tuned if the source email
specified exact cut-offs. A filing without enough verified inputs is marked
**INSUFFICIENT** rather than scored on thin data.

---

## Stage 2 (deliberately deferred)

These contract fields are always `null` for now, and the dashboard tolerates that:

- `competitor_impact` — needs the firm's portfolio list.
- `sector_kpis` — industry-specific metrics (e.g. ARPOB for hospitals).
- `risk_factors` — extracted prospectus risks.

They are left as empty fields on purpose, not faked.

## Known limitations (honest notes)

- **IPO-stage prospectuses** don't always link a short "abridged" PDF on the listing
  page, so their financials may come through as `INSUFFICIENT` until we parse the full
  prospectus. DRHP-stage filings (the main focus) extract reliably.
- **Web-search fallback is off by default** so nothing unverified is ever emitted. It's
  a ready plug-in point (`websearch.py`) if we later add a search/data provider.
- **Issue size in ₹** is often masked (`[●]`) in a draft filing, so those amounts may be
  blank until the company sets a price band.
- The **sector classifier** is keyword-based; good enough for grouping, and easy to
  sharpen later using the PDF's business description.
