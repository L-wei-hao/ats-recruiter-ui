from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from math import sqrt
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple
import re

__all__ = [
    "ChunkScope",
    "Candidate",
    "CandidateExperience",
    "CandidateProfileFact",
    "CoverageSummary",
    "Explanation",
    "ExplanationRequest",
    "HybridSearchEngine",
    "ResumeChunk",
    "SearchEvidence",
    "SearchFilters",
    "SearchQuery",
    "SearchResult",
    "chunk_experiences",
    "generate_explanation",
]

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)?")


class ChunkScope(str, Enum):
    ROLE_BOUNDED = "role_bounded"
    SUMMARY = "summary"
    SKILLS = "skills"
    FALLBACK = "fallback"


@dataclass(frozen=True)
class Candidate:
    id: str
    full_name: str
    location: str
    country: str
    function_area: str
    industry: str
    years_of_experience: float
    work_authorization: str


@dataclass(frozen=True)
class CandidateExperience:
    id: str
    candidate_id: str
    company_name: str
    job_title: str
    start_date: date
    end_date: Optional[date]
    industry: str
    function_area: str
    description: str


@dataclass(frozen=True)
class CandidateProfileFact:
    id: str
    candidate_id: str
    fact_type: str
    fact_value: str
    source_type: str
    source_id: str
    evidence_text: str
    confidence: float
    is_verified: bool = False


@dataclass(frozen=True)
class ResumeChunk:
    id: str
    resume_id: str
    candidate_id: str
    experience_id: Optional[str]
    chunk_index: int
    chunk_type: str
    chunk_scope: ChunkScope
    content: str
    function_area: str
    industry: str
    skills: Sequence[str]
    years_of_experience: float
    recency_rank: float
    verified_evidence_quality: float
    embedding: Sequence[float] = field(default_factory=tuple)
    full_text_terms: Set[str] = field(default_factory=set)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SearchFilters:
    locations: Set[str] = field(default_factory=set)
    countries: Set[str] = field(default_factory=set)
    function_areas: Set[str] = field(default_factory=set)
    industries: Set[str] = field(default_factory=set)
    work_authorizations: Set[str] = field(default_factory=set)
    minimum_years: Optional[float] = None
    verified_only: bool = False


@dataclass(frozen=True)
class SearchQuery:
    text: str
    filters: SearchFilters = field(default_factory=SearchFilters)
    required_skills: Set[str] = field(default_factory=set)
    preferred_skills: Set[str] = field(default_factory=set)
    top_k: int = 10


@dataclass(frozen=True)
class SearchEvidence:
    chunk_id: str
    raw_similarity: float
    semantic_score: float
    keyword_score: float
    skill_score: float
    verified_quality: float
    recency_score: float


@dataclass(frozen=True)
class CoverageSummary:
    required_skill_matches: Set[str]
    required_skill_coverage: float
    preferred_skill_matches: Set[str]
    preferred_skill_coverage: float


@dataclass(frozen=True)
class SearchResult:
    candidate: Candidate
    evidence: Dict[str, SearchEvidence]
    coverage: CoverageSummary
    final_score: float
    score_components: Dict[str, float]
    selected_chunks: List[ResumeChunk]


@dataclass(frozen=True)
class ExplanationRequest:
    query_text: str
    result: Mapping[str, Any]


@dataclass(frozen=True)
class Explanation:
    candidate_id: str
    evidence_summary: str
    narrative: str
    score_components: Dict[str, float]


class HybridSearchEngine:
    def __init__(self, candidates: Iterable[Candidate], chunks: Iterable[ResumeChunk]):
        self._candidates = {candidate.id: candidate for candidate in candidates}
        self._chunks_by_candidate: Dict[str, List[ResumeChunk]] = {}
        for chunk in chunks:
            self._chunks_by_candidate.setdefault(chunk.candidate_id, []).append(chunk)
        for chunk_list in self._chunks_by_candidate.values():
            chunk_list.sort(key=lambda c: (c.chunk_index, c.id))

    def search(self, query: SearchQuery) -> List[SearchResult]:
        query_tokens = _tokens(query.text)
        query_skill_tokens = {_normalize(skill) for skill in query.required_skills}
        preferred_skill_tokens = {_normalize(skill) for skill in query.preferred_skills}

        results: List[SearchResult] = []
        for candidate in self._candidates.values():
            if not self._candidate_passes_filters(candidate, query.filters):
                continue

            chunks = self._chunks_by_candidate.get(candidate.id, [])
            if not chunks and (query.text.strip() or query.required_skills or query.preferred_skills):
                continue

            evidence = self._score_evidence(query.text, query_tokens, query_skill_tokens, preferred_skill_tokens, chunks)
            if not evidence and (query.text.strip() or query.required_skills or query.preferred_skills):
                continue

            coverage = self._coverage_for_candidate(query, chunks)
            score_components = self._score_candidate(candidate, query, chunks, evidence, coverage)
            final_score = sum(score_components.values())

            selected_chunks = [chunk for chunk in chunks if chunk.id in evidence]
            selected_chunks.sort(
                key=lambda chunk: (
                    evidence[chunk.id].raw_similarity,
                    evidence[chunk.id].keyword_score,
                    chunk.recency_rank,
                ),
                reverse=True,
            )
            results.append(
                SearchResult(
                    candidate=candidate,
                    evidence=evidence,
                    coverage=coverage,
                    final_score=final_score,
                    score_components=score_components,
                    selected_chunks=selected_chunks,
                )
            )

        results.sort(
            key=lambda result: (
                result.final_score,
                result.coverage.required_skill_coverage,
                result.score_components.get("semantic", 0.0),
                result.score_components.get("coverage", 0.0),
            ),
            reverse=True,
        )
        return results[: query.top_k]

    def _candidate_passes_filters(self, candidate: Candidate, filters: SearchFilters) -> bool:
        if filters.locations and _normalize(candidate.location) not in {_normalize(v) for v in filters.locations}:
            return False
        if filters.countries and _normalize(candidate.country) not in {_normalize(v) for v in filters.countries}:
            return False
        if filters.function_areas and _normalize(candidate.function_area) not in {_normalize(v) for v in filters.function_areas}:
            return False
        if filters.industries and _normalize(candidate.industry) not in {_normalize(v) for v in filters.industries}:
            return False
        if filters.work_authorizations and _normalize(candidate.work_authorization) not in {_normalize(v) for v in filters.work_authorizations}:
            return False
        if filters.minimum_years is not None and candidate.years_of_experience < filters.minimum_years:
            return False
        return True

    def _score_evidence(
        self,
        query_text: str,
        query_tokens: Set[str],
        required_skill_tokens: Set[str],
        preferred_skill_tokens: Set[str],
        chunks: Sequence[ResumeChunk],
    ) -> Dict[str, SearchEvidence]:
        evidence: Dict[str, SearchEvidence] = {}
        for chunk in chunks:
            chunk_tokens = _tokens(chunk.content) | { _normalize(term) for term in chunk.full_text_terms }
            skill_tokens = {_normalize(skill) for skill in chunk.skills}

            semantic_score = _semantic_similarity(query_text, chunk.embedding, chunk.content)
            keyword_score = _keyword_overlap(query_tokens, chunk_tokens)
            skill_overlap = len(required_skill_tokens & (skill_tokens | chunk_tokens))
            preferred_overlap = len(preferred_skill_tokens & (skill_tokens | chunk_tokens))
            skill_score = 0.0
            if required_skill_tokens:
                skill_score = skill_overlap / len(required_skill_tokens)
            elif preferred_skill_tokens:
                skill_score = preferred_overlap / len(preferred_skill_tokens)

            raw_similarity = (
                0.45 * semantic_score
                + 0.25 * keyword_score
                + 0.2 * skill_score
                + 0.1 * min(chunk.verified_evidence_quality, 1.0)
            )

            if raw_similarity <= 0 and not query_text.strip():
                continue
            if raw_similarity <= 0 and not keyword_score and not semantic_score and not skill_score:
                continue

            evidence[chunk.id] = SearchEvidence(
                chunk_id=chunk.id,
                raw_similarity=round(raw_similarity, 6),
                semantic_score=round(semantic_score, 6),
                keyword_score=round(keyword_score, 6),
                skill_score=round(skill_score, 6),
                verified_quality=round(min(chunk.verified_evidence_quality, 1.0), 6),
                recency_score=round(min(max(chunk.recency_rank, 0.0), 1.0), 6),
            )

        return evidence

    def _coverage_for_candidate(self, query: SearchQuery, chunks: Sequence[ResumeChunk]) -> CoverageSummary:
        chunk_skill_tokens: Set[str] = set()
        for chunk in chunks:
            chunk_skill_tokens.update({_normalize(skill) for skill in chunk.skills})
            chunk_skill_tokens.update({_normalize(term) for term in chunk.full_text_terms})
            chunk_skill_tokens.update(_tokens(chunk.content))

        required_matches = {_normalize(skill) for skill in query.required_skills} & chunk_skill_tokens
        preferred_matches = {_normalize(skill) for skill in query.preferred_skills} & chunk_skill_tokens

        required_coverage = 1.0 if not query.required_skills else len(required_matches) / len(query.required_skills)
        preferred_coverage = 1.0 if not query.preferred_skills else len(preferred_matches) / len(query.preferred_skills)
        return CoverageSummary(
            required_skill_matches={skill for skill in query.required_skills if _normalize(skill) in required_matches},
            required_skill_coverage=round(required_coverage, 6),
            preferred_skill_matches={skill for skill in query.preferred_skills if _normalize(skill) in preferred_matches},
            preferred_skill_coverage=round(preferred_coverage, 6),
        )

    def _score_candidate(
        self,
        candidate: Candidate,
        query: SearchQuery,
        chunks: Sequence[ResumeChunk],
        evidence: Dict[str, SearchEvidence],
        coverage: CoverageSummary,
    ) -> Dict[str, float]:
        if evidence:
            semantic = max(item.semantic_score for item in evidence.values())
            keyword = max(item.keyword_score for item in evidence.values())
            evidence_quality = sum(item.verified_quality for item in evidence.values()) / len(evidence)
            recency = sum(item.recency_score for item in evidence.values()) / len(evidence)
            evidence_coverage = sum(item.skill_score for item in evidence.values()) / len(evidence)
        else:
            semantic = keyword = evidence_quality = recency = evidence_coverage = 0.0

        function_area_score = self._attribute_match_score(candidate.function_area, query.filters.function_areas)
        industry_score = self._attribute_match_score(candidate.industry, query.filters.industries)
        location_score = 1.0 if not query.filters.locations else self._attribute_match_score(candidate.location, query.filters.locations)
        eligibility_score = 1.0 if not query.filters.work_authorizations else self._attribute_match_score(candidate.work_authorization, query.filters.work_authorizations)
        years_score = self._years_score(candidate.years_of_experience, query.filters.minimum_years)

        candidate_semantic = 0.35 * semantic + 0.15 * keyword
        candidate_coverage = 0.35 * coverage.required_skill_coverage + 0.15 * coverage.preferred_skill_coverage + 0.1 * evidence_coverage
        candidate_domain = 0.12 * function_area_score + 0.08 * industry_score
        candidate_trust = 0.1 * evidence_quality + 0.05 * recency
        candidate_fitness = 0.04 * location_score + 0.03 * eligibility_score + 0.03 * years_score

        return {
            "semantic": round(candidate_semantic, 6),
            "coverage": round(candidate_coverage, 6),
            "domain": round(candidate_domain, 6),
            "trust": round(candidate_trust, 6),
            "fitness": round(candidate_fitness, 6),
        }

    @staticmethod
    def _attribute_match_score(value: str, allowed: Set[str]) -> float:
        if not allowed:
            return 1.0
        normalized = _normalize(value)
        return 1.0 if normalized in {_normalize(item) for item in allowed} else 0.0

    @staticmethod
    def _years_score(years_of_experience: float, minimum_years: Optional[float]) -> float:
        if minimum_years is None or minimum_years <= 0:
            return min(max(years_of_experience / 20.0, 0.0), 1.0)
        if years_of_experience >= minimum_years:
            return 1.0
        return max(years_of_experience / minimum_years, 0.0)


def chunk_experiences(
    *,
    resume_id: str,
    experiences: Sequence[CandidateExperience],
    summary_text: str,
    skill_texts: Sequence[str],
    fallback_text: str,
) -> List[ResumeChunk]:
    chunks: List[ResumeChunk] = []
    chunk_index = 0

    for experience in experiences:
        content = " | ".join(
            [
                experience.company_name,
                experience.job_title,
                f"{experience.start_date.isoformat()} - {experience.end_date.isoformat() if experience.end_date else 'Present'}",
                experience.industry,
                experience.function_area,
                experience.description.strip(),
            ]
        )
        chunks.append(
            ResumeChunk(
                id=f"{resume_id}-exp-{experience.id}",
                resume_id=resume_id,
                candidate_id=experience.candidate_id,
                experience_id=experience.id,
                chunk_index=chunk_index,
                chunk_type="work_role",
                chunk_scope=ChunkScope.ROLE_BOUNDED,
                content=content,
                function_area=experience.function_area,
                industry=experience.industry,
                skills=tuple(_normalize(skill) for skill in _dedupe_preserve_order(skill_texts)),
                years_of_experience=_experience_years(experience.start_date, experience.end_date),
                recency_rank=_recency_rank(experience.end_date),
                verified_evidence_quality=0.85,
                full_text_terms=_tokens(content),
                metadata={"company_name": experience.company_name, "job_title": experience.job_title},
            )
        )
        chunk_index += 1

    if summary_text.strip():
        chunks.append(
            ResumeChunk(
                id=f"{resume_id}-summary",
                resume_id=resume_id,
                candidate_id=experiences[0].candidate_id if experiences else resume_id,
                experience_id=None,
                chunk_index=chunk_index,
                chunk_type="summary",
                chunk_scope=ChunkScope.SUMMARY,
                content=summary_text.strip(),
                function_area=experiences[0].function_area if experiences else "",
                industry=experiences[0].industry if experiences else "",
                skills=tuple(_normalize(skill) for skill in _dedupe_preserve_order(skill_texts)),
                years_of_experience=0.0,
                recency_rank=0.4,
                verified_evidence_quality=0.7,
                full_text_terms=_tokens(summary_text),
                metadata={"source": "summary"},
            )
        )
        chunk_index += 1

    if fallback_text.strip():
        chunks.append(
            ResumeChunk(
                id=f"{resume_id}-fallback",
                resume_id=resume_id,
                candidate_id=experiences[0].candidate_id if experiences else resume_id,
                experience_id=None,
                chunk_index=chunk_index,
                chunk_type="fallback",
                chunk_scope=ChunkScope.FALLBACK,
                content=fallback_text.strip(),
                function_area=experiences[0].function_area if experiences else "",
                industry=experiences[0].industry if experiences else "",
                skills=tuple(),
                years_of_experience=0.0,
                recency_rank=0.1,
                verified_evidence_quality=0.3,
                full_text_terms=_tokens(fallback_text),
                metadata={"source": "fallback"},
            )
        )

    return chunks


def generate_explanation(request: ExplanationRequest) -> Explanation:
    result = request.result
    candidate = result.get("candidate")
    selected_chunks = list(result.get("selected_chunks", []))
    selected_facts = list(result.get("selected_facts", []))
    score_components = dict(result.get("score_components", {}))

    evidence_lines: List[str] = []
    for chunk in selected_chunks:
        content = getattr(chunk, "content", "")
        if content:
            evidence_lines.append(content)

    if not evidence_lines:
        evidence_lines.append("No evidence snippets were selected.")

    fact_lines: List[str] = []
    for fact in selected_facts:
        fact_value = getattr(fact, "fact_value", "")
        evidence_text = getattr(fact, "evidence_text", "")
        verified = bool(getattr(fact, "is_verified", False))
        prefix = "Verified fact" if verified else "Unverified fact"
        fact_lines.append(f"{prefix}: {fact_value} — {evidence_text}".strip())

    if not fact_lines:
        fact_lines.append("No selected facts.")

    candidate_name = getattr(candidate, "full_name", getattr(candidate, "id", "candidate"))
    candidate_id = getattr(candidate, "id", str(result.get("candidate_id", "unknown")))
    final_score = result.get("final_score")
    narrative = (
        f"Candidate {candidate_name} was ranked using selected evidence only. "
        f"Score components: {', '.join(f'{k}={v:.3f}' if isinstance(v, (int, float)) else f'{k}={v}' for k, v in score_components.items())}. "
        f"Final score: {final_score:.3f}.'" if isinstance(final_score, (int, float)) else f"Candidate {candidate_name} was ranked using selected evidence only."
    )
    if any("Unverified fact" in line for line in fact_lines):
        narrative += " Unverified facts are clearly marked and should not be treated as canonical."

    return Explanation(
        candidate_id=candidate_id,
        evidence_summary=" | ".join(evidence_lines),
        narrative=narrative + " " + " ".join(fact_lines),
        score_components=score_components,
    )


def _tokens(text: str) -> Set[str]:
    return {_normalize(token) for token in _TOKEN_RE.findall(text.lower()) if _normalize(token)}


def _normalize(text: str) -> str:
    return " ".join(_TOKEN_RE.findall(text.lower())).strip()


def _keyword_overlap(query_tokens: Set[str], chunk_tokens: Set[str]) -> float:
    if not query_tokens:
        return 0.0
    return len(query_tokens & chunk_tokens) / len(query_tokens)


def _semantic_similarity(query_text: str, embedding: Sequence[float], content: str) -> float:
    if not embedding:
        return _keyword_overlap(_tokens(query_text), _tokens(content))
    query_embedding = _hash_embedding(query_text, len(embedding))
    return _cosine(query_embedding, list(embedding))


def _hash_embedding(text: str, dimensions: int) -> List[float]:
    if dimensions <= 0:
        return []
    buckets = [0.0] * dimensions
    tokens = list(_tokens(text))
    if not tokens:
        return buckets
    for index, token in enumerate(tokens):
        slot = abs(hash(token)) % dimensions
        weight = 1.0 + (index % 3) * 0.1
        buckets[slot] += weight
    norm = sqrt(sum(value * value for value in buckets))
    if norm == 0:
        return buckets
    return [value / norm for value in buckets]


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    size = min(len(left), len(right))
    if size == 0:
        return 0.0
    dot = sum(left[i] * right[i] for i in range(size))
    left_norm = sqrt(sum(left[i] * left[i] for i in range(size)))
    right_norm = sqrt(sum(right[i] * right[i] for i in range(size)))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, min(dot / (left_norm * right_norm), 1.0))


def _dedupe_preserve_order(items: Sequence[str]) -> List[str]:
    seen: Set[str] = set()
    ordered: List[str] = []
    for item in items:
        normalized = _normalize(item)
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(item)
    return ordered


def _experience_years(start_date: date, end_date: Optional[date]) -> float:
    end = end_date or date.today()
    delta_days = max((end - start_date).days, 0)
    return round(delta_days / 365.25, 2)


def _recency_rank(end_date: Optional[date]) -> float:
    if end_date is None:
        return 1.0
    years_since = max((date.today() - end_date).days / 365.25, 0.0)
    return max(0.0, min(1.0, 1.0 - (years_since / 10.0)))
