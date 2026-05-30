from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

from .models import BackgroundJob, JobStatus, RetryableJobError, utcnow
from .queue import InMemoryQueueBackend


JobHandler = Callable[[BackgroundJob, dict[str, Any]], dict[str, Any] | None]


@dataclass(slots=True)
class JobExecutionPolicy:
    max_concurrency: int = 1
    retry_backoff_seconds: int = 30


@dataclass(slots=True)
class BackgroundWorker:
    backend: InMemoryQueueBackend
    handlers: Mapping[str, JobHandler]
    policies: Mapping[str, JobExecutionPolicy] = field(default_factory=dict)
    default_policy: JobExecutionPolicy = field(default_factory=JobExecutionPolicy)
    worker_id: str = "worker-1"

    def policy_for(self, job_type: str) -> JobExecutionPolicy:
        return self.policies.get(job_type, self.default_policy)

    def run_once(self, *, now: datetime | None = None, context: dict[str, Any] | None = None, queue_name: str = "default") -> int:
        now = now or utcnow()
        context = context or {}
        processed = 0
        active_by_type: dict[str, int] = {}
        ready_jobs = self.backend._ready_jobs(queue_name, now, set())

        for job in ready_jobs:
            if processed >= self.default_policy.max_concurrency:
                break
            policy = self.policy_for(job.job_type)
            if active_by_type.get(job.job_type, 0) >= policy.max_concurrency:
                continue

            claimed = job.copy(
                status=JobStatus.PROCESSING,
                attempts=job.attempts + 1,
                started_at=job.started_at or now,
                locked_at=now,
                locked_by=self.worker_id,
                updated_at=now,
            )
            self.backend._jobs[job.id] = claimed
            active_by_type[job.job_type] = active_by_type.get(job.job_type, 0) + 1
            handler = self.handlers.get(job.job_type)
            if handler is None:
                error = self.backend.payload_error(RuntimeError(f"No handler registered for {job.job_type}"), retryable=False)
                self.backend.mark_dead_letter(job.id, error=error, now=now)
                processed += 1
                continue

            try:
                result = handler(claimed, context)
                self.backend.mark_completed(job.id, result=result, now=now)
            except RetryableJobError as exc:
                error = self.backend.payload_error(exc, retryable=True)
                if claimed.attempts >= claimed.max_attempts:
                    self.backend.mark_dead_letter(job.id, error=error, now=now)
                else:
                    self.backend.schedule_retry(
                        job.id,
                        error=error,
                        now=now,
                        retry_delay_seconds=policy.retry_backoff_seconds,
                    )
            except Exception as exc:
                error = self.backend.payload_error(exc, retryable=False)
                self.backend.mark_dead_letter(job.id, error=error, now=now)
            processed += 1

        return processed

    def run_until_idle(self, *, now: datetime | None = None, context: dict[str, Any] | None = None, queue_name: str = "default", max_rounds: int = 100) -> int:
        total = 0
        for _ in range(max_rounds):
            processed = self.run_once(now=now, context=context, queue_name=queue_name)
            total += processed
            if processed == 0:
                break
        return total
