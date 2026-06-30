from drhp_pipeline.contract import (
    Dashboard, Filing, Financials, Meta, MetricValue, Summary,
)


def test_empty_metric_is_all_null():
    m = MetricValue.empty()
    assert m.value is None and m.source is None and m.confidence is None


def test_financials_default_all_null():
    fin = Financials()
    dumped = fin.model_dump()
    assert all(v == {"value": None, "source": None, "confidence": None} for v in dumped.values())


def test_dashboard_json_preserves_nulls_and_stage2_fields():
    f = Filing(
        id="abc", company_name="Acme Ltd", company_name_normalized="acme",
        filing_date="2026-06-30", filing_type="DRHP", stage="DRHP",
    )
    d = Dashboard(
        meta=Meta(run_date="2026-06-30", week_start="2026-06-24", week_end="2026-06-30",
                  data_as_of="2026-06-30", snapshot_id="2026-06-30"),
        summary=Summary(), filings=[f],
    )
    import json
    obj = json.loads(d.to_json())
    assert obj["meta"]["previous_snapshot_id"] is None
    assert obj["summary"]["deltas"] is None
    # Stage 2 fields present but null
    for key in ("competitor_impact", "risk_factors", "sector_kpis"):
        assert obj["filings"][0][key] is None


def test_contract_rejects_unknown_field():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Meta(run_date="x", week_start="x", week_end="x", data_as_of="x",
             snapshot_id="x", bogus="nope")
