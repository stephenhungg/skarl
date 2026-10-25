"""Contract plumbing only; model adapters are intentionally unavailable."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from uuid import uuid4

from jsonschema.exceptions import SchemaError

from .validation import load_report, validate_report_payload


def scaffold_payload(submission_id: str, task_version_id: str, sha256: str, duration_ms: int) -> dict:
    return {
        "schemaVersion": "1.0",
        "reportId": f"scaffold-{uuid4()}",
        "submissionId": submission_id,
        "taskVersionId": task_version_id,
        "source": {"sha256": sha256, "durationMs": duration_ms},
        "pipeline": {
            "version": "scaffold-0.1.0",
            "status": "ml_unavailable",
            "implementation": "scaffold",
            "modelRuns": [],
        },
        "criteria": [
            {
                "criterionId": "task-adherence",
                "status": "unobservable",
                "evidence": [],
                "reason": "No inference adapter has evaluated this submission.",
            }
        ],
        "duplicate": {"status": "not_checked", "matches": []},
        "recommendation": "needs_review",
        "warnings": ["Scaffold metadata only. No model inference or payment authorization occurred."],
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="skarl-verifier",
        description="Validate advisory evidence reports. Inference is not implemented.",
    )
    commands = root.add_subparsers(dest="command", required=True)

    validate = commands.add_parser("validate-report", help="Validate a report against typed and JSON contracts")
    validate.add_argument("report", type=Path)
    validate.add_argument("--schema", type=Path, help="Path to the canonical verification JSON Schema")
    validate.add_argument("--task-spec", type=Path, help="Trusted order task spec JSON; never use model-generated metadata")
    validate.add_argument(
        "--criterion-id",
        action="append",
        dest="criterion_ids",
        help="Task rubric criterion ID; repeat for each. Rejects criteria outside the rubric.",
    )

    scaffold = commands.add_parser("scaffold-report", help="Emit an explicit ml_unavailable report")
    scaffold.add_argument("--submission-id", required=True)
    scaffold.add_argument("--task-version-id", required=True)
    scaffold.add_argument("--sha256", required=True)
    scaffold.add_argument("--duration-ms", required=True, type=int)
    scaffold.add_argument("--output", type=Path)
    scaffold.add_argument("--schema", type=Path)

    analyze = commands.add_parser("analyze", help="Unavailable placeholder; exits 4 without calling a model")
    analyze.add_argument("media", type=Path)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "analyze":
        print(
            json.dumps({
                "status": "ml_unavailable",
                "message": "Inference adapters are not implemented. No upload, inference, or payment occurred.",
            }),
            file=sys.stderr,
        )
        return 4

    try:
        if args.command == "validate-report":
            task_spec = json.loads(args.task_spec.read_text(encoding="utf-8")) if args.task_spec else None
            report = load_report(args.report, args.schema, args.criterion_ids, task_spec)
            print(json.dumps({"valid": True, "reportId": report.reportId, "inferenceRan": False}))
            return 0

        payload = scaffold_payload(
            args.submission_id, args.task_version_id, args.sha256, args.duration_ms
        )
        report = validate_report_payload(payload, args.schema)
        rendered = report.model_dump_json(indent=2, exclude_none=True) + "\n"
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
        else:
            print(rendered, end="")
        return 0
    except (OSError, ValueError, RecursionError, SchemaError) as error:
        print(f"validation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
