from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, Iterable

from .models import BackgroundJob, JobErrorPayload, JobStatus, utcnow


class InMemoryQueueBackend:
    def __init__(self):
        self._lock = Lock()
        self._jobs: dict[str, BackgroundJob] = {}
        self._idempotency_index: dict[str, str] = {}

    def count(self) -> int:
        with self._lock:
            return len(self._jobs)

    def enqueue(self, job: BackgroundJob) -> BackgroundJob:
        with self._lock:
            if job.idempotency_key:
                existing_id = self._idempotency_index.get(job.idempotency_key)
                if existing_id:
                    return self._jobs[existing_id]
                self._idempotency_index[job.idempotency_key] = job.id
            self._jobs[job.id] = job.copy(status=JobStatus.QUEUED, updated_at=utcnow())
            return self._jobs[job.id]

    def get(self, job_id: str) -> BackgroundJob:
        with self._lock:
            return self._jobs[job_id]

    def get_by_entity_id(self, entity_id: str) -> BackgroundJob:
        with self._lock:
            for job in self._jobs.values():
                if job.entity_id == entity_id:
                    return job
        raise KeyError(entity_id)

    def list_jobs(self) -> list[BackgroundJob]:
        with self._lock:
            return list(self._jobs.values())

    def _ready_jobs(self, queue_name: str, now: datetime, exclude_job_types: set[str] | None = None) -> list[BackgroundJob]:
        exclude_job_types = exclude_job_types or set()
        candidates = []
        for job in self._jobs.values():
            if job.queue_name != queue_name:
                continue
            if job.job_type in exclude_job_types:
                continue
            if job.status not in {JobStatus.QUEUED, JobStatus.RETRYING}:
                continue
            if job.scheduled_at and job.scheduled_at > now:
                continue
            if job.next_retry_at and job.next_retry_at > now:
                continue
            candidates.append(job)
        candidates.sort(key=lambda j: (-j.priority, j.created_at, j.id))
        return candidates

    def claim_due(
        self,
        queue_name: str = "default",
        *,
        now: datetime | None = None,
        exclude_job_types: Iterable[str] | None = None,
        worker_id: str | None = None,
    ) -> BackgroundJob | None:
        now = now or utcnow()
        with self._lock:
            ready = self._ready_jobs(queue_name, now, set(exclude_job_types or []))
            if not ready:
                return None
            job = ready[0]
            claimed = job.copy(
                status=JobStatus.PROCESSING,
                attempts=job.attempts + 1,
                started_at=job.started_at or now,
                locked_at=now,
                locked_by=worker_id,
                updated_at=now,
            )
            self._jobs[job.id] = claimed
            return claimed

    def mark_completed(self, job_id: str, result: dict[str, Any] | None = None, *, now: datetime | None = None) -> BackgroundJob:
        now = now or utcnow()
        with self._lock:
            job = self._jobs[job_id]
            completed = job.copy(status=JobStatus.COMPLETED, result=result, finished_at=now, updated_at=now)
            self._jobs[job_id] = completed
            return completed

    def schedule_retry(
        self,
        job_id: str,
        *,
        error: dict[str, Any],
        now: datetime | None = None,
        retry_delay_seconds: int = 0,
    ) -> BackgroundJob:
        now = now or utcnow()
        retry_at = now + timedelta(seconds=retry_delay_seconds)
        with self._lock:
            job = self._jobs[job_id]
            retrying = job.copy(
                status=JobStatus.RETRYING,
                error=error,
                next_retry_at=retry_at,
                locked_at=None,
                locked_by=None,
                updated_at=now,
            )
            self._jobs[job_id] = retrying
            return retrying

    def mark_failed(self, job_id: str, *, error: dict[str, Any], now: datetime | None = None) -> BackgroundJob:
        now = now or utcnow()
        with self._lock:
            job = self._jobs[job_id]
            failed = job.copy(status=JobStatus.FAILED, error=error, finished_at=now, updated_at=now)
            self._jobs[job_id] = failed
            return failed

    def mark_dead_letter(self, job_id: str, *, error: dict[str, Any], now: datetime | None = None) -> BackgroundJob:
        now = now or utcnow()
        with self._lock:
            job = self._jobs[job_id]
            dead = job.copy(status=JobStatus.DEAD_LETTER, error=error, finished_at=now, updated_at=now)
            self._jobs[job_id] = dead
            return dead

    def payload_error(self, exc: Exception, retryable: bool) -> dict[str, Any]:
        return JobErrorPayload(
            code=exc.__class__.__name__,
            message=str(exc),
            retryable=retryable,
        ).as_dict()

    def jobs_by_status(self, *statuses: JobStatus) -> list[BackgroundJob]:
        wanted = set(statuses)
        with self._lock:
            return [job for job in self._jobs.values() if job.status in wanted]
