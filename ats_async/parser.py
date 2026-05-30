from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import re


SECTION_ALIASES = {
    "summary": "summary",
    "profile": "summary",
    "about": "summary",
    "skills": "skills",
    "technical skills": "skills",
    "experience": "experience",
    "work experience": "experience",
    "employment": "experience",
    "education": "education",
    "certifications": "certifications",
    "certificates": "certifications",
    "languages": "languages",
    "projects": "projects",
}

KNOWN_SKILLS = {
    "python",
    "fastapi",
    "postgresql",
    "redis",
    "valkey",
    "docker",
    "aws",
    "sql",
    "javascript",
    "typescript",
    "react",
    "n8n",
    "llm",
    "rag",
    "pgvector",
    "celery",
    "rq",
    "arq",
}

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}")
HEADING_RE = re.compile(r"^[A-Z][A-Z\s/&-]{2,}$")
DATE_RE = re.compile(r"(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|Present|Current|\d{4})", re.I)


@dataclass(slots=True)
class ResumeContact:
    email: str | None = None
    phone: str | None = None
    location: str | None = None


@dataclass(slots=True)
class ResumeExperience:
    company: str
    title: str
    dates: str | None = None
    description: str = ""


@dataclass(slots=True)
class ParsedResume:
    raw_text: str
    sections: dict[str, str] = field(default_factory=dict)
    contact: ResumeContact = field(default_factory=ResumeContact)
    experiences: list[ResumeExperience] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    education: list[str] = field(default_factory=list)
    certifications: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ResumeParser:
    def parse(self, text: str) -> ParsedResume:
        normalized = self._normalize(text)
        lines = normalized.split("\n")
        sections = self._split_sections(lines)
        contact = self._extract_contact(normalized)
        experiences = self._extract_experiences(sections.get("experience", ""))
        skills = self._extract_skills(sections.get("skills", "") + "\n" + normalized)
        education = self._extract_bullets(sections.get("education", ""))
        certifications = self._extract_bullets(sections.get("certifications", ""))
        languages = self._extract_bullets(sections.get("languages", ""))
        warnings = []
        if not experiences:
            warnings.append("No experience section detected")
        return ParsedResume(
            raw_text=normalized,
            sections=sections,
            contact=contact,
            experiences=experiences,
            skills=skills,
            education=education,
            certifications=certifications,
            languages=languages,
            warnings=warnings,
        )

    def _normalize(self, text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        lines = [line.rstrip() for line in text.split("\n")]
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()
        return "\n".join(lines)

    def _split_sections(self, lines: list[str]) -> dict[str, str]:
        sections: dict[str, list[str]] = {}
        current = "preamble"
        sections[current] = []
        for line in lines:
            normalized = line.strip().lower().rstrip(":")
            if normalized in SECTION_ALIASES or HEADING_RE.match(line.strip()):
                current = SECTION_ALIASES.get(normalized, normalized.lower())
                sections.setdefault(current, [])
                continue
            sections.setdefault(current, []).append(line)
        return {name: self._normalize("\n".join(content)).strip() for name, content in sections.items() if "\n".join(content).strip()}

    def _extract_contact(self, text: str) -> ResumeContact:
        email = next(iter(EMAIL_RE.findall(text)), None)
        phone = next(iter(PHONE_RE.findall(text)), None)
        first_lines = [line.strip() for line in text.split("\n")[:4] if line.strip()]
        location = None
        for line in first_lines[1:]:
            if "@" not in line and not PHONE_RE.search(line):
                location = line
                break
        return ResumeContact(email=email, phone=phone, location=location)

    def _extract_experiences(self, text: str) -> list[ResumeExperience]:
        experiences: list[ResumeExperience] = []
        if not text:
            return experiences
        blocks = [block.strip() for block in re.split(r"\n{2,}", text) if block.strip()]
        for block in blocks:
            lines = [line.strip("-• \t") for line in block.split("\n") if line.strip()]
            if not lines:
                continue
            header = lines[0]
            parts = [part.strip() for part in re.split(r"\s*[—|-]\s*", header) if part.strip()]
            company = parts[0] if parts else header
            title = parts[1] if len(parts) > 1 else ""
            dates = parts[2] if len(parts) > 2 else None
            description = "\n".join(lines[1:]).strip()
            experiences.append(ResumeExperience(company=company, title=title, dates=dates, description=description))
        return experiences

    def _extract_skills(self, text: str) -> list[str]:
        explicit = []
        for token in re.split(r"[,\n;/•]+", text):
            cleaned = token.strip()
            if not cleaned:
                continue
            normalized = cleaned.lower()
            if normalized in KNOWN_SKILLS:
                explicit.append(self._canonical_skill(cleaned))
        seen = set()
        result = []
        for skill in explicit:
            key = skill.lower()
            if key not in seen:
                seen.add(key)
                result.append(skill)
        return result

    def _canonical_skill(self, skill: str) -> str:
        lowered = skill.strip().lower()
        return {
            "postgresql": "PostgreSQL",
            "fastapi": "FastAPI",
            "pgvector": "pgvector",
            "aws": "AWS",
            "sql": "SQL",
            "redis": "Redis",
            "docker": "Docker",
            "python": "Python",
            "n8n": "n8n",
            "llm": "LLM",
            "rag": "RAG",
            "celery": "Celery",
            "rq": "RQ",
            "arq": "Arq",
            "react": "React",
            "typescript": "TypeScript",
            "javascript": "JavaScript",
            "valkey": "Valkey",
        }.get(lowered, skill.strip())

    def _extract_bullets(self, text: str) -> list[str]:
        if not text:
            return []
        items: list[str] = []
        for line in text.split("\n"):
            cleaned = line.strip("-• \t")
            if cleaned:
                items.append(cleaned)
        return items
