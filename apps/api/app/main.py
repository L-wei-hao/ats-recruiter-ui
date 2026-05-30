from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4
import json

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ats_async.extract import ResumeTextExtractor, ResumeTextExtractionError
from ats_async.models import BackgroundJob, JobStatus
from ats_async.parser import ResumeParser
from ats_async.facts import UnverifiedFactExtractor
from ats_async.queue import InMemoryQueueBackend


UTC = timezone.utc


@dataclass(slots=True)
class User:
    id: str
    email: str
    password: str
    full_name: str
    roles: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Profile:
    id: str
    full_name: str
    email: str
    current_title: str | None = None
    current_company: str | None = None
    location: str | None = None
    created_by: str | None = None


@dataclass(slots=True)
class ResumeRecord:
    id: str
    profile_id: str
    filename: str
    file_path: str
    raw_text: str
    extracted_skills: list[str]
    parsed_json: dict[str, Any]
    background_job_id: str
    status: str = "uploaded"
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(slots=True)
class AuditEvent:
    id: int
    event_type: str
    action: str
    actor_id: str | None
    data: dict[str, Any]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(slots=True)
class AppState:
    users: dict[str, User] = field(default_factory=dict)
    tokens: dict[str, str] = field(default_factory=dict)
    profiles: dict[str, Profile] = field(default_factory=dict)
    resumes: dict[str, ResumeRecord] = field(default_factory=dict)
    queue: InMemoryQueueBackend = field(default_factory=InMemoryQueueBackend)
    audits: list[AuditEvent] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    next_audit_id: int = 1

    def log_event(self, event_type: str, action: str, actor_id: str | None, data: dict[str, Any]) -> None:
        event = AuditEvent(id=self.next_audit_id, event_type=event_type, action=action, actor_id=actor_id, data=data)
        self.next_audit_id += 1
        self.audits.append(event)
        self.events.append(
            {
                "id": event.id,
                "event": event_type,
                "action": action,
                "actor_id": actor_id,
                "data": data,
                "created_at": event.created_at.isoformat(),
            }
        )


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    role: str


class ProfileCreateRequest(BaseModel):
    full_name: str
    email: str
    current_title: str | None = None
    current_company: str | None = None
    location: str | None = None


class RegisterResponse(BaseModel):
    access_token: str
    user_id: str
    email: str
    roles: list[str]


class ProfileResponse(BaseModel):
    id: str
    full_name: str
    email: str
    current_title: str | None = None
    current_company: str | None = None
    location: str | None = None


class SearchItem(BaseModel):
    profile_id: str
    resume_id: str
    score: float
    snippet: str


class SearchResponse(BaseModel):
    items: list[SearchItem]


ALLOWED_ROLES = {"admin", "recruiter", "hiring_manager", "reviewer"}


def create_app(db_path: Path | str, upload_dir: Path | str, seed_demo_data: bool = False) -> FastAPI:
    app = FastAPI(title="ATS API", version="0.1.0")
    state = AppState()
    upload_path = Path(upload_dir)
    upload_path.mkdir(parents=True, exist_ok=True)
    text_extractor = ResumeTextExtractor()
    parser = ResumeParser()
    fact_extractor = UnverifiedFactExtractor()

    def current_user(authorization: str | None = Header(default=None)) -> User:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing bearer token")
        token = authorization.removeprefix("Bearer ").strip()
        user_id = state.tokens.get(token)
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return state.users[user_id]

    def require_role(user: User, *roles: str) -> User:
        if not set(user.roles).intersection(roles):
            raise HTTPException(status_code=403, detail="Forbidden")
        return user

    def create_token() -> str:
        return uuid4().hex

    def serialise_job(job: BackgroundJob) -> dict[str, Any]:
        return {
            "id": job.id,
            "job_type": job.job_type,
            "entity_type": job.entity_type,
            "entity_id": job.entity_id,
            "queue_name": job.queue_name,
            "priority": job.priority,
            "status": job.status.value,
            "attempts": job.attempts,
            "max_attempts": job.max_attempts,
            "payload": job.payload,
            "result": job.result,
            "error": job.error,
            "created_at": job.created_at.isoformat(),
            "updated_at": job.updated_at.isoformat(),
            "next_retry_at": job.next_retry_at.isoformat() if job.next_retry_at else None,
        }

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/version")
    def version() -> dict[str, str]:
        return {"service": "ats-api", "version": "0.1.0"}

    @app.post("/auth/register", status_code=201, response_model=RegisterResponse)
    def register(payload: RegisterRequest, authorization: str | None = Header(default=None)) -> RegisterResponse:
        if payload.role not in ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail="Unsupported role")
        if state.users:
            actor = current_user(authorization)
            require_role(actor, "admin")
        user_id = uuid4().hex
        user = User(id=user_id, email=payload.email, password=payload.password, full_name=payload.full_name, roles=[payload.role])
        token = create_token()
        state.users[user_id] = user
        state.tokens[token] = user_id
        state.log_event("audit", "auth.register", user_id, {"email": payload.email, "roles": [payload.role]})
        return RegisterResponse(access_token=token, user_id=user_id, email=user.email, roles=user.roles)

    @app.get("/me")
    def me(user: User = Depends(current_user)) -> dict[str, Any]:
        return {"id": user.id, "email": user.email, "full_name": user.full_name, "roles": user.roles}

    @app.post("/profiles", status_code=201)
    def create_profile(payload: ProfileCreateRequest, user: User = Depends(current_user)) -> dict[str, Any]:
        require_role(user, "admin")
        profile_id = uuid4().hex
        profile = Profile(
            id=profile_id,
            full_name=payload.full_name,
            email=payload.email,
            current_title=payload.current_title,
            current_company=payload.current_company,
            location=payload.location,
            created_by=user.id,
        )
        state.profiles[profile_id] = profile
        state.log_event("audit", "profile.create", user.id, {"profile_id": profile_id, "email": payload.email})
        return {
            "id": profile.id,
            "full_name": profile.full_name,
            "email": profile.email,
            "current_title": profile.current_title,
            "current_company": profile.current_company,
            "location": profile.location,
        }

    @app.get("/profiles/{profile_id}")
    def get_profile(profile_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        profile = state.profiles.get(profile_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        return {
            "id": profile.id,
            "full_name": profile.full_name,
            "email": profile.email,
            "current_title": profile.current_title,
            "current_company": profile.current_company,
            "location": profile.location,
        }

    @app.get("/audit")
    def audit(user: User = Depends(current_user)) -> dict[str, Any]:
        require_role(user, "admin")
        return {
            "items": [
                {
                    "id": event.id,
                    "event_type": event.event_type,
                    "action": event.action,
                    "actor_id": event.actor_id,
                    "data": event.data,
                    "created_at": event.created_at.isoformat(),
                }
                for event in state.audits
            ]
        }

    @app.post("/resumes/upload", status_code=201)
    async def upload_resume(
        profile_id: str = Form(...),
        file: UploadFile = File(...),
        user: User = Depends(current_user),
    ) -> dict[str, Any]:
        if profile_id not in state.profiles:
            raise HTTPException(status_code=404, detail="Profile not found")
        profile = state.profiles[profile_id]
        resume_id = uuid4().hex
        file_path = upload_path / f"{resume_id}_{file.filename}"
        contents = await file.read()
        file_path.write_bytes(contents)

        try:
            raw_text = text_extractor.extract(file_path)
        except ResumeTextExtractionError:
            raw_text = contents.decode("utf-8", errors="replace")

        parsed = parser.parse(raw_text)
        facts = fact_extractor.extract(parsed, source_id=resume_id)
        background_job = state.queue.enqueue(
            BackgroundJob(
                job_type="resume.uploaded",
                entity_type="resume",
                entity_id=resume_id,
                payload={"profile_id": profile_id, "file_path": str(file_path), "filename": file.filename},
            )
        )
        state.resumes[resume_id] = ResumeRecord(
            id=resume_id,
            profile_id=profile_id,
            filename=file.filename,
            file_path=str(file_path),
            raw_text=raw_text,
            extracted_skills=parsed.skills,
            parsed_json={
                "sections": parsed.sections,
                "skills": parsed.skills,
                "certifications": parsed.certifications,
                "facts": [fact.__dict__ for fact in facts],
            },
            background_job_id=background_job.id,
        )
        state.log_event("audit", "resume.upload", user.id, {"resume_id": resume_id, "profile_id": profile_id})
        state.log_event("background_job.updated", "background_job.created", user.id, {"job": serialise_job(background_job)})
        return {
            "resume_id": resume_id,
            "candidate_id": profile_id,
            "background_job_id": background_job.id,
            "status": "uploaded",
        }

    @app.get("/background-jobs/{job_id}")
    def get_background_job(job_id: str, user: User = Depends(current_user)) -> dict[str, Any]:
        for job in state.queue.list_jobs():
            if job.id == job_id:
                return serialise_job(job)
        raise HTTPException(status_code=404, detail="Background job not found")

    @app.get("/search", response_model=SearchResponse)
    def search(q: str, user: User = Depends(current_user)) -> SearchResponse:
        terms = {token.lower() for token in q.split() if token.strip()}
        items: list[SearchItem] = []
        for resume in state.resumes.values():
            profile = state.profiles[resume.profile_id]
            haystack = f"{profile.full_name} {profile.current_title or ''} {profile.current_company or ''} {resume.raw_text} {' '.join(resume.extracted_skills)}".lower()
            matches = sum(1 for term in terms if term in haystack)
            if matches == 0:
                continue
            snippet = resume.raw_text[:160].replace("\n", " ")
            items.append(
                SearchItem(
                    profile_id=resume.profile_id,
                    resume_id=resume.id,
                    score=float(matches) + 0.1 * len(resume.extracted_skills),
                    snippet=snippet,
                )
            )
        items.sort(key=lambda item: (-item.score, item.profile_id))
        return SearchResponse(items=items)

    @app.get("/events")
    def events(after: int = 0, limit: int = 10, user: User = Depends(current_user)) -> StreamingResponse:
        def iterator():
            count = 0
            for event in state.events:
                if event["id"] <= after:
                    continue
                payload = json.dumps(event, ensure_ascii=False)
                yield f"event: {event['event']}\n"
                yield f"data: {payload}\n\n"
                count += 1
                if count >= limit:
                    break

        return StreamingResponse(iterator(), media_type="text/event-stream")

    if seed_demo_data:
        demo_user = User(id="demo-admin", email="admin@example.com", password="demo", full_name="Demo Admin", roles=["admin"])
        token = create_token()
        state.users[demo_user.id] = demo_user
        state.tokens[token] = demo_user.id
        state.log_event("audit", "auth.register", demo_user.id, {"email": demo_user.email, "roles": demo_user.roles})

    app.state.ats = state
    return app
