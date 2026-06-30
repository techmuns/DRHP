"""
Data Contract — the single source of truth for the shape of `public/data/latest.json`.

This is the frozen interface between the data pipeline (Phase 0) and the UI (Phase 1).
Every other module writes its output *through* these models so the emitted JSON can
never drift from the agreed shape. Field names and structure must not change.

Stage-2 fields (`competitor_impact`, `risk_factors`, `sector_kpis`) are present but
always `null` in Stage 1. The UI is built to tolerate that.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Controlled vocabularies (kept as Literals so a typo fails fast in tests)
# ---------------------------------------------------------------------------
Source = Literal["DRHP_PDF", "WEB", "derived"]
Confidence = Literal["high", "medium", "low"]
FilingType = Literal["DRHP", "Corrigendum", "Addendum", "UDRHP", "Prospectus"]
Stage = Literal["DRHP", "IPO"]
IssueType = Literal["Fresh", "OFS", "Both"]
Bucket = Literal["DIG DEEPER", "MONITOR", "WATCH", "INSUFFICIENT"]
Stamp = Literal["FILED_THIS_WEEK", "UPDATED", "IPO_STAGE", "PORTFOLIO_WATCH"]


class _Model(BaseModel):
    """Base: forbid unknown fields so the contract can't silently grow."""

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Financials — every number carries value + where it came from + how much to trust it
# ---------------------------------------------------------------------------
class MetricValue(_Model):
    """A single financial figure with provenance.

    An "empty" metric (nothing known yet) is all-null: value/source/confidence = None.
    """

    value: Optional[float] = None
    source: Optional[Source] = None
    confidence: Optional[Confidence] = None

    @classmethod
    def empty(cls) -> "MetricValue":
        return cls(value=None, source=None, confidence=None)


class Financials(_Model):
    revenue_fy25: MetricValue = Field(default_factory=MetricValue.empty)
    revenue_fy24: MetricValue = Field(default_factory=MetricValue.empty)
    rev_growth_pct: MetricValue = Field(default_factory=MetricValue.empty)
    ebitda_fy25: MetricValue = Field(default_factory=MetricValue.empty)
    ebitda_margin_pct: MetricValue = Field(default_factory=MetricValue.empty)
    pat_fy25: MetricValue = Field(default_factory=MetricValue.empty)
    pat_fy24: MetricValue = Field(default_factory=MetricValue.empty)
    pat_growth_pct: MetricValue = Field(default_factory=MetricValue.empty)
    pat_margin_pct: MetricValue = Field(default_factory=MetricValue.empty)
    roe_pct: MetricValue = Field(default_factory=MetricValue.empty)
    roce_pct: MetricValue = Field(default_factory=MetricValue.empty)
    debt_equity: MetricValue = Field(default_factory=MetricValue.empty)
    asset_base_cr: MetricValue = Field(default_factory=MetricValue.empty)
    promoter_hold_pct: MetricValue = Field(default_factory=MetricValue.empty)


# ---------------------------------------------------------------------------
# Issue size
# ---------------------------------------------------------------------------
class Issue(_Model):
    type: Optional[IssueType] = None
    fresh_cr: Optional[float] = None
    ofs_cr: Optional[float] = None
    total_cr: Optional[float] = None
    market_cap_cr: Optional[float] = None
    issue_to_mktcap_pct: Optional[float] = None


# ---------------------------------------------------------------------------
# Score
# ---------------------------------------------------------------------------
class ScoreComponents(_Model):
    rev_growth: Optional[float] = None
    pat_margin: Optional[float] = None
    roe: Optional[float] = None
    roce: Optional[float] = None
    pat_growth: Optional[float] = None
    revenue_scale: Optional[float] = None


class Score(_Model):
    total: Optional[float] = None
    components: ScoreComponents = Field(default_factory=ScoreComponents)
    bucket: Bucket = "INSUFFICIENT"


class Sources(_Model):
    sebi_url: Optional[str] = None
    drhp_pdf_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Filing — one row of the monitor
# ---------------------------------------------------------------------------
class Filing(_Model):
    id: str
    company_name: str
    company_name_normalized: str
    filing_date: str  # ISO YYYY-MM-DD
    filing_type: FilingType
    stage: Stage
    sector: Optional[str] = None
    sub_sector: Optional[str] = None
    business_summary: Optional[str] = None
    issue: Issue = Field(default_factory=Issue)
    financials: Financials = Field(default_factory=Financials)
    score: Score = Field(default_factory=Score)
    lead_managers: List[str] = Field(default_factory=list)
    stamps: List[Stamp] = Field(default_factory=list)
    sources: Sources = Field(default_factory=Sources)

    # ----- IPO lifecycle (from NSE; null when not matched / not available) -----
    board: Optional[str] = None          # Mainboard | SME
    current_stage: Optional[str] = None  # DRHP Filed | Updated/Corrected | IPO Open | Listing Soon | Listed | Withdrawn
    listing_outcome: Optional[str] = None  # Positive | Negative | Pending | null

    # ----- STAGE 2 (always null in Stage 1; UI must tolerate null) -----
    competitor_impact: Optional[dict] = None
    risk_factors: Optional[List[str]] = None
    sector_kpis: Optional[dict] = None


# ---------------------------------------------------------------------------
# Summary blocks
# ---------------------------------------------------------------------------
class Buckets(_Model):
    dig_deeper: int = 0
    monitor: int = 0
    watch: int = 0


class Deltas(_Model):
    # null until a previous snapshot exists; values like "+2" | "flat" | "-1"
    new_drhp: Optional[str] = None
    new_ipo: Optional[str] = None
    dig_deeper: Optional[str] = None
    monitor: Optional[str] = None
    watch: Optional[str] = None


class SectorConcentration(_Model):
    sector: str
    count: int = 0
    total_issue_cr: float = 0


class Summary(_Model):
    new_drhp_count: int = 0
    new_ipo_count: int = 0
    buckets: Buckets = Field(default_factory=Buckets)
    deltas: Optional[Deltas] = None  # null on first run
    sector_concentration: List[SectorConcentration] = Field(default_factory=list)


class Meta(_Model):
    run_date: str
    week_start: str
    week_end: str
    data_as_of: str
    snapshot_id: str
    previous_snapshot_id: Optional[str] = None  # null on first run


# ---------------------------------------------------------------------------
# Root document
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# IPO market layer (from NSE) — additive; null/empty when the source is unreachable
# ---------------------------------------------------------------------------
class IpoRow(_Model):
    company_name: str
    board: Optional[str] = None          # Mainboard | SME
    sector: Optional[str] = None
    symbol: Optional[str] = None
    issue_open: Optional[str] = None
    issue_close: Optional[str] = None
    listing_date: Optional[str] = None
    price_band: Optional[str] = None
    issue_size_cr: Optional[float] = None
    subscription_x: Optional[float] = None
    issue_price: Optional[float] = None
    current_price: Optional[float] = None   # NSE quote blocked -> always null for now
    gain_pct: Optional[float] = None        # listing gain/loss -> null until price exists
    status: Optional[str] = None
    stage: Optional[str] = None             # Upcoming | IPO Open | Listing Soon | Listed | Withdrawn


class IpoPulse(_Model):
    drhp_filed: Optional[int] = None
    updated: Optional[int] = None
    ipo_open: Optional[int] = None
    listing_soon: Optional[int] = None
    listed: Optional[int] = None
    positive_listing: Optional[int] = None   # needs listing price -> null
    negative_listing: Optional[int] = None


class IpoMarket(_Model):
    available: bool = False                  # false -> UI shows "pending source"
    as_of: Optional[str] = None
    source: Optional[str] = None
    pulse: IpoPulse = Field(default_factory=IpoPulse)
    by_board: dict = Field(default_factory=dict)
    open_upcoming: List[IpoRow] = Field(default_factory=list)
    recent_listings: List[IpoRow] = Field(default_factory=list)


class Dashboard(_Model):
    meta: Meta
    summary: Summary
    filings: List[Filing] = Field(default_factory=list)
    ipo_market: Optional[IpoMarket] = None

    def to_json(self, indent: int = 2) -> str:
        """Serialize to the exact contract JSON (nulls preserved, key order stable)."""
        return self.model_dump_json(indent=indent)
