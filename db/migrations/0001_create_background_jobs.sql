-- Create the durable background_jobs table used to track asynchronous processing.
-- PostgreSQL is the source of truth for job state; Redis/Valkey handles execution.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'background_job_status'
    ) THEN
        CREATE TYPE background_job_status AS ENUM (
            'queued',
            'processing',
            'completed',
            'failed',
            'retrying',
            'cancelled',
            'dead_letter'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS background_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    correlation_id UUID,
    idempotency_key TEXT,
    queue_name TEXT NOT NULL DEFAULT 'default',
    priority INTEGER NOT NULL DEFAULT 0,
    status background_job_status NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    error JSONB,
    last_error_code TEXT,
    last_error_message TEXT,
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT background_jobs_attempts_nonnegative CHECK (attempts >= 0),
    CONSTRAINT background_jobs_max_attempts_positive CHECK (max_attempts > 0),
    CONSTRAINT background_jobs_priority_range CHECK (priority BETWEEN -1000 AND 1000),
    CONSTRAINT background_jobs_entity_type_not_empty CHECK (length(trim(entity_type)) > 0),
    CONSTRAINT background_jobs_job_type_not_empty CHECK (length(trim(job_type)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_idempotency_key_uq
    ON background_jobs (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS background_jobs_status_queue_idx
    ON background_jobs (status, queue_name, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS background_jobs_entity_lookup_idx
    ON background_jobs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS background_jobs_retry_idx
    ON background_jobs (status, next_retry_at)
    WHERE status IN ('retrying', 'queued');

CREATE INDEX IF NOT EXISTS background_jobs_correlation_idx
    ON background_jobs (correlation_id);

CREATE OR REPLACE FUNCTION set_background_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_background_jobs_updated_at ON background_jobs;
CREATE TRIGGER trg_background_jobs_updated_at
BEFORE UPDATE ON background_jobs
FOR EACH ROW
EXECUTE FUNCTION set_background_jobs_updated_at();
