import json
import os
from datetime import date

from drhp_pipeline import ipo_market as im

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def load(name):
    return json.load(open(os.path.join(FIX, name)))


def raw():
    return {
        "upcoming": load("nse_upcoming.json"),
        "current": load("nse_current.json"),
        "past": load("nse_past.json"),
    }


def test_parse_helpers():
    assert im.parse_date("29-Jun-2026") == "2026-06-29"
    assert im.parse_date("-") is None
    assert im.board_from_series("SME") == "SME"
    assert im.board_from_series("EQ") == "Mainboard"
    assert im.parse_price_band("Rs.125 to Rs.136 ") == (125.0, 136.0)
    assert im.parse_subscription("1.111") == 1.11
    assert im.parse_subscription("") is None
    # 1.36cr shares * 136 -> 184.96 Cr
    assert im.issue_size_cr("13600000", 136.0) == 184.96


def test_clean_company_detects_withdrawn():
    name, w = im.clean_company("Sri Priyanka Geo Commex Limited-Issue Withdrawn")
    assert name == "Sri Priyanka Geo Commex Limited" and w is True
    name, w = im.clean_company("Aastha Spintex Limited")
    assert name == "Aastha Spintex Limited" and w is False


def test_build_market_from_real_fixtures():
    market = im.build_market(raw(), date(2026, 6, 30))
    assert market.available is True
    assert market.source == "NSE"
    # open/upcoming has the live issues; board detected
    names = [r.company_name for r in market.open_upcoming]
    assert "Aastha Spintex Limited" in names
    aastha = next(r for r in market.open_upcoming if r.company_name == "Aastha Spintex Limited")
    assert aastha.board == "Mainboard"
    assert aastha.issue_open == "2026-06-29"
    assert aastha.issue_size_cr and aastha.issue_size_cr > 100
    assert aastha.subscription_x is not None  # from current-issue feed
    # SME correctly tagged
    assert any(r.board == "SME" for r in market.open_upcoming)
    # recent listings present, and gain/loss honestly left null (no price feed)
    assert all(r.gain_pct is None and r.current_price is None for r in market.recent_listings)
    # the past-issues feed mixes in NCDs/bonds/REITs — recent listings must be
    # equity IPOs only, so no coupon-code (leading-digit) bond symbols leak through
    assert market.recent_listings, "expected some equity listings in the window"
    assert all(not (r.symbol or "")[:1].isdigit() for r in market.recent_listings)
    # pulse counts derived; positive/negative listing stays null (not computable)
    assert market.pulse.ipo_open is not None
    assert market.pulse.positive_listing is None


def test_is_equity_series():
    assert im.is_equity_series("EQ")
    assert im.is_equity_series("sme")      # case-insensitive
    assert im.is_equity_series(" BE ")     # whitespace-tolerant
    assert not im.is_equity_series("N0")   # NCD / bond
    assert not im.is_equity_series("DEBT")
    assert not im.is_equity_series("RR")   # REIT
    assert not im.is_equity_series("IV")   # InvIT
    assert not im.is_equity_series(None)


def test_is_debt_symbol():
    # coupon-code bond/NCD symbols -> debt
    assert im.is_debt_symbol("783LTFL29")   # 7.83% L&T Finance 2029
    assert im.is_debt_symbol("12VPT28A")    # 12% Viviana Power Tech 2028-A (SME platform)
    assert im.is_debt_symbol("727NGEL36")
    # genuine equity tickers, including digit-led ones -> not debt
    assert not im.is_debt_symbol("KNACK")
    assert not im.is_debt_symbol("360ONE")
    assert not im.is_debt_symbol("20MICRONS")
    assert not im.is_debt_symbol("63MOONS")
    assert not im.is_debt_symbol(None)


def test_recent_listings_excludes_non_equity():
    run_date = date(2026, 7, 13)
    past = [
        {"companyName": "Knack Packaging Limited", "securityType": "EQ",
         "symbol": "KNACK", "priceRange": "Rs.100 to Rs.110", "listingDate": "08-Jul-2026"},
        {"companyName": "Utkal Speciality Limited", "securityType": "SME",
         "symbol": "UTKAL", "priceRange": "Rs.90 to Rs.95", "listingDate": "17-Jun-2026"},
        # Mainboard NCD tranche — dropped by the series allowlist (N-series)
        {"companyName": "L&T Finance Limited", "securityType": "N0",
         "symbol": "783LTFL29", "priceRange": "Rs.1000", "listingDate": "10-Jul-2026"},
        # SME-platform NCD — passes the series allowlist (SME) but dropped by the
        # coupon-code symbol guard
        {"companyName": "Viviana Power Tech Limited", "securityType": "SME",
         "symbol": "12VPT28A", "priceRange": "Rs.55", "listingDate": "22-Jun-2026"},
        # explicit debt — dropped
        {"companyName": "Nashik Municipal Corporation", "securityType": "DEBT",
         "symbol": "NMC01", "priceRange": "Rs.1000", "listingDate": "05-Jul-2026"},
        # REIT — dropped
        {"companyName": "Bagmane Prime Office REIT", "securityType": "RR",
         "symbol": "BAGMANE", "priceRange": "Rs.95 to Rs.100", "listingDate": "02-Jul-2026"},
    ]
    rows = im.build_recent_listings(past, run_date)
    assert {r.company_name for r in rows} == {"Knack Packaging Limited", "Utkal Speciality Limited"}
    assert next(r for r in rows if r.symbol == "UTKAL").board == "SME"


def test_build_market_unavailable():
    m = im.build_market(None, date(2026, 6, 30))
    assert m.available is False
    assert m.open_upcoming == [] and m.recent_listings == []
