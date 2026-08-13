#!/usr/bin/env python3
"""Validate the repository-scoped Codex AI layer without third-party packages."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / ".agents" / "skills"
AGENTS_DIR = ROOT / ".codex" / "agents"
EXPECTED_GITHUB_USER = "noamtz"
FORBIDDEN_GITHUB_USER = "noamtz" + "nm"
EXPECTED_GITHUB_REPOSITORY = "noamtz/cpa-platform"
EXPECTED_GITHUB_REMOTE = "git@github.com:noamtz/cpa-platform.git"


def error(errors: list[str], message: str) -> None:
    errors.append(message)


def parse_skill_frontmatter(path: Path, errors: list[str]) -> tuple[str, set[str]]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        error(errors, f"{path.relative_to(ROOT)}: missing YAML frontmatter")
        return "", set()

    try:
        header, _body = text[4:].split("\n---\n", 1)
    except ValueError:
        error(errors, f"{path.relative_to(ROOT)}: unterminated YAML frontmatter")
        return "", set()

    keys: set[str] = set()
    name = ""
    for line in header.splitlines():
        if not line or line[0].isspace() or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        keys.add(key)
        if key == "name":
            name = value.strip().strip('"\'')

    unsupported = keys - {"name", "description"}
    if unsupported:
        error(
            errors,
            f"{path.relative_to(ROOT)}: unsupported Codex skill frontmatter keys "
            f"{sorted(unsupported)}",
        )
    if keys != {"name", "description"}:
        error(errors, f"{path.relative_to(ROOT)}: frontmatter must define name and description")
    return name, keys


def validate_skills(errors: list[str]) -> None:
    if not SKILLS_DIR.is_dir():
        error(errors, ".agents/skills is missing")
        return

    names: dict[str, Path] = {}
    for skill_dir in sorted(path for path in SKILLS_DIR.iterdir() if path.is_dir()):
        skill_path = skill_dir / "SKILL.md"
        if not skill_path.is_file():
            error(errors, f"{skill_dir.relative_to(ROOT)}: missing SKILL.md")
            continue
        name, _keys = parse_skill_frontmatter(skill_path, errors)
        if name != skill_dir.name:
            error(
                errors,
                f"{skill_path.relative_to(ROOT)}: name {name!r} does not match folder {skill_dir.name!r}",
            )
        if name and not re.fullmatch(r"[a-z0-9-]{1,64}", name):
            error(errors, f"{skill_path.relative_to(ROOT)}: invalid skill name {name!r}")
        if name in names:
            error(
                errors,
                f"duplicate skill name {name!r}: {names[name].relative_to(ROOT)} and "
                f"{skill_path.relative_to(ROOT)}",
            )
        names[name] = skill_path


def validate_agents(errors: list[str]) -> None:
    required = {"name", "description", "developer_instructions"}
    names: dict[str, Path] = {}
    for path in sorted(AGENTS_DIR.glob("*.toml")):
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
            error(errors, f"{path.relative_to(ROOT)}: invalid TOML: {exc}")
            continue
        missing = required - data.keys()
        if missing:
            error(errors, f"{path.relative_to(ROOT)}: missing required keys {sorted(missing)}")
        name = data.get("name")
        if not isinstance(name, str):
            continue
        if path.stem != name:
            error(errors, f"{path.relative_to(ROOT)}: name {name!r} must match filename")
        if name in names:
            error(errors, f"duplicate custom agent name {name!r}")
        names[name] = path


def validate_config(errors: list[str]) -> None:
    config_path = ROOT / ".codex" / "config.toml"
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        error(errors, f".codex/config.toml: {exc}")
        return

    mcp = config.get("mcp_servers", {}).get("codebase-search", {})
    if mcp.get("command") != "uv":
        error(errors, ".codex/config.toml: codebase-search MCP command must be 'uv'")
    if "tooling/mcp/codebase_search.py" not in mcp.get("args", []):
        error(errors, ".codex/config.toml: codebase-search MCP script path is missing")
    expected_tools = {"where_is", "find_references", "outline"}
    if set(mcp.get("enabled_tools", [])) != expected_tools:
        error(errors, ".codex/config.toml: codebase-search MCP tool allowlist is incomplete")
    if mcp.get("default_tools_approval_mode") != "approve":
        error(errors, ".codex/config.toml: read-only codebase-search tools should be pre-approved")

    github_mcp = config.get("mcp_servers", {}).get("github-projects", {})
    if github_mcp.get("command") != "powershell":
        error(errors, ".codex/config.toml: github-projects MCP command must be 'powershell'")
    if "tooling/mcp/github_projects.ps1" not in github_mcp.get("args", []):
        error(errors, ".codex/config.toml: github-projects MCP launcher path is missing")
    if "default_tools_approval_mode" in github_mcp:
        error(errors, ".codex/config.toml: write-capable GitHub tools must retain client approval defaults")

    hook_path = ROOT / ".codex" / "hooks.json"
    try:
        hooks = json.loads(hook_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        error(errors, f".codex/hooks.json: {exc}")
        return
    if not isinstance(hooks.get("hooks"), dict):
        error(errors, ".codex/hooks.json: top-level hooks object is missing")


def validate_github_project_documents(errors: list[str]) -> None:
    launcher_path = ROOT / "tooling" / "mcp" / "github_projects.ps1"
    try:
        launcher = launcher_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        error(errors, f"tooling/mcp/github_projects.ps1: {exc}")
    else:
        required_launcher_tokens = {
            "gh auth token --hostname github.com --user noamtz": "select the repository GitHub account",
            "GITHUB_PERSONAL_ACCESS_TOKEN": "pass authentication to the MCP server",
            "GITHUB_TOOLSETS": "limit the enabled GitHub toolsets",
            "projects,issues,repos,pull_requests": "enable the document workflow toolsets",
            "ghcr.io/github/github-mcp-server:v1.9.0": "pin the official GitHub MCP image",
        }
        for token, purpose in required_launcher_tokens.items():
            if token not in launcher:
                error(errors, f"tooling/mcp/github_projects.ps1: must {purpose} ({token})")
        if re.search(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b", launcher):
            error(errors, "tooling/mcp/github_projects.ps1: contains a GitHub token literal")

    manifest_path = ROOT / ".github" / "project-documents.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        error(errors, f".github/project-documents.json: {exc}")
        return

    if manifest.get("schemaVersion") != 1:
        error(errors, ".github/project-documents.json: schemaVersion must be 1")
    if manifest.get("canonicalArtifact") != "repository-issue-body":
        error(errors, ".github/project-documents.json: canonicalArtifact must be repository-issue-body")
    if manifest.get("projectItemType") != "issue":
        error(errors, ".github/project-documents.json: projectItemType must be issue")
    if manifest.get("repository") != EXPECTED_GITHUB_REPOSITORY:
        error(errors, f".github/project-documents.json: repository must be {EXPECTED_GITHUB_REPOSITORY}")
    project = manifest.get("project")
    if not isinstance(project, dict):
        error(errors, ".github/project-documents.json: project object is missing")
        project = {}
    if project.get("owner") != EXPECTED_GITHUB_USER:
        error(errors, f".github/project-documents.json: project.owner must be {EXPECTED_GITHUB_USER}")

    origin = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if origin.returncode == 0:
        if origin.stdout.strip() != EXPECTED_GITHUB_REMOTE:
            error(errors, f"git origin must be {EXPECTED_GITHUB_REMOTE}")
        for key in ("owner", "number", "url"):
            if not project.get(key):
                error(errors, f".github/project-documents.json: project.{key} must be configured when origin exists")

    configured_user = subprocess.run(
        ["git", "config", "--local", "--get", "github.user"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if configured_user.returncode or configured_user.stdout.strip() != EXPECTED_GITHUB_USER:
        error(errors, f"local git config github.user must be {EXPECTED_GITHUB_USER}")

    github_wrapper = ROOT / "tooling" / "github.py"
    try:
        wrapper_text = github_wrapper.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        error(errors, f"tooling/github.py: {exc}")
    else:
        if 'GITHUB_USER = "noamtz"' not in wrapper_text:
            error(errors, "tooling/github.py: must select GitHub user noamtz")
        if '"--user", GITHUB_USER' not in wrapper_text:
            error(errors, "tooling/github.py: must request the selected user's keyring token")

    reference = ROOT / ".agents" / "references" / "github-project-documents.md"
    if not reference.is_file():
        error(errors, ".agents/references/github-project-documents.md is missing")
    agents_text = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    if ".agents/references/github-project-documents.md" not in agents_text:
        error(errors, "AGENTS.md: GitHub Project document contract is not linked")

    artifact_skills = {
        "plan-create-prd",
        "plan-architecture",
        "plan-create-stories",
        "piv-plan-implementation",
        "piv-implement",
        "piv-investigate-issue",
        "piv-implement-issue",
        "piv-review-changes",
        "piv-review-pr",
        "piv-create-pr",
        "piv-slice-epic",
        "system-execution-report",
        "system-evolution-review",
    }
    for skill_name in artifact_skills:
        skill_path = SKILLS_DIR / skill_name / "SKILL.md"
        text = skill_path.read_text(encoding="utf-8")
        if ".agents/references/github-project-documents.md" not in text:
            error(errors, f"{skill_path.relative_to(ROOT)}: GitHub Project document contract is not linked")
        if FORBIDDEN_GITHUB_USER in text:
            error(errors, f"{skill_path.relative_to(ROOT)}: contains the forbidden GitHub identity")
        if re.search(r"(?m)^\s*gh(?:\.exe)?\s", text):
            error(errors, f"{skill_path.relative_to(ROOT)}: bypasses tooling/github.py with bare gh")


def validate_github_identity_hook(errors: list[str]) -> None:
    hook_path = ROOT / ".codex" / "hooks" / "pre_tool_use.py"
    hook_text = hook_path.read_text(encoding="utf-8")
    required = {
        'EXPECTED_GITHUB_USER = "noamtz"': "expected GitHub user",
        'FORBIDDEN_GITHUB_USER = "' + FORBIDDEN_GITHUB_USER + '"': "forbidden GitHub user",
        'EXPECTED_GITHUB_REMOTE = "git@github.com:noamtz/cpa-platform.git"': "expected Git remote",
        "uses_bare_github_cli": "bare GitHub CLI gate",
        "origin_matches_expected": "origin validation",
    }
    for token, purpose in required.items():
        if token not in hook_text:
            error(errors, f".codex/hooks/pre_tool_use.py: missing {purpose}")

    cases = [
        ({"tool_name": "Bash", "tool_input": {"command": "git status"}}, False, "ordinary command"),
        (
            {"tool_name": "Bash", "tool_input": {"command": "gh issue list"}},
            True,
            "bare gh command",
        ),
        (
            {"tool_name": "Bash", "tool_input": {"command": f"echo {FORBIDDEN_GITHUB_USER}"}},
            True,
            "forbidden GitHub identity",
        ),
        (
            {"tool_name": "mcp__github-projects__list_projects", "tool_input": {}},
            False,
            "GitHub MCP with correct origin",
        ),
    ]
    for event, should_deny, label in cases:
        result = subprocess.run(
            [sys.executable, str(hook_path)],
            cwd=ROOT,
            input=json.dumps(event),
            check=False,
            capture_output=True,
            text=True,
        )
        denied = '"permissionDecision":"deny"' in result.stdout
        if denied != should_deny:
            error(errors, f".codex/hooks/pre_tool_use.py: wrong decision for {label}")


def validate_archon(errors: list[str]) -> None:
    for path in sorted((ROOT / ".archon" / "workflows").glob("*.yaml")):
        text = path.read_text(encoding="utf-8")
        if re.search(r"(?m)^provider:\s*(?!codex\s*$)\S+", text):
            error(errors, f"{path.relative_to(ROOT)}: workflow provider is not codex")
        if re.search(r"(?i)claude|sonnet|opus|haiku", text):
            error(errors, f"{path.relative_to(ROOT)}: contains a Claude model or instruction reference")


def validate_active_text(errors: list[str]) -> None:
    active_roots = [ROOT / "AGENTS.md", ROOT / ".agents" / "skills", ROOT / ".codex", ROOT / ".archon"]
    forbidden = {
        "$ARGUMENTS": "Claude argument placeholder",
        ".claude/": "Claude project path",
        "CLAUDE.md": "Claude instruction filename",
    }
    for source in active_roots:
        paths = [source] if source.is_file() else source.rglob("*")
        for path in paths:
            if not path.is_file() or "archive" in path.parts or path.suffix.lower() not in {
                ".md",
                ".toml",
                ".json",
                ".yaml",
                ".yml",
                ".py",
                ".sh",
            }:
                continue
            text = path.read_text(encoding="utf-8")
            for token, label in forbidden.items():
                if token == "$ARGUMENTS" and ".archon" in path.parts:
                    # $ARGUMENTS is Archon's documented workflow input variable.
                    continue
                if token in text:
                    error(errors, f"{path.relative_to(ROOT)}: contains {label} ({token})")

    if (ROOT / ".claude").exists():
        error(errors, ".claude still exists; active Claude configuration should be archived or removed")
    if (ROOT / ".mcp.json").exists():
        error(errors, ".mcp.json still exists; Codex MCP config belongs in .codex/config.toml")


def main() -> int:
    errors: list[str] = []
    if not (ROOT / "AGENTS.md").is_file():
        error(errors, "AGENTS.md is missing")
    validate_skills(errors)
    validate_agents(errors)
    validate_config(errors)
    validate_github_project_documents(errors)
    validate_github_identity_hook(errors)
    validate_archon(errors)
    validate_active_text(errors)

    if errors:
        print(f"Codex AI layer validation failed with {len(errors)} error(s):")
        for item in errors:
            print(f"- {item}")
        return 1

    skill_count = sum(1 for path in SKILLS_DIR.iterdir() if path.is_dir())
    agent_count = sum(1 for _ in AGENTS_DIR.glob("*.toml"))
    print(f"Codex AI layer is valid: {skill_count} skills, {agent_count} custom agents.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
