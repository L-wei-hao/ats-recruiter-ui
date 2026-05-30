from __future__ import annotations

from datetime import date

from ats_search import (
    ChunkScope,
    Candidate,
    CandidateExperience,
    CandidateProfileFact,
    ExplanationRequest,
    HybridSearchEngine,
    SearchFilters,
    SearchQuery,
    ResumeChunk,
    chunk_experiences,
    generate_explanation,
)


def test_chunk_experiences_keeps_roles_bounded():
    experiences = [
        CandidateExperience(
            id="exp-1",
            candidate_id="cand-1",
            company_name="Bank A",
            job_title="Product Manager",
            start_date=date(2021, 1, 1),
            end_date=date(2023, 1, 1),
            industry="Financial Services",
            function_area="Product Management",
            description="Led payments roadmap. Worked with compliance and analytics.",
        ),
        CandidateExperience(
            id="exp-2",
            candidate_id="cand-1",
            company_name="Tech B",
            job_title="Engineering Manager",
            start_date=date(2018, 1, 1),
            end_date=date(2020, 12, 31),
            industry="Technology",
            function_area="Engineering",
            description="Managed platform team. Built APIs and search infrastructure.",
        ),
    ]

    chunks = chunk_experiences(
        resume_id="resume-1",
        experiences=experiences,
        summary_text="Delivered cross-functional outcomes.",
        skill_texts=["Python", "SQL"],
        fallback_text="Full resume raw text.",
    )

    assert [chunk.experience_id for chunk in chunks] == ["exp-1", "exp-2", None, None]
    assert all(chunk.chunk_scope != ChunkScope.FALLBACK or chunk.experience_id is None for chunk in chunks)
    assert chunks[0].content.startswith("Bank A | Product Manager")
    assert chunks[1].content.startswith("Tech B | Engineering Manager")
    assert chunks[-1].chunk_scope == ChunkScope.FALLBACK


def test_hybrid_search_groups_evidence_by_candidate_and_deduplicates_skills():
    candidate = Candidate(
        id="cand-1",
        full_name="Wei Hao",
        location="Singapore",
        country="Singapore",
        function_area="Product Management",
        industry="Financial Services",
        years_of_experience=8,
        work_authorization="Singapore Citizen",
    )

    chunks = [
        ResumeChunk(
            id="chunk-1",
            resume_id="resume-1",
            candidate_id="cand-1",
            experience_id="exp-1",
            chunk_index=0,
            chunk_type="work_role",
            chunk_scope=ChunkScope.ROLE_BOUNDED,
            content="Built KYC onboarding flows in Python and PostgreSQL.",
            function_area="Product Management",
            industry="Financial Services",
            skills=["Python", "PostgreSQL", "KYC"],
            years_of_experience=3,
            recency_rank=0.9,
            verified_evidence_quality=0.8,
            embedding=[0.9, 0.1, 0.0],
            full_text_terms={"python", "postgreSQL", "kyc"},
        ),
        ResumeChunk(
            id="chunk-2",
            resume_id="resume-1",
            candidate_id="cand-1",
            experience_id="exp-1",
            chunk_index=1,
            chunk_type="work_role",
            chunk_scope=ChunkScope.ROLE_BOUNDED,
            content="Repeated Python and Python and Python across the description.",
            function_area="Product Management",
            industry="Financial Services",
            skills=["Python"],
            years_of_experience=3,
            recency_rank=0.9,
            verified_evidence_quality=0.7,
            embedding=[0.85, 0.15, 0.0],
            full_text_terms={"python"},
        ),
    ]

    engine = HybridSearchEngine(candidates=[candidate], chunks=chunks)
    results = engine.search(
        SearchQuery(
            text="python kyc product",
            filters=SearchFilters(function_areas={"Product Management"}, industries={"Financial Services"}),
            required_skills={"Python", "KYC"},
            preferred_skills={"PostgreSQL"},
        )
    )

    assert len(results) == 1
    result = results[0]
    assert result.candidate.id == "cand-1"
    assert result.coverage.required_skill_coverage == 1.0
    assert result.coverage.required_skill_matches == {"Python", "KYC"}
    assert result.evidence["chunk-2"].keyword_score < result.evidence["chunk-1"].keyword_score
    assert result.final_score > 0


def test_search_filters_out_non_matching_candidates():
    candidates = [
        Candidate(
            id="cand-1",
            full_name="Alice",
            location="Singapore",
            country="Singapore",
            function_area="Engineering",
            industry="Technology",
            years_of_experience=5,
            work_authorization="Singapore Citizen",
        ),
        Candidate(
            id="cand-2",
            full_name="Bob",
            location="Kuala Lumpur",
            country="Malaysia",
            function_area="Sales",
            industry="Retail",
            years_of_experience=7,
            work_authorization="Requires sponsorship",
        ),
    ]

    chunks = [
        ResumeChunk(
            id="chunk-1",
            resume_id="r1",
            candidate_id="cand-1",
            experience_id="exp-1",
            chunk_index=0,
            chunk_type="work_role",
            chunk_scope=ChunkScope.ROLE_BOUNDED,
            content="Built Python services for payments.",
            function_area="Engineering",
            industry="Technology",
            skills=["Python"],
            years_of_experience=5,
            recency_rank=0.9,
            verified_evidence_quality=0.9,
            embedding=[0.8, 0.2],
            full_text_terms={"python", "payments"},
        ),
        ResumeChunk(
            id="chunk-2",
            resume_id="r2",
            candidate_id="cand-2",
            experience_id="exp-2",
            chunk_index=0,
            chunk_type="work_role",
            chunk_scope=ChunkScope.ROLE_BOUNDED,
            content="Managed retail account portfolios.",
            function_area="Sales",
            industry="Retail",
            skills=["Account Management"],
            years_of_experience=7,
            recency_rank=0.8,
            verified_evidence_quality=0.7,
            embedding=[0.2, 0.8],
            full_text_terms={"retail", "account"},
        ),
    ]

    engine = HybridSearchEngine(candidates=candidates, chunks=chunks)
    results = engine.search(
        SearchQuery(
            text="python payments",
            filters=SearchFilters(function_areas={"Engineering"}, locations={"Singapore"}, minimum_years=3),
        )
    )

    assert [result.candidate.id for result in results] == ["cand-1"]


def test_explanation_uses_selected_evidence_and_marks_unverified_facts():
    candidate = Candidate(
        id="cand-1",
        full_name="Wei Hao",
        location="Singapore",
        country="Singapore",
        function_area="Product Management",
        industry="Financial Services",
        years_of_experience=8,
        work_authorization="Singapore Citizen",
    )
    chunk = ResumeChunk(
        id="chunk-1",
        resume_id="r1",
        candidate_id="cand-1",
        experience_id="exp-1",
        chunk_index=0,
        chunk_type="work_role",
        chunk_scope=ChunkScope.ROLE_BOUNDED,
        content="Built KYC onboarding flows.",
        function_area="Product Management",
        industry="Financial Services",
        skills=["KYC"],
        years_of_experience=3,
        recency_rank=1.0,
        verified_evidence_quality=0.9,
        embedding=[0.9, 0.1],
        full_text_terms={"kyc", "onboarding"},
    )
    fact = CandidateProfileFact(
        id="fact-1",
        candidate_id="cand-1",
        fact_type="certification",
        fact_value="CAMS",
        source_type="ai_extracted",
        source_id="resume-1",
        evidence_text="Likely certified in AML",
        confidence=0.6,
        is_verified=False,
    )
    result = {
        "candidate": candidate,
        "selected_chunks": [chunk],
        "selected_facts": [fact],
        "score_components": {"semantic": 0.8, "coverage": 1.0},
        "final_score": 0.91,
    }

    explanation = generate_explanation(
        ExplanationRequest(query_text="KYC product manager", result=result)
    )

    assert explanation.candidate_id == "cand-1"
    assert "Built KYC onboarding flows." in explanation.evidence_summary
    assert "Unverified fact" in explanation.narrative
    assert explanation.score_components["semantic"] == 0.8


def test_candidate_keyword_stuffing_does_not_outweigh_unique_skill_coverage():
    candidate = Candidate(
        id="cand-1",
        full_name="Wei Hao",
        location="Singapore",
        country="Singapore",
        function_area="Engineering",
        industry="Technology",
        years_of_experience=6,
        work_authorization="Singapore Citizen",
    )
    chunks = [
        ResumeChunk(
            id="chunk-1",
            resume_id="r1",
            candidate_id="cand-1",
            experience_id="exp-1",
            chunk_index=0,
            chunk_type="work_role",
            chunk_scope=ChunkScope.ROLE_BOUNDED,
            content="Python Python Python Python Python",
            function_area="Engineering",
            industry="Technology",
            skills=["Python"],
            years_of_experience=6,
            recency_rank=0.5,
            verified_evidence_quality=0.5,
            embedding=[0.95, 0.05],
            full_text_terms={"python"},
        ),
        ResumeChunk(
            id="chunk-2",
            resume_id="r1",
            candidate_id="cand-1",
            experience_id="exp-2",
            chunk_index=1,
            chunk_type="project",
            chunk_scope=ChunkScope.ROLE_BOUNDED,
            content="Built reliable data pipelines with SQL and Python.",
            function_area="Engineering",
            industry="Technology",
            skills=["Python", "SQL"],
            years_of_experience=6,
            recency_rank=0.8,
            verified_evidence_quality=0.9,
            embedding=[0.8, 0.2],
            full_text_terms={"python", "sql", "data"},
        ),
    ]
    engine = HybridSearchEngine(candidates=[candidate], chunks=chunks)
    results = engine.search(
        SearchQuery(
            text="python sql",
            required_skills={"Python", "SQL"},
        )
    )

    assert len(results) == 1
    assert results[0].coverage.required_skill_matches == {"Python", "SQL"}
    assert results[0].final_score > results[0].evidence["chunk-1"].raw_similarity
