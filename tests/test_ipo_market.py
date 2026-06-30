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
    # pulse counts derived; positive/negative listing stays null (not computable)
    assert market.pulse.ipo_open is not None
    assert market.pulse.positive_listing is None


def test_build_market_unavailable():
    m = im.build_market(None, date(2026, 6, 30))
    assert m.available is False
    assert m.open_upcoming == [] and m.recent_listings == []
