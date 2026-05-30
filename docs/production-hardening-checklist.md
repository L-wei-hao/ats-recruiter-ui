# ATS Production Hardening Checklist

This document turns the Phase 6 / Sprint 7 hardening work into a concrete go-live gate for the ATS MVP.

Scope:
- Audit trails
- Security and privacy controls
- Test coverage and AI evaluations
- Monitoring, alerting, and cost visibility
- Backups and restore drills
- Deployment readiness and rollback checks

## 1) Audit trails

Minimum audit events:
- Authentication: sign-in, sign-out, session refresh, failed auth, password or secret reset
- Authorization: 403 denials for restricted candidate, job, verification, and callback actions
- Candidate/profile changes: create, edit, delete, merge, ownership changes
- Resume lifecycle: upload, parse start/finish, chunking, embedding, index, failure, retry
- Verification workflow: approve, reject, edit, comment, escalation
- Job workflow: create, edit, approve, request matching, stage changes, approvals, sends
- n8n callbacks: workflow start, callback success/failure, signature failure, timeout, retry
- Sensitive data operations: export, retention policy changes, deletion, restore

Required audit fields:
- actor_id
- actor_role
- action
- entity_type
- entity_id
- correlation_id
- request_id or trace_id
- timestamp
- before/after metadata where safe
- source IP and user agent where available

Audit log rules:
- Append-only through normal application APIs
- No full resume bodies, secrets, access tokens, or raw provider payloads in audit rows
- Redact PII from free-text metadata
- Keep correlation IDs consistent across backend, workers, and n8n callbacks

Audit verification checks:
- [ ] Each sensitive route writes an audit event
- [ ] 403 responses are logged with actor and resource context
- [ ] Audit writes do not block the main transaction path beyond acceptable latency
- [ ] Audit log queries support incident review and operational search

## 2) Security and privacy controls

Transport and access:
- [ ] Production traffic is HTTPS-only
- [ ] HSTS enabled in production
- [ ] Object storage uses private buckets/containers
- [ ] Resume files and derived artifacts are accessed via signed URLs or backend authorization
- [ ] n8n editor is not publicly exposed without strong authentication
- [ ] Sensitive callbacks require signed payload validation

Authentication and authorization:
- [ ] Backend enforces RBAC on every candidate, job, verification, and callback action
- [ ] Unauthorized actions return consistent 403 responses
- [ ] Human approval is required for sensitive state changes
- [ ] Least-privilege credentials are used for database, storage, queue, and AI provider access

Upload and file safety:
- [ ] MIME type and extension are validated server-side
- [ ] File size limits are enforced
- [ ] Malware scanning runs before production release
- [ ] Reject archives or unexpected file types unless explicitly supported
- [ ] Quarantine path exists for suspicious files

Privacy and data handling:
- [ ] Data retention policy covers original files, raw text, parsed JSON, chunks, embeddings, facts, audit logs, and backups
- [ ] Deletion removes or tombstones derived artifacts consistently, including embeddings
- [ ] Export workflow exists for candidate data subject requests
- [ ] AI provider prompts exclude unnecessary PII
- [ ] Logs redact secrets and personal data
- [ ] External provider usage is documented in the privacy review

Security review checklist:
- [ ] Auth/session handling reviewed
- [ ] RBAC reviewed
- [ ] Upload path reviewed
- [ ] n8n ingress/egress reviewed
- [ ] Object storage access reviewed
- [ ] Secrets handling reviewed
- [ ] Logs reviewed for PII leakage
- [ ] AI provider data exposure reviewed
- [ ] Deletion/export workflows reviewed

## 3) Tests and AI evaluations

Baseline automated tests:
- [ ] Backend unit tests for validation, auth, RBAC, audit logging, and job lifecycle
- [ ] Worker tests for retries, backoff, dead-letter handling, idempotency, and callback failures
- [ ] Frontend tests for dashboard, profile, search, verification, and SSE fallback states
- [ ] Integration tests for upload → job creation → status updates → retrieval/search flows
- [ ] E2E tests for upload, ingestion status, search, matching, explanation, and verification

AI evaluation suite:
- [ ] Role-bounded chunking does not merge unrelated employers or roles
- [ ] Unique skill coverage scoring is resistant to keyword stuffing
- [ ] Retrieval returns evidence-backed results, not chunk-only rankings
- [ ] Explanations cite selected evidence and do not recommend auto reject/hire
- [ ] Unverified facts are visibly labeled
- [ ] Human verification cannot be silently bypassed by later AI output

Eval dataset rules:
- [ ] Use synthetic or scrubbed resumes; no real PII in fixtures
- [ ] Include positive and negative counterexamples
- [ ] Include at least one keyword-stuffing adversarial case
- [ ] Include at least one unrelated-role chunking adversarial case
- [ ] Record expected outputs and evaluation thresholds

Release gates:
- [ ] Critical evals run in CI
- [ ] Full evals run before release
- [ ] Failed evals block deployment until explained and accepted

## 4) Monitoring, alerting, and cost tracking

Core metrics:
- API latency and error rate
- Queue depth by job type
- Job duration by status and queue
- Retry count and dead-letter count
- n8n invocation count, latency, and failure rate
- LLM token usage and embedding usage
- Storage growth for resumes, raw text, parsed artifacts, and backups
- PostgreSQL health, replication status, table/index bloat, and connection usage

Alert conditions:
- [ ] Dead-letter spike
- [ ] Queue backlog above threshold
- [ ] n8n unavailable or callback failures spike
- [ ] API error rate above threshold
- [ ] Backup failure or restore-test failure
- [ ] Database saturation, disk pressure, or connection exhaustion
- [ ] Cost anomaly in LLM or embedding spend

Operational logs:
- [ ] Correlation IDs are present end-to-end
- [ ] Logs exclude secrets and PII
- [ ] Error summaries are sanitized
- [ ] Traceability from upload to final state exists for every job

## 5) Backups and restore checks

Backup coverage:
- PostgreSQL database
- Object storage for resumes and derived artifacts
- n8n workflow exports
- Critical configuration and environment templates

Backup rules:
- [ ] Backups are automated
- [ ] Backups are encrypted
- [ ] Backup access is restricted
- [ ] Backup retention is documented
- [ ] Restore procedure is documented
- [ ] RPO and RTO targets are explicit

Restore drill procedure:
1. Restore PostgreSQL into an isolated environment.
2. Restore or reconnect object storage artifacts.
3. Import n8n workflow exports.
4. Validate that a sample resume, parsed artifacts, and a sample job can be opened.
5. Confirm queue-backed jobs recover cleanly after restore.
6. Verify audit trail continuity for restored data.

Restore acceptance checks:
- [ ] Database restore succeeds
- [ ] Object artifacts are accessible
- [ ] Workflows can be reloaded
- [ ] Sample application flows work after restore
- [ ] Restore time meets target RTO
- [ ] Data loss stays within target RPO

## 6) Deployment readiness checklist

Pre-deploy gate:
- [ ] Required secrets are present and rotated if needed
- [ ] Migrations are applied successfully in staging
- [ ] Tests and evals passed
- [ ] Backup restore drill passed recently
- [ ] Security review sign-off recorded
- [ ] Observability dashboards are live
- [ ] Rollback plan is written and understood
- [ ] Production HTTPS and access controls are confirmed

Smoke tests:
- [ ] Health endpoint returns OK
- [ ] Auth login/session flow works
- [ ] Resume upload creates a background job
- [ ] SSE or polling updates work
- [ ] Search returns candidate-level results
- [ ] Verification actions write audit logs
- [ ] n8n callback flow succeeds with signed request validation

Rollback plan:
- [ ] Rollback trigger conditions defined
- [ ] Previous release artifact retained
- [ ] Database rollback strategy documented or migration rollback verified
- [ ] Feature flags or release toggles documented
- [ ] Communication owner identified

Post-deploy verification:
- [ ] Error rate and latency are within baseline
- [ ] Queue depth returns to normal
- [ ] Backups continue to run successfully
- [ ] Audit logs populate for real traffic
- [ ] Alerts are not firing unexpectedly
- [ ] No privacy or auth regressions observed

## Definition of done for hardening

Hardening is complete only when all of the following are true:
- Audit logs exist for sensitive actions and are safe to retain
- Security and privacy controls are implemented and reviewed
- Tests and AI evaluations cover the high-risk flows
- Monitoring and alerting can detect service degradation and cost spikes
- Backups are encrypted and restore-tested
- A deployment checklist exists and is usable by someone other than the implementer
