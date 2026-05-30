# Kanban Board

This board converts readme.md into an actionable engineering plan for an AI-powered ATS.

Architecture guardrails:
- PostgreSQL is the source of truth.
- pgvector is the semantic memory.
- The backend enforces business rules and owns final writes.
- n8n orchestrates workflows but must not be overloaded with unbounded direct webhooks.
- Queue workers control throughput, retries, and rate limits.
- Resume processing is asynchronous.
- Frontend status updates use SSE for MVP, with polling fallback; WebSockets remain an option if bidirectional collaboration is needed.
- AI-extracted candidate facts are unverified until reviewed.
- Verified candidate data must never be overwritten by AI-extracted data.
- Ranking must not use raw keyword frequency; it must use unique skill coverage, evidence quality, function area, industry relevance, and structured filters.
- Resume chunks must be role-bounded and section-aware.
- AI must not automatically reject or hire candidates.
- Human approval is required for sensitive actions.

## Backlog

### [ATS-007] Implement RBAC foundation

**Type:** Security  
**Priority:** P0  
**Phase:** Phase 1  
**Owner:** Security  
**Depends on:** ATS-006

**Description:**  
Define roles and permissions for recruiters, hiring managers, admins, and reviewers before sensitive workflows are built.

**Acceptance Criteria:**
- RBAC tables or policy config define roles and permissions.
- Backend checks permissions on candidate, job, verification, and n8n callback actions.
- Unauthorized actions return consistent 403 responses and are audit logged.

**Implementation Notes:**
- Human approval workflows depend on reliable actor identity and authorization.
- Separate permission to view candidates from permission to verify facts or advance stages.
- Keep policy tests close to API route tests.

### [ATS-008] Create environment variable and secret management baseline

**Type:** DevOps  
**Priority:** P0  
**Phase:** Phase 1  
**Owner:** DevOps  
**Depends on:** ATS-001

**Description:**  
Document and validate all required runtime settings for database, object storage, queue, n8n, LLM, auth, and frontend endpoints.

**Acceptance Criteria:**
- .env.example contains every required variable with safe placeholder values.
- Backend and worker fail fast on missing required secrets.
- Production deployment checklist includes secret rotation and storage requirements.

**Implementation Notes:**
- Do not commit real secrets.
- Include separate variables for n8n inbound token and outbound callback token.
- Use per-environment concurrency and rate-limit settings.

### [ATS-009] Add base CI checks

**Type:** DevOps  
**Priority:** P1  
**Phase:** Phase 1  
**Owner:** DevOps  
**Depends on:** ATS-003, ATS-004, ATS-005

**Description:**  
Add automated linting, type checks, unit tests, migration checks, and frontend build checks.

**Acceptance Criteria:**
- CI runs backend tests and type/lint checks.
- CI runs frontend lint/type/build checks.
- CI starts PostgreSQL with pgvector and validates migrations.

**Implementation Notes:**
- Keep CI fast for MVP; add longer integration and AI evaluation suites later.
- Fail builds on migration drift.
- Cache dependencies safely.

### [ATS-010] Implement candidate tables

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-003

**Description:**  
Create canonical candidate tables for recruiter-managed profile data with clear source and verification semantics.

**Acceptance Criteria:**
- candidates table stores canonical identity/profile fields and timestamps.
- Candidate records support status, ownership, and deduplication keys.
- Verified fields cannot be overwritten by lower-trust AI extracted values.

**Implementation Notes:**
- PostgreSQL is the source of truth for candidate records.
- Use nullable fields for unknown data instead of hallucinated defaults.
- Add indexes for recruiter workspace and common filters.

### [ATS-011] Implement resume tables

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-010

**Description:**  
Create resume storage metadata, versioning, status fields, hashes, and parsed snapshot structures without bloating core tables.

**Acceptance Criteria:**
- resumes table stores file_url, raw_text_url, parsed_json_url, hashes, language, version, status, and processed_at.
- parsed_resume_snapshots stores extracted JSON with parser version, model name, confidence, and timestamp.
- Resume statuses include uploaded, parsing, chunking, embedding, indexed, failed, and needs_review.

**Implementation Notes:**
- Original files and large raw text should live in object storage where possible.
- Use file_hash and text_hash for deduplication and idempotency.
- Parsed snapshots must be auditable and versioned.

### [ATS-012] Implement candidate experience table

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-010

**Description:**  
Model work history with role, employer, dates, industry, function area, source, confidence, and verification data.

**Acceptance Criteria:**
- candidate_experiences supports company, title, dates, location, industry, sub_industry, function_area, description, source, confidence, and verification fields.
- Records can be linked to resumes and parsed snapshots.
- Indexes support filtering by industry, function area, recency, and candidate.

**Implementation Notes:**
- Experience records are essential for role-bounded chunking.
- Do not merge different employers, titles, or date ranges into one experience.
- Use constraints to prevent impossible date ranges where feasible.

### [ATS-013] Implement candidate profile facts table

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-010, ATS-011

**Description:**  
Store AI-extracted and inferred candidate facts separately from verified candidate profile fields.

**Acceptance Criteria:**
- candidate_profile_facts includes fact_type, fact_value, source_type, source_id, evidence_text, confidence, verification fields, and created_at.
- AI-extracted facts are searchable but default to unverified.
- Business logic prevents unverified facts from overwriting verified candidate fields.

**Implementation Notes:**
- Supported fact types include skill, industry, function_area, certification, current_title, company, education, language, and work_authorization.
- Field precedence is human verified, candidate provided, recruiter entered, resume extracted, AI inferred, unknown.
- Facts should preserve evidence text for reviewer trust.

### [ATS-014] Implement skill evidence model with verification flags

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-010, ATS-011

**Description:**  
Create candidate_skill_evidence to support unique skill coverage scoring and human verification.

**Acceptance Criteria:**
- candidate_skill_evidence stores skill_name, evidence_type, evidence_source, resume_chunk_id, confidence, is_human_verified, and timestamps.
- Each candidate-skill evidence item can reference the resume chunk or reviewer action that supports it.
- Search scoring can count each required skill once per candidate rather than raw frequency.

**Implementation Notes:**
- Evidence types include explicit_skill_list, work_experience, project, certification, education, interview_feedback, recruiter_verified.
- Use normalized skill names while preserving original evidence text.
- Verification flags must be visible in API responses and UI.

### [ATS-015] Implement background jobs table

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-003

**Description:**  
Create a database-backed job status model for async resume ingestion, matching, retries, and UI updates.

**Acceptance Criteria:**
- background_jobs includes job_type, entity_type, entity_id, status, priority, attempts, max_attempts, payload, result, error fields, and timestamps.
- Statuses include queued, processing, completed, failed, retrying, cancelled, and dead_letter.
- Every queued event has a corresponding background_jobs record for observability.

**Implementation Notes:**
- The queue handles execution, but PostgreSQL records durable job state.
- Frontend should read job status from backend, not directly from Redis.
- Use idempotency keys to avoid duplicate processing.

### [ATS-016] Implement queue using Redis/Valkey and BullMQ/Celery

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-002, ATS-015

**Description:**  
Add event publishing and consumption infrastructure between backend, workers, and n8n orchestration.

**Acceptance Criteria:**
- Backend can publish resume.uploaded and job.matching.requested events.
- Worker can consume events and update background_jobs status.
- Queue names, retry limits, and priority handling are configurable.

**Implementation Notes:**
- For FastAPI/Python use Celery/RQ/Arq; for Node use BullMQ.
- Do not trigger unbounded direct n8n webhooks from resume uploads.
- Persist event correlation IDs for tracing.

### [ATS-017] Implement resume upload API

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-006, ATS-011, ATS-016

**Description:**  
Create the authenticated API endpoint for uploading resume files and starting asynchronous ingestion.

**Acceptance Criteria:**
- API accepts allowed resume file types and rejects unsupported or oversized files.
- API stores metadata in resumes with status uploaded.
- API creates background job and publishes resume.uploaded without waiting for parsing.

**Implementation Notes:**
- Validate MIME type and extension; scan files in production.
- Return resume_id, candidate_id, background_job_id, and initial status.
- Never block the upload request on LLM parsing or embeddings.

### [ATS-018] Store resume files in object storage

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-017

**Description:**  
Integrate S3-compatible storage for original files, raw text, parsed JSON, and other large artifacts.

**Acceptance Criteria:**
- Uploaded resume files are stored outside PostgreSQL with durable object URLs/keys.
- File hash and text hash are computed and stored.
- Object storage errors produce failed job states without orphaning database records.

**Implementation Notes:**
- Use local MinIO for development if cloud S3 is not configured.
- Store object keys, not public URLs, if private signed access is required.
- Apply retention and deletion policy in Phase 6.

### [ATS-019] Implement async resume ingestion event

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-016, ATS-017, ATS-018

**Description:**  
Ensure resume processing begins via durable queue event and background job state rather than synchronous web request work.

**Acceptance Criteria:**
- resume.uploaded event payload includes resume_id, candidate_id, object key, job_id, and correlation_id.
- API response returns before parsing starts.
- Duplicate events are idempotent and do not create duplicate chunks or facts.

**Implementation Notes:**
- Use transactional outbox if queue publish consistency becomes a risk.
- At minimum, record publish failures and allow manual retry.
- Publish SSE background_job.updated after the job is queued.

### [ATS-020] Implement worker concurrency control

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-016, ATS-019

**Description:**  
Control throughput, retries, and rate limits for parsing, LLM extraction, embeddings, matching, and n8n calls.

**Acceptance Criteria:**
- Worker concurrency is configurable per job type.
- LLM and embedding calls are rate limited and retried with backoff.
- Workers update background_jobs timestamps and statuses consistently.

**Implementation Notes:**
- Suggested defaults: parsing 5, embedding 10, matching 2, email drafting 10.
- Do not use unlimited parallelism for n8n webhook calls.
- Add per-provider rate-limit configuration.

### [ATS-021] Implement retry and dead-letter handling

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 2  
**Owner:** Backend  
**Depends on:** ATS-015, ATS-016, ATS-020

**Description:**  
Add structured failure handling so transient errors retry and permanent failures are visible and recoverable.

**Acceptance Criteria:**
- Failed jobs retry with exponential backoff until max_attempts.
- Jobs exceeding max_attempts move to dead_letter with error_code and error_message.
- Recruiters or admins can see failed jobs and manually retry where allowed.

**Implementation Notes:**
- Separate retryable provider failures from validation and unsupported file errors.
- Store sanitized error messages only; avoid exposing secrets or PII.
- Dead-letter handling must trigger UI status updates.

### [ATS-022] Implement resume text extraction pipeline

**Type:** Backend  
**Priority:** P1  
**Phase:** Phase 2  
**Owner:** AI  
**Depends on:** ATS-018, ATS-020

**Description:**  
Extract raw text from PDF/DOCX resumes, store compressed or object-backed text, and hand off to structured parsing.

**Acceptance Criteria:**
- Pipeline extracts text for supported PDF and DOCX files.
- Raw extracted text is stored in object storage or compressed table with text_hash.
- Extraction failures mark resume failed and preserve reviewer-readable error reason.

**Implementation Notes:**
- Use deterministic parsers before LLM calls where possible.
- Record parser version for reproducibility.
- Avoid storing unnecessary duplicate full text in multiple tables.

### [ATS-023] Implement structured resume parsing and unverified fact extraction

**Type:** AI  
**Priority:** P1  
**Phase:** Phase 2  
**Owner:** AI  
**Depends on:** ATS-013, ATS-014, ATS-022

**Description:**  
Extract structured candidate facts, experiences, skills, education, and certifications while preserving trust boundaries.

**Acceptance Criteria:**
- Parser writes parsed_resume_snapshots and candidate_profile_facts with source_type and confidence.
- AI-extracted facts default to unverified.
- Verified candidate fields are never overwritten by extracted data.

**Implementation Notes:**
- Use schemas and validation to constrain LLM output.
- Store original evidence text for each extracted fact.
- Flag low-confidence or conflicting facts as needs_review.

### [ATS-024] Implement role-bounded resume chunking

**Type:** AI  
**Priority:** P0  
**Phase:** Phase 3  
**Owner:** AI  
**Depends on:** ATS-012, ATS-022, ATS-023

**Description:**  
Create section-aware chunks that do not cross unrelated roles, employers, titles, date ranges, industries, or function areas.

**Acceptance Criteria:**
- Work experience chunks are bounded to one logical role whenever possible.
- Chunk metadata includes chunk_scope, experience_id, company_name, job_title, dates, industry, function_area, and skills.
- Fallback raw_text chunks are clearly marked and excluded or downweighted in precision-sensitive scoring.

**Implementation Notes:**
- Recommended sizes: summary 100-200 tokens, skills 50-150, work role 150-400, project 100-300.
- Do not create broad 800-token chunks that merge different roles.
- Chunking quality should be covered by AI evaluation tests later.

### [ATS-025] Generate embeddings and store in pgvector

**Type:** AI  
**Priority:** P0  
**Phase:** Phase 3  
**Owner:** AI  
**Depends on:** ATS-024, ATS-020

**Description:**  
Generate embeddings for resume chunks and persist them in PostgreSQL pgvector with metadata for retrieval and evidence.

**Acceptance Criteria:**
- resume_chunks table stores chunk text, metadata, token counts, and embedding vector.
- Embedding generation is asynchronous and rate limited.
- Embedding model name and dimension are recorded for compatibility.

**Implementation Notes:**
- Choose embedding dimension before migration finalization.
- Use batch embedding where provider allows.
- Re-embedding should be possible when model version changes.

### [ATS-026] Implement pgvector HNSW index

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 3  
**Owner:** Backend  
**Depends on:** ATS-025

**Description:**  
Add pgvector indexes to support fast semantic retrieval over resume chunks.

**Acceptance Criteria:**
- HNSW index exists on resume_chunks.embedding with the selected distance metric.
- Query plan confirms index usage for vector retrieval.
- Migration documents index parameters and rebuild procedure.

**Implementation Notes:**
- Pick cosine or inner product consistently with embedding model normalization.
- HNSW index creation can be expensive; plan for production maintenance windows.
- Add fallback exact search for tiny datasets or tests.

### [ATS-027] Implement full-text search index

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 3  
**Owner:** Backend  
**Depends on:** ATS-024

**Description:**  
Add PostgreSQL full-text search indexes for keyword evidence retrieval without using raw frequency as final score.

**Acceptance Criteria:**
- resume_chunks or evidence tables expose tsvector indexes for keyword retrieval.
- Search can return evidence locations and source chunks.
- Ranking logic does not use raw keyword occurrence frequency as final score.

**Implementation Notes:**
- Full-text search retrieves evidence; reranking decides candidate order.
- Include section and source metadata in results.
- Consider trigram indexes for skill normalization and typo tolerance.

### [ATS-028] Implement hybrid search

**Type:** Backend  
**Priority:** P1  
**Phase:** Phase 3  
**Owner:** Backend  
**Depends on:** ATS-026, ATS-027

**Description:**  
Combine semantic vector retrieval, full-text evidence retrieval, and structured filters into one candidate search pipeline.

**Acceptance Criteria:**
- Search pipeline retrieves broad vector evidence and keyword evidence.
- Structured filters apply before final reranking where appropriate.
- Results include candidate IDs, evidence snippets, component scores, and trace IDs.

**Implementation Notes:**
- Do not rank raw chunks as final candidate results.
- Group evidence by candidate before scoring.
- Keep retrieval thresholds configurable and testable.

### [ATS-029] Implement unique keyword coverage scoring

**Type:** AI  
**Priority:** P0  
**Phase:** Phase 3  
**Owner:** AI  
**Depends on:** ATS-014, ATS-027

**Description:**  
Score skill matches by unique required and preferred skill coverage instead of total keyword frequency.

**Acceptance Criteria:**
- Each required skill is counted at most once per candidate for coverage scoring.
- Scoring considers evidence type, section, recency, and verification status.
- Tests prove repeated keyword stuffing does not increase score unfairly.

**Implementation Notes:**
- Suggested score: required coverage 0.60, preferred coverage 0.20, recency 0.10, verified evidence 0.10.
- Preserve evidence list for recruiter explanation.
- Normalize synonyms before counting unique skills.

### [ATS-030] Implement candidate-level reranking

**Type:** AI  
**Priority:** P0  
**Phase:** Phase 3  
**Owner:** AI  
**Depends on:** ATS-028, ATS-029

**Description:**  
Aggregate chunk-level evidence into candidate-level scores and explanations using the README production scoring model.

**Acceptance Criteria:**
- Candidate scores combine semantic relevance, required skill coverage, function area, industry relevance, years, recency, eligibility, and verified evidence quality.
- Final ranking is by candidate, not by chunk.
- Every score component is returned for UI display.

**Implementation Notes:**
- Recommended weights: semantic 25%, required skills 20%, function area 15%, industry 15%, years 10%, recency 5%, location/work eligibility 5%, verified evidence 5%.
- Keep weights configurable for evaluation.
- Use selected evidence only for explanation generation.

### [ATS-031] Implement function area and industry classification

**Type:** AI  
**Priority:** P1  
**Phase:** Phase 3  
**Owner:** AI  
**Depends on:** ATS-012, ATS-023

**Description:**  
Classify candidate experiences and chunks by function area and industry so matching can filter and score relevance.

**Acceptance Criteria:**
- Experiences and chunks can store function_area, industry, and sub_industry.
- Classifier returns confidence, source_type, and evidence text.
- Low-confidence classifications are marked unverified and reviewable.

**Implementation Notes:**
- Use deterministic taxonomy matching before LLM inference where possible.
- Function area and industry are score inputs, not hidden model-only fields.
- Classification should avoid overwriting verified values.

### [ATS-032] Implement industry taxonomy normalization

**Type:** AI  
**Priority:** P1  
**Phase:** Phase 3  
**Owner:** AI  
**Depends on:** ATS-031

**Description:**  
Create a normalized taxonomy for industries, sub-industries, and aliases to improve filters and scoring consistency.

**Acceptance Criteria:**
- Taxonomy tables or config define canonical industry and sub_industry values.
- Alias mapping normalizes common variants to canonical values.
- API and UI expose canonical values while preserving original extracted labels.

**Implementation Notes:**
- Start with a pragmatic MVP taxonomy, then expand based on real resumes.
- Version taxonomy changes because old classifications may need migration.
- Include Singapore-relevant industries if targeting local recruiting workflows.

### [ATS-033] Implement candidate search API

**Type:** Backend  
**Priority:** P1  
**Phase:** Phase 3  
**Owner:** Backend  
**Depends on:** ATS-028, ATS-030, ATS-032

**Description:**  
Expose authenticated endpoints for natural language and structured candidate search.

**Acceptance Criteria:**
- API accepts semantic query, required skills, preferred skills, function area, industry, location, and experience filters.
- API returns reranked candidate results with evidence and component scores.
- API supports pagination, trace IDs, and stable ordering.

**Implementation Notes:**
- Backend parses and validates all filters.
- LLM summaries should run asynchronously if they would slow response time.
- Responses must clearly label unverified facts and evidence.

### [ATS-034] Implement job creation API

**Type:** Backend  
**Priority:** P1  
**Phase:** Phase 3  
**Owner:** Backend  
**Depends on:** ATS-006, ATS-007

**Description:**  
Create APIs for jobs, requirements, structured filters, approval status, and matching requests.

**Acceptance Criteria:**
- Recruiters can create, update, and submit jobs for approval.
- Job requirements store required skills, preferred skills, function area, industry, location, eligibility, and seniority.
- Matching cannot start until required approval rules are satisfied.

**Implementation Notes:**
- Human approval is required for sensitive actions.
- Use job.approved event to trigger matching.
- Audit all job requirement changes.

### [ATS-035] Implement job matching worker

**Type:** Backend  
**Priority:** P1  
**Phase:** Phase 3  
**Owner:** Backend  
**Depends on:** ATS-030, ATS-034

**Description:**  
Process job.matching.requested events asynchronously and persist match results.

**Acceptance Criteria:**
- Worker consumes job matching jobs from the queue with concurrency limit.
- Worker stores match results with candidate score, component scores, selected evidence, and status.
- Worker publishes job.matching.completed or job.matching.failed UI events.

**Implementation Notes:**
- Default matching concurrency should be low, e.g. 2.
- Matching must group by candidate and avoid chunk-only ranking.
- Use correlation IDs for traceability.

### [ATS-036] Implement match explanation generation

**Type:** AI  
**Priority:** P1  
**Phase:** Phase 3  
**Owner:** AI  
**Depends on:** ATS-030, ATS-035

**Description:**  
Generate recruiter-readable explanations using only selected evidence and visible score components.

**Acceptance Criteria:**
- Explanations cite specific evidence snippets and sections.
- Explanations mark unverified AI-extracted facts clearly.
- LLM is prohibited from recommending automatic rejection or hiring.

**Implementation Notes:**
- Use structured prompt templates and JSON schema validation.
- Include caveats when evidence is weak or unverified.
- Store explanation model/version for audit.

### [ATS-037] Deploy and configure n8n

**Type:** DevOps  
**Priority:** P1  
**Phase:** Phase 4  
**Owner:** DevOps  
**Depends on:** ATS-002, ATS-008

**Description:**  
Deploy self-hosted n8n as the workflow orchestrator for AI workflows, approvals, and integrations.

**Acceptance Criteria:**
- n8n is available in local stack with persistent storage.
- n8n credentials are stored securely and not committed.
- n8n has separate inbound webhook authentication and outbound backend callback credentials.

**Implementation Notes:**
- n8n orchestrates workflows but is not the system of record.
- Avoid direct unbounded webhooks for heavy processing.
- Export workflows to n8n/workflows for version control.

### [ATS-038] Implement security controls for n8n

**Type:** Security  
**Priority:** P0  
**Phase:** Phase 4  
**Owner:** Security  
**Depends on:** ATS-037

**Description:**  
Harden n8n access, webhooks, callbacks, secrets, and network exposure.

**Acceptance Criteria:**
- n8n webhooks require authentication or signed payloads.
- Backend validates n8n callback signatures and allowed workflow IDs.
- n8n is protected behind HTTPS, basic/auth provider controls, and least-privilege credentials.

**Implementation Notes:**
- Do not expose n8n editor publicly without strong authentication.
- Use IP allowlists or private network routing where possible.
- Audit all n8n-triggered state changes through backend APIs.

### [ATS-039] Implement queue-to-n8n workflow invocation pattern

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 4  
**Owner:** Backend  
**Depends on:** ATS-020, ATS-037, ATS-038

**Description:**  
Have workers invoke n8n only under controlled concurrency, retries, and rate limits instead of direct frontend/backend webhook storms.

**Acceptance Criteria:**
- Worker invokes n8n with signed payloads and job correlation IDs.
- n8n callbacks update state only through authenticated backend endpoints.
- Load test proves 500 resume uploads queue cleanly without 500 simultaneous n8n executions.

**Implementation Notes:**
- Queue worker controls throughput; n8n orchestrates steps.
- Record n8n execution IDs in background_jobs.result.
- Implement backpressure when n8n is unavailable.

### [ATS-040] Implement n8n Resume Ingestion Agent

**Type:** AI  
**Priority:** P1  
**Phase:** Phase 4  
**Owner:** AI  
**Depends on:** ATS-023, ATS-039

**Description:**  
Create an n8n workflow that orchestrates resume parsing, LLM extraction, validation, and backend callbacks.

**Acceptance Criteria:**
- Workflow accepts resume ingestion jobs only from authenticated worker calls.
- Workflow returns structured extraction output to backend validation endpoints.
- Workflow failures are reported with retryable/non-retryable error details.

**Implementation Notes:**
- Backend remains responsible for final database writes and business rules.
- Workflow should not directly overwrite verified candidate data.
- Export workflow JSON to version control.

### [ATS-041] Implement Candidate Search Agent in n8n

**Type:** AI  
**Priority:** P2  
**Phase:** Phase 4  
**Owner:** AI  
**Depends on:** ATS-033, ATS-039

**Description:**  
Create an n8n workflow for optional asynchronous search enrichment such as query interpretation and result summarization.

**Acceptance Criteria:**
- Agent enriches search context without replacing backend search/ranking rules.
- Agent outputs are marked AI-generated and validated by backend.
- Slow enrichment updates the UI asynchronously.

**Implementation Notes:**
- Search API should still return useful results without this agent.
- Do not allow agent summaries to change canonical ranking silently.
- Use selected evidence only.

### [ATS-042] Implement Job Matching Agent in n8n

**Type:** AI  
**Priority:** P2  
**Phase:** Phase 4  
**Owner:** AI  
**Depends on:** ATS-035, ATS-039

**Description:**  
Create an n8n workflow for job matching enrichment, requirement parsing, and explanation drafting where useful.

**Acceptance Criteria:**
- Agent works from approved job requirements and selected candidate evidence.
- Agent cannot autonomously reject or hire candidates.
- Agent output is validated and saved through backend APIs.

**Implementation Notes:**
- Backend matching worker remains the scoring authority.
- Human approval is required for sensitive actions.
- Keep prompts versioned.

### [ATS-043] Implement Interview Prep Agent

**Type:** AI  
**Priority:** P2  
**Phase:** Phase 4  
**Owner:** AI  
**Depends on:** ATS-036, ATS-039

**Description:**  
Create a workflow that drafts interview briefs based on job requirements, candidate evidence, and recruiter-selected focus areas.

**Acceptance Criteria:**
- Briefs cite candidate evidence and job requirements.
- Briefs label unverified facts and confidence.
- Recruiter must approve or edit briefs before sharing externally.

**Implementation Notes:**
- Do not infer protected characteristics or sensitive personal data.
- Generate questions, evidence gaps, and verification prompts.
- Publish interview.brief.ready to UI.

### [ATS-044] Implement Email Drafting Agent

**Type:** AI  
**Priority:** P2  
**Phase:** Phase 4  
**Owner:** AI  
**Depends on:** ATS-039

**Description:**  
Create a workflow that drafts recruiter emails for review without sending automatically.

**Acceptance Criteria:**
- Email drafts require human review before sending.
- Drafts are saved with status draft and audit metadata.
- Workflow publishes email.draft.ready event to UI.

**Implementation Notes:**
- Never send candidate communications automatically in MVP.
- Templates should avoid discriminatory or sensitive language.
- Integrate email provider only after security review.

### [ATS-045] Implement n8n failure handling

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 4  
**Owner:** Backend  
**Depends on:** ATS-021, ATS-039

**Description:**  
Handle n8n timeouts, bad responses, callback failures, provider errors, and partial workflow completion safely.

**Acceptance Criteria:**
- n8n invocation failures update background_jobs and retry when safe.
- Timeouts do not leave resumes permanently in processing status.
- Dead-lettered n8n jobs expose enough sanitized detail for operations review.

**Implementation Notes:**
- Classify errors as retryable, manual_review, or terminal.
- Callbacks must be idempotent.
- Add alerting hooks in Phase 6.

### [ATS-046] Implement SSE or WebSocket updates

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 5  
**Owner:** Backend  
**Depends on:** ATS-015, ATS-019, ATS-035

**Description:**  
Provide real-time server-to-client updates for resume status, background jobs, match completion, interview briefs, and email drafts.

**Acceptance Criteria:**
- Backend exposes authenticated SSE endpoint for recruiter dashboard updates.
- Events include resume.status.updated, background_job.updated, job.matching.completed, job.matching.failed, interview.brief.ready, and email.draft.ready.
- Frontend can fall back to polling if SSE connection fails.

**Implementation Notes:**
- SSE is recommended for MVP because updates are mostly server-to-client.
- Use WebSockets only if bidirectional collaboration becomes required.
- Scope events by tenant/recruiter permissions.

### [ATS-047] Implement recruiter dashboard

**Type:** Frontend  
**Priority:** P1  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-005, ATS-046

**Description:**  
Build the landing dashboard for recruiters to see jobs, candidates, processing activity, failures, and pending review items.

**Acceptance Criteria:**
- Dashboard shows active jobs, recent candidate uploads, background job status, and failure counts.
- Dashboard updates automatically via SSE or polling fallback.
- Dashboard links to candidate search, candidate profiles, job creation, and review queues.

**Implementation Notes:**
- Expose processing badges and last updated timestamps.
- Show clear callouts for needs_review and failed states.
- Do not expose data beyond the user permissions.

### [ATS-048] Implement candidate profile UI

**Type:** Frontend  
**Priority:** P1  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-010, ATS-011, ATS-013, ATS-014, ATS-046

**Description:**  
Build candidate profile pages that show canonical profile data, resumes, experiences, skills, evidence, verification state, and async status.

**Acceptance Criteria:**
- Profile displays verified profile fields separately from unverified AI-extracted facts.
- Resume processing status updates without manual refresh.
- Skill evidence shows source, confidence, evidence text, and verification status.

**Implementation Notes:**
- Never hide that AI-extracted facts are unverified.
- Display source precedence clearly.
- Include retry action for failed resume processing where authorized.

### [ATS-049] Implement candidate search UI

**Type:** Frontend  
**Priority:** P1  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-033

**Description:**  
Build recruiter search screens for natural language queries, structured filters, and result exploration.

**Acceptance Criteria:**
- Search UI supports semantic query, required/preferred skills, function area, industry, location, and experience filters.
- Results show candidate-level scores, not chunk-level rank only.
- Unverified evidence is visibly marked in results.

**Implementation Notes:**
- Make filter chips and score components transparent.
- Support loading and empty states.
- Avoid UI language that suggests AI is making final hiring decisions.

### [ATS-050] Implement match explanation UI

**Type:** Frontend  
**Priority:** P1  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-036, ATS-049

**Description:**  
Display match explanations, selected evidence, score components, and confidence/verification indicators.

**Acceptance Criteria:**
- UI shows semantic relevance, skill coverage, function area, industry, years, recency, eligibility, and evidence quality components.
- Evidence snippets link back to resume chunk or experience context.
- UI includes disclaimer that AI supports recruiter review and does not reject/hire automatically.

**Implementation Notes:**
- Use progressive disclosure for detailed evidence.
- Highlight missing required skills as clearly as matched skills.
- Keep explanation text grounded in selected evidence.

### [ATS-051] Implement job creation UI

**Type:** Frontend  
**Priority:** P1  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-034

**Description:**  
Build screens for creating jobs, defining requirements, setting filters, and submitting jobs for approval/matching.

**Acceptance Criteria:**
- Form captures required skills, preferred skills, function area, industry, location, eligibility, seniority, and description.
- Job cannot request matching until required fields and approval rules pass.
- Changes are saved through authenticated APIs and visible in audit logs.

**Implementation Notes:**
- Use taxonomy-controlled inputs where available.
- Make approval state visible.
- Warn if requirements are too vague for reliable matching.

### [ATS-052] Implement human verification UI for AI-extracted facts

**Type:** Frontend  
**Priority:** P0  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-013, ATS-014, ATS-048

**Description:**  
Create a review workflow for recruiters or reviewers to verify, reject, or correct extracted facts and skill evidence.

**Acceptance Criteria:**
- Reviewers can approve, reject, edit, and comment on extracted facts.
- Verification writes verified_by and verified_at and updates audit logs.
- Verified canonical data is protected from being overwritten by later AI extraction.

**Implementation Notes:**
- This is a safety-critical UI.
- Show evidence text beside every proposed fact.
- Batch review can be added later, but single-fact review is required for MVP safety.

### [ATS-053] Implement candidate pipeline UI

**Type:** Frontend  
**Priority:** P2  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-047, ATS-048

**Description:**  
Build a pipeline board for candidate stages with human-controlled transitions and auditability.

**Acceptance Criteria:**
- Recruiters can move candidates between configured stages when authorized.
- Stage changes publish candidate.stage.changed and are audit logged.
- AI suggestions cannot move candidates automatically.

**Implementation Notes:**
- Human approval remains required for sensitive actions.
- Use stage transition guards to prevent accidental rejection/hiring.
- Expose last actor and timestamp.

### [ATS-054] Implement interview brief UI

**Type:** Frontend  
**Priority:** P2  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-043, ATS-046

**Description:**  
Display AI-generated interview briefs for recruiter review, editing, and approval.

**Acceptance Criteria:**
- Brief UI shows evidence-grounded questions and caveats.
- Unverified facts are marked and can be sent to verification workflow.
- Briefs require human review before sharing externally.

**Implementation Notes:**
- Keep edit history if briefs are used operationally.
- Avoid protected-class or sensitive data prompts.
- Publish status updates through SSE.

### [ATS-055] Implement email draft review UI

**Type:** Frontend  
**Priority:** P2  
**Phase:** Phase 5  
**Owner:** Frontend  
**Depends on:** ATS-044, ATS-046

**Description:**  
Provide a safe human review interface for AI-generated candidate communications.

**Acceptance Criteria:**
- Email drafts can be reviewed, edited, approved, rejected, or regenerated.
- No email is sent without explicit human action.
- All approvals and sends are audit logged.

**Implementation Notes:**
- Add tone and compliance checks before sending.
- Separate drafting from actual email provider integration.
- Display source job/candidate context.

### [ATS-056] Implement audit logging

**Type:** Security  
**Priority:** P0  
**Phase:** Phase 6  
**Owner:** Security  
**Depends on:** ATS-006, ATS-007

**Description:**  
Create comprehensive audit logs for authentication, candidate changes, verification, job changes, AI workflows, n8n callbacks, and sensitive actions.

**Acceptance Criteria:**
- audit_logs table captures actor, action, entity_type, entity_id, before/after metadata where safe, IP/user agent, correlation_id, and timestamp.
- Sensitive actions require audit entries.
- Audit logs are immutable through normal application APIs.

**Implementation Notes:**
- Avoid storing full resume content or secrets in audit metadata.
- Use append-only model.
- Audit logs are required before production launch.

### [ATS-057] Implement security and privacy controls

**Type:** Security  
**Priority:** P0  
**Phase:** Phase 6  
**Owner:** Security  
**Depends on:** ATS-038, ATS-056

**Description:**  
Harden the system for PII protection, access control, secure transport, file handling, and privacy requirements.

**Acceptance Criteria:**
- All production traffic uses HTTPS.
- Resume files are private and accessed via signed URLs or backend authorization.
- Security review covers auth, RBAC, n8n, object storage, file upload, secrets, logs, and AI provider data handling.

**Implementation Notes:**
- The user prefers HTTPS; plain HTTP is not acceptable for production.
- Add malware scanning for uploaded files before production.
- Document privacy policy assumptions and data processor risks.

### [ATS-058] Implement data retention and deletion workflows

**Type:** Security  
**Priority:** P1  
**Phase:** Phase 6  
**Owner:** Security  
**Depends on:** ATS-018, ATS-056

**Description:**  
Define and implement retention, deletion, and export handling for resumes, parsed artifacts, embeddings, and candidate data.

**Acceptance Criteria:**
- Retention policy covers original files, raw text, parsed JSON, chunks, embeddings, facts, and audit logs.
- Authorized deletion removes or tombstones all derived resume artifacts consistently.
- Deletion events are audit logged and verified by tests.

**Implementation Notes:**
- Embeddings are derived personal data and must be included in deletion plans.
- Audit logs may need retention exceptions; document them.
- Use background jobs for large deletion operations.

### [ATS-059] Implement AI evaluation test suite

**Type:** Testing  
**Priority:** P0  
**Phase:** Phase 6  
**Owner:** QA  
**Depends on:** ATS-024, ATS-029, ATS-030, ATS-036

**Description:**  
Create evaluations for chunking correctness, scoring robustness, retrieval precision, explanation faithfulness, and safety constraints.

**Acceptance Criteria:**
- Tests prove role-bounded chunking does not merge unrelated roles.
- Tests prove repeated keyword frequency does not unfairly improve ranking.
- Tests check explanations cite selected evidence and do not recommend automatic rejection/hiring.

**Implementation Notes:**
- Build a small synthetic resume/job dataset with known expected outcomes.
- Track metrics over time: precision@k, recall@k, explanation faithfulness, false positive rate.
- Run critical evals in CI and full evals before releases.

### [ATS-060] Implement backend and frontend test coverage

**Type:** Testing  
**Priority:** P1  
**Phase:** Phase 6  
**Owner:** QA  
**Depends on:** ATS-009

**Description:**  
Add unit, integration, and end-to-end tests for core APIs, workers, search, UI flows, auth, and async updates.

**Acceptance Criteria:**
- Backend tests cover migrations, auth/RBAC, resume upload, jobs, search, verification, and audit logging.
- Worker tests cover retries, dead-letter, idempotency, and n8n failure paths.
- Frontend tests cover dashboard, profile, search, explanation, and verification UI states.

**Implementation Notes:**
- Use fixture resumes that do not contain real PII.
- Mock LLM providers in unit tests.
- Include SSE fallback behavior tests.

### [ATS-061] Implement monitoring, alerting, and cost tracking

**Type:** DevOps  
**Priority:** P1  
**Phase:** Phase 6  
**Owner:** DevOps  
**Depends on:** ATS-020, ATS-045, ATS-056

**Description:**  
Add observability for API health, queue depth, worker failures, n8n failures, LLM usage, latency, and storage growth.

**Acceptance Criteria:**
- Metrics include API latency/error rate, queue depth, job durations, retry/dead-letter counts, n8n failure rate, and LLM token/embedding costs.
- Alerts exist for dead-letter spikes, queue backlog, n8n downtime, database errors, and cost anomalies.
- Logs include correlation IDs without leaking PII or secrets.

**Implementation Notes:**
- Cost tracking is important because embeddings and LLM summaries can scale unexpectedly.
- Monitor PostgreSQL table and index bloat.
- Add dashboards before production launch.

### [ATS-062] Implement backup and recovery

**Type:** DevOps  
**Priority:** P0  
**Phase:** Phase 6  
**Owner:** DevOps  
**Depends on:** ATS-002, ATS-018

**Description:**  
Create backup and recovery procedures for PostgreSQL, object storage, n8n workflows, and critical configuration.

**Acceptance Criteria:**
- PostgreSQL backups are automated and restore-tested.
- Object storage backup/replication plan covers resumes and derived artifacts.
- n8n workflow exports and credentials recovery process are documented.

**Implementation Notes:**
- Backups must be encrypted and access controlled.
- Test restore into isolated environment.
- Document RPO/RTO decisions.

### [ATS-063] Implement deployment checklist

**Type:** Documentation  
**Priority:** P0  
**Phase:** Phase 6  
**Owner:** DevOps  
**Depends on:** ATS-057, ATS-059, ATS-061, ATS-062

**Description:**  
Create the production readiness checklist covering security, privacy, data, AI safety, observability, backups, and rollback.

**Acceptance Criteria:**
- Checklist includes HTTPS, secrets, RBAC, n8n hardening, upload scanning, audit logs, eval pass, backup restore, monitoring, and rollback.
- Checklist identifies launch blockers and owner sign-off requirements.
- Deployment runbook includes smoke tests, post-deploy verification, and a pointer to docs/production-hardening-checklist.md.

**Implementation Notes:**
- Do not launch production until P0 security and AI safety checks pass.
- Include manual steps for DNS, certificates, migrations, worker scaling, and restore drills.
- Keep checklist updated as architecture decisions are finalized and release criteria evolve.


## Ready

### [ATS-001] Initialize repository structure

**Type:** DevOps  
**Priority:** P0  
**Phase:** Phase 1  
**Owner:** DevOps  
**Depends on:** None

**Description:**  
Create the monorepo layout for frontend, backend, workers, n8n exports, infra, migrations, and documentation without modifying readme.md.

**Acceptance Criteria:**
- Repository has apps/api, apps/web, apps/worker, infra, db/migrations, n8n/workflows, tests, and docs directories.
- Root README references the architecture constraints from readme.md without duplicating or weakening them.
- Local developer commands are documented in IMPLEMENTATION_PLAN.md and package/tooling files.

**Implementation Notes:**
- Use a monorepo so backend, worker, and frontend share typed contracts.
- Keep generated artifacts and uploaded resumes out of git with .gitignore.
- Add a docs/architecture.md stub for deeper ADRs later.

### [ATS-002] Create Docker Compose for PostgreSQL, pgvector, Redis/Valkey, and n8n

**Type:** DevOps  
**Priority:** P0  
**Phase:** Phase 1  
**Owner:** DevOps  
**Depends on:** ATS-001

**Description:**  
Provide a local production-like stack with PostgreSQL as source of truth, pgvector as semantic memory, queue storage, and self-hosted n8n.

**Acceptance Criteria:**
- docker compose starts PostgreSQL with pgvector extension available.
- Redis or Valkey is reachable by backend and workers.
- n8n runs with basic auth and persistent volume storage.

**Implementation Notes:**
- Prefer pgvector/pgvector PostgreSQL image for local development.
- Use Valkey if Redis licensing is a concern; otherwise Redis is acceptable for MVP.
- Do not expose n8n publicly without authentication and reverse-proxy controls.

### [ATS-003] Create database migration system

**Type:** Database  
**Priority:** P0  
**Phase:** Phase 1  
**Owner:** Backend  
**Depends on:** ATS-002

**Description:**  
Add a repeatable migration workflow for schema creation, pgvector extension setup, indexes, and rollback handling.

**Acceptance Criteria:**
- Migrations can be applied from a clean database with one documented command.
- Migrations enable pgcrypto and vector extensions.
- CI can run migrations against an ephemeral database.

**Implementation Notes:**
- Use Alembic for FastAPI/Python or Prisma/Drizzle for TypeScript/NestJS; pick one in ADR-001.
- Every table must include created_at and updated_at where applicable.
- PostgreSQL remains the source of truth; n8n must not own canonical data.

### [ATS-004] Scaffold backend API application

**Type:** Backend  
**Priority:** P0  
**Phase:** Phase 1  
**Owner:** Backend  
**Depends on:** ATS-001

**Description:**  
Create the backend service that enforces business rules, validates inputs, owns writes to PostgreSQL, and publishes queue events.

**Acceptance Criteria:**
- Backend exposes /health and /version endpoints.
- Configuration loads from environment variables with typed validation.
- App has modules for auth, candidates, resumes, jobs, search, events, and audit.

**Implementation Notes:**
- FastAPI is recommended for MVP because Python ecosystem simplifies RAG and resume parsing.
- Do not let n8n write unvalidated records directly to business tables.
- Add OpenAPI generation from day one.

### [ATS-005] Scaffold frontend application

**Type:** Frontend  
**Priority:** P1  
**Phase:** Phase 1  
**Owner:** Frontend  
**Depends on:** ATS-001

**Description:**  
Create the recruiter-facing React/Next.js application with routing, API client, auth shell, and status update infrastructure.

**Acceptance Criteria:**
- Frontend renders a protected dashboard shell.
- API client reads backend base URL from environment configuration.
- SSE client abstraction is stubbed with reconnect and polling fallback hooks.

**Implementation Notes:**
- Use React or Next.js as allowed by README; prefer Next.js if server rendering and auth middleware are useful.
- Keep UI states explicit: uploaded, parsing, chunking, embedding, indexed, failed, needs_review.
- Design components to display verified vs unverified facts.

### [ATS-006] Implement authentication foundation

**Type:** Security  
**Priority:** P0  
**Phase:** Phase 1  
**Owner:** Security  
**Depends on:** ATS-004, ATS-005

**Description:**  
Add login/session/JWT foundation so all recruiter and admin actions are attributable and protected.

**Acceptance Criteria:**
- Protected API routes reject unauthenticated requests.
- Frontend supports login/logout and persists session securely.
- All authenticated requests include actor identity for audit logging.

**Implementation Notes:**
- Use secure cookies or short-lived access tokens with refresh flow.
- Never log passwords, tokens, resume contents, or PII.
- Seed only non-production demo users in local development.


## In Progress

No cards currently assigned.

## Blocked

No cards currently assigned.

## Review

No cards currently assigned.

## Done

No cards currently assigned.

# Milestone Roadmap

## Milestone 1: Foundation Skeleton
Target: End of Phase 1.
- Repository structure, Docker Compose, PostgreSQL/pgvector, Redis or Valkey, n8n, backend scaffold, frontend scaffold, auth/RBAC foundations, migration system, environment validation, and CI baseline.
- Exit criteria: local stack starts cleanly, backend and frontend health checks pass, migrations run from scratch, and protected routes exist.

## Milestone 2: Safe Resume Ingestion MVP
Target: End of Phase 2.
- Candidate, resume, experience, profile fact, skill evidence, and background job schemas.
- Resume upload stores files in object storage, creates durable job state, publishes queue events, and workers process ingestion asynchronously.
- Exit criteria: a recruiter can upload a resume, see status changes, and recover from failures without direct n8n overload.

## Milestone 3: RAG Search and Matching MVP
Target: End of Phase 3.
- Role-bounded chunks, embeddings, pgvector HNSW index, full-text index, hybrid retrieval, unique skill coverage scoring, candidate-level reranking, industry/function classification, search API, job API, matching worker, and grounded explanations.
- Exit criteria: a recruiter can search and match candidates with transparent component scores and evidence-grounded explanations.

## Milestone 4: Controlled n8n Orchestration
Target: End of Phase 4.
- Hardened n8n deployment, signed webhooks/callbacks, queue-to-n8n pattern, resume ingestion workflow, optional search/matching/interview/email agents, and failure handling.
- Exit criteria: workers invoke n8n under concurrency controls and all state changes return through authenticated backend APIs.

## Milestone 5: Recruiter Workflow UX
Target: End of Phase 5.
- Dashboard, profile, search, match explanation, job creation, human verification, pipeline, interview brief, email draft review, and SSE updates.
- Exit criteria: recruiters can complete the MVP workflow without manual refresh and can verify or reject AI-extracted facts.

## Milestone 6: Production Hardening
Target: End of Phase 6.
- Audit logs, security/privacy controls, retention/deletion, AI evaluation suite, full test coverage, monitoring, cost tracking, backups, recovery, and deployment checklist.
- Exit criteria: production readiness checklist is signed off and all P0 security, privacy, and AI safety gates pass.

# Dependency Map

## Foundation chain
- ATS-001 -> ATS-002 -> ATS-003
- ATS-001 -> ATS-004 -> ATS-006 -> ATS-007
- ATS-001 -> ATS-005 -> ATS-006
- ATS-003 + ATS-004 + ATS-005 -> ATS-009

## Data and ingestion chain
- ATS-003 -> ATS-010 -> ATS-011, ATS-012, ATS-013, ATS-014
- ATS-003 -> ATS-015
- ATS-002 + ATS-015 -> ATS-016
- ATS-006 + ATS-011 + ATS-016 -> ATS-017 -> ATS-018 -> ATS-019
- ATS-016 + ATS-019 -> ATS-020 -> ATS-021
- ATS-018 + ATS-020 -> ATS-022 -> ATS-023

## RAG and search chain
- ATS-012 + ATS-022 + ATS-023 -> ATS-024 -> ATS-025 -> ATS-026
- ATS-024 -> ATS-027
- ATS-026 + ATS-027 -> ATS-028
- ATS-014 + ATS-027 -> ATS-029
- ATS-028 + ATS-029 -> ATS-030
- ATS-012 + ATS-023 -> ATS-031 -> ATS-032
- ATS-028 + ATS-030 + ATS-032 -> ATS-033
- ATS-006 + ATS-007 -> ATS-034
- ATS-030 + ATS-034 -> ATS-035 -> ATS-036

## n8n orchestration chain
- ATS-002 + ATS-008 -> ATS-037 -> ATS-038
- ATS-020 + ATS-037 + ATS-038 -> ATS-039
- ATS-023 + ATS-039 -> ATS-040
- ATS-033 + ATS-039 -> ATS-041
- ATS-035 + ATS-039 -> ATS-042
- ATS-036 + ATS-039 -> ATS-043
- ATS-039 -> ATS-044
- ATS-021 + ATS-039 -> ATS-045

## UX chain
- ATS-015 + ATS-019 + ATS-035 -> ATS-046
- ATS-005 + ATS-046 -> ATS-047
- ATS-010 + ATS-011 + ATS-013 + ATS-014 + ATS-046 -> ATS-048
- ATS-033 -> ATS-049
- ATS-036 + ATS-049 -> ATS-050
- ATS-034 -> ATS-051
- ATS-013 + ATS-014 + ATS-048 -> ATS-052
- ATS-047 + ATS-048 -> ATS-053
- ATS-043 + ATS-046 -> ATS-054
- ATS-044 + ATS-046 -> ATS-055

## Production hardening chain
- ATS-006 + ATS-007 -> ATS-056
- ATS-038 + ATS-056 -> ATS-057
- ATS-018 + ATS-056 -> ATS-058
- ATS-024 + ATS-029 + ATS-030 + ATS-036 -> ATS-059
- ATS-009 -> ATS-060
- ATS-020 + ATS-045 + ATS-056 -> ATS-061
- ATS-002 + ATS-018 -> ATS-062
- ATS-057 + ATS-059 + ATS-061 + ATS-062 -> ATS-063

# Recommended First 10 Tasks to Start With

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

# Architecture Risks That Still Need Decisions

- Backend stack decision: FastAPI is recommended for MVP, but NestJS remains viable if the team prefers TypeScript across backend and frontend.
- Queue library decision: Celery/RQ/Arq fits Python; BullMQ fits Node. Pick based on backend stack before implementation.
- Object storage provider: local MinIO is suitable for development, but production needs a selected S3-compatible provider, retention policy, encryption, and signed access pattern.
- Embedding model and vector dimension: choose early because it affects pgvector column type, indexes, re-embedding, and cost.
- Taxonomy scope: define how broad the first industry/function taxonomy should be and who owns normalization updates.
- Tenant model: decide whether MVP is single-tenant or multi-tenant before finalizing RBAC, audit logs, and event scoping.
- Human approval boundaries: define which actions require approval: job activation, candidate stage changes, email sends, fact verification, external sharing, and rejection/hiring decisions.
- n8n hosting exposure: decide whether n8n is private-network-only or externally accessible behind HTTPS, SSO/basic auth, and IP restrictions.
- AI provider data policy: confirm whether resume content may be sent to external LLM/embedding providers or if local/private models are required.
- Search evaluation thresholds: define acceptable precision/recall and false-positive thresholds before using matching in real hiring workflows.
