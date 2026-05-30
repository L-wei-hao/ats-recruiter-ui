# ATS n8n workflows

This directory contains the workflow exports for the ATS orchestration layer.

Design goals:
- n8n only orchestrates business workflows.
- Backend APIs remain the source of truth and own final writes.
- Every inbound callback is signed and verified.
- Human approval is required for email drafts and other sensitive actions.
- Heavy ingestion, chunking, embedding, and scoring stay in workers, not in n8n.

Expected backend contract:
- `POST /api/n8n/workflows/resume-ingestion`
- `POST /api/n8n/workflows/candidate-search`
- `POST /api/n8n/workflows/job-matching`
- `POST /api/n8n/workflows/interview-prep`
- `POST /api/n8n/workflows/integrations`
- `POST /api/n8n/workflows/email-draft`
- `POST /api/n8n/workflows/notifications`
- `POST /api/n8n/callbacks`
- `POST /api/n8n/failures`

Required environment variables:
- `ATS_API_BASE_URL`
- `ATS_N8N_INBOUND_TOKEN`
- `ATS_N8N_CALLBACK_SECRET`

Import notes:
- Workflow files are intentionally export-style JSON objects so they can be imported into n8n and reviewed as code.
- All workflows are disabled by default.
- Update the backend endpoints before turning a workflow on in production.
