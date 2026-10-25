"""Strict Python representation of the shared verification-report contract."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from typing import Annotated, Any, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, model_validator

# Largest integer JavaScript represents exactly; the JSON Schema uses the same bound.
MAX_SAFE_INTEGER = 9007199254740991
# Explicit whitespace class shared with the JSON Schema so Python and JavaScript agree.
NONBLANK = re.compile(
    "[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\x1c-\x1f\x85]"
)


def _require_nonblank(value: str) -> str:
    if not NONBLANK.search(value):
        raise ValueError("must contain a non-whitespace character")
    return value


def _integral_number(value: Any) -> Any:
    # JSON Schema treats 1.0 as an integer; accept it here too, but never bool or str.
    if isinstance(value, bool):
        raise ValueError("must be an integer, not a boolean")
    if isinstance(value, float):
        if not (math.isfinite(value) and value.is_integer()):
            raise ValueError("must be a finite integer")
        return int(value)
    return value


NonemptyString = Annotated[str, Field(min_length=1), AfterValidator(_require_nonblank)]
NonnegativeInt = Annotated[
    int, BeforeValidator(_integral_number), Field(strict=True, ge=0, le=MAX_SAFE_INTEGER)
]
DecimalString = Annotated[str, Field(pattern=r"^[0-9]+(\.[0-9]+)?$")]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    @model_validator(mode="before")
    @classmethod
    def reject_null(cls, data: Any) -> Any:
        # Optional contract fields are omitted, never null.
        if isinstance(data, dict):
            nulls = sorted(key for key, value in data.items() if value is None)
            if nulls:
                raise ValueError(f"null is not allowed; omit optional fields: {', '.join(nulls)}")
        return data


class Source(ContractModel):
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    durationMs: NonnegativeInt


class ModelRun(ContractModel):
    provider: NonemptyString
    model: NonemptyString
    promptVersion: NonemptyString
    inputTokens: NonnegativeInt | None = None
    outputTokens: NonnegativeInt | None = None
    elapsedMs: NonnegativeInt | None = None
    costUsd: DecimalString | None = None


class Pipeline(ContractModel):
    version: NonemptyString
    status: Literal["completed", "needs_review", "failed", "ml_unavailable"]
    implementation: Literal["scaffold", "inference"]
    modelRuns: list[ModelRun]


class Evidence(ContractModel):
    modality: Literal["video", "audio", "text"]
    startMs: NonnegativeInt
    endMs: NonnegativeInt
    claim: NonemptyString
    sourceId: NonemptyString | None = None

    @model_validator(mode="after")
    def validate_interval(self) -> Self:
        if self.endMs < self.startMs:
            raise ValueError("evidence endMs must be greater than or equal to startMs")
        return self


class Criterion(ContractModel):
    criterionId: NonemptyString
    status: Literal["supported", "contradicted", "unobservable"]
    evidence: list[Evidence]
    reason: NonemptyString


class DuplicateMatch(ContractModel):
    submissionId: NonemptyString
    score: Annotated[float, Field(ge=0, le=1)]
    overlapMs: NonnegativeInt


class DuplicateCheck(ContractModel):
    status: Literal["not_checked", "clear", "suspected"]
    matches: list[DuplicateMatch]

    @model_validator(mode="after")
    def validate_matches(self) -> Self:
        if self.status == "suspected" and not self.matches:
            raise ValueError("a suspected duplicate requires at least one match")
        if self.status != "suspected" and self.matches:
            raise ValueError("not_checked and clear duplicate checks cannot list matches")
        return self


class TaskSpec(ContractModel):
    """Trusted order metadata, supplied separately from model output."""
    object: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,79}$")]
    distractors: Annotated[list[Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,79}$")]], Field(max_length=16)]
    target: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,79}$")]
    steps: Annotated[list[Annotated[NonemptyString, Field(max_length=2000)]], Field(min_length=1, max_length=16)]
    narration: Annotated[list[Annotated[NonemptyString, Field(max_length=2000)]], Field(max_length=16)] | None = None

    @model_validator(mode="after")
    def validate_labels(self) -> Self:
        labels = [self.object, self.target, *self.distractors]
        if any(label in {"other", "unknown"} for label in labels):
            raise ValueError("task spec labels cannot use reserved fallbacks")
        if len({self.object, *self.distractors}) != len(self.distractors) + 1 or self.target in self.distractors:
            raise ValueError("task spec distractors must be distinct")
        return self


class ActionObservation(ContractModel):
    action: Literal["pickup", "place"]
    object: Annotated[NonemptyString, Field(max_length=80)]
    target: Annotated[NonemptyString, Field(max_length=80)]
    startMs: NonnegativeInt
    endMs: NonnegativeInt
    description: Annotated[NonemptyString, Field(max_length=2000)]


class TranscriptSegment(ContractModel):
    startMs: NonnegativeInt
    endMs: NonnegativeInt
    text: Annotated[NonemptyString, Field(max_length=2000)]


class VideoObservation(ContractModel):
    visibility: Literal["clear", "occluded", "uncertain"]
    observations: Annotated[list[ActionObservation], Field(max_length=64)]


class AudioObservation(ContractModel):
    transcript: Annotated[str, Field(max_length=16000)]
    segments: Annotated[list[TranscriptSegment], Field(max_length=256)]
    claims: Annotated[list[ActionObservation], Field(max_length=64)]


class Observations(ContractModel):
    video: VideoObservation | None = None
    audio: AudioObservation | None = None


class VerificationReport(ContractModel):
    schemaVersion: Literal["1.0"]
    reportId: NonemptyString
    submissionId: NonemptyString
    taskVersionId: NonemptyString
    source: Source
    pipeline: Pipeline
    criteria: list[Criterion]
    duplicate: DuplicateCheck
    recommendation: Literal["accept", "request_correction", "needs_review"]
    warnings: list[NonemptyString] | None = None
    observations: Observations | None = None

    @model_validator(mode="after")
    def validate_advisory_result(self) -> Self:
        if self.pipeline.implementation == "scaffold" or self.pipeline.status != "completed":
            if self.recommendation != "needs_review":
                raise ValueError("scaffold and incomplete runs must recommend needs_review")

        if self.recommendation == "accept":
            if not self.pipeline.modelRuns:
                raise ValueError("accept requires a recorded model run")
            if not self.criteria or any(item.status != "supported" for item in self.criteria):
                raise ValueError("accept requires nonempty, fully supported criteria")
            if any(
                not any(evidence.modality in ("video", "audio") for evidence in item.evidence)
                for item in self.criteria
            ):
                raise ValueError("accept requires video or audio evidence for every supported criterion")
            if any(
                evidence.endMs == evidence.startMs
                for item in self.criteria
                for evidence in item.evidence
            ):
                raise ValueError("accept requires nonzero-length evidence")
            if self.source.durationMs == 0:
                raise ValueError("accept requires a nonzero source duration")
            if self.warnings:
                raise ValueError("accept cannot carry warnings")
            if self.duplicate.status != "clear" or self.duplicate.matches:
                raise ValueError("accept requires a completed, clear duplicate check")

        criterion_ids = [item.criterionId for item in self.criteria]
        if len(criterion_ids) != len(set(criterion_ids)):
            raise ValueError("criterionId must be unique within a report")

        for criterion in self.criteria:
            for evidence in criterion.evidence:
                if evidence.endMs > self.source.durationMs:
                    raise ValueError("evidence must stay within the source duration")

        for match in self.duplicate.matches:
            if match.submissionId.lower() == self.submissionId.lower():
                raise ValueError("a duplicate candidate cannot reference the same submission")
            if match.overlapMs > self.source.durationMs:
                raise ValueError("duplicate overlap must stay within the source duration")

        actions = self.action_observations()
        segments = self.observations.audio.segments if self.observations and self.observations.audio else []
        for item in [*actions, *segments]:
            if item.endMs <= item.startMs:
                raise ValueError("observations require nonzero, ordered intervals")
            if item.endMs > self.source.durationMs:
                raise ValueError("observation exceeds source duration")

        return self

    def action_observations(self) -> list[ActionObservation]:
        if not self.observations:
            return []
        return [
            *(self.observations.video.observations if self.observations.video else []),
            *(self.observations.audio.claims if self.observations.audio else []),
        ]


def validate_against_task_spec(report: VerificationReport, task_spec: TaskSpec | None) -> VerificationReport:
    """Validate labels using only the trusted order spec, never narration or report text."""
    observations = report.action_observations()
    if task_spec is None and (observations or (report.pipeline.version == "task-evidence-2.0" and report.recommendation == "accept")):
        raise ValueError("task-scoped observations require the order task spec")
    if task_spec is None:
        return report
    objects = {task_spec.object, *task_spec.distractors, "other", "unknown"}
    targets = {task_spec.target, "other", "unknown"}
    for observation in observations:
        if observation.object not in objects:
            raise ValueError(f"object is not in the task spec: {observation.object}")
        if observation.target not in targets:
            raise ValueError(f"target is not in the task spec: {observation.target}")
    return report


def validate_against_rubric(
    report: VerificationReport, rubric_criterion_ids: Iterable[str], task_spec: TaskSpec | None = None
) -> VerificationReport:
    """Reject criteria the task never defined; model output can invent its own."""
    validate_against_task_spec(report, task_spec)
    rubric = list(rubric_criterion_ids)
    if not rubric or len(set(rubric)) != len(rubric):
        raise ValueError("rubric criterion IDs must be nonempty and unique")
    reported = {item.criterionId for item in report.criteria}
    unknown = sorted(reported - set(rubric))
    if unknown:
        raise ValueError(f"criteria are not in the task rubric: {', '.join(unknown)}")
    if report.recommendation == "accept":
        missing = sorted(set(rubric) - reported)
        if missing:
            raise ValueError(f"accept requires every rubric criterion: {', '.join(missing)}")
    return report
