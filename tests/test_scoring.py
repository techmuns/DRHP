from drhp_pipeline.contract import Financials, MetricValue
from drhp_pipeline.scoring import WEIGHTS, score_financials


def mv(v):
    return MetricValue(value=v, source="DRHP_PDF", confidence="high")


def test_weights_sum_to_100():
    assert sum(WEIGHTS.values()) == 100


def test_full_marks_when_all_metrics_saturate():
    fin = Financials(
        rev_growth_pct=mv(50), pat_margin_pct=mv(30), roe_pct=mv(40),
        roce_pct=mv(40), pat_growth_pct=mv(80), revenue_fy25=mv(9000),
    )
    s = score_financials(fin)
    assert s.total == 100
    assert s.bucket == "DIG DEEPER"


def test_zero_metrics_give_watch():
    fin = Financials(
        rev_growth_pct=mv(0), pat_margin_pct=mv(0), roe_pct=mv(0),
        roce_pct=mv(0), pat_growth_pct=mv(0), revenue_fy25=mv(0),
    )
    s = score_financials(fin)
    assert s.total == 0
    assert s.bucket == "WATCH"


def test_missing_inputs_marks_insufficient_not_guessed():
    # Only revenue scale present -> coverage below threshold
    fin = Financials(revenue_fy25=mv(1000))
    s = score_financials(fin)
    assert s.bucket == "INSUFFICIENT"
    assert s.total is None


def test_components_are_null_when_input_missing():
    fin = Financials(revenue_fy25=mv(5000), pat_margin_pct=mv(20))
    s = score_financials(fin)
    assert s.components.revenue_scale == 15
    assert s.components.pat_margin == 20
    assert s.components.roe is None  # not guessed
    assert s.bucket == "DIG DEEPER"  # 35 >= 25


def test_band_is_clamped_at_full_weight():
    fin = Financials(revenue_fy25=mv(50000), pat_margin_pct=mv(20))
    s = score_financials(fin)
    assert s.components.revenue_scale == 15  # clamped, not >15
