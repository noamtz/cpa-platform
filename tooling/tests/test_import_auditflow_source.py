from __future__ import annotations

import argparse
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling import import_auditflow_source as importer


def run_git(repo: Path, *args: str, input_bytes: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        input=input_bytes,
        check=False,
        capture_output=True,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).decode("utf-8", "replace")
        raise AssertionError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout


def write_file(root: Path, relative: str, content: str) -> None:
    path = root / Path(*relative.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content.encode("utf-8"))


def initialize_repo(path: Path) -> None:
    path.mkdir(parents=True)
    run_git(path, "init", "-b", "main")
    run_git(path, "config", "user.name", "Importer Test")
    run_git(path, "config", "user.email", "importer@example.invalid")
    run_git(path, "config", "core.autocrlf", "false")


def commit_all(repo: Path, message: str) -> str:
    run_git(repo, "add", "--all")
    run_git(repo, "commit", "-m", message)
    return run_git(repo, "rev-parse", "HEAD").decode().strip()


class ImportAuditFlowSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="auditflow-import-test-")
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.destination = self.root / "destination"
        self.remote = self.root / "source-remote.git"
        initialize_repo(self.source)
        initialize_repo(self.destination)
        self._write_source_fixture()
        run_git(self.source, "add", "-f", "base44/.app.jsonc")
        self.source_commit = commit_all(self.source, "source baseline")
        run_git(self.root, "clone", "--bare", str(self.source), str(self.remote))
        run_git(self.source, "remote", "add", "origin", str(self.remote))
        self._write_destination_fixture()
        commit_all(self.destination, "destination baseline")
        run_git(
            self.destination,
            "remote",
            "add",
            "origin",
            "https://example.invalid/destination.git",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_source_fixture(self) -> None:
        write_file(self.source, ".gitignore", "node_modules\ndist\nbase44/.app.jsonc\n")
        write_file(self.source, "base44/.app.jsonc", "{}\n")
        write_file(self.source, "README.md", "source readme\n")
        write_file(self.source, "app.txt", "exact application bytes\n")
        write_file(self.source, "nested/file with spaces.txt", "nul-safe inventory path\n")
        write_file(self.source, ".agents/AGENTS.md", "obsolete instructions\n")
        write_file(self.source, ".agents/skills/legacy/SKILL.md", "legacy skill\n")
        for path, job in importer.WORKFLOW_JOBS.items():
            write_file(
                self.source,
                path,
                f"name: Fixture\n\non: workflow_dispatch\n\njobs:\n  {job}:\n"
                "    runs-on: ubuntu-latest\n    steps: []\n",
            )

    def _write_destination_fixture(self) -> None:
        write_file(
            self.destination,
            ".gitignore",
            ".codex/logs/\n__pycache__/\n*.pyc\n",
        )
        write_file(self.destination, "README.md", "destination readme\n")
        write_file(self.destination, "AGENTS.md", "destination controls\n")
        write_file(self.destination, "tooling/keep.txt", "keep tooling\n")
        write_file(self.destination, "sentinel.txt", "never delete\n")

    def inspect_args(self, **changes: object) -> argparse.Namespace:
        values: dict[str, object] = {
            "source": self.source,
            "destination": self.destination,
            "expected_commit": self.source_commit,
            "verify_applied": False,
            "manifest": None,
        }
        values.update(changes)
        return argparse.Namespace(**values)

    def apply_args(self) -> argparse.Namespace:
        return argparse.Namespace(
            source=self.source,
            destination=self.destination,
            expected_commit=self.source_commit,
            manifest=self.destination / "docs/migration/manifest.json",
        )

    def test_inspect_is_dry_run_and_classifies_nul_safe_inventory(self) -> None:
        before = run_git(self.destination, "status", "--porcelain=v1", "-z")
        with contextlib.redirect_stdout(io.StringIO()):
            importer.inspect_command(self.inspect_args())
        after = run_git(self.destination, "status", "--porcelain=v1", "-z")

        self.assertEqual(before, after)
        self.assertFalse((self.destination / "app.txt").exists())
        snapshot = importer.inspect_source(self.source, self.source_commit)
        by_path = {entry.path: entry for entry in snapshot.entries}
        self.assertEqual(by_path["app.txt"].disposition, "copy-exact")
        self.assertEqual(by_path[".gitignore"].disposition, "merge")
        self.assertEqual(by_path["README.md"].disposition, "exclude")
        self.assertEqual(
            by_path[".github/workflows/deploy-lambda.yml"].disposition,
            "adapt-after-copy",
        )
        self.assertIn("nested/file with spaces.txt", by_path)

    def test_apply_verifies_blobs_preserves_controls_and_source(self) -> None:
        source_head = run_git(self.source, "rev-parse", "HEAD")
        source_status = run_git(self.source, "status", "--porcelain=v1", "-z")
        with contextlib.redirect_stdout(io.StringIO()):
            importer.apply_command(self.apply_args())

        self.assertEqual((self.destination / "README.md").read_text(), "destination readme\n")
        self.assertEqual((self.destination / "AGENTS.md").read_text(), "destination controls\n")
        self.assertEqual((self.destination / "tooling/keep.txt").read_text(), "keep tooling\n")
        self.assertEqual((self.destination / "sentinel.txt").read_text(), "never delete\n")
        self.assertEqual((self.destination / "app.txt").read_text(), "exact application bytes\n")
        for path in importer.WORKFLOW_JOBS:
            workflow = (self.destination / Path(*path.split("/"))).read_text()
            self.assertIn("github.repository == 'noamtz/auditflow'", workflow)
            self.assertIn("See #9", workflow)

        manifest_path = self.apply_args().manifest
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["files"]), 10)
        exact = next(item for item in manifest["files"] if item["path"] == "app.txt")
        self.assertEqual(exact["blob"], exact["verification"]["destinationBlob"])
        untracked = run_git(
            self.destination,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        )
        self.assertIn(b"base44/.app.jsonc", untracked)

        recorded_base = manifest["destination"]["baseCommit"]
        manifest["source"]["gitVersion"] = "git version recorded-at-import"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        committed_import = commit_all(self.destination, "commit imported baseline")
        self.assertNotEqual(recorded_base, committed_import)
        with contextlib.redirect_stdout(io.StringIO()):
            importer.inspect_command(
                self.inspect_args(verify_applied=True, manifest=manifest_path)
            )

        manifest["files"][0]["blob"] = "0" * 40
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(importer.ImportFailure, "Manifest does not match"):
            importer.inspect_command(
                self.inspect_args(verify_applied=True, manifest=manifest_path)
            )

        self.assertEqual(run_git(self.source, "rev-parse", "HEAD"), source_head)
        self.assertEqual(run_git(self.source, "status", "--porcelain=v1", "-z"), source_status)

    def test_stage_extracts_exact_commit_outside_repositories(self) -> None:
        output = self.root / "stage"
        run_git(self.source, "config", "core.autocrlf", "true")
        args = argparse.Namespace(
            source=self.source,
            expected_commit=self.source_commit,
            output=output,
        )
        with contextlib.redirect_stdout(io.StringIO()):
            importer.stage_command(args)
        self.assertEqual((output / "app.txt").read_bytes(), b"exact application bytes\n")
        self.assertFalse((output / ".git").exists())

    def test_dirty_destination_is_rejected(self) -> None:
        write_file(self.destination, "dirty.txt", "uncommitted\n")
        with self.assertRaisesRegex(importer.ImportFailure, "Destination repository is dirty"):
            importer.apply_command(self.apply_args())

    def test_existing_copy_target_is_rejected_as_collision(self) -> None:
        write_file(self.destination, "app.txt", "collision\n")
        commit_all(self.destination, "add collision")
        with self.assertRaisesRegex(importer.ImportFailure, "Unexpected destination collision"):
            importer.apply_command(self.apply_args())

    def test_commit_drift_is_rejected(self) -> None:
        write_file(self.source, "later.txt", "drift\n")
        commit_all(self.source, "later source")
        with self.assertRaisesRegex(importer.ImportFailure, "Source commit mismatch"):
            importer.inspect_source(self.source, self.source_commit)

    def test_case_collisions_are_rejected(self) -> None:
        blob = run_git(self.source, "hash-object", "-w", "--stdin", input_bytes=b"same\n").decode().strip()
        tree_input = (
            f"100644 blob {blob}\tCase.txt\n"
            f"100644 blob {blob}\tcase.txt\n"
        ).encode()
        tree = run_git(self.source, "mktree", input_bytes=tree_input).decode().strip()
        commit = run_git(self.source, "commit-tree", tree, "-m", "case tree").decode().strip()
        with self.assertRaisesRegex(importer.ImportFailure, "case-colliding"):
            importer.read_tree(self.source, commit)

    def test_attributes_lfs_symlink_and_gitlink_are_rejected(self) -> None:
        normal_blob = run_git(
            self.source,
            "hash-object",
            "-w",
            "--stdin",
            input_bytes=b"target\n",
        ).decode().strip()
        lfs_blob = run_git(
            self.source,
            "hash-object",
            "-w",
            "--stdin",
            input_bytes=b"version https://git-lfs.github.com/spec/v1\n",
        ).decode().strip()
        commit_id = run_git(self.source, "rev-parse", "HEAD").decode().strip()
        cases = {
            "attribute": importer.TreeEntry(
                "100644", "blob", normal_blob, 7, ".gitattributes", "copy-exact"
            ),
            "lfs": importer.TreeEntry("100644", "blob", lfs_blob, 47, "asset.bin", "copy-exact"),
            "symlink": importer.TreeEntry("120000", "blob", normal_blob, 7, "link", "copy-exact"),
            "gitlink": importer.TreeEntry("160000", "commit", commit_id, 0, "module", "copy-exact"),
        }
        for label, entry in cases.items():
            with self.subTest(label=label):
                with self.assertRaises(importer.ImportFailure):
                    importer.validate_source_features(self.source, (entry,))

    def test_path_escape_and_preserved_source_controls_are_rejected(self) -> None:
        for path in ("../escape", "/absolute", "bad\\path"):
            with self.subTest(path=path):
                with self.assertRaises(importer.ImportFailure):
                    importer.validate_relative_path(path)
        for path in ("AGENTS.md", ".codex/config.toml", "tooling/overwrite.py"):
            with self.subTest(path=path):
                with self.assertRaises(importer.ImportFailure):
                    importer.disposition_for(path)


if __name__ == "__main__":
    unittest.main()
