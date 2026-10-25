"""Run the cross-language contract cases also used by packages/contracts/src/verification.test.ts."""

from copy import deepcopy
import json
from pathlib import Path

import pytest

from skarl_verifier.models import validate_against_rubric
from skarl_verifier.validation import validate_report_payload

CASES = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "packages/contracts/schemas/fixtures/verification-cases.json"
    ).read_text(encoding="utf-8")
)


def with_changes(base: dict, changes: dict) -> dict:
    value = deepcopy(base)
    for path, replacement in changes.items():
        keys = path.split(".")
        target = value
        for key in keys[:-1]:
            target = target[int(key)] if isinstance(target, list) else target[key]
        last = keys[-1]
        if isinstance(target, list):
            index = int(last)
            if index == len(target):
                target.append(replacement)
            else:
                target[index] = replacement
        else:
            target[last] = replacement
    return value


def is_valid(case: dict) -> bool:
    payload = with_changes(CASES["bases"][case["base"]], case.get("set", {}))
    try:
        report = validate_report_payload(payload)
        if "rubric" in case:
            validate_against_rubric(report, case["rubric"])
    except ValueError:
        return False
    return True


@pytest.mark.parametrize("case", CASES["cases"], ids=[case["name"] for case in CASES["cases"]])
def test_shared_case(case):
    assert is_valid(case) is case["valid"]
