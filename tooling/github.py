#!/usr/bin/env python3
"""Run GitHub CLI for this repository with the noamtz credential only."""

from __future__ import annotations

import os
import subprocess
import sys


GITHUB_HOST = "github.com"
GITHUB_USER = "noamtz"


def token_for_repository_account() -> str:
    result = subprocess.run(
        ["gh", "auth", "token", "--hostname", GITHUB_HOST, "--user", GITHUB_USER],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode or not result.stdout.strip():
        detail = result.stderr.strip() or "credential not found"
        raise RuntimeError(f"GitHub account {GITHUB_USER} is unavailable: {detail}")
    return result.stdout.strip()


def main() -> int:
    if len(sys.argv) == 1:
        print("Usage: python tooling/github.py <gh arguments>", file=sys.stderr)
        return 2

    try:
        token = token_for_repository_account()
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1

    environment = os.environ.copy()
    environment["GH_HOST"] = GITHUB_HOST
    environment["GH_TOKEN"] = token
    try:
        return subprocess.run(["gh", *sys.argv[1:]], env=environment, check=False).returncode
    finally:
        environment.pop("GH_TOKEN", None)
        token = ""


if __name__ == "__main__":
    raise SystemExit(main())
