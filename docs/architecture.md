# ATS Architecture

This repository is being organized as a foundation for an AI-assisted ATS.

## Repo layout

- `apps/api/` — backend API placeholder; future FastAPI service, auth, business rules, and audit logging.
- `apps/web/` — recruiter-facing frontend placeholder; current Vite/React app lives at the repository root today.
- `apps/worker/` — asynchronous processing workers for ingestion, enrichment, and indexing.
- `db/migrations/` — versioned PostgreSQL migrations.
- `infra/postgres/init/` — database bootstrap SQL for local development.
- `infra/caddy/` — production Caddy reverse-proxy config for HTTPS deployment.
- `n8n/workflows/` — checked-in n8n workflow exports.
- `scripts/` — foundation validation helpers used by CI and deployment smoke tests.
- `tests/` — integration and smoke checks for the foundation.

## Foundation guardrails

- PostgreSQL is the source of truth.
- pgvector is the semantic search layer.
- Valkey provides queue and event backplane primitives.
- n8n is for orchestration, approvals, and notification workflows only.
- AI-extracted facts remain unverified until a human or trusted process marks them verified.
- Verified candidate data must not be overwritten by lower-trust extractions.
- Ranking must use structured evidence and unique coverage, not raw keyword frequency.
- Resume processing stays asynchronous.

## Local stack

The root `docker-compose.yml` starts three local services:

- PostgreSQL 16 with pgvector
- Valkey
- n8n

The PostgreSQL container uses `infra/postgres/init/001_extensions.sql` to enable `pgcrypto` and `vector` on first boot.

## Environment baseline

- `.env.example` documents the minimum runtime contract for the foundation.
- `scripts/validate_env.py` validates both `.env.example` and runtime environment values.
- Missing required runtime values should fail fast before app startup.

## CI baseline

CI should check:

- env example completeness
- repo scaffold completeness
- Docker Compose syntax
- frontend unit tests
- frontend build output
- Python helper syntax

This keeps the foundation stable while later tasks add backend, worker, and workflow logic.
