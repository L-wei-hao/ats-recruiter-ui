-- Create the core ATS PostgreSQL schema beyond background_jobs.
-- The schema keeps canonical profile data, immutable review evidence, job/application tracking,
-- and append-only activity/audit trails while preserving verification boundaries.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_status') THEN
        CREATE TYPE profile_status AS ENUM (
            'active',
            'inactive',
            'archived',
            'merged',
            'needs_review'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resume_status') THEN
        CREATE TYPE resume_status AS ENUM (
            'uploaded',
            'queued',
            'extracting_text',
            'structuring',
            'chunking',
            'embedding',
            'indexed',
            'failed',
            'needs_review'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_kind') THEN
        CREATE TYPE source_kind AS ENUM (
            'candidate_provided',
            'recruiter_entered',
            'resume_extracted',
            'ai_inferred',
            'system_generated',
            'manual_review'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        CREATE TYPE verification_status AS ENUM (
            'unverified',
            'needs_review',
            'verified',
            'rejected'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fact_type') THEN
        CREATE TYPE fact_type AS ENUM (
            'skill',
            'industry',
            'function_area',
            'certification',
            'current_title',
            'company',
            'education',
            'language',
            'work_authorization',
            'location',
            'summary'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_type') THEN
        CREATE TYPE evidence_type AS ENUM (
            'explicit_skill_list',
            'work_experience',
            'project',
            'certification',
            'education',
            'manual_entry',
            'verified_review',
            'interview_feedback',
            'recruiter_verified'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chunk_scope') THEN
        CREATE TYPE chunk_scope AS ENUM (
            'candidate_summary',
            'skills_section',
            'single_role',
            'single_project',
            'education',
            'certification',
            'fallback_raw_text'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM (
            'draft',
            'pending_review',
            'approved',
            'open',
            'paused',
            'closed',
            'archived'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
        CREATE TYPE application_status AS ENUM (
            'applied',
            'screening',
            'interviewing',
            'offer',
            'hired',
            'rejected',
            'withdrawn',
            'archived'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artifact_kind') THEN
        CREATE TYPE artifact_kind AS ENUM (
            'search_query',
            'search_result',
            'match_explanation',
            'candidate_ranking',
            'workflow_output',
            'cached_explanation'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_action') THEN
        CREATE TYPE activity_action AS ENUM (
            'created',
            'updated',
            'status_changed',
            'submitted',
            'approved',
            'rejected',
            'commented',
            'retried',
            'archived',
            'restored'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_risk_level') THEN
        CREATE TYPE audit_risk_level AS ENUM (
            'low',
            'medium',
            'high',
            'critical'
        );
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_mutation_of_verified_profile_data()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.verification_status = 'verified' THEN
        RAISE EXCEPTION 'verified profile data is immutable';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_append_only_row_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    preferred_name TEXT,
    email TEXT,
    phone TEXT,
    location TEXT,
    country TEXT,
    current_title TEXT,
    current_company TEXT,
    primary_function_area TEXT,
    primary_industry TEXT,
    secondary_industries JSONB NOT NULL DEFAULT '[]'::jsonb,
    status profile_status NOT NULL DEFAULT 'active',
    dedupe_key TEXT,
    owner_user_id UUID,
    source_kind source_kind NOT NULL DEFAULT 'manual_review',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT profiles_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT profiles_secondary_industries_array CHECK (jsonb_typeof(secondary_industries) = 'array'),
    CONSTRAINT profiles_full_name_not_blank CHECK (length(trim(full_name)) > 0),
    CONSTRAINT profiles_dedupe_key_not_blank CHECK (dedupe_key IS NULL OR length(trim(dedupe_key)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_dedupe_key_uq
    ON profiles (dedupe_key)
    WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_uq
    ON profiles (lower(email))
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_status_name_idx
    ON profiles (status, full_name);

CREATE INDEX IF NOT EXISTS profiles_workspace_idx
    ON profiles (owner_user_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    uploaded_by_user_id UUID,
    file_name TEXT NOT NULL,
    file_mime_type TEXT,
    file_size_bytes BIGINT,
    file_url TEXT,
    file_storage_key TEXT,
    file_hash TEXT NOT NULL,
    raw_text_url TEXT,
    raw_text_storage_key TEXT,
    text_hash TEXT,
    parsed_json_url TEXT,
    parsed_json_storage_key TEXT,
    language_code TEXT,
    status resume_status NOT NULL DEFAULT 'uploaded',
    version INTEGER NOT NULL DEFAULT 1,
    parse_attempts INTEGER NOT NULL DEFAULT 0,
    processed_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT resumes_version_positive CHECK (version > 0),
    CONSTRAINT resumes_parse_attempts_nonnegative CHECK (parse_attempts >= 0),
    CONSTRAINT resumes_file_hash_not_blank CHECK (length(trim(file_hash)) > 0),
    CONSTRAINT resumes_file_name_not_blank CHECK (length(trim(file_name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS resumes_profile_file_hash_version_uq
    ON resumes (profile_id, file_hash, version);

CREATE INDEX IF NOT EXISTS resumes_profile_status_idx
    ON resumes (profile_id, status, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS resumes_hash_idx
    ON resumes (file_hash);

CREATE INDEX IF NOT EXISTS resumes_text_hash_idx
    ON resumes (text_hash)
    WHERE text_hash IS NOT NULL;

DROP TRIGGER IF EXISTS trg_resumes_updated_at ON resumes;
CREATE TRIGGER trg_resumes_updated_at
BEFORE UPDATE ON resumes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS parsed_resume_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    snapshot_kind TEXT NOT NULL DEFAULT 'structured_resume',
    parser_version TEXT NOT NULL,
    model_name TEXT,
    model_provider TEXT,
    confidence NUMERIC(5,4),
    boundary_confidence NUMERIC(5,4),
    extracted_json JSONB NOT NULL,
    extracted_text TEXT,
    source_kind source_kind NOT NULL DEFAULT 'resume_extracted',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT parsed_resume_snapshots_confidence_range CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    CONSTRAINT parsed_resume_snapshots_boundary_confidence_range CHECK (boundary_confidence IS NULL OR (boundary_confidence >= 0 AND boundary_confidence <= 1)),
    CONSTRAINT parsed_resume_snapshots_kind_not_blank CHECK (length(trim(snapshot_kind)) > 0),
    CONSTRAINT parsed_resume_snapshots_parser_version_not_blank CHECK (length(trim(parser_version)) > 0)
);

CREATE INDEX IF NOT EXISTS parsed_resume_snapshots_resume_created_idx
    ON parsed_resume_snapshots (resume_id, created_at DESC);

CREATE INDEX IF NOT EXISTS parsed_resume_snapshots_profile_created_idx
    ON parsed_resume_snapshots (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS parsed_resume_snapshots_parser_idx
    ON parsed_resume_snapshots (parser_version, model_name);

CREATE TABLE IF NOT EXISTS profile_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
    parsed_snapshot_id UUID REFERENCES parsed_resume_snapshots(id) ON DELETE SET NULL,
    fact_type fact_type NOT NULL,
    fact_value TEXT NOT NULL,
    normalized_value TEXT,
    source_kind source_kind NOT NULL DEFAULT 'resume_extracted',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_text TEXT,
    confidence NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
    verification_status verification_status NOT NULL DEFAULT 'unverified',
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT profile_facts_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT profile_facts_fact_value_not_blank CHECK (length(trim(fact_value)) > 0),
    CONSTRAINT profile_facts_verified_columns_consistent CHECK (
        (verification_status = 'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
        OR
        (verification_status <> 'verified' AND verified_by IS NULL AND verified_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_facts_dedup_uq
    ON profile_facts (profile_id, fact_type, COALESCE(normalized_value, fact_value), source_kind, COALESCE(source_reference, ''));

CREATE INDEX IF NOT EXISTS profile_facts_profile_fact_idx
    ON profile_facts (profile_id, fact_type, verification_status, created_at DESC);

CREATE INDEX IF NOT EXISTS profile_facts_resume_idx
    ON profile_facts (resume_id, created_at DESC)
    WHERE resume_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_profile_facts_updated_at ON profile_facts;
CREATE TRIGGER trg_profile_facts_updated_at
BEFORE UPDATE ON profile_facts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_profile_facts_verified_immutable ON profile_facts;
CREATE TRIGGER trg_profile_facts_verified_immutable
BEFORE UPDATE OR DELETE ON profile_facts
FOR EACH ROW
EXECUTE FUNCTION prevent_mutation_of_verified_profile_data();

CREATE TABLE IF NOT EXISTS skill_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
    experience_id UUID,
    parsed_snapshot_id UUID REFERENCES parsed_resume_snapshots(id) ON DELETE SET NULL,
    skill_name TEXT NOT NULL,
    normalized_skill_name TEXT NOT NULL,
    evidence_type evidence_type NOT NULL,
    evidence_source TEXT,
    evidence_text TEXT,
    source_kind source_kind NOT NULL DEFAULT 'resume_extracted',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
    verification_status verification_status NOT NULL DEFAULT 'unverified',
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT skill_evidence_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT skill_evidence_skill_name_not_blank CHECK (length(trim(skill_name)) > 0),
    CONSTRAINT skill_evidence_normalized_skill_name_not_blank CHECK (length(trim(normalized_skill_name)) > 0),
    CONSTRAINT skill_evidence_verified_columns_consistent CHECK (
        (verification_status = 'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
        OR
        (verification_status <> 'verified' AND verified_by IS NULL AND verified_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS skill_evidence_profile_skill_idx
    ON skill_evidence (profile_id, normalized_skill_name, verification_status, created_at DESC);

CREATE INDEX IF NOT EXISTS skill_evidence_resume_idx
    ON skill_evidence (resume_id, created_at DESC)
    WHERE resume_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS skill_evidence_experience_idx
    ON skill_evidence (experience_id, created_at DESC)
    WHERE experience_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_skill_evidence_updated_at ON skill_evidence;
CREATE TRIGGER trg_skill_evidence_updated_at
BEFORE UPDATE ON skill_evidence
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_skill_evidence_verified_immutable ON skill_evidence;
CREATE TRIGGER trg_skill_evidence_verified_immutable
BEFORE UPDATE OR DELETE ON skill_evidence
FOR EACH ROW
EXECUTE FUNCTION prevent_mutation_of_verified_profile_data();

CREATE TABLE IF NOT EXISTS profile_experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
    parsed_snapshot_id UUID REFERENCES parsed_resume_snapshots(id) ON DELETE SET NULL,
    role_id TEXT,
    company_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    location TEXT,
    function_area TEXT,
    industry TEXT,
    sub_industry TEXT,
    description TEXT,
    start_date DATE,
    end_date DATE,
    is_current_role BOOLEAN NOT NULL DEFAULT FALSE,
    source_kind source_kind NOT NULL DEFAULT 'resume_extracted',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_text TEXT,
    confidence NUMERIC(5,4) NOT NULL DEFAULT 0.5000,
    verification_status verification_status NOT NULL DEFAULT 'unverified',
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT profile_experiences_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT profile_experiences_company_name_not_blank CHECK (length(trim(company_name)) > 0),
    CONSTRAINT profile_experiences_job_title_not_blank CHECK (length(trim(job_title)) > 0),
    CONSTRAINT profile_experiences_date_order CHECK (
        start_date IS NULL OR end_date IS NULL OR start_date <= end_date
    ),
    CONSTRAINT profile_experiences_verified_columns_consistent CHECK (
        (verification_status = 'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
        OR
        (verification_status <> 'verified' AND verified_by IS NULL AND verified_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS profile_experiences_profile_dates_idx
    ON profile_experiences (profile_id, start_date DESC NULLS LAST, end_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS profile_experiences_profile_company_idx
    ON profile_experiences (profile_id, company_name, job_title);

CREATE INDEX IF NOT EXISTS profile_experiences_resume_idx
    ON profile_experiences (resume_id, created_at DESC)
    WHERE resume_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profile_experiences_role_lookup_idx
    ON profile_experiences (profile_id, function_area, industry, sub_industry, is_current_role);

ALTER TABLE skill_evidence
    ADD CONSTRAINT skill_evidence_experience_fk
    FOREIGN KEY (experience_id)
    REFERENCES profile_experiences (id)
    ON DELETE SET NULL;

DROP TRIGGER IF EXISTS trg_profile_experiences_updated_at ON profile_experiences;
CREATE TRIGGER trg_profile_experiences_updated_at
BEFORE UPDATE ON profile_experiences
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_profile_experiences_verified_immutable ON profile_experiences;
CREATE TRIGGER trg_profile_experiences_verified_immutable
BEFORE UPDATE OR DELETE ON profile_experiences
FOR EACH ROW
EXECUTE FUNCTION prevent_mutation_of_verified_profile_data();

CREATE TABLE IF NOT EXISTS search_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    job_id UUID,
    application_id UUID,
    artifact_kind artifact_kind NOT NULL,
    query_text TEXT,
    query_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    semantic_query TEXT,
    result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    explanation_text TEXT,
    score NUMERIC(10,6),
    model_name TEXT,
    prompt_version TEXT,
    source_kind source_kind NOT NULL DEFAULT 'system_generated',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT search_artifacts_score_range CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
    CONSTRAINT search_artifacts_kind_query_consistency CHECK (
        artifact_kind <> 'search_query' OR query_text IS NOT NULL OR semantic_query IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS search_artifacts_profile_created_idx
    ON search_artifacts (profile_id, created_at DESC)
    WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS search_artifacts_job_created_idx
    ON search_artifacts (job_id, created_at DESC)
    WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS search_artifacts_application_created_idx
    ON search_artifacts (application_id, created_at DESC)
    WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS search_artifacts_kind_created_idx
    ON search_artifacts (artifact_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_job_ref TEXT,
    title TEXT NOT NULL,
    company_name TEXT,
    location TEXT,
    country TEXT,
    function_area TEXT,
    industry TEXT,
    sub_industry TEXT,
    employment_type TEXT,
    seniority TEXT,
    status job_status NOT NULL DEFAULT 'draft',
    description TEXT,
    requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
    required_skills TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    preferred_skills TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    compensation JSONB NOT NULL DEFAULT '{}'::jsonb,
    approval_requested_at TIMESTAMPTZ,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    source_kind source_kind NOT NULL DEFAULT 'recruiter_entered',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT jobs_title_not_blank CHECK (length(trim(title)) > 0),
    CONSTRAINT jobs_external_job_ref_not_blank CHECK (external_job_ref IS NULL OR length(trim(external_job_ref)) > 0),
    CONSTRAINT jobs_required_skills_are_not_null CHECK (required_skills IS NOT NULL),
    CONSTRAINT jobs_preferred_skills_are_not_null CHECK (preferred_skills IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_external_job_ref_uq
    ON jobs (external_job_ref)
    WHERE external_job_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_status_created_idx
    ON jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_function_industry_idx
    ON jobs (function_area, industry, status);

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    matched_search_artifact_id UUID REFERENCES search_artifacts(id) ON DELETE SET NULL,
    status application_status NOT NULL DEFAULT 'applied',
    pipeline_stage TEXT,
    source_kind source_kind NOT NULL DEFAULT 'manual_review',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    applied_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT applications_pair_uq UNIQUE (profile_id, job_id)
);

CREATE INDEX IF NOT EXISTS applications_job_status_idx
    ON applications (job_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS applications_profile_status_idx
    ON applications (profile_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS applications_matched_search_idx
    ON applications (matched_search_artifact_id)
    WHERE matched_search_artifact_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at
BEFORE UPDATE ON applications
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE search_artifacts
    ADD CONSTRAINT search_artifacts_job_fk
    FOREIGN KEY (job_id)
    REFERENCES jobs (id)
    ON DELETE SET NULL;

ALTER TABLE search_artifacts
    ADD CONSTRAINT search_artifacts_application_fk
    FOREIGN KEY (application_id)
    REFERENCES applications (id)
    ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    actor_role TEXT,
    action activity_action NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_kind source_kind NOT NULL DEFAULT 'system_generated',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    correlation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT activity_logs_summary_not_blank CHECK (length(trim(summary)) > 0),
    CONSTRAINT activity_logs_entity_type_not_blank CHECK (length(trim(entity_type)) > 0),
    CONSTRAINT activity_logs_entity_id_not_blank CHECK (length(trim(entity_id)) > 0)
);

CREATE INDEX IF NOT EXISTS activity_logs_entity_idx
    ON activity_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_logs_actor_idx
    ON activity_logs (actor_user_id, created_at DESC)
    WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_logs_profile_idx
    ON activity_logs (profile_id, created_at DESC)
    WHERE profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    actor_role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    boundary_name TEXT,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    before_state JSONB,
    after_state JSONB,
    diff JSONB,
    reason TEXT,
    request_id UUID,
    correlation_id UUID,
    ip_address INET,
    user_agent TEXT,
    risk_level audit_risk_level NOT NULL DEFAULT 'low',
    source_kind source_kind NOT NULL DEFAULT 'system_generated',
    source_reference TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT audit_logs_action_not_blank CHECK (length(trim(action)) > 0),
    CONSTRAINT audit_logs_entity_type_not_blank CHECK (length(trim(entity_type)) > 0),
    CONSTRAINT audit_logs_entity_id_not_blank CHECK (length(trim(entity_id)) > 0)
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
    ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
    ON audit_logs (actor_user_id, created_at DESC)
    WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_boundary_idx
    ON audit_logs (boundary_name, created_at DESC)
    WHERE boundary_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_risk_idx
    ON audit_logs (risk_level, created_at DESC);

DROP TRIGGER IF EXISTS trg_activity_logs_append_only ON activity_logs;
CREATE TRIGGER trg_activity_logs_append_only
BEFORE UPDATE OR DELETE ON activity_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_append_only_row_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_append_only_row_mutation();

CREATE OR REPLACE VIEW candidates AS
SELECT * FROM profiles;

CREATE OR REPLACE VIEW candidate_profile_facts AS
SELECT * FROM profile_facts;

CREATE OR REPLACE VIEW candidate_skill_evidence AS
SELECT * FROM skill_evidence;

CREATE OR REPLACE VIEW candidate_experiences AS
SELECT * FROM profile_experiences;
