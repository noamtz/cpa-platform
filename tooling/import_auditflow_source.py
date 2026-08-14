#!/usr/bin/env python3
"""Import a pinned AuditFlow Git tree without touching its working tree."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


PINNED_COMMIT = "5920c779cc49d6502bdbb2aad56e40845778fc9c"
PINNED_TREE = "3b917168ac82d871be3fe08e503388b7eae06ff8"
PINNED_COUNTS = {
    "copy-exact": 174,
    "adapt-after-copy": 3,
    "merge": 1,
    "exclude": 6,
}
WORKFLOW_JOBS = {
    ".github/workflows/deploy-lambda.yml": "deploy",
    ".github/workflows/deploy-lambda-prod.yml": "deploy",
    ".github/workflows/rollback-prod.yml": "rollback",
}
WORKFLOW_COMMENT = (
    "    # Legacy AuditFlow deployment evidence only; disabled in cpa-platform. See #9.\n"
)
WORKFLOW_GUARD = "    if: github.repository == 'noamtz/auditflow'\n"
PRESERVED_SOURCE_PREFIXES = (".codex/", ".archon/", "tooling/")
ALLOWED_IMPLEMENTATION_DIRTY_PATHS = {
    "tooling/import_auditflow_source.py",
    "tooling/tests/test_import_auditflow_source.py",
}
REQUIRED_DESTINATION_IGNORE_RULES = {".codex/logs/", "__pycache__/", "*.pyc"}
TRACKED_IGNORE_EXCEPTIONS = {"base44/.app.jsonc": "!base44/.app.jsonc"}


class ImportFailure(RuntimeError):
    """Raised when an import safety invariant is not satisfied."""


@dataclass(frozen=True)
class TreeEntry:
    mode: str
    kind: str
    object_id: str
    size: int
    path: str
    disposition: str


@dataclass(frozen=True)
class SourceSnapshot:
    remote: str
    commit: str
    tree: str
    git_version: str
    entries: tuple[TreeEntry, ...]


def run(
    command: list[str],
    *,
    cwd: Path,
    input_bytes: bytes | None = None,
) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        command,
        cwd=cwd,
        input=input_bytes,
        check=False,
        capture_output=True,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).decode("utf-8", "replace").strip()
        raise ImportFailure(f"{' '.join(command)} failed in {cwd}: {detail}")
    return result


def git(repo: Path, *args: str, input_bytes: bytes | None = None) -> bytes:
    return run(["git", *args], cwd=repo, input_bytes=input_bytes).stdout


def decode(value: bytes) -> str:
    return value.decode("utf-8", "surrogateescape").strip()


def resolve_repo(path: Path, label: str) -> Path:
    resolved = path.resolve(strict=True)
    top = Path(decode(git(resolved, "rev-parse", "--show-toplevel"))).resolve(strict=True)
    if resolved != top:
        raise ImportFailure(f"{label} must be the repository root: {top}")
    return resolved


def ensure_separate_paths(first: Path, second: Path, labels: tuple[str, str]) -> None:
    try:
        first.relative_to(second)
    except ValueError:
        pass
    else:
        raise ImportFailure(f"{labels[0]} must not be inside {labels[1]}")
    try:
        second.relative_to(first)
    except ValueError:
        pass
    else:
        raise ImportFailure(f"{labels[1]} must not be inside {labels[0]}")


def status_paths(repo: Path) -> list[str]:
    raw = git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    paths: list[str] = []
    fields = raw.split(b"\0")
    index = 0
    while index < len(fields):
        field = fields[index]
        index += 1
        if not field:
            continue
        text = field.decode("utf-8", "surrogateescape")
        if len(text) < 4:
            raise ImportFailure(f"Could not parse git status entry: {text!r}")
        paths.append(text[3:].replace("\\", "/"))
        if text[:2] in {"R ", "C ", " R", " C"} and index < len(fields):
            index += 1
    return paths


def require_clean_source(source: Path) -> None:
    dirty = status_paths(source)
    if dirty:
        raise ImportFailure(f"Source repository is dirty: {dirty}")


def require_clean_destination(destination: Path) -> None:
    dirty = status_paths(destination)
    unexpected = [path for path in dirty if path not in ALLOWED_IMPLEMENTATION_DIRTY_PATHS]
    if unexpected:
        raise ImportFailure(f"Destination repository is dirty: {unexpected}")


def validate_relative_path(raw_path: str) -> str:
    path = PurePosixPath(raw_path)
    if not raw_path or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ImportFailure(f"Unsafe Git path: {raw_path!r}")
    if "\\" in raw_path:
        raise ImportFailure(f"Git path contains a backslash: {raw_path!r}")
    return path.as_posix()


def contained_path(root: Path, relative_path: str) -> Path:
    target = (root / Path(*PurePosixPath(validate_relative_path(relative_path)).parts)).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError as exc:
        raise ImportFailure(f"Path escapes destination: {relative_path!r}") from exc
    return target


def disposition_for(path: str) -> str:
    if path == "README.md" or path == ".agents/AGENTS.md" or path.startswith(".agents/skills/"):
        return "exclude"
    if path == ".gitignore":
        return "merge"
    if path in WORKFLOW_JOBS:
        return "adapt-after-copy"
    if (
        path == "AGENTS.md"
        or path == ".github/project-documents.json"
        or path.startswith(PRESERVED_SOURCE_PREFIXES)
    ):
        raise ImportFailure(f"Source path collides with preserved destination control: {path}")
    return "copy-exact"


def read_tree(source: Path, commit: str) -> tuple[TreeEntry, ...]:
    raw = git(source, "ls-tree", "-r", "-z", "--long", commit)
    entries: list[TreeEntry] = []
    folded: dict[str, list[str]] = {}
    for item in raw.split(b"\0"):
        if not item:
            continue
        try:
            metadata, encoded_path = item.split(b"\t", 1)
            mode, kind, object_id, raw_size = metadata.split()
        except ValueError as exc:
            raise ImportFailure("Could not parse git ls-tree output") from exc
        path = validate_relative_path(encoded_path.decode("utf-8", "surrogateescape"))
        size = int(raw_size) if raw_size.isdigit() else 0
        entry = TreeEntry(
            mode=mode.decode("ascii"),
            kind=kind.decode("ascii"),
            object_id=object_id.decode("ascii"),
            size=size,
            path=path,
            disposition=disposition_for(path),
        )
        entries.append(entry)
        folded.setdefault(path.casefold(), []).append(path)

    collisions = [paths for paths in folded.values() if len(paths) > 1]
    if collisions:
        raise ImportFailure(f"Source contains case-colliding paths: {collisions}")
    return tuple(entries)


def validate_source_features(source: Path, entries: tuple[TreeEntry, ...]) -> None:
    unsupported_modes = [entry.path for entry in entries if entry.mode not in {"100644", "100755"}]
    if unsupported_modes:
        raise ImportFailure(f"Source contains gitlinks, symlinks, or unsupported modes: {unsupported_modes}")
    attributes = [entry.path for entry in entries if PurePosixPath(entry.path).name == ".gitattributes"]
    if attributes:
        raise ImportFailure(f"Source contains Git attribute files: {attributes}")
    lfs = [
        entry.path
        for entry in entries
        if git(source, "cat-file", "blob", entry.object_id).startswith(
            b"version https://git-lfs.github.com/spec/"
        )
    ]
    if lfs:
        raise ImportFailure(f"Source contains Git LFS pointers: {lfs}")


def inspect_source(source_path: Path, expected_commit: str) -> SourceSnapshot:
    source = resolve_repo(source_path, "source")
    require_clean_source(source)
    head = decode(git(source, "rev-parse", "HEAD"))
    commit = decode(git(source, "rev-parse", f"{expected_commit}^{{commit}}"))
    if head != expected_commit or commit != expected_commit:
        raise ImportFailure(
            f"Source commit mismatch: HEAD={head}, resolved={commit}, expected={expected_commit}"
        )

    remote = decode(git(source, "remote", "get-url", "origin"))
    remote_main = decode(git(source, "ls-remote", remote, "refs/heads/main")).split()
    if not remote_main or remote_main[0] != expected_commit:
        actual = remote_main[0] if remote_main else "missing"
        raise ImportFailure(f"Source remote main mismatch: {actual} != {expected_commit}")

    tree = decode(git(source, "rev-parse", f"{expected_commit}^{{tree}}"))
    entries = read_tree(source, expected_commit)
    validate_source_features(source, entries)

    counts = disposition_counts(entries)
    if expected_commit == PINNED_COMMIT:
        if tree != PINNED_TREE:
            raise ImportFailure(f"Pinned tree mismatch: {tree} != {PINNED_TREE}")
        if counts != PINNED_COUNTS:
            raise ImportFailure(f"Pinned disposition counts changed: {counts} != {PINNED_COUNTS}")
        blob_bytes = sum(entry.size for entry in entries)
        if len(entries) != 184 or blob_bytes != 1_909_064:
            raise ImportFailure(f"Pinned inventory changed: {len(entries)} files/{blob_bytes} bytes")

    git_version = decode(run(["git", "--version"], cwd=source).stdout)
    return SourceSnapshot(remote, commit, tree, git_version, entries)


def disposition_counts(entries: Iterable[TreeEntry]) -> dict[str, int]:
    counts = {name: 0 for name in ("copy-exact", "adapt-after-copy", "merge", "exclude")}
    for entry in entries:
        counts[entry.disposition] += 1
    return counts


def archive_bytes(source: Path, commit: str) -> bytes:
    return run(
        ["git", "-c", "core.autocrlf=false", "archive", "--format=tar", commit],
        cwd=source,
    ).stdout


def extract_archive(archive: bytes, output: Path) -> None:
    if output.exists() and any(output.iterdir()):
        raise ImportFailure(f"Stage output is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    root = output.resolve()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
        for member in bundle.getmembers():
            if member.isdir():
                contained_path(root, member.name).mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise ImportFailure(f"Archive contains unsupported member: {member.name}")
            target = contained_path(root, member.name)
            payload = bundle.extractfile(member)
            if payload is None:
                raise ImportFailure(f"Could not read archive member: {member.name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload.read())
            if member.mode & 0o111:
                target.chmod(target.stat().st_mode | 0o111)


def raw_blob_id(repo: Path, path: Path) -> str:
    return decode(git(repo, "hash-object", "--no-filters", str(path)))


def adapt_workflow(source_bytes: bytes, path: str) -> bytes:
    try:
        text = source_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ImportFailure(f"Workflow is not UTF-8: {path}") from exc
    if WORKFLOW_GUARD.strip() in text or WORKFLOW_COMMENT.strip() in text:
        raise ImportFailure(f"Source workflow already contains the destination guard: {path}")
    job = WORKFLOW_JOBS[path]
    marker = f"jobs:\n  {job}:\n"
    if text.count(marker) != 1:
        raise ImportFailure(f"Could not locate unique job in workflow: {path}")
    return text.replace(marker, marker + WORKFLOW_COMMENT + WORKFLOW_GUARD, 1).encode("utf-8")


def remove_workflow_guard(destination_bytes: bytes, path: str) -> bytes:
    try:
        text = destination_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ImportFailure(f"Adapted workflow is not UTF-8: {path}") from exc
    block = WORKFLOW_COMMENT + WORKFLOW_GUARD
    if text.count(block) != 1:
        raise ImportFailure(f"Workflow guard is missing or duplicated: {path}")
    return text.replace(block, "", 1).encode("utf-8")


def merge_gitignore(destination_bytes: bytes, source_bytes: bytes) -> bytes:
    destination = destination_bytes.decode("utf-8")
    source = source_bytes.decode("utf-8")
    known_rules = {
        line.strip()
        for line in destination.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    additions: list[str] = []
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped:
            if additions and additions[-1] != "":
                additions.append("")
            continue
        if stripped.startswith("#"):
            if stripped.casefold() == "#env":
                stripped = "# Environment"
            if stripped not in additions:
                additions.append(stripped)
            continue
        if stripped not in known_rules:
            additions.append(stripped)
            known_rules.add(stripped)
    for ignored_path, exception in TRACKED_IGNORE_EXCEPTIONS.items():
        if ignored_path in additions and exception not in known_rules:
            additions.insert(additions.index(ignored_path) + 1, exception)
            known_rules.add(exception)
    while additions and additions[-1] == "":
        additions.pop()
    merged = destination.rstrip() + "\n\n# AuditFlow application runtime/build/infrastructure\n"
    merged += "\n".join(additions) + "\n"
    return merged.encode("utf-8")


def gitignore_rules(payload: bytes) -> list[str]:
    return [
        line.strip()
        for line in payload.decode("utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def verify_gitignore(source_bytes: bytes, destination_bytes: bytes) -> None:
    source_rules = set(gitignore_rules(source_bytes))
    destination_rules = gitignore_rules(destination_bytes)
    missing = sorted((source_rules | REQUIRED_DESTINATION_IGNORE_RULES) - set(destination_rules))
    if missing:
        raise ImportFailure(f"Merged .gitignore is missing rules: {missing}")
    duplicates = sorted({rule for rule in destination_rules if destination_rules.count(rule) > 1})
    if duplicates:
        raise ImportFailure(f"Merged .gitignore contains duplicate rules: {duplicates}")
    for ignored_path, exception in TRACKED_IGNORE_EXCEPTIONS.items():
        if ignored_path in source_rules:
            if exception not in destination_rules:
                raise ImportFailure(f"Merged .gitignore is missing tracked-file exception: {exception}")
            if destination_rules.index(exception) < destination_rules.index(ignored_path):
                raise ImportFailure(f"Tracked-file exception precedes broad rule: {exception}")


def verify_source_archive(source: Path, snapshot: SourceSnapshot, stage: Path) -> None:
    for entry in snapshot.entries:
        target = contained_path(stage, entry.path)
        if not target.is_file():
            raise ImportFailure(f"Archive is missing tracked file: {entry.path}")
        actual = raw_blob_id(source, target)
        if actual != entry.object_id:
            raise ImportFailure(f"Archived blob mismatch for {entry.path}: {actual} != {entry.object_id}")


def preflight_destination(
    destination: Path,
    snapshot: SourceSnapshot,
    *,
    allow_applied: bool,
) -> None:
    for entry in snapshot.entries:
        if entry.disposition not in {"copy-exact", "adapt-after-copy"}:
            continue
        target = contained_path(destination, entry.path)
        if target.exists() and not allow_applied:
            raise ImportFailure(f"Unexpected destination collision: {entry.path}")


def destination_metadata(destination: Path) -> dict[str, str]:
    return {
        "remote": decode(git(destination, "remote", "get-url", "origin")),
        "baseCommit": decode(git(destination, "rev-parse", "HEAD")),
        "branch": decode(git(destination, "branch", "--show-current")),
    }


def verify_destination_entry(
    source: Path,
    destination: Path,
    stage: Path,
    entry: TreeEntry,
) -> dict[str, str]:
    source_file = contained_path(stage, entry.path)
    if entry.disposition == "exclude":
        return {"status": "excluded-by-policy"}
    destination_file = contained_path(destination, entry.path)
    if not destination_file.is_file():
        raise ImportFailure(f"Destination is missing imported path: {entry.path}")
    destination_blob = raw_blob_id(destination, destination_file)
    if entry.disposition == "copy-exact":
        if destination_blob != entry.object_id:
            raise ImportFailure(
                f"Destination blob mismatch for {entry.path}: {destination_blob} != {entry.object_id}"
            )
        return {"status": "verified-exact", "destinationBlob": destination_blob}
    if entry.disposition == "adapt-after-copy":
        restored = remove_workflow_guard(destination_file.read_bytes(), entry.path)
        header = b"blob " + str(len(restored)).encode() + b"\0"
        if hashlib.sha1(header + restored).hexdigest() != entry.object_id:
            raise ImportFailure(f"Workflow has changes beyond its repository guard: {entry.path}")
        return {"status": "verified-adapted", "destinationBlob": destination_blob}
    verify_gitignore(source_file.read_bytes(), destination_file.read_bytes())
    return {"status": "verified-merged", "destinationBlob": destination_blob}


def build_manifest(
    source: Path,
    destination: Path,
    snapshot: SourceSnapshot,
    stage: Path,
    *,
    verify_applied: bool,
) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    for entry in snapshot.entries:
        verification = (
            verify_destination_entry(source, destination, stage, entry)
            if verify_applied
            else {"status": "verified-source"}
        )
        files.append(
            {
                "path": entry.path,
                "mode": entry.mode,
                "blob": entry.object_id,
                "size": entry.size,
                "destination": None if entry.disposition == "exclude" else entry.path,
                "disposition": entry.disposition,
                "verification": verification,
            }
        )
    return {
        "schemaVersion": 1,
        "source": {
            "remote": snapshot.remote,
            "commit": snapshot.commit,
            "tree": snapshot.tree,
            "gitVersion": snapshot.git_version,
            "trackedFiles": len(snapshot.entries),
            "blobBytes": sum(entry.size for entry in snapshot.entries),
        },
        "destination": destination_metadata(destination),
        "dispositionCounts": disposition_counts(snapshot.entries),
        "files": files,
    }


def manifest_verification_evidence(manifest: dict[str, Any]) -> dict[str, Any]:
    """Return the immutable evidence used to verify a committed import manifest."""
    source = manifest.get("source", {})
    destination = manifest.get("destination", {})
    return {
        "schemaVersion": manifest.get("schemaVersion"),
        "source": {
            "remote": source.get("remote"),
            "commit": source.get("commit"),
            "tree": source.get("tree"),
            "trackedFiles": source.get("trackedFiles"),
            "blobBytes": source.get("blobBytes"),
        },
        "destination": {"remote": destination.get("remote")},
        "dispositionCounts": manifest.get("dispositionCounts"),
        "files": manifest.get("files"),
    }


def compare_manifest(expected_path: Path, actual: dict[str, Any]) -> None:
    try:
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ImportFailure(f"Could not read manifest {expected_path}: {exc}") from exc
    if manifest_verification_evidence(expected) != manifest_verification_evidence(actual):
        raise ImportFailure(f"Manifest does not match the inspected source/destination: {expected_path}")


def inspect_command(args: argparse.Namespace) -> None:
    source = resolve_repo(args.source, "source")
    destination = resolve_repo(args.destination, "destination")
    ensure_separate_paths(source, destination, ("source", "destination"))
    snapshot = inspect_source(source, args.expected_commit)
    preflight_destination(destination, snapshot, allow_applied=args.verify_applied)
    with tempfile.TemporaryDirectory(prefix="auditflow-inspect-") as temporary:
        stage = Path(temporary).resolve()
        ensure_separate_paths(stage, source, ("stage", "source"))
        ensure_separate_paths(stage, destination, ("stage", "destination"))
        extract_archive(archive_bytes(source, snapshot.commit), stage)
        verify_source_archive(source, snapshot, stage)
        manifest = build_manifest(
            source,
            destination,
            snapshot,
            stage,
            verify_applied=args.verify_applied,
        )
    if args.manifest:
        compare_manifest(args.manifest.resolve(), manifest)
    print(
        json.dumps(
            {
                "sourceCommit": snapshot.commit,
                "sourceTree": snapshot.tree,
                "trackedFiles": len(snapshot.entries),
                "blobBytes": sum(entry.size for entry in snapshot.entries),
                "dispositionCounts": disposition_counts(snapshot.entries),
                "verifiedApplied": args.verify_applied,
            },
            indent=2,
        )
    )


def stage_command(args: argparse.Namespace) -> None:
    source = resolve_repo(args.source, "source")
    output = args.output.resolve()
    ensure_separate_paths(output, source, ("stage", "source"))
    snapshot = inspect_source(source, args.expected_commit)
    extract_archive(archive_bytes(source, snapshot.commit), output)
    verify_source_archive(source, snapshot, output)
    print(f"Staged {len(snapshot.entries)} verified files at {output}")


def apply_command(args: argparse.Namespace) -> None:
    source = resolve_repo(args.source, "source")
    destination = resolve_repo(args.destination, "destination")
    ensure_separate_paths(source, destination, ("source", "destination"))
    require_clean_destination(destination)
    snapshot = inspect_source(source, args.expected_commit)
    preflight_destination(destination, snapshot, allow_applied=False)
    manifest_path = args.manifest.resolve()
    try:
        manifest_path.relative_to(destination)
    except ValueError as exc:
        raise ImportFailure("Manifest must be written inside the destination repository") from exc
    if manifest_path.exists():
        raise ImportFailure(f"Manifest already exists: {manifest_path}")

    with tempfile.TemporaryDirectory(prefix="auditflow-apply-") as temporary:
        stage = Path(temporary).resolve()
        ensure_separate_paths(stage, source, ("stage", "source"))
        ensure_separate_paths(stage, destination, ("stage", "destination"))
        extract_archive(archive_bytes(source, snapshot.commit), stage)
        verify_source_archive(source, snapshot, stage)
        for entry in snapshot.entries:
            source_file = contained_path(stage, entry.path)
            destination_file = contained_path(destination, entry.path)
            if entry.disposition == "exclude":
                continue
            if entry.disposition == "merge":
                if not destination_file.is_file():
                    raise ImportFailure(f"Required merge destination is missing: {entry.path}")
                payload = merge_gitignore(destination_file.read_bytes(), source_file.read_bytes())
            elif entry.disposition == "adapt-after-copy":
                payload = adapt_workflow(source_file.read_bytes(), entry.path)
            else:
                payload = source_file.read_bytes()
            destination_file.parent.mkdir(parents=True, exist_ok=True)
            destination_file.write_bytes(payload)
            if entry.mode == "100755":
                destination_file.chmod(destination_file.stat().st_mode | 0o111)

        manifest = build_manifest(
            source,
            destination,
            snapshot,
            stage,
            verify_applied=True,
        )
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        f"Imported {len(snapshot.entries)} accounted paths at {snapshot.commit}; "
        f"manifest: {manifest_path.relative_to(destination)}"
    )


def add_source_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    inspect_parser = commands.add_parser("inspect", help="Inspect without writing")
    add_source_arguments(inspect_parser)
    inspect_parser.add_argument("--destination", type=Path, required=True)
    inspect_parser.add_argument("--verify-applied", action="store_true")
    inspect_parser.add_argument("--manifest", type=Path)
    inspect_parser.set_defaults(handler=inspect_command)

    stage_parser = commands.add_parser("stage", help="Extract the pinned tree to an empty directory")
    add_source_arguments(stage_parser)
    stage_parser.add_argument("--output", type=Path, required=True)
    stage_parser.set_defaults(handler=stage_command)

    apply_parser = commands.add_parser("apply", help="Apply the classified import")
    add_source_arguments(apply_parser)
    apply_parser.add_argument("--destination", type=Path, required=True)
    apply_parser.add_argument("--manifest", type=Path, required=True)
    apply_parser.set_defaults(handler=apply_command)
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()
        args.handler(args)
    except (FileNotFoundError, ImportFailure, OSError, ValueError) as exc:
        print(f"AuditFlow import failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
