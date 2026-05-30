from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .parser import ParsedResume


@dataclass(slots=True)
class UnverifiedFact:
    fact_type: str
    fact_value: str
    source_type: str
    source_id: str
    evidence_text: str
    confidence: float
    is_verified: bool = False


@dataclass(slots=True)
class UnverifiedFactExtractor:
    def extract(self, parsed: ParsedResume, source_id: str = "resume") -> list[UnverifiedFact]:
        facts: list[UnverifiedFact] = []
        seen: set[tuple[str, str]] = set()
        for skill in parsed.skills:
            self._add_fact(facts, seen, "skill", skill, "resume_extracted", source_id, f"Detected skill in skills section: {skill}", 0.95)
        for certification in parsed.certifications:
            self._add_fact(facts, seen, "certification", certification, "resume_extracted", source_id, f"Detected certification entry: {certification}", 0.9)
        if parsed.experiences:
            first = parsed.experiences[0]
            if first.title:
                self._add_fact(facts, seen, "current_title", first.title, "resume_extracted", source_id, f"Experience header: {first.company} — {first.title}", 0.8)
            if first.company:
                self._add_fact(facts, seen, "company", first.company, "resume_extracted", source_id, f"Experience header: {first.company} — {first.title}", 0.8)
        if parsed.contact.location:
            self._add_fact(facts, seen, "location", parsed.contact.location, "resume_extracted", source_id, f"Contact line: {parsed.contact.location}", 0.7)
        return facts

    def _add_fact(
        self,
        facts: list[UnverifiedFact],
        seen: set[tuple[str, str]],
        fact_type: str,
        fact_value: str,
        source_type: str,
        source_id: str,
        evidence_text: str,
        confidence: float,
    ) -> None:
        key = (fact_type, fact_value.lower())
        if key in seen:
            return
        seen.add(key)
        facts.append(
            UnverifiedFact(
                fact_type=fact_type,
                fact_value=fact_value,
                source_type=source_type,
                source_id=source_id,
                evidence_text=evidence_text,
                confidence=confidence,
                is_verified=False,
            )
        )
