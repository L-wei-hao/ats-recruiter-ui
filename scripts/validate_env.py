#!/usr/bin/env python3
"""Validate ATS environment files and runtime environment.

Usage:
  python scripts/validate_env.py --mode example .env.example
  python scripts/validate_env.py --mode runtime
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, Tuple

REQUIRED_KEYS = [
    "APP_NAME",
    "APP_ENV",
    "API_BASE_URL",
    "WEB_BASE_URL",
    "DATABASE_URL",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "VALKEY_URL",
    "N8N_HOST",
    "N8N_PORT",
    "N8N_PROTOCOL",
    "N8N_BASIC_AUTH_ACTIVE",
    "N8N_BASIC_AUTH_USER",
    "N8N_BASIC_AUTH_PASSWORD",
    "N8N_ENCRYPTION_KEY",
    "N8N_INBOUND_TOKEN",
    "N8N_OUTBOUND_TOKEN",
    "JWT_SECRET",
    "SESSION_SECRET",
]

PLACEHOLDER_HINTS = ("change-me", "replace", "todo", "example", "***")


def parse_env_file(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=VALUE, got {raw_line!r}")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise ValueError(f"{path}:{line_number}: empty key")
        if key in values:
            raise ValueError(f"{path}:{line_number}: duplicate key {key}")
        values[key] = value
    return values


def env_is_placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in PLACEHOLDER_HINTS)


def validate_pairs(pairs: Iterable[Tuple[str, str]], allow_placeholders: bool) -> None:
    errors = []
    for key, value in pairs:
        if value is None or str(value).strip() == "":
            errors.append(f"{key} is missing or empty")
            continue
        if not allow_placeholders and env_is_placeholder(str(value)):
            errors.append(f"{key} looks like a placeholder value: {value!r}")
    if errors:
        raise ValueError("\n".join(errors))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", default=".env", help="Path to env file for example mode")
    parser.add_argument(
        "--mode",
        choices=("runtime", "example"),
        default="runtime",
        help="runtime validates current process environment; example validates an env file",
    )
    args = parser.parse_args()

    if args.mode == "example":
        env_path = Path(args.path)
        if not env_path.exists():
            raise SystemExit(f"env example file not found: {env_path}")
        values = parse_env_file(env_path)
        missing = [key for key in REQUIRED_KEYS if key not in values]
        if missing:
            raise SystemExit("Missing keys in example env file:\n- " + "\n- ".join(missing))
        validate_pairs(((key, values[key]) for key in REQUIRED_KEYS), allow_placeholders=True)
        print(f"OK: validated {env_path} with {len(REQUIRED_KEYS)} required keys")
        return 0

    runtime_values = [(key, os.environ.get(key, "")) for key in REQUIRED_KEYS]
    validate_pairs(runtime_values, allow_placeholders=False)
    print(f"OK: runtime environment contains {len(REQUIRED_KEYS)} required keys")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
