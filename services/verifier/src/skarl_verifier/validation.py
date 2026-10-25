"""Validate typed fields and the repository's canonical JSON Schema."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from .models import VerificationReport, validate_against_rubric

SCHEMA_RELATIVE_PATH = Path("packages/contracts/schemas/verification-report.schema.json")


def canonical_schema_path(explicit_path: Path | None = None) -> Path:
    if explicit_path is not None:
        if not explicit_path.is_file():
            raise FileNotFoundError(f"canonical schema not found: {explicit_path}")
        return explicit_path

    # Search only from this package's location so a file in the working directory
    # cannot replace the canonical schema.
    for root in Path(__file__).resolve().parents:
        candidate = root / SCHEMA_RELATIVE_PATH
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"cannot find {SCHEMA_RELATIVE_PATH} from the installed package; pass --schema"
    )


def validate_report_payload(
    payload: dict[str, Any], schema_path: Path | None = None
) -> VerificationReport:
    report = VerificationReport.model_validate(payload)
    schema = json.loads(canonical_schema_path(schema_path).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(payload),
        key=lambda error: "/".join(str(part) for part in error.absolute_path),
    )
    if errors:
        details = "; ".join(
            f"{'/'.join(str(part) for part in error.absolute_path) or '$'}: {error.message}"
            for error in errors
        )
        raise ValueError(f"canonical schema validation failed: {details}")
    return report


def load_report(
    path: Path, schema_path: Path | None = None, rubric_criterion_ids: list[str] | None = None
) -> VerificationReport:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("a verification report must be a JSON object")
    report = validate_report_payload(payload, schema_path)
    if rubric_criterion_ids is not None:
        validate_against_rubric(report, rubric_criterion_ids)
    return report
