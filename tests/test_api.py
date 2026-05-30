from __future__ import annotations

from io import BytesIO

from fastapi.testclient import TestClient

from apps.api.app.main import create_app


def make_client(tmp_path):
    app = create_app(db_path=tmp_path / "ats.sqlite3", upload_dir=tmp_path / "uploads", seed_demo_data=False)
    return TestClient(app)


def test_health_and_version(tmp_path):
    client = make_client(tmp_path)

    health = client.get("/health")
    version = client.get("/version")

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert version.status_code == 200
    assert version.json()["service"] == "ats-api"


def test_auth_rbac_profile_and_audit(tmp_path):
    client = make_client(tmp_path)

    bootstrap = client.post(
        "/auth/register",
        json={"email": "admin@example.com", "password": "secret123", "full_name": "Admin User", "role": "admin"},
    )
    assert bootstrap.status_code == 201
    admin_token = bootstrap.json()["access_token"]

    me = client.get("/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "admin@example.com"
    assert "admin" in me.json()["roles"]

    recruiter = client.post(
        "/auth/register",
        json={"email": "recruiter@example.com", "password": "secret123", "full_name": "Recruiter User", "role": "recruiter"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert recruiter.status_code == 201
    recruiter_token = recruiter.json()["access_token"]

    forbidden = client.post(
        "/profiles",
        headers={"Authorization": f"Bearer {recruiter_token}"},
        json={"full_name": "Candidate One", "email": "candidate@example.com"},
    )
    assert forbidden.status_code == 403

    allowed = client.post(
        "/profiles",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"full_name": "Candidate One", "email": "candidate@example.com", "current_title": "Engineer"},
    )
    assert allowed.status_code == 201
    profile_id = allowed.json()["id"]

    fetched = client.get(f"/profiles/{profile_id}", headers={"Authorization": f"Bearer {admin_token}"})
    assert fetched.status_code == 200
    assert fetched.json()["full_name"] == "Candidate One"

    audit = client.get("/audit", headers={"Authorization": f"Bearer {admin_token}"})
    assert audit.status_code == 200
    actions = [row["action"] for row in audit.json()["items"]]
    assert "auth.register" in actions
    assert "profile.create" in actions


def test_resume_upload_creates_background_job_and_search_and_sse(tmp_path):
    client = make_client(tmp_path)

    admin = client.post(
        "/auth/register",
        json={"email": "admin@example.com", "password": "secret123", "full_name": "Admin User", "role": "admin"},
    )
    admin_token = admin.json()["access_token"]
    profile = client.post(
        "/profiles",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"full_name": "Resume Candidate", "email": "resume@example.com", "current_company": "Acme"},
    )
    profile_id = profile.json()["id"]

    upload = client.post(
        "/resumes/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        data={"profile_id": profile_id},
        files={"file": ("resume.txt", BytesIO(b"Python FastAPI PostgreSQL"), "text/plain")},
    )
    assert upload.status_code == 201
    payload = upload.json()
    assert payload["status"] == "uploaded"
    assert payload["background_job_id"]

    job = client.get(f"/background-jobs/{payload['background_job_id']}", headers={"Authorization": f"Bearer {admin_token}"})
    assert job.status_code == 200
    assert job.json()["status"] == "queued"

    search = client.get("/search", headers={"Authorization": f"Bearer {admin_token}"}, params={"q": "Python"})
    assert search.status_code == 200
    assert search.json()["items"]
    assert search.json()["items"][0]["profile_id"] == profile_id

    with client.stream("GET", "/events?after=0&limit=4", headers={"Authorization": f"Bearer {admin_token}"}) as stream:
        body = "".join(chunk.decode("utf-8") for chunk in stream.iter_raw())
    assert "event: audit" in body or "event: background_job.updated" in body
