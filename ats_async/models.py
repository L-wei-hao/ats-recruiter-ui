from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"
    CANCELLED = "cancelled"
    DEAD_LETTER = "dead_letter"


class RetryableJobError(Exception):
    """Signals a transient failure that may be retried."""


@dataclass(slots=True)
class BackgroundJob:
    job_type: str
    entity_type: str
    entity_id: str
    queue_name: str = "default"
    priority: int = 0
    max_attempts: int = 3
    payload: dict[str, Any] = field(default_factory=dict)
    correlation_id: str | None = None
    idempotency_key: str | None = None
    scheduled_at: datetime | None = None
    id: str = field(default_factory=lambda: str(uuid4()))
    status: JobStatus = JobStatus.QUEUED
    attempts: int = 0
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    next_retry_at: datetime | None = None
    locked_at: datetime | None = None
    locked_by: str | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    def copy(self, **changes: Any) -> "BackgroundJob":
        return replace(self, **changes)


@dataclass(slots=True)
class JobErrorPayload:
    code: str
    message: str
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "details": self.details,
        }
