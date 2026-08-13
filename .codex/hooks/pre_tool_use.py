#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# ///
"""Codex PreToolUse guardrail for secrets, destructive deletes, and GitHub identity.

Codex sends one JSON event on stdin. A matching command emits Codex's structured
deny response on stdout. Unexpected hook failures deliberately fail open so a
broken local policy cannot brick the session.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ENV_TEMPLATE_SUFFIXES = (".env.example", ".env.sample", ".env.template")

SECRET_PATH = re.compile(
    r"(?<![\w.-])\.env(?:\.[A-Za-z0-9_-]+)?(?![\w.-])|"
    r"\.pem(?![\w.-])|\.key(?![\w.-])|"
    r"(?:^|[/\\\s])id_(?:rsa|ed25519)(?![\w.-])|[/\\]\.ssh[/\\]|"
    r"[/\\]\.aws[/\\]credentials(?![\w.-])|[/\\]\.netrc(?![\w.-])|"
    r"credentials\.json(?![\w.-])",
    re.IGNORECASE,
)

ENV_DUMP = (
    re.compile(r"\bprintenv\b", re.IGNORECASE),
    re.compile(r"(?:^|[;&|]\s*)env\s*(?:[|>]|$)", re.IGNORECASE),
    re.compile(
        r"\becho\b.*\$\{?[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)",
        re.IGNORECASE,
    ),
    re.compile(r"os\.environ|process\.env|ENV\[", re.IGNORECASE),
    re.compile(r"Get-ChildItem\s+(?:Env:|environment)", re.IGNORECASE),
    re.compile(r"\b(?:dir|ls|gci)\s+Env:", re.IGNORECASE),
)

RECURSIVE_FORCE_DELETE = (
    re.compile(r"\brm\b[^\r\n]*(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)", re.IGNORECASE),
    re.compile(r"\brm\b[^\r\n]*(?:--recursive[^\r\n]*--force|--force[^\r\n]*--recursive)", re.IGNORECASE),
    re.compile(
        r"\bRemove-Item\b[^\r\n]*(?:-Recurse[^\r\n]*-Force|-Force[^\r\n]*-Recurse)",
        re.IGNORECASE,
    ),
)

BLOCKED_SECRET_MESSAGE = (
    "BLOCKED: access to likely secret material is not allowed. "
    "Use a committed .env.example/.sample/.template file or ask the user for a safe input."
)
BLOCKED_DELETE_MESSAGE = (
    "BLOCKED: recursive force deletion is disabled by the project hook. "
    "Resolve and verify a narrow target, then use a recoverable or explicitly approved operation."
)
EXPECTED_GITHUB_USER = "noamtz"
FORBIDDEN_GITHUB_USER = "noamtznm"
EXPECTED_GITHUB_REMOTE = "git@github.com:noamtz/cpa-platform.git"
BLOCKED_GITHUB_IDENTITY_MESSAGE = (
    "BLOCKED: this repository may use only the noamtz GitHub identity and "
    "git@github.com:noamtz/cpa-platform.git."
)
BLOCKED_BARE_GH_MESSAGE = (
    "BLOCKED: invoke GitHub CLI through 'python tooling/github.py' so this repository always uses noamtz."
)

BARE_GH_COMMAND = re.compile(r"(?:^|[;&|]\s*)gh(?:\.exe)?\s", re.IGNORECASE)
REMOTE_MUTATION = re.compile(r"\bgit\s+remote\s+(?:add|set-url)\b", re.IGNORECASE)


def deny(reason: str) -> None:
    """Emit the structured response Codex requires to block PreToolUse."""
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


def _command_text(tool_input: Any) -> str:
    if not isinstance(tool_input, dict):
        return ""
    command = tool_input.get("command", "")
    return command if isinstance(command, str) else ""


def _is_safe_template(text: str) -> bool:
    normalized = text.replace("\\", "/").lower()
    return any(suffix in normalized for suffix in ENV_TEMPLATE_SUFFIXES)


def is_secret_access(tool_name: str, tool_input: Any) -> bool:
    """Detect obvious secret paths and environment-dump commands."""
    text = _command_text(tool_input).replace("\\", "/")
    if not text:
        return False

    if tool_name == "Bash" and any(pattern.search(text) for pattern in ENV_DUMP):
        return True

    matches = [match.group(0) for match in SECRET_PATH.finditer(text)]
    return any(not _is_safe_template(match) for match in matches)


def is_recursive_force_delete(tool_name: str, tool_input: Any) -> bool:
    if tool_name != "Bash":
        return False
    command = _command_text(tool_input)
    return any(pattern.search(command) for pattern in RECURSIVE_FORCE_DELETE)


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def serialized_input(tool_input: Any) -> str:
    try:
        return json.dumps(tool_input, ensure_ascii=False).lower()
    except (TypeError, ValueError):
        return ""


def uses_forbidden_github_identity(tool_input: Any) -> bool:
    return FORBIDDEN_GITHUB_USER in serialized_input(tool_input)


def uses_bare_github_cli(tool_name: str, tool_input: Any) -> bool:
    return tool_name == "Bash" and bool(BARE_GH_COMMAND.search(_command_text(tool_input)))


def mutates_remote_away_from_expected(tool_name: str, tool_input: Any) -> bool:
    if tool_name != "Bash":
        return False
    command = _command_text(tool_input)
    return bool(REMOTE_MUTATION.search(command) and EXPECTED_GITHUB_REMOTE.lower() not in command.lower())


def origin_matches_expected() -> bool:
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=repository_root(),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.returncode == 0 and result.stdout.strip() == EXPECTED_GITHUB_REMOTE


def main() -> None:
    try:
        event = json.load(sys.stdin)
        tool_name = event.get("tool_name", "")
        tool_input = event.get("tool_input", {})

        if is_secret_access(tool_name, tool_input):
            deny(BLOCKED_SECRET_MESSAGE)
            return

        if is_recursive_force_delete(tool_name, tool_input):
            deny(BLOCKED_DELETE_MESSAGE)
            return

        if uses_forbidden_github_identity(tool_input):
            deny(BLOCKED_GITHUB_IDENTITY_MESSAGE)
            return

        if uses_bare_github_cli(tool_name, tool_input):
            deny(BLOCKED_BARE_GH_MESSAGE)
            return

        if mutates_remote_away_from_expected(tool_name, tool_input):
            deny(BLOCKED_GITHUB_IDENTITY_MESSAGE)
            return

        if tool_name.startswith(("mcp__github-projects__", "mcp__github_projects__")) and not origin_matches_expected():
            deny(BLOCKED_GITHUB_IDENTITY_MESSAGE)
    except Exception:
        raise SystemExit(0)


if __name__ == "__main__":
    main()
