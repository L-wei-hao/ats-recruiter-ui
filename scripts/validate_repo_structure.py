#!/usr/bin/env python3
"""Validate the ATS foundation repo structure."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_PATHS = [
    "apps/api/README.md",
    "apps/web/README.md",
    "apps/worker/README.md",
    "db/migrations/0001_create_background_jobs.sql",
    "docs/architecture.md",
    "docker-compose.yml",
    ".env.example",
    ".gitignore",
    "infra/postgres/init/001_extensions.sql",
    "n8n/README.md",
    "n8n/workflows/README.md",
    "scripts/validate_env.py",
    "scripts/validate_repo_structure.py",
    "src/App.tsx",
    "src/main.tsx",
    "src/styles.css",
    "tests/README.md",
    ".github/workflows/ci.yml",
]


def main() -> int:
    missing = [relative for relative in EXPECTED_PATHS if not (ROOT / relative).exists()]
    if missing:
        print("Missing foundation paths:")
        for relative in missing:
            print(f"- {relative}")
        return 1
    print(f"OK: verified {len(EXPECTED_PATHS)} foundation paths")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
