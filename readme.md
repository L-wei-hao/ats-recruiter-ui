# ATS Project

## Project Overview

This project is a software platform for managing recruitment operations, profile records, resume documents, workflow automation, and searchable talent data.

The system is designed as an internal productivity tool that helps teams organize job-related records, process uploaded documents, search structured profile data, and automate workflow notifications.

The project includes:

* A web application for users and administrators
* A backend API for business rules and permissions
* PostgreSQL as the primary database
* pgvector for semantic document search
* Redis or Valkey for queues and event delivery
* Backend workers for asynchronous processing
* n8n for business workflow automation
* Server-Sent Events, SSE, for live frontend updates
* Object storage for uploaded files
* Audit logs and privacy controls

This project does not make final employment decisions. It is a workflow and information management system.

---

## Project Goals

The project aims to build a reliable and scalable application that can:

1. Store and manage profile records
2. Store and manage uploaded resume documents
3. Extract structured information from documents
4. Keep AI-extracted information separate from verified information
5. Support semantic search over resume content
6. Support structured filters such as function area, industry, skills, and location
7. Process documents asynchronously through workers
8. Provide real-time status updates in the frontend
9. Use n8n for workflow automation and human approval flows
10. Maintain audit logs, privacy controls, and operational visibility

---

## Architecture Summary

```text
Frontend
  |
  v
Backend API
  |
  v
PostgreSQL + pgvector
  |
  v
Redis or Valkey Queue
  |
  v
Backend Workers
  |
  v
n8n Workflow Automation
```

## Architecture Principles

```text
PostgreSQL is the source of truth.
pgvector is the semantic search layer.
The backend API enforces business rules.
Redis or Valkey handles queues and event delivery.
Backend workers handle high-volume processing.
n8n handles business workflow automation.
The frontend receives live updates through SSE.
AI-extracted facts are unverified by default.
Human-verified data must not be overwritten automatically.
```

---

## Core Components

## 1. Frontend Application

The frontend provides the user interface for:

* Dashboard
* Profile records
* Document upload
* Document processing status
* Search interface
* Detail pages
* Workflow status
* Human verification of extracted facts
* Admin settings

Recommended stack:

* Next.js or React
* TypeScript
* Tailwind CSS
* SSE client hook for live updates

---

## 2. Backend API

The backend API owns application rules and data access.

Responsibilities:

* Authentication
* Authorization
* Role-based access control
* Profile management
* Document upload API
* Job and workflow records
* Search API
* Audit logging
* Queue job creation
* SSE event publishing
* Data validation

Recommended stack:

* FastAPI
* NestJS
* Django

---

## 3. PostgreSQL Database

PostgreSQL is the source of truth for the application.

It stores:

* Users
* Roles
* Profile records
* Resume metadata
* Extracted facts
* Verification status
* Background jobs
* Search records
* Workflow state
* Audit logs

---

## 4. pgvector

pgvector is used for semantic search over document chunks.

It stores embeddings for:

* Resume chunks
* Job or project descriptions
* Searchable document sections

Vector search is used together with structured filters and full-text search.

---

## 5. Redis or Valkey

Redis or Valkey is used for:

* Background queues
* Worker coordination
* Retry handling
* Dead-letter handling
* Pub/Sub event delivery
* SSE event backplane

---

## 6. Backend Workers

Backend workers own high-volume asynchronous processing.

Workers are responsible for:

* Document text extraction
* Two-pass document structuring
* Role-bounded chunk generation
* Embedding generation
* pgvector writes
* Full-text indexing
* Deterministic search preparation
* Background job status updates
* Retry handling
* Dead-letter handling

Workers must control concurrency and rate limits.

---

## 7. n8n Workflow Automation

n8n is used for business workflow automation.

n8n should handle:

* Notification workflows
* Human approval workflows
* Interview preparation workflows
* Email draft workflows
* Offer workflow automation
* Calendar and email integrations
* HRIS or external system integrations
* Reminder workflows

n8n should not handle high-volume document ingestion, chunking, embedding, or deterministic scoring.

---

# Data Model Overview

## Core Tables

The system should include the following database areas:

```text
users
roles
permissions
profiles
resumes
resume_texts
resume_chunks
profile_facts
skill_evidence
profile_experiences
jobs
applications
background_jobs
search_results
match_explanations
activity_logs
audit_logs
```

---

## Profile Records

Profile records store user-visible information.

Example fields:

```text
id
full_name
email
phone
location
country
current_title
current_company
primary_function_area
primary_industry
secondary_industries
created_at
updated_at
```

---

## Resume Records

Resume records store metadata about uploaded documents.

Example fields:

```text
id
profile_id
file_name
file_url
file_type
file_hash
raw_text_url
parsed_json_url
status
uploaded_at
processed_at
```

Resume statuses:

```text
uploaded
queued
extracting_text
structuring
chunking
embedding
indexed
failed
needs_review
```

---

## Profile Facts

AI-extracted or system-extracted information should be stored as facts.

Facts must include source and verification status.

Example fields:

```text
id
profile_id
fact_type
fact_value
source_type
source_id
evidence_text
confidence
is_human_verified
verified_by
verified_at
created_at
```

Fact types:

```text
skill
industry
function_area
certification
current_title
company
education
language
work_authorization
```

Important rule:

```text
Extracted facts are unverified by default.
Verified profile data must not be overwritten automatically.
```

---

## Skill Evidence

Skill evidence should be tracked separately from verified skills.

Example fields:

```text
id
profile_id
skill_name
evidence_type
evidence_source
resume_chunk_id
evidence_text
confidence
is_human_verified
verified_by
verified_at
created_at
```

Evidence types:

```text
explicit_skill_list
work_experience
project
certification
education
manual_entry
verified_review
```

---

## Resume Chunks

Resume chunks are used for semantic search.

Chunks should be role-bounded and section-aware.

Example fields:

```text
id
profile_id
resume_id
experience_id
chunk_index
chunk_type
chunk_scope
content
function_area
industry
sub_industry
company_name
job_title
start_date
end_date
embedding
metadata
created_at
```

Chunk scopes:

```text
candidate_summary
skills_section
single_role
single_project
education
certification
fallback_raw_text
```

---

# Document Processing Pipeline

## Processing Flow

```text
1. User uploads resume document.
2. Backend stores file in object storage.
3. Backend creates resume record.
4. Backend creates background job.
5. Backend publishes job to Redis or Valkey queue.
6. Worker consumes the job.
7. Worker extracts raw text.
8. Worker runs two-pass structuring.
9. Worker creates role-bounded chunks.
10. Worker generates embeddings.
11. Worker stores chunks and vectors.
12. Worker updates processing status.
13. Worker publishes update through Redis Pub/Sub.
14. Frontend receives SSE update.
```

---

## Two-Pass Document Structuring

The system uses a two-pass pipeline for reliable chunking.

### Pass 1: Structuring

A low-cost LLM receives extracted raw text and returns a structured JSON map.

The JSON includes:

* Section boundaries
* Work experience boundaries
* Company names
* Job titles
* Function area
* Industry
* Sub-industry
* Start and end character positions

Example output:

```json
{
  "work_experience": [
    {
      "role_id": "role_1",
      "company": "Example SaaS Company",
      "job_title": "HR Business Partner",
      "function_area": "Human Resources",
      "industry": "Technology",
      "sub_industry": "SaaS",
      "start_char": 450,
      "end_char": 1200
    }
  ]
}
```

### Pass 2: Vectorization

The worker uses the JSON boundaries to slice the original text.

The worker then:

* Creates role-bounded chunks
* Applies metadata
* Generates embeddings
* Stores vectors in pgvector

If boundary confidence is low, the resume should be marked as:

```text
needs_review
```

---

# Search Design

## Search Principles

The search system should combine:

* Semantic search
* Full-text search
* Structured filters
* Deterministic scoring
* Evidence tracking

The search system should not rely on raw keyword frequency.

---

## Unique Skill Coverage

Skill matching should count unique skill coverage, not repeated keyword occurrences.

Example:

```text
Bad:
A repeated term increases score every time it appears.

Good:
A required skill is counted once per profile, with evidence attached.
```

Recommended score inputs:

```text
semantic relevance
required skill coverage
function area match
industry relevance
years of relevant experience
recency of relevant experience
location or work eligibility
verified evidence quality
```

---

## Candidate-Level Aggregation

The system should not rank raw chunks as final results.

Correct flow:

```text
1. Retrieve chunks.
2. Group chunks by profile.
3. Deduplicate evidence.
4. Score profile-level results.
5. Return profile-level search results.
```

---

# Lazy Explanation Generation

Generative explanation should be lazy-loaded.

The system should not generate explanations for every possible profile result.

Explanation generation should happen when:

* A user opens a detail page
* A user clicks Generate Explanation
* A result is inside a configured top-N threshold
* A workflow explicitly requests it

The system should cache generated explanations.

Cache invalidation should happen when:

* The resume changes
* The job or search criteria changes
* Relevant facts are updated
* The prompt version changes

---

# Function Area and Industry

The system should classify function area separately from industry.

```text
Function area = what the person does.
Industry = the business domain or company sector.
Sub-industry = a more specific category.
```

Examples:

```text
Function Area: Human Resources
Industry: Technology
Sub-Industry: SaaS
```

Function area examples:

```text
Human Resources
Engineering
Sales
Marketing
Finance
Legal
Operations
Product Management
Data and Analytics
Cybersecurity
Information Technology
```

Industry examples:

```text
Technology
Financial Services
Healthcare
Manufacturing
Logistics
Education
Retail
Government
Professional Services
```

Important rules:

```text
HR is a function area, not an industry.
Engineering is a function area, not an industry.
Sales is a function area, not an industry.
Finance as a role is a function area.
Financial Services is an industry.
```

---

# Real-Time Frontend Updates

The frontend should use Server-Sent Events, SSE, for async updates.

Redis Pub/Sub should be used as the backplane.

Flow:

```text
Worker completes background job.
Worker publishes event to Redis Pub/Sub.
Backend instances subscribe to Redis.
The instance holding the SSE connection sends the event to the browser.
Frontend updates the UI.
```

Events:

```text
resume.status.updated
background_job.updated
profile.updated
search.completed
search.failed
explanation.ready
interview.brief.ready
email.draft.ready
```

Frontend should support:

* Processing badges
* Retry button on failure
* Live status updates
* Polling fallback
* Reconnect logic
* User and tenant event filtering

---

# n8n Workflow Scope

n8n should be used for business workflows, not high-volume processing.

Allowed n8n workflows:

```text
interview_brief_workflow
email_draft_workflow
offer_approval_workflow
review_reminder_workflow
calendar_notification_workflow
external_integration_workflow
```

n8n should not own:

```text
resume ingestion
document chunking
embedding generation
vector database writes
deterministic search scoring
high-volume background ETL
```

---

# API Areas

## Profile APIs

```text
GET /api/profiles
POST /api/profiles
GET /api/profiles/{id}
PATCH /api/profiles/{id}
```

## Resume APIs

```text
POST /api/resumes/upload
GET /api/resumes/{id}
POST /api/resumes/{id}/retry
```

## Search APIs

```text
POST /api/search
GET /api/search/{id}
POST /api/search/{id}/explanation
```

## Job APIs

```text
GET /api/jobs
POST /api/jobs
GET /api/jobs/{id}
PATCH /api/jobs/{id}
```

## Workflow APIs

```text
POST /api/workflows/interview-brief
POST /api/workflows/email-draft
POST /api/workflows/approval
```

## Event APIs

```text
GET /api/events/stream
```

---

# Implementation Phases

## Phase 1: Foundation

Goal:

Set up the base project infrastructure.

Deliverables:

* Repository structure
* Docker Compose
* PostgreSQL with pgvector
* Redis or Valkey
* n8n
* Backend scaffold
* Frontend scaffold
* Environment variables
* Database migration system

Exit criteria:

* Local stack starts successfully
* Database migrations run
* Backend health endpoint works
* Frontend loads

---

## Phase 2: Data Model and Async Processing

Goal:

Implement the database foundation and asynchronous processing model.

Deliverables:

* Profile schema
* Resume schema
* Profile facts schema
* Skill evidence schema
* Background jobs table
* Queue worker scaffold
* Resume upload API
* Object storage integration
* Resume processing statuses

Exit criteria:

* Resume can be uploaded
* Background job is created
* Worker can process queued job
* Status updates are recorded

---

## Phase 3: Document Processing and Search

Goal:

Build the document processing and semantic search pipeline.

Deliverables:

* Text extraction
* Two-pass document structuring
* Boundary validation
* Role-bounded chunks
* Embedding generation
* pgvector writes
* HNSW index
* Full-text search index
* Hybrid search API
* Unique skill coverage scoring

Exit criteria:

* Uploaded document becomes searchable
* Search returns profile-level results
* Evidence is attached to results
* Raw keyword frequency does not inflate score

---

## Phase 4: Frontend Experience

Goal:

Build the main user interface.

Deliverables:

* Dashboard
* Profile detail page
* Resume upload UI
* Processing status UI
* Search UI
* Explanation UI
* Human verification UI
* SSE hook
* Polling fallback

Exit criteria:

* Users can upload documents
* Users can see live processing updates
* Users can search records
* Users can review extracted facts

---

## Phase 5: n8n Business Workflows

Goal:

Add workflow automation for business processes.

Deliverables:

* n8n configuration
* Webhook authentication
* Interview brief workflow
* Email draft workflow
* Approval workflow
* Reminder workflow
* External integration pattern

Exit criteria:

* Backend can trigger n8n business workflows
* n8n can call backend APIs
* Human approval workflows are supported
* Workflow activity is logged

---

## Phase 6: Production Hardening

Goal:

Prepare the system for production use.

Deliverables:

* Audit logging
* Security review
* Data retention policies
* Monitoring
* Error tracking
* AI evaluation tests
* Backup and recovery
* Deployment checklist

Exit criteria:

* System has operational monitoring
* Sensitive actions are audited
* Failed jobs can be retried
* Production deployment process is documented

---

# MVP Scope

MVP includes:

1. Local development stack
2. Backend API scaffold
3. Frontend scaffold
4. PostgreSQL with pgvector
5. Redis or Valkey queue
6. Resume upload
7. Background job tracking
8. Worker-based processing
9. Two-pass document structuring
10. Role-bounded chunking
11. Embedding storage
12. Search API
13. SSE status updates
14. Profile detail page
15. Human verification of extracted facts

MVP excludes:

```text
Auto decision-making
High-volume external integrations
Complex approval workflows
Advanced analytics
Mobile application
```

---

# Non-Negotiable Rules

```text
Do not use n8n for high-volume resume ETL.
Do not treat AI-extracted facts as verified.
Do not overwrite verified data automatically.
Do not rely on raw keyword frequency.
Do not rank raw chunks as final profile results.
Do not generate explanations for every search result by default.
Do not build SSE using only local in-memory events.
```

---

# Recommended First 10 Tasks

1. Initialize repository structure
2. Create Docker Compose stack
3. Set up database migration system
4. Implement core profile and resume schema
5. Implement background jobs table
6. Implement Redis or Valkey queue worker scaffold
7. Implement resume upload API
8. Add object storage integration
9. Implement SSE endpoint with Redis Pub/Sub
10. Implement two-pass document structuring prototype

---

# Project Status

Current status:

```text
Planning
```

Next milestone:

```text
Foundation setup
```
