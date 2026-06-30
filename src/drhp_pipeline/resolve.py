"""
Stage 3 — Entity resolution & dedup.

  * Normalize company names (lowercase, strip "Limited/Ltd/Pvt/...", punctuation).
  * Collapse all filings for one entity into a single record, keeping the latest
    filing as the representative.
  * A correction/update (Corrigendum / Addendum / UDRHP) anywhere in the group sets
    the `UPDATED` stamp.
  * If an entity appears on BOTH the DRHP and the IPO page, set the `IPO_STAGE` stamp
    (it has progressed from draft to final offer).

The output is one `ResolvedFiling` per entity, ready for week-tagging and enrichment.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional

from .scraper import ScrapedFiling

# Whole-word company suffixes/joiners stripped during normalization.
_NORMALIZE_STOPWORDS = {
    "limited", "ltd", "pvt", "private", "llp", "inc", "incorporated",
    "corporation", "corp", "plc", "company",
}
# Update-type filings imply the base filing was revised.
_UPDATE_TYPES = {"Corrigendum", "Addendum", "UDRHP"}
# Base-type ranking for tie-breaking the representative (higher = more representative).
_TYPE_RANK = {"Prospectus": 5, "DRHP": 4, "UDRHP": 3, "Addendum": 2, "Corrigendum": 1}


def normalize_name(name: str) -> str:
    """Canonical key for matching the same company across filings/weeks."""
    s = name.lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9\s]", " ", s)  # drop punctuation
    tokens = [t for t in s.split() if t and t not in _NORMALIZE_STOPWORDS]
    if tokens and tokens[0] == "the":
        tokens = tokens[1:]
    return " ".join(tokens)


def stable_id(normalized: str) -> str:
    """Deterministic id for an entity — stable across weeks and stage changes."""
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]


def display_name(raw: str) -> str:
    """Tidy an all-caps SEBI title into readable Title Case; leave mixed case alone."""
    letters = re.sub(r"[^A-Za-z]", "", raw)
    if letters and letters.isupper():
        return raw.title()
    return raw.strip()


@dataclass
class ResolvedFiling:
    id: str
    normalized_name: str
    company_name: str
    filing_date: date  # representative (latest) date
    filing_type: str
    stage: str  # "DRHP" | "IPO"
    sebi_url: str
    abridged_pdf_url: Optional[str] = None
    stamps: List[str] = field(default_factory=list)
    all_filings: List[ScrapedFiling] = field(default_factory=list)


def _pick_representative(filings: List[ScrapedFiling]) -> ScrapedFiling:
    """Latest by date; ties broken by base-type rank, then stage (IPO over DRHP)."""
    return max(
        filings,
        key=lambda f: (
            f.filing_date,
            1 if f.stage == "IPO" else 0,
            _TYPE_RANK.get(f.filing_type, 0),
        ),
    )


def resolve(filings: List[ScrapedFiling]) -> List[ResolvedFiling]:
    groups: dict[str, List[ScrapedFiling]] = {}
    for f in filings:
        groups.setdefault(normalize_name(f.company_name_raw), []).append(f)

    resolved: List[ResolvedFiling] = []
    for norm, group in groups.items():
        rep = _pick_representative(group)
        has_ipo = any(f.stage == "IPO" for f in group)
        has_drhp = any(f.stage == "DRHP" for f in group)

        stamps: List[str] = []
        if has_ipo and has_drhp:
            stamps.append("IPO_STAGE")
        if any(f.filing_type in _UPDATE_TYPES for f in group):
            stamps.append("UPDATED")

        # Prefer an abridged-PDF link from the representative, else any filing that has one.
        pdf = rep.abridged_pdf_url or next(
            (f.abridged_pdf_url for f in group if f.abridged_pdf_url), None
        )

        resolved.append(
            ResolvedFiling(
                id=stable_id(norm),
                normalized_name=norm,
                company_name=display_name(rep.company_name_raw),
                filing_date=rep.filing_date,
                filing_type=rep.filing_type,
                stage=rep.stage,
                sebi_url=rep.sebi_url,
                abridged_pdf_url=pdf,
                stamps=stamps,
                all_filings=sorted(group, key=lambda f: f.filing_date),
            )
        )

    # Stable, friendly ordering: newest filing first.
    resolved.sort(key=lambda r: r.filing_date, reverse=True)
    return resolved
