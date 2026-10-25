#!/usr/bin/env python3
"""Check split hygiene and score supplied labels; never run or simulate inference."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from math import sqrt
from pathlib import Path
import re
import sys
from typing import Any
import unicodedata

SPLITS = {"train", "validation", "test"}
DECISIONS = {"accept", "request_correction", "needs_review"}
CRITERION_STATUSES = {"supported", "contradicted", "unobservable"}
DUPLICATE_STATUSES = {"not_checked", "clear", "suspected"}
ZERO_WIDTH = re.compile("[\u200b-\u200d\u2060\ufeff]")
# Any shared value across splits leaks: the same person, session, recording, or file.
LEAKAGE_KEYS = ("actorId", "sessionId", "originRecordingId", "mediaPath", "contentSha256")


def nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonempty string")
    return value


def leakage_key(value: str) -> str:
    """Normalize so cosmetic variants of an ID cannot slip across splits."""
    return ZERO_WIDTH.sub("", unicodedata.normalize("NFKC", value)).strip().casefold()


def validate_outcome(outcome: Any, label: str) -> None:
    if not isinstance(outcome, dict):
        raise ValueError(f"{label} must be an object")
    if outcome.get("recommendation") not in DECISIONS:
        raise ValueError(f"{label}.recommendation is invalid")
    if outcome.get("duplicateStatus") not in DUPLICATE_STATUSES:
        raise ValueError(f"{label}.duplicateStatus is invalid")
    criteria = outcome.get("criteria")
    if not isinstance(criteria, dict) or not criteria:
        raise ValueError(f"{label}.criteria must be a nonempty status mapping")
    for name, status in criteria.items():
        nonempty_string(name, f"{label}.criterionId")
        if status not in CRITERION_STATUSES:
            raise ValueError(f"{label}.criteria.{name} is invalid")
    if outcome["recommendation"] == "accept":
        if any(status != "supported" for status in criteria.values()):
            raise ValueError(f"{label}: accept requires every criterion to be supported")
        if outcome["duplicateStatus"] != "clear":
            raise ValueError(f"{label}: accept requires a clear duplicate check")


def validate_manifest(manifest: Any) -> list[dict[str, Any]]:
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "1.0":
        raise ValueError("manifest must be an object with schemaVersion 1.0")
    if not isinstance(manifest.get("syntheticMetadata"), bool):
        raise ValueError("manifest must explicitly set syntheticMetadata to true or false")
    samples = manifest.get("samples")
    if not isinstance(samples, list) or not samples:
        raise ValueError("manifest.samples must be a nonempty list")

    seen_ids: set[str] = set()
    groups: dict[tuple[str, str], str] = {}
    for index, sample in enumerate(samples):
        label = f"samples[{index}]"
        if not isinstance(sample, dict):
            raise ValueError(f"{label} must be an object")
        sample_id = nonempty_string(sample.get("sampleId"), f"{label}.sampleId")
        if sample_id in seen_ids:
            raise ValueError(f"duplicate sampleId: {sample_id}")
        seen_ids.add(sample_id)
        split = sample.get("split")
        if split not in SPLITS:
            raise ValueError(f"{label}.split is invalid")
        for key in ("actorId", "sessionId", "originRecordingId"):
            nonempty_string(sample.get(key), f"{label}.{key}")
        nonempty_string(sample.get("variant"), f"{label}.variant")
        if not manifest["syntheticMetadata"]:
            nonempty_string(sample.get("mediaPath"), f"{label}.mediaPath")
        elif sample.get("mediaPath") is not None:
            nonempty_string(sample.get("mediaPath"), f"{label}.mediaPath")
        if sample.get("contentSha256") is not None and not re.fullmatch(
            r"[0-9a-f]{64}", str(sample["contentSha256"])
        ):
            raise ValueError(f"{label}.contentSha256 must be a lowercase hex SHA-256")
        for key in LEAKAGE_KEYS:
            value = sample.get(key)
            if value is None:
                continue
            previous_split = groups.setdefault((key, leakage_key(value)), split)
            if previous_split != split:
                raise ValueError(f"split leakage: {key}={value} appears in {previous_split} and {split}")
        validate_outcome(sample.get("expected"), f"{label}.expected")
    return samples


def wilson(k: int, n: int) -> list[float] | None:
    """Two-sided Wilson score interval, 95%; no estimate without observations."""
    if isinstance(k, bool) or isinstance(n, bool) or not isinstance(k, int) or not isinstance(n, int) or not 0 <= k <= n:
        raise ValueError("Wilson counts must be integers with 0 <= k <= n")
    if n == 0:
        return None
    z = 1.959963984540054
    p = k / n
    denominator = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denominator
    radius = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return [0.0 if k == 0 else max(0.0, center - radius), 1.0 if k == n else min(1.0, center + radius)]


def criterion_agreement(pairs: list[tuple[str, str]]) -> dict:
    labels = sorted(CRITERION_STATUSES)
    matrix = {label: {actual: 0 for actual in labels} for label in labels}
    for expected, actual in pairs:
        matrix[expected][actual] += 1
    n = len(pairs)
    correct = sum(matrix[label][label] for label in labels)
    observed = correct / n if n else None
    chance = sum(sum(matrix[label].values()) * sum(matrix[row][label] for row in labels) for label in labels) / (n * n) if n else None
    return {"labels": labels, "count": n, "confusionMatrix": matrix,
            "matrixOrientation": "rows=human/expected, columns=predicted",
            "observedAgreement": observed, "expectedAgreement": chance,
            "cohenKappa": (observed - chance) / (1 - chance) if chance is not None and chance < 1 else None}


def risk_coverage(pairs: list[tuple[str, str]], total: int) -> dict:
    decided = [(expected, actual) for expected, actual in pairs if actual in {"accept", "request_correction"}]
    errors = sum(expected != actual for expected, actual in decided)
    return {"autoDecidedCount": len(decided), "errorCount": errors,
            "coverage": len(decided) / total if total else None,
            "risk": errors / len(decided) if decided else None}


def classification_summary(pairs: list[tuple[str, str]], classes: set[str]) -> dict:
    rows = {}
    for name in sorted(classes):
        true_positive = sum(expected == name and actual == name for expected, actual in pairs)
        false_positive = sum(expected != name and actual == name for expected, actual in pairs)
        false_negative = sum(expected == name and actual != name for expected, actual in pairs)
        precision_denominator = true_positive + false_positive
        recall_denominator = true_positive + false_negative
        rows[name] = {
            "truePositive": true_positive,
            "falsePositive": false_positive,
            "falseNegative": false_negative,
            "precision": true_positive / precision_denominator if precision_denominator else None,
            "recall": true_positive / recall_denominator if recall_denominator else None,
        }
    correct = sum(expected == actual for expected, actual in pairs)
    return {
        "count": len(pairs),
        "correct": correct,
        "accuracy": correct / len(pairs) if pairs else None,
        "accuracyCi95": wilson(correct, len(pairs)),
        "perClass": rows,
    }


def score_predictions(manifest: dict, predictions: Any, split: str) -> dict:
    samples = [sample for sample in validate_manifest(manifest) if sample["split"] == split]
    if not samples:
        raise ValueError(f"no samples in requested split: {split}")
    if not isinstance(predictions, list):
        raise ValueError("predictions must be a JSON list")

    by_id = {}
    for index, prediction in enumerate(predictions):
        if not isinstance(prediction, dict):
            raise ValueError(f"predictions[{index}] must be an object")
        sample_id = nonempty_string(prediction.get("sampleId"), f"predictions[{index}].sampleId")
        if sample_id in by_id:
            raise ValueError(f"duplicate prediction for {sample_id}")
        validate_outcome(prediction, f"predictions[{index}]")
        if "successfulAnalysis" in prediction and not isinstance(prediction["successfulAnalysis"], bool):
            raise ValueError(f"predictions[{index}].successfulAnalysis must be boolean")
        by_id[sample_id] = prediction

    expected_ids = {sample["sampleId"] for sample in samples}
    missing = expected_ids - by_id.keys()
    extra = by_id.keys() - expected_ids
    if missing or extra:
        raise ValueError(f"prediction coverage mismatch; missing={sorted(missing)}, extra={sorted(extra)}")

    decision_pairs = []
    duplicate_pairs = []
    criterion_pairs = []
    successful_decision_pairs = []
    successful_criterion_pairs = []
    for sample in samples:
        expected = sample["expected"]
        actual = by_id[sample["sampleId"]]
        if set(actual["criteria"]) != set(expected["criteria"]):
            raise ValueError(f"criterion coverage mismatch for {sample['sampleId']}")
        decision_pairs.append((expected["recommendation"], actual["recommendation"]))
        duplicate_pairs.append((expected["duplicateStatus"], actual["duplicateStatus"]))
        criterion_pairs.extend(
            (expected_status, actual["criteria"][name])
            for name, expected_status in expected["criteria"].items()
        )
        # Legacy supplied labels have no provider metadata; they remain unverified.
        if actual.get("successfulAnalysis", True):
            successful_decision_pairs.append((expected["recommendation"], actual["recommendation"]))
            successful_criterion_pairs.extend((status, actual["criteria"][name]) for name, status in expected["criteria"].items())

    invalid = [(expected, actual) for expected, actual in decision_pairs if expected != "accept"]
    false_accepts = sum(expected != "accept" and actual == "accept" for expected, actual in successful_decision_pairs)
    correct = sum(expected == actual for expected, actual in successful_decision_pairs)
    return {
        "assessment": "synthetic_plumbing_only" if manifest["syntheticMetadata"] else "supplied_prediction_scores",
        "syntheticMetadata": manifest["syntheticMetadata"],
        "inferenceRan": False,
        "split": split,
        "sampleCount": len(samples),
        "recommendations": classification_summary(decision_pairs, DECISIONS),
        "duplicates": classification_summary(duplicate_pairs, DUPLICATE_STATUSES),
        "criteria": classification_summary(criterion_pairs, CRITERION_STATUSES),
        "criterionAgreement": criterion_agreement(successful_criterion_pairs),
        "failureAdjustedDecisionAccuracy": correct / len(samples),
        "failureAdjustedDecisionAccuracyCi95": wilson(correct, len(samples)),
        "conditionalDecisionAccuracy": correct / len(successful_decision_pairs) if successful_decision_pairs else None,
        "conditionalDecisionAccuracyCi95": wilson(correct, len(successful_decision_pairs)),
        "riskCoverage": risk_coverage(successful_decision_pairs, len(samples)),
        "falseAcceptance": {
            "count": false_accepts,
            "nonAcceptableCount": len(invalid),
            "rate": false_accepts / len(invalid) if invalid else None,
            "ci95": wilson(false_accepts, len(invalid)),
        },
        "reviewRate": sum(actual == "needs_review" for _, actual in decision_pairs) / len(samples),
        "warning": (
            "Synthetic labels test scoring plumbing only; they are not model results."
            if manifest["syntheticMetadata"]
            else "Scores describe supplied predictions; this command does not run or independently verify inference."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--check-manifest", action="store_true")
    parser.add_argument("--predictions", type=Path)
    parser.add_argument("--split", choices=sorted(SPLITS), default="test")
    args = parser.parse_args(argv)
    if not args.check_manifest and args.predictions is None:
        parser.error("choose --check-manifest or supply --predictions")

    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        samples = validate_manifest(manifest)
        if args.predictions is not None:
            predictions = json.loads(args.predictions.read_text(encoding="utf-8"))
            result = score_predictions(manifest, predictions, args.split)
        else:
            result = {
                "validManifest": True,
                "syntheticMetadata": manifest["syntheticMetadata"],
                "sampleCount": len(samples),
                "splitCounts": dict(Counter(sample["split"] for sample in samples)),
                "inferenceRan": False,
                "warning": "Structure and split hygiene only; media content and model quality were not evaluated.",
            }
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError) as error:
        print(f"evaluation input error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
