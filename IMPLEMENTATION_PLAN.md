# ATS Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task once the user asks to start building.

Goal: Build a safe MVP of the AI-powered ATS described in readme.md, with asynchronous resume ingestion, pgvector search, candidate-level matching, n8n orchestration, and recruiter review workflows.

Architecture: PostgreSQL is the source of truth, pgvector stores semantic resume chunks, backend APIs enforce business rules, workers own throughput/retries/rate limits, and n8n orchestrates AI workflows only behind controlled queue-driven invocation. AI-extracted facts remain unverified until reviewed and must never overwrite verified candidate data.

Tech Stack Recommendation: React or Next.js frontend, FastAPI backend, PostgreSQL + pgvector, Redis/Valkey queue, Celery/RQ/Arq workers for Python or BullMQ for Node, S3-compatible object storage, self-hosted n8n, SSE for MVP real-time updates.

---

## Execution Strategy

1. Build the foundation first: repo layout, Docker Compose, backend, frontend, migrations, auth, RBAC, environment validation, and CI.
2. Implement durable data models before AI workflows: candidates, resumes, experiences, profile facts, skill evidence, chunks, jobs, and audit logs.
3. Build asynchronous ingestion before parsing: uploads must store files, create background_jobs rows, publish queue events, and return immediately.
4. Add workers with concurrency controls before connecting n8n: workers must protect n8n and LLM providers from overload.
5. Build role-bounded chunking and pgvector indexes before search APIs.
6. Implement hybrid retrieval and candidate-level reranking before explanations.
7. Add recruiter UI workflows with SSE status updates and human verification.
8. Harden with tests, AI evals, audit logs, security review, monitoring, backups, and deployment checklist.

## Immediate Sprint 1: Foundation

### Task 1: Initialize repository structure
- Create apps/api, apps/web, apps/worker, db/migrations, infra, n8n/workflows, tests, and docs.
- Add .gitignore for env files, object storage data, uploads, build outputs, and local database volumes.
- Add docs/architecture.md summarizing the README guardrails.
- Verify readme.md is unchanged.

### Task 2: Create local Docker Compose stack
- Add PostgreSQL with pgvector extension.
- Add Redis or Valkey.
- Add n8n with persistent volume and authentication.
- Add optional MinIO for object storage if production S3 is not selected.
- Verify all services start and backend can connect.

### Task 3: Add migration system
- Choose migration tooling based on backend stack.
- Add initial migration enabling pgcrypto and vector extensions.
- Add migration command to developer docs.
- Verify a clean database can migrate from zero.

### Task 4: Scaffold backend API
- Add /health and /version.
- Add typed environment settings.
- Add modules for auth, candidates, resumes, jobs, search, events, workers, and audit.
- Verify local API starts and exposes OpenAPI docs.

### Task 5: Scaffold frontend
- Add dashboard shell, routing, API client, auth shell, and SSE client stub.
- Add status badge component for uploaded, parsing, chunking, embedding, indexed, failed, and needs_review.
- Verify frontend can call backend /health.

### Task 6: Authentication and RBAC foundation
- Add user/session or JWT auth.
- Add role and permission model.
- Protect backend routes.
- Ensure all state-changing actions have actor identity available for audit logs.

## Sprint 2: Data Model and Resume Upload

### Task 7: Implement candidate and resume schema
- Add candidates table for canonical profile data.
- Add resumes table with file_url/key, raw_text_url/key, parsed_json_url/key, file_hash, text_hash, status, version, and timestamps.
- Add parsed_resume_snapshots for auditable extracted JSON.
- Verify migrations and basic CRUD tests pass.

### Task 8: Implement trust-boundary tables
- Add candidate_experiences.
- Add candidate_profile_facts.
- Add candidate_skill_evidence.
- Ensure all AI-extracted data defaults to unverified.
- Add constraints and tests preventing verified data overwrite by lower-trust sources.

### Task 9: Implement background job tracking
- Add background_jobs table with queued, processing, completed, failed, retrying, cancelled, and dead_letter statuses.
- Add helper functions for status updates.
- Verify job lifecycle tests.

### Task 10: Implement resume upload API
- Validate file type and size.
- Store original file in object storage.
- Create resume row with uploaded status.
- Create background_jobs row.
- Publish resume.uploaded queue event.
- Return resume_id, candidate_id, background_job_id, and status immediately.

## Sprint 3: Workers, Parsing, and Chunking

### Task 11: Implement queue and workers
- Choose Redis/Valkey plus Celery/RQ/Arq or BullMQ.
- Add queue publisher and consumer.
- Add concurrency and rate-limit configuration per job type.
- Add retry and dead-letter handling.
- Verify 500 queued uploads do not create 500 direct n8n webhook calls.

### Task 12: Extract resume text and structured facts
- Extract text from PDF/DOCX.
- Store raw text in object storage or compressed table.
- Save parsed_resume_snapshots.
- Write extracted facts and skill evidence as unverified records with evidence text and confidence.
- Never overwrite verified candidate fields.

### Task 13: Implement role-bounded chunking
- Create resume_chunks table with experience_id, company_name, job_title, dates, chunk_scope, industry, function_area, token count, content, metadata, and embedding field.
- Chunk work history by role, employer, title, date range, industry, and function area.
- Mark fallback raw text chunks explicitly.
- Test that unrelated roles are not merged.

## Sprint 4: RAG Search and Matching

### Task 14: Add embeddings and indexes
- Generate embeddings asynchronously with rate limits.
- Store model name and vector dimensions.
- Add pgvector HNSW index.
- Add PostgreSQL full-text index.
- Verify query plans and retrieval tests.

### Task 15: Implement hybrid search
- Parse query into semantic query and structured filters.
- Retrieve vector evidence and full-text evidence.
- Apply filters.
- Group evidence by candidate.
- Return candidate-level results with evidence snippets.

### Task 16: Implement scoring and reranking
- Implement unique required/preferred skill coverage.
- Add function area, industry, years, recency, eligibility, and verified evidence quality components.
- Use candidate-level aggregation, not chunk-level final ranking.
- Prove keyword stuffing does not inflate rank.

### Task 17: Implement job matching
- Add job creation API and approval state.
- Publish job.matching.requested only after approval.
- Worker computes candidate matches asynchronously.
- Store selected evidence, component scores, and final score.
- Publish job.matching.completed or job.matching.failed events.

### Task 18: Implement explanation generation
- Generate explanations only from selected evidence.
- Mark unverified facts clearly.
- Include score components in explanation payload.
- Add guardrail tests: AI cannot recommend automatic rejection or hiring.

## Sprint 5: n8n Orchestration

### Task 19: Harden and connect n8n
- Secure n8n with authentication, HTTPS in production, signed webhooks/callbacks, and least-privilege credentials.
- Invoke n8n from workers under concurrency limits.
- Route all final writes through backend APIs.
- Export workflows to n8n/workflows.

### Task 20: Build n8n workflows
- Resume Ingestion Agent for extraction orchestration.
- Candidate Search Agent for optional asynchronous enrichment.
- Job Matching Agent for optional requirement parsing or explanation enrichment.
- Interview Prep Agent.
- Email Drafting Agent with human review required.
- Failure handling workflow for timeouts and provider errors.

## Sprint 6: Recruiter UX

### Task 21: Build dashboard and status updates
- Implement authenticated SSE endpoint with polling fallback.
- Show resume.status.updated, background_job.updated, job.matching.completed, job.matching.failed, interview.brief.ready, and email.draft.ready.
- Build recruiter dashboard with processing states and failures.

### Task 22: Build candidate and verification screens
- Candidate profile page shows canonical profile, resumes, experiences, facts, skills, evidence, and statuses.
- Human verification UI allows approve, reject, edit, and comment on extracted facts.
- Verified facts cannot be overwritten by later AI extraction.

### Task 23: Build search and matching screens
- Candidate search UI supports natural language and structured filters.
- Match explanation UI shows score components and evidence.
- Job creation UI supports requirements, approval, and matching request.
- Pipeline UI keeps candidate stage changes human-controlled.

## Sprint 7: Production Hardening

### Task 24: Add audit logging
- Log auth events, profile changes, verification actions, job changes, n8n callbacks, stage changes, email approvals, and sensitive actions.
- Keep logs append-only through normal APIs.
- Avoid logging secrets or full resume content.

### Task 25: Add security and privacy controls
- Enforce HTTPS in production.
- Use private object storage and signed access.
- Add upload scanning before production.
- Add data retention, deletion, and export workflows.
- Include embeddings and parsed artifacts in deletion handling.

### Task 26: Add tests and AI evaluations
- Unit and integration tests for backend, workers, and frontend.
- E2E tests for upload, ingestion status, search, matching, explanation, and verification.
- AI evals for chunking, retrieval, scoring, explanation faithfulness, and no auto reject/hire behavior.

### Task 27: Add monitoring, backups, and deployment readiness
- Create docs/production-hardening-checklist.md as the go-live gate for audit trails, security/privacy, tests, AI evals, monitoring, backups, and deployment checks.
- Track API latency/errors, queue depth, job durations, retries, dead letters, n8n errors, LLM costs, storage growth, and database health.
- Add automated encrypted backups and restore tests.
- Complete deployment checklist with sign-offs, smoke tests, rollback plan, and post-deploy verification.

## Build Order Summary

Recommended first 10 cards:
1. ATS-001 Initialize repository structure
2. ATS-002 Create Docker Compose for PostgreSQL, pgvector, Redis/Valkey, and n8n
3. ATS-003 Create database migration system
4. ATS-004 Scaffold backend API application
5. ATS-005 Scaffold frontend application
6. ATS-006 Implement authentication foundation
7. ATS-008 Create environment variable and secret management baseline
8. ATS-010 Implement candidate tables
9. ATS-011 Implement resume tables
10. ATS-015 Implement background jobs table

## Non-Negotiable Implementation Rules

- Do not use raw keyword frequency as a ranking score.
- Do not rank chunks as final candidates.
- Do not allow resume chunks to cross unrelated job roles.
- Do not send heavy processing directly through unbounded webhooks.
- Do not let n8n become the system of record.
- Do not overwrite verified data with AI-extracted data.
- Do not treat AI-extracted skills as verified.
- Do not require recruiters to refresh manually for async processing updates.
- Do not let AI automatically reject or hire candidates.
- Require human approval for sensitive actions.
