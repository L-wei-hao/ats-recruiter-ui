from datetime import datetime, timedelta, timezone

import pytest

from ats_async.models import BackgroundJob, JobStatus, RetryableJobError
from ats_async.queue import InMemoryQueueBackend
from ats_async.worker import BackgroundWorker, JobExecutionPolicy


UTC = timezone.utc


def make_job(job_type: str, priority: int = 0, *, entity_id: str = "entity-1", max_attempts: int = 3, payload=None, scheduled_at=None, idempotency_key=None):
    return BackgroundJob(
        job_type=job_type,
        entity_type="resume",
        entity_id=entity_id,
        priority=priority,
        max_attempts=max_attempts,
        payload=payload or {},
        scheduled_at=scheduled_at,
        idempotency_key=idempotency_key,
    )


def test_claim_due_prefers_priority_and_due_jobs():
    backend = InMemoryQueueBackend()
    now = datetime(2026, 5, 30, 10, 0, tzinfo=UTC)
    future = now + timedelta(minutes=10)
    backend.enqueue(make_job("resume.uploaded", priority=1, entity_id="a", scheduled_at=future))
    backend.enqueue(make_job("resume.uploaded", priority=5, entity_id="b"))
    backend.enqueue(make_job("resume.uploaded", priority=9, entity_id="c"))

    job = backend.claim_due("default", now=now)

    assert job is not None
    assert job.entity_id == "c"
    assert job.status is JobStatus.PROCESSING
    assert job.attempts == 1


def test_enqueue_honors_idempotency_key():
    backend = InMemoryQueueBackend()
    first = backend.enqueue(make_job("resume.uploaded", idempotency_key="abc"))
    second = backend.enqueue(make_job("resume.uploaded", idempotency_key="abc"))

    assert first.id == second.id
    assert backend.count() == 1


def test_retry_and_dead_letter_flow():
    backend = InMemoryQueueBackend()
    job = backend.enqueue(make_job("resume.uploaded", max_attempts=2))

    backend.schedule_retry(job.id, error={"message": "transient"}, now=datetime(2026, 5, 30, 10, 0, tzinfo=UTC), retry_delay_seconds=0)
    assert backend.get(job.id).status is JobStatus.RETRYING

    claimed = backend.claim_due("default", now=datetime(2026, 5, 30, 10, 0, tzinfo=UTC))
    assert claimed is not None
    backend.mark_dead_letter(claimed.id, error={"message": "still failing"})
    assert backend.get(job.id).status is JobStatus.DEAD_LETTER


def test_worker_respects_per_job_type_concurrency_limit_and_completes_jobs():
    backend = InMemoryQueueBackend()
    backend.enqueue(make_job("resume.uploaded", entity_id="a"))
    backend.enqueue(make_job("resume.uploaded", entity_id="b"))
    backend.enqueue(make_job("resume.parsed", entity_id="c"))

    processed = []

    def handle_resume_uploaded(job, _context):
        processed.append((job.job_type, job.entity_id))
        return {"entity_id": job.entity_id}

    def handle_resume_parsed(job, _context):
        processed.append((job.job_type, job.entity_id))
        return {"entity_id": job.entity_id}

    worker = BackgroundWorker(
        backend=backend,
        handlers={
            "resume.uploaded": handle_resume_uploaded,
            "resume.parsed": handle_resume_parsed,
        },
        policies={
            "resume.uploaded": JobExecutionPolicy(max_concurrency=1),
            "resume.parsed": JobExecutionPolicy(max_concurrency=1),
        },
        default_policy=JobExecutionPolicy(max_concurrency=2),
    )

    processed_now = worker.run_once(now=datetime(2026, 5, 30, 10, 0, tzinfo=UTC))

    assert processed_now == 2
    assert processed == [("resume.uploaded", "a"), ("resume.parsed", "c")]
    assert backend.get_by_entity_id("b").status is JobStatus.QUEUED
    assert backend.get_by_entity_id("a").status is JobStatus.COMPLETED
    assert backend.get_by_entity_id("c").status is JobStatus.COMPLETED


def test_worker_retries_retryable_errors_until_success():
    backend = InMemoryQueueBackend()
    backend.enqueue(make_job("resume.uploaded", max_attempts=3))

    attempts = {"count": 0}

    def handle(job, _context):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise RetryableJobError("temporary problem")
        return {"ok": True}

    worker = BackgroundWorker(
        backend=backend,
        handlers={"resume.uploaded": handle},
        default_policy=JobExecutionPolicy(max_concurrency=1, retry_backoff_seconds=0),
    )

    assert worker.run_once(now=datetime(2026, 5, 30, 10, 0, tzinfo=UTC)) == 1
    assert backend.get_by_entity_id("entity-1").status is JobStatus.RETRYING
    assert worker.run_once(now=datetime(2026, 5, 30, 10, 0, tzinfo=UTC)) == 1
    assert backend.get_by_entity_id("entity-1").status is JobStatus.RETRYING
    assert worker.run_once(now=datetime(2026, 5, 30, 10, 0, tzinfo=UTC)) == 1
    assert backend.get_by_entity_id("entity-1").status is JobStatus.COMPLETED
