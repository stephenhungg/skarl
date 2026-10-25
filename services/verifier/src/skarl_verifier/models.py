"""Strict Python representation of the shared verification-report contract."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

NonemptyString = Annotated[str, Field(min_length=1)]
NonnegativeInt = Annotated[int, Field(strict=True, ge=0)]
DecimalString = Annotated[str, Field(pattern=r"^[0-9]+(\.[0-9]+)?$")]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


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
            if any(not item.evidence for item in self.criteria):
                raise ValueError("accept requires evidence for every supported criterion")
            if self.duplicate.status != "clear" or self.duplicate.matches:
                raise ValueError("accept requires a completed, clear duplicate check")

        criterion_ids = [item.criterionId for item in self.criteria]
        if len(criterion_ids) != len(set(criterion_ids)):
            raise ValueError("criterionId must be unique within a report")

        for criterion in self.criteria:
            for evidence in criterion.evidence:
                if evidence.modality in ("video", "audio") and evidence.endMs > self.source.durationMs:
                    raise ValueError("audio/video evidence must stay within the source duration")

        for match in self.duplicate.matches:
            if match.submissionId == self.submissionId:
                raise ValueError("a duplicate candidate cannot reference the same submission")
            if match.overlapMs > self.source.durationMs:
                raise ValueError("duplicate overlap must stay within the source duration")

        return self
