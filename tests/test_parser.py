from ats_async.parser import ResumeParser
from ats_async.facts import UnverifiedFactExtractor


SAMPLE_RESUME = """John Doe
john@example.com | +65 9123 4567 | Singapore

SUMMARY
Senior Python engineer with 8 years of experience building FastAPI services.

SKILLS
Python, FastAPI, PostgreSQL, Redis, Docker, AWS

EXPERIENCE
ACME Pte Ltd — Senior Software Engineer — Jan 2022 to Present
- Built async ingestion pipelines for resumes.
- Led backend services in Python and FastAPI.

EDUCATION
BSc Computer Science, NUS

CERTIFICATIONS
AWS Certified Solutions Architect
"""


def test_parser_identifies_sections_and_contact_details():
    parsed = ResumeParser().parse(SAMPLE_RESUME)

    assert parsed.contact.email == "john@example.com"
    assert parsed.contact.phone == "+65 9123 4567"
    assert "summary" in parsed.sections
    assert "skills" in parsed.sections
    assert parsed.experiences[0].company == "ACME Pte Ltd"
    assert parsed.experiences[0].title == "Senior Software Engineer"


def test_fact_extractor_emits_unverified_facts_with_evidence():
    parsed = ResumeParser().parse(SAMPLE_RESUME)
    facts = UnverifiedFactExtractor().extract(parsed)

    skill_fact_values = {fact.fact_value for fact in facts if fact.fact_type == "skill"}
    cert_fact_values = {fact.fact_value for fact in facts if fact.fact_type == "certification"}

    assert {"Python", "FastAPI", "PostgreSQL", "Redis"}.issubset(skill_fact_values)
    assert "AWS Certified Solutions Architect" in cert_fact_values
    assert all(not fact.is_verified for fact in facts)
    assert all(fact.evidence_text for fact in facts)
