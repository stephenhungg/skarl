from copy import deepcopy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from skarl_verifier.models import VerificationReport

EXAMPLE = Path(__file__).resolve().parents[1] / "examples/scaffold-report.json"


@pytest.fixture
def payload():
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def test_scaffold_is_explicitly_unavailable(payload):
    report = VerificationReport.model_validate(payload)
    assert report.pipeline.status == "ml_unavailable"
    assert report.recommendation == "needs_review"
    assert not report.pipeline.modelRuns


def test_scaffold_cannot_recommend_acceptance(payload):
    payload["recommendation"] = "accept"
    with pytest.raises(ValidationError, match="scaffold and incomplete"):
        VerificationReport.model_validate(payload)


def test_monetary_output_is_rejected(payload):
    payload["payoutAmount"] = "7.50"
    with pytest.raises(ValidationError, match="Extra inputs"):
        VerificationReport.model_validate(payload)


def test_evidence_cannot_exceed_source_duration(payload):
    payload["criteria"][0]["evidence"] = [{
        "modality": "video", "startMs": 10000, "endMs": 13000, "claim": "A cup moves."
    }]
    with pytest.raises(ValidationError, match="within the source duration"):
        VerificationReport.model_validate(payload)


def test_evidence_cannot_run_backwards(payload):
    payload["criteria"][0]["evidence"] = [{
        "modality": "audio", "startMs": 5000, "endMs": 4000, "claim": "The speaker says red."
    }]
    with pytest.raises(ValidationError, match="greater than or equal"):
        VerificationReport.model_validate(payload)


def test_boolean_is_not_a_timestamp(payload):
    payload["source"]["durationMs"] = True
    with pytest.raises(ValidationError):
        VerificationReport.model_validate(payload)


def test_acceptance_requires_clear_duplicate_check(payload):
    payload["pipeline"].update(status="completed", implementation="inference")
    payload["pipeline"]["modelRuns"] = [{
        "provider": "synthetic", "model": "synthetic-model", "promptVersion": "test-v1"
    }]
    for criterion in payload["criteria"]:
        criterion["status"] = "supported"
        criterion["evidence"] = [{
            "modality": "video", "startMs": 0, "endMs": 1000,
            "claim": "Synthetic evidence for a contract test only."
        }]
    payload["recommendation"] = "accept"
    with pytest.raises(ValidationError, match="clear duplicate"):
        VerificationReport.model_validate(payload)


def test_acceptance_requires_a_recorded_model_run(payload):
    payload["pipeline"].update(status="completed", implementation="inference")
    payload["recommendation"] = "accept"
    with pytest.raises(ValidationError, match="recorded model run"):
        VerificationReport.model_validate(payload)


def test_duplicate_cannot_reference_itself(payload):
    payload["duplicate"] = {
        "status": "suspected",
        "matches": [{"submissionId": payload["submissionId"], "score": 0.9, "overlapMs": 1000}],
    }
    with pytest.raises(ValidationError, match="same submission"):
        VerificationReport.model_validate(payload)


def test_duplicate_criterion_ids_are_rejected(payload):
    payload["criteria"].append(deepcopy(payload["criteria"][0]))
    with pytest.raises(ValidationError, match="criterionId must be unique"):
        VerificationReport.model_validate(payload)
