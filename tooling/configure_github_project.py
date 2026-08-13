#!/usr/bin/env python3
"""Link this repository to a GitHub Project used for canonical project documents."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".github" / "project-documents.json"
GITHUB_HOST = "github.com"
GITHUB_OWNER = "noamtz"
GITHUB_REPOSITORY = "noamtz/cpa-platform"
PROJECT_DESCRIPTION = "Canonical product and delivery documents for AuditFlow."
PROJECT_README = """# AuditFlow project documents

Canonical PRDs and architecture documents are Markdown pages in the repository Wiki. Repository issues in this
Project track their epics and architecture work. Implementation plans, root-cause analyses, execution reports,
and review reports remain canonical in their issue bodies. Use the **Artifact type** field to filter them.

Technical contracts required while changing code remain versioned in the repository.
"""
WIKI_REPOSITORY = "noamtz/cpa-platform.wiki"
WIKI_URL = "https://github.com/noamtz/cpa-platform/wiki"
ARTIFACT_TYPES = [
    "PRD",
    "Architecture",
    "Implementation plan",
    "RCA",
    "Execution report",
    "Code review",
    "System review",
]
LABELS = {
    "epic": ("8250DF", "Master delivery tracker for a product epic"),
    "artifact:prd": ("0E8A16", "Canonical product requirements document"),
    "artifact:architecture": ("1D76DB", "Canonical architecture decision or specification"),
    "artifact:plan": ("5319E7", "Canonical implementation plan"),
    "artifact:rca": ("D93F0B", "Canonical root-cause analysis"),
    "artifact:report": ("FBCA04", "Canonical execution or review report"),
}
ARTIFACT_STORAGE = {
    "PRD": "github-wiki-markdown",
    "Architecture": "github-wiki-markdown",
    "Implementation plan": "repository-issue-body",
    "RCA": "repository-issue-body",
    "Execution report": "repository-issue-body",
    "Code review": "repository-issue-body",
    "System review": "repository-issue-body",
}


def run_gh(*args: str, json_output: bool = False) -> Any:
    token_result = subprocess.run(
        ["gh", "auth", "token", "--hostname", GITHUB_HOST, "--user", GITHUB_OWNER],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if token_result.returncode or not token_result.stdout.strip():
        detail = token_result.stderr.strip() or "credential not found"
        raise RuntimeError(f"GitHub account {GITHUB_OWNER} is unavailable: {detail}")
    environment = os.environ.copy()
    environment["GH_HOST"] = GITHUB_HOST
    environment["GH_TOKEN"] = token_result.stdout.strip()
    result = subprocess.run(
        ["gh", *args],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=environment,
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"gh {' '.join(args)} failed: {detail}")
    return json.loads(result.stdout) if json_output else result.stdout.strip()


def ensure_artifact_field(owner: str, project_number: int) -> None:
    fields = run_gh(
        "project",
        "field-list",
        str(project_number),
        "--owner",
        owner,
        "--format",
        "json",
        json_output=True,
    )
    names = {str(field.get("name", "")).casefold() for field in fields.get("fields", [])}
    if "artifact type" in names:
        return
    run_gh(
        "project",
        "field-create",
        str(project_number),
        "--owner",
        owner,
        "--name",
        "Artifact type",
        "--data-type",
        "SINGLE_SELECT",
        "--single-select-options",
        ",".join(ARTIFACT_TYPES),
    )


def ensure_labels(repository: str) -> None:
    for name, (color, description) in LABELS.items():
        run_gh(
            "label",
            "create",
            name,
            "--repo",
            repository,
            "--color",
            color,
            "--description",
            description,
            "--force",
        )


def configure(args: argparse.Namespace) -> dict[str, Any]:
    repository = GITHUB_REPOSITORY
    owner = GITHUB_OWNER

    if args.create_title:
        project = run_gh(
            "project",
            "create",
            "--owner",
            owner,
            "--title",
            args.create_title,
            "--format",
            "json",
            json_output=True,
        )
        project_number = int(project["number"])
    else:
        project_number = args.project_number
        project = run_gh(
            "project",
            "view",
            str(project_number),
            "--owner",
            owner,
            "--format",
            "json",
            json_output=True,
        )

    run_gh(
        "project",
        "edit",
        str(project_number),
        "--owner",
        owner,
        "--description",
        PROJECT_DESCRIPTION,
        "--readme",
        PROJECT_README,
    )
    run_gh("project", "link", str(project_number), "--owner", owner, "--repo", repository)
    ensure_artifact_field(owner, project_number)
    ensure_labels(repository)

    return {
        "schemaVersion": 2,
        "repository": repository,
        "wiki": {
            "repository": WIKI_REPOSITORY,
            "url": WIKI_URL,
            "canonicalArtifactTypes": ["PRD", "Architecture"],
        },
        "project": {
            "owner": owner,
            "number": project_number,
            "url": project.get("url"),
        },
        "canonicalArtifacts": ARTIFACT_STORAGE,
        "projectItemType": "issue",
        "projectItemRole": "tracker",
        "artifactField": "Artifact type",
        "artifactTypes": ARTIFACT_TYPES,
        "configuredAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Link an existing or new GitHub Project and configure document metadata."
    )
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--project-number", type=int, help="Existing GitHub Project number")
    choice.add_argument("--create-title", help="Create and link a new GitHub Project with this title")
    return parser.parse_args()


def main() -> int:
    try:
        manifest = configure(parse_args())
    except (FileNotFoundError, KeyError, ValueError, RuntimeError) as exc:
        print(f"GitHub Project configuration failed: {exc}", file=sys.stderr)
        print(f"Ensure gh is authenticated as {GITHUB_OWNER} with the project scope.", file=sys.stderr)
        return 1

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Configured {manifest['project']['url']} for {manifest['repository']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
