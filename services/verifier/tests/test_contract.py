import json
from pathlib import Path

import pytest

from skarl_verifier.cli import main, scaffold_payload
from skarl_verifier.validation import canonical_schema_path, load_report, validate_report_payload

EXAMPLE = Path(__file__).resolve().parents[1] / "examples/scaffold-report.json"


def test_example_matches_canonical_contract():
    report = load_report(EXAMPLE)
    assert report.schemaVersion == "1.0"


def test_generated_scaffold_matches_contract():
    payload = scaffold_payload("submission", "task-v1", "0" * 64, 10000)
    assert validate_report_payload(payload).recommendation == "needs_review"


def test_completed_evidence_can_recommend_acceptance():
    payload = scaffold_payload("submission", "task-v1", "0" * 64, 10000)
    payload["pipeline"].update(status="completed", implementation="inference")
    payload["pipeline"]["modelRuns"] = [{
        "provider": "synthetic-test-only", "model": "not-a-real-inference",
        "promptVersion": "contract-test-v1"
    }]
    payload["criteria"][0].update(
        status="supported",
        evidence=[{
            "modality": "video", "startMs": 1000, "endMs": 2000,
            "claim": "Synthetic evidence for contract validation only."
        }],
    )
    payload["duplicate"] = {"status": "clear", "matches": []}
    payload["recommendation"] = "accept"
    assert validate_report_payload(payload).recommendation == "accept"


def test_missing_schema_is_an_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        canonical_schema_path(tmp_path / "missing.json")


def test_validation_does_not_claim_inference(capsys):
    assert main(["validate-report", str(EXAMPLE)]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["valid"] is True
    assert result["inferenceRan"] is False


def test_analysis_is_unavailable_and_fails_closed(capsys):
    assert main(["analyze", "missing-video.mp4"]) == 4
    result = json.loads(capsys.readouterr().err)
    assert result["status"] == "ml_unavailable"
