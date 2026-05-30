-- Search and matching schema for semantic retrieval, hybrid search, and explanations.
-- PostgreSQL remains the source of truth; pgvector stores chunk embeddings.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    function_area TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    years_of_experience NUMERIC(5,2) NOT NULL DEFAULT 0,
    work_authorization TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    dedupe_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT candidates_full_name_not_empty CHECK (length(trim(full_name)) > 0),
    CONSTRAINT candidates_years_nonnegative CHECK (years_of_experience >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS candidates_dedupe_key_uq
    ON candidates (dedupe_key)
    WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS candidates_function_area_idx
    ON candidates (function_area);

CREATE INDEX IF NOT EXISTS candidates_industry_idx
    ON candidates (industry);

CREATE INDEX IF NOT EXISTS candidates_location_idx
    ON candidates (location, country);

CREATE TABLE IF NOT EXISTS candidate_experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    resume_id UUID,
    company_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    location TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    sub_industry TEXT NOT NULL DEFAULT '',
    function_area TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'resume',
    source_id TEXT,
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT candidate_experiences_dates_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS candidate_experiences_candidate_idx
    ON candidate_experiences (candidate_id, start_date DESC);

CREATE INDEX IF NOT EXISTS candidate_experiences_function_area_idx
    ON candidate_experiences (function_area, industry);

CREATE TABLE IF NOT EXISTS candidate_profile_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    fact_type TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    evidence_text TEXT NOT NULL DEFAULT '',
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS candidate_profile_facts_candidate_idx
    ON candidate_profile_facts (candidate_id, fact_type);

CREATE INDEX IF NOT EXISTS candidate_profile_facts_verified_idx
    ON candidate_profile_facts (candidate_id, is_verified, fact_type);

CREATE TABLE IF NOT EXISTS candidate_skill_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    evidence_type TEXT NOT NULL,
    evidence_source TEXT NOT NULL,
    resume_chunk_id UUID,
    evidence_text TEXT NOT NULL DEFAULT '',
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500,
    is_human_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS candidate_skill_evidence_candidate_idx
    ON candidate_skill_evidence (candidate_id, skill_name);

CREATE INDEX IF NOT EXISTS candidate_skill_evidence_verified_idx
    ON candidate_skill_evidence (candidate_id, is_human_verified, skill_name);

CREATE TABLE IF NOT EXISTS resume_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id UUID NOT NULL,
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    experience_id UUID REFERENCES candidate_experiences(id) ON DELETE SET NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    chunk_type TEXT NOT NULL,
    chunk_scope TEXT NOT NULL,
    content TEXT NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
    function_area TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    years_of_experience NUMERIC(5,2) NOT NULL DEFAULT 0,
    recency_rank NUMERIC(4,3) NOT NULL DEFAULT 0,
    verified_evidence_quality NUMERIC(4,3) NOT NULL DEFAULT 0,
    embedding vector(1536),
    embedding_model TEXT,
    embedding_dimensions INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT resume_chunks_index_nonnegative CHECK (chunk_index >= 0),
    CONSTRAINT resume_chunks_years_nonnegative CHECK (years_of_experience >= 0),
    CONSTRAINT resume_chunks_recency_range CHECK (recency_rank BETWEEN 0 AND 1),
    CONSTRAINT resume_chunks_verified_quality_range CHECK (verified_evidence_quality BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS resume_chunks_candidate_idx
    ON resume_chunks (candidate_id, chunk_scope, chunk_index);

CREATE INDEX IF NOT EXISTS resume_chunks_experience_idx
    ON resume_chunks (experience_id, chunk_index);

CREATE INDEX IF NOT EXISTS resume_chunks_tsv_idx
    ON resume_chunks USING GIN (content_tsv);

CREATE INDEX IF NOT EXISTS resume_chunks_metadata_idx
    ON resume_chunks USING GIN (metadata);

CREATE INDEX IF NOT EXISTS resume_chunks_skills_idx
    ON resume_chunks USING GIN (skills);

CREATE INDEX IF NOT EXISTS resume_chunks_function_area_idx
    ON resume_chunks (function_area, industry);

CREATE INDEX IF NOT EXISTS resume_chunks_embedding_hnsw_idx
    ON resume_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS resume_chunks_embedding_lookup_idx
    ON resume_chunks (candidate_id, embedding_model, embedding_dimensions);

CREATE TABLE IF NOT EXISTS match_explanations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    search_id UUID,
    prompt_version TEXT NOT NULL DEFAULT 'v1',
    explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS match_explanations_candidate_idx
    ON match_explanations (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS match_explanations_search_idx
    ON match_explanations (search_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_search_tables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_candidates_updated_at') THEN
        DROP TRIGGER trg_candidates_updated_at ON candidates;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_candidate_experiences_updated_at') THEN
        DROP TRIGGER trg_candidate_experiences_updated_at ON candidate_experiences;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_candidate_profile_facts_updated_at') THEN
        DROP TRIGGER trg_candidate_profile_facts_updated_at ON candidate_profile_facts;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_candidate_skill_evidence_updated_at') THEN
        DROP TRIGGER trg_candidate_skill_evidence_updated_at ON candidate_skill_evidence;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_resume_chunks_updated_at') THEN
        DROP TRIGGER trg_resume_chunks_updated_at ON resume_chunks;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_match_explanations_updated_at') THEN
        DROP TRIGGER trg_match_explanations_updated_at ON match_explanations;
    END IF;
END $$;

CREATE TRIGGER trg_candidates_updated_at
BEFORE UPDATE ON candidates
FOR EACH ROW EXECUTE FUNCTION set_search_tables_updated_at();

CREATE TRIGGER trg_candidate_experiences_updated_at
BEFORE UPDATE ON candidate_experiences
FOR EACH ROW EXECUTE FUNCTION set_search_tables_updated_at();

CREATE TRIGGER trg_candidate_profile_facts_updated_at
BEFORE UPDATE ON candidate_profile_facts
FOR EACH ROW EXECUTE FUNCTION set_search_tables_updated_at();

CREATE TRIGGER trg_candidate_skill_evidence_updated_at
BEFORE UPDATE ON candidate_skill_evidence
FOR EACH ROW EXECUTE FUNCTION set_search_tables_updated_at();

CREATE TRIGGER trg_resume_chunks_updated_at
BEFORE UPDATE ON resume_chunks
FOR EACH ROW EXECUTE FUNCTION set_search_tables_updated_at();

CREATE TRIGGER trg_match_explanations_updated_at
BEFORE UPDATE ON match_explanations
FOR EACH ROW EXECUTE FUNCTION set_search_tables_updated_at();
