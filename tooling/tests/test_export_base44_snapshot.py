from __future__ import annotations

import contextlib
import copy
import io
import json
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from tooling import export_base44_snapshot as exporter


FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "base44-export" / "records.json"
)
VIEWER_PATH = Path(__file__).parents[1] / "base44_snapshot_viewer.html"


def fixture_records() -> dict[str, list[dict[str, object]]]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class SnapshotViewerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = VIEWER_PATH.read_text(encoding="utf-8")

    def test_viewer_is_offline_and_does_not_persist_snapshot_data(self) -> None:
        self.assertIn("connect-src 'none'", self.source)
        self.assertNotRegex(self.source, r"(?i)<script[^>]+src=")
        self.assertNotRegex(self.source, r"(?i)<link[^>]+href=")
        for forbidden_api in (
            "fetch(",
            "XMLHttpRequest",
            "WebSocket",
            "localStorage",
            "sessionStorage",
            "indexedDB",
            "innerHTML",
        ):
            with self.subTest(api=forbidden_api):
                self.assertNotIn(forbidden_api, self.source)

    def test_viewer_requires_a_folder_and_expected_snapshot_contract(self) -> None:
        self.assertIn("webkitdirectory", self.source)
        self.assertIn("manifest.json", self.source)
        for entity in exporter.ENTITIES:
            with self.subTest(entity=entity):
                self.assertIn(f'"{entity}"', self.source)

    def test_inline_script_has_valid_javascript_syntax(self) -> None:
        script = self.source.split("<script>", 1)[1].split("</script>", 1)[0]
        with tempfile.TemporaryDirectory() as temporary:
            script_path = Path(temporary) / "viewer.js"
            script_path.write_text(script, encoding="utf-8")
            result = subprocess.run(
                ["node", "--check", str(script_path)],
                capture_output=True,
                check=False,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)


class FakeBridge:
    data_env = "prod"
    app_fingerprint = "a" * 64
    source_sha256 = "b" * 64

    def __init__(self, records: dict[str, list[dict[str, object]]] | None = None):
        self.records = copy.deepcopy(records or fixture_records())
        self.calls: list[tuple[str, int, int]] = []
        self.signed: list[str] = []

    def list_page(self, entity: str, limit: int, skip: int) -> list[dict[str, object]]:
        self.calls.append((entity, limit, skip))
        values = sorted(self.records[entity], key=lambda item: str(item.get("id", "")))
        return copy.deepcopy(values[skip : skip + limit])

    def sign_file(self, source_reference: str) -> str:
        self.signed.append(source_reference)
        return "https://signed.example.test/synthetic"

    def sign_files(self, source_references: list[str]) -> list[exporter.SigningResult]:
        return [exporter.SigningResult(self.sign_file(item), None) for item in source_references]


class FakeResponse(io.BytesIO):
    def __init__(self, content: bytes, *, status: int = 200, headers: dict[str, str] | None = None):
        super().__init__(content)
        self.status = status
        self.code = status
        self.headers = headers or {}


class FakeOpener:
    def __init__(self, responses: list[FakeResponse | Exception]):
        self.responses = responses
        self.requests: list[object] = []

    def open(self, request: object, timeout: float) -> FakeResponse:
        self.requests.append(request)
        value = self.responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value


def synthetic_downloader(
    url: str,
    run_root: Path,
    *,
    allowed_hosts: frozenset[str] | None,
) -> exporter.DownloadResult:
    del url, allowed_hosts
    content = b"invented shared fixture bytes"
    digest = exporter.sha256_bytes(content)
    relative = f"files/sha256/{digest[:2]}/{digest}"
    path = exporter.contained_path(run_root, relative)
    exporter.publish_immutable(path, content)
    return exporter.DownloadResult(digest, len(content), relative)


class SnapshotPrimitiveTests(unittest.TestCase):
    def test_canonical_json_preserves_unicode_and_sorts_keys(self) -> None:
        value = {"z": "שלום", "a": {"b": 1}}
        self.assertEqual(
            exporter.canonical_json_bytes(value),
            '{"a":{"b":1},"z":"שלום"}'.encode("utf-8"),
        )
    def test_canonical_json_rejects_non_finite_numbers(self) -> None:
        with self.assertRaisesRegex(exporter.SnapshotFailure, "non_finite_number"):
            exporter.canonical_json_bytes({"value": float("nan")})

    def test_safe_relative_path_rejects_escape_and_backslash(self) -> None:
        for value in ("../state.json", "/state.json", "entities\\Client"):
            with self.subTest(value=value), self.assertRaises(exporter.SnapshotFailure):
                exporter.safe_relative_path(value)

    def test_atomic_write_replaces_complete_content(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "nested" / "state.json"
            exporter.atomic_write_bytes(path, b"first")
            exporter.atomic_write_bytes(path, b"second")
            self.assertEqual(path.read_bytes(), b"second")
            self.assertFalse(list(path.parent.glob("*.tmp")))

    def test_output_inside_worktree_is_rejected(self) -> None:
        with self.assertRaisesRegex(exporter.SnapshotFailure, "path_inside_repository"):
            exporter.require_absolute_outside_repository(exporter.REPOSITORY_ROOT, must_exist=True)

    def test_immutable_publish_detects_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "artifact"
            exporter.publish_immutable(path, b"one")
            exporter.publish_immutable(path, b"one")
            with self.assertRaisesRegex(exporter.SnapshotFailure, "immutable_artifact_drift"):
                exporter.publish_immutable(path, b"two")


class RuntimeTests(unittest.TestCase):
    def test_runtime_versions_require_pinned_deno(self) -> None:
        def runner(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            if command[0] == "node":
                return subprocess.CompletedProcess(command, 0, "v24.13.0\n", "")
            if command[0] in {"deno", "deno.cmd"}:
                return subprocess.CompletedProcess(command, 0, "deno 2.9.5\nv8 synthetic\n", "")
            return subprocess.CompletedProcess(command, 0, "0.1.10\n", "")

        self.assertEqual(
            exporter.runtime_versions(runner),
            {"node": "v24.13.0", "deno": "2.9.5", "base44Cli": "0.1.10"},
        )

    def test_runtime_versions_fail_safely_when_deno_is_missing(self) -> None:
        def runner(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            if command[0] == "node":
                return subprocess.CompletedProcess(command, 0, "v24.13.0\n", "")
            if command[0] in {"deno", "deno.cmd"}:
                raise FileNotFoundError
            return subprocess.CompletedProcess(command, 0, "0.1.10\n", "")

        with self.assertRaisesRegex(exporter.SnapshotFailure, "deno_runtime_unavailable"):
            exporter.runtime_versions(runner)


class PaginationTests(unittest.TestCase):
    def test_empty_entity_closes_on_one_empty_page(self) -> None:
        records = fixture_records()
        records["Client"] = []
        bridge = FakeBridge(records)
        inventory = exporter.inventory_records(bridge, "Client", 1000)
        self.assertEqual(len(inventory.records), 0)
        self.assertEqual(bridge.calls, [("Client", 1000, 0)])

    def test_exact_page_and_page_plus_one_boundaries(self) -> None:
        for count, expected_offsets in ((1000, [0, 1000]), (1001, [0, 1000])):
            with self.subTest(count=count):
                records = fixture_records()
                records["Client"] = [{"id": f"record-{index:04d}"} for index in range(count)]
                bridge = FakeBridge(records)
                inventory = exporter.inventory_records(bridge, "Client", 1000)
                self.assertEqual(len(inventory.records), count)
                self.assertEqual([call[2] for call in bridge.calls], expected_offsets)

    def test_missing_duplicate_and_non_increasing_ids_fail_closed(self) -> None:
        cases = (
            [{"name": "missing"}],
            [{"id": "same"}, {"id": "same"}],
        )
        for values in cases:
            with self.subTest(values=values):
                bridge = FakeBridge({**fixture_records(), "Client": values})
                with self.assertRaises(exporter.SnapshotFailure):
                    exporter.inventory_records(bridge, "Client", 1000)

        class UnsortedBridge(FakeBridge):
            def list_page(self, entity: str, limit: int, skip: int) -> list[dict[str, object]]:
                return [{"id": "z"}, {"id": "a"}][skip : skip + limit]

        with self.assertRaisesRegex(exporter.SnapshotFailure, "non_increasing_record_id"):
            exporter.inventory_records(UnsortedBridge(), "Client", 1000)

    def test_inventory_preserves_raw_embedded_json_string(self) -> None:
        raw = '{ "z": 1, "a": [2] }'
        bridge = FakeBridge({**fixture_records(), "Client": [{"id": "one", "raw": raw}]})
        inventory = exporter.inventory_records(bridge, "Client", 10)
        self.assertEqual(inventory.records[0]["raw"], raw)

    def test_stability_compares_per_id_record_hashes(self) -> None:
        first = exporter.inventory_records(
            FakeBridge({**fixture_records(), "Client": [{"id": "one", "value": 1}]}),
            "Client",
            10,
        )
        second = exporter.inventory_records(
            FakeBridge({**fixture_records(), "Client": [{"id": "one", "value": 2}]}),
            "Client",
            10,
        )
        with self.assertRaisesRegex(exporter.SnapshotFailure, "source_inventory_drift"):
            exporter.assert_same_inventory(first, second)

    def test_page_size_one_and_normal_must_have_same_ids(self) -> None:
        first = exporter.inventory_records(
            FakeBridge({**fixture_records(), "Client": [{"id": "one"}, {"id": "two"}]}),
            "Client",
            10,
        )
        second = exporter.inventory_records(
            FakeBridge({**fixture_records(), "Client": [{"id": "one"}]}),
            "Client",
            1,
        )
        with self.assertRaisesRegex(exporter.SnapshotFailure, "pagination_id_set_mismatch"):
            exporter.assert_same_id_set(first, second)


class ResumeTests(unittest.TestCase):
    def test_resume_verifies_checkpoint_and_accepts_artifact_ahead_of_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            bridge = FakeBridge()
            run_root, state = exporter._initialize_or_resume(output, bridge, 1000, None, 0, False)
            content = b"durable"
            exporter.publish_immutable(run_root / "durable.bin", content)
            exporter._checkpoint_artifact(run_root, state, "durable.bin", content)
            exporter.publish_immutable(run_root / "ahead.bin", b"not-checkpointed")
            resumed_root, resumed = exporter._initialize_or_resume(
                output, bridge, 1000, None, 0, True
            )
            self.assertEqual(resumed_root, run_root)
            self.assertEqual(resumed["status"], "inventory")

    def test_resume_rejects_artifact_tamper(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            bridge = FakeBridge()
            run_root, state = exporter._initialize_or_resume(output, bridge, 1000, None, 0, False)
            exporter.publish_immutable(run_root / "durable.bin", b"durable")
            exporter._checkpoint_artifact(run_root, state, "durable.bin", b"durable")
            (run_root / "durable.bin").write_bytes(b"tampered")
            with self.assertRaisesRegex(exporter.SnapshotFailure, "checkpoint_artifact_tamper"):
                exporter._initialize_or_resume(output, bridge, 1000, None, 0, True)

    def test_resume_rejects_page_size_and_bridge_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            bridge = FakeBridge()
            exporter._initialize_or_resume(output, bridge, 1000, None, 0, False)
            with self.assertRaisesRegex(exporter.SnapshotFailure, "resume_config_drift"):
                exporter._initialize_or_resume(output, bridge, 999, None, 0, True)

    def test_resume_rejects_a_different_exporter_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            bridge = FakeBridge()
            run_root, state = exporter._initialize_or_resume(
                output, bridge, 1000, None, 0, False
            )
            state["toolVersion"] = "0.9.0"
            exporter.write_json(run_root / "state.json", state)
            with self.assertRaisesRegex(exporter.SnapshotFailure, "tool_version_mismatch"):
                exporter._initialize_or_resume(output, bridge, 1000, None, 0, True)

    def test_resume_discards_only_uncheckpointed_partial_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            bridge = FakeBridge()
            run_root, _ = exporter._initialize_or_resume(output, bridge, 1000, None, 0, False)
            partial_root = run_root / "files" / "sha256"
            partial_root.mkdir(parents=True)
            partial = partial_root / ".download-fixture.part"
            unrelated = partial_root / "keep-me"
            partial.write_bytes(b"partial")
            unrelated.write_bytes(b"private artifact ahead of checkpoint")
            exporter._initialize_or_resume(output, bridge, 1000, None, 0, True)
            self.assertFalse(partial.exists())
            self.assertTrue(unrelated.exists())

    def test_fresh_run_never_reuses_existing_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            first, _ = exporter._initialize_or_resume(output, FakeBridge(), 1000, None, 0, False)
            second, _ = exporter._initialize_or_resume(output, FakeBridge(), 1000, None, 0, False)
            self.assertNotEqual(first, second)

    def test_concurrent_export_fails_before_loading_or_overwriting_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary).resolve()
            with exporter._exclusive_export_lock(output):
                with self.assertRaisesRegex(exporter.SnapshotFailure, "export_lock_held"):
                    exporter.export_snapshot(
                        FakeBridge(), output, downloader=synthetic_downloader
                    )


class DiscoveryTests(unittest.TestCase):
    def inventories(self, records: dict[str, list[dict[str, object]]] | None = None):
        bridge = FakeBridge(records)
        return {
            entity: exporter.inventory_records(bridge, entity, 1000)
            for entity in exporter.ENTITIES
        }

    def test_fixture_covers_raw_decoded_typed_legacy_and_public_references(self) -> None:
        references, findings = exporter.discover_references(self.inventories())
        sources = {item["sourceReference"] for item in references.values()}
        self.assertIn("private/submission-fixture/form-106", sources)
        self.assertIn("private/submission-fixture/stale", sources)
        self.assertIn("private://submission-fixture/signed-pdf", sources)
        self.assertIn("private/pdf-template-fixture/base", sources)
        self.assertIn("https://files.example.test/synthetic/document", sources)
        self.assertFalse(findings)

    def test_json_pointer_escapes_decoded_object_keys(self) -> None:
        references, _ = exporter.discover_references(self.inventories())
        item = next(
            value
            for value in references.values()
            if value["sourceReference"] == "private/submission-fixture/stale"
        )
        pointers = {entry["jsonPointer"] for entry in item["occurrences"]}
        self.assertIn("/responses/$decoded/stale~1step~0one/files/0", pointers)

    def test_duplicate_reference_keeps_all_occurrences(self) -> None:
        references, _ = exporter.discover_references(self.inventories())
        item = next(
            value
            for value in references.values()
            if value["sourceReference"] == "private://submission-fixture/signed-pdf"
        )
        self.assertEqual(len(item["occurrences"]), 2)

    def test_malformed_known_json_is_a_typed_finding(self) -> None:
        records = fixture_records()
        records["Submission"][0]["responses"] = "{broken"
        _, findings = exporter.discover_references(self.inventories(records))
        self.assertIn("malformed_known_json", {item["reason"] for item in findings})

    def test_drive_ids_normal_text_and_embedded_base64_are_not_references(self) -> None:
        references, _ = exporter.discover_references(self.inventories())
        sources = {item["sourceReference"] for item in references.values()}
        self.assertNotIn("drive-fixture-id-not-a-url", sources)
        self.assertFalse(any(source.startswith("data:") for source in sources))

    def test_unknown_scheme_and_http_are_unresolved(self) -> None:
        records = fixture_records()
        records["Client"][0]["unknown"] = ["http://files.example.test/a", "ftp://files.example.test/b"]
        _, findings = exporter.discover_references(self.inventories(records))
        self.assertEqual(
            sum(item["reason"] == "unsupported_reference" for item in findings), 2
        )

    def test_private_reference_variants_only_swap_evidenced_private_prefixes(self) -> None:
        self.assertEqual(
            exporter.private_reference_variants("private://fixture/path"),
            [("private_scheme_to_path", "private/fixture/path")],
        )
        self.assertEqual(
            exporter.private_reference_variants("private/fixture/path"),
            [("private_path_to_scheme", "private://fixture/path")],
        )
        self.assertEqual(exporter.private_reference_variants("mp/fixture/path"), [])


class DownloadTests(unittest.TestCase):
    def test_streams_and_content_addresses_exact_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeOpener([FakeResponse(b"fixture", headers={"Content-Length": "7"})])
            result = exporter.download_to_store(
                "https://files.example.test/item",
                Path(temporary),
                allowed_hosts=frozenset({"files.example.test"}),
                opener=opener,
                url_validator=lambda url, hosts: None,
            )
            self.assertEqual(result.byte_length, 7)
            self.assertEqual(exporter.contained_path(Path(temporary), result.relative_path).read_bytes(), b"fixture")

    def test_duplicate_content_reuses_one_content_object(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = exporter.download_to_store(
                "https://one.example.test/item",
                root,
                allowed_hosts=None,
                opener=FakeOpener([FakeResponse(b"same")]),
                url_validator=lambda url, hosts: None,
            )
            second = exporter.download_to_store(
                "https://two.example.test/item",
                root,
                allowed_hosts=None,
                opener=FakeOpener([FakeResponse(b"same")]),
                url_validator=lambda url, hosts: None,
            )
            self.assertEqual(first, second)
            self.assertEqual(len(list((root / "files" / "sha256").glob("*/*"))), 1)

    def test_content_length_and_size_limit_fail_closed(self) -> None:
        cases = (
            (FakeResponse(b"short", headers={"Content-Length": "9"}), 100, "content_length_mismatch"),
            (FakeResponse(b"oversized"), 3, "size_limit_exceeded"),
        )
        for response, limit, category in cases:
            with self.subTest(category=category), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(exporter.SnapshotFailure, category):
                    exporter.download_to_store(
                        "https://files.example.test/item",
                        Path(temporary),
                        allowed_hosts=None,
                        max_bytes=limit,
                        opener=FakeOpener([response]),
                        url_validator=lambda url, hosts: None,
                    )

    def test_http_not_found_is_a_static_missing_source_category(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            error = urllib.error.HTTPError(
                "https://files.example.test/missing", 404, "private detail", {}, None
            )
            with self.assertRaisesRegex(exporter.SnapshotFailure, "source_file_missing"):
                exporter.download_to_store(
                    "https://files.example.test/missing",
                    Path(temporary),
                    allowed_hosts=frozenset({"files.example.test"}),
                    opener=FakeOpener([error]),
                    url_validator=lambda url, hosts: None,
                )

    def test_each_redirect_is_revalidated(self) -> None:
        validated: list[str] = []
        with tempfile.TemporaryDirectory() as temporary:
            opener = FakeOpener(
                [
                    FakeResponse(b"", status=302, headers={"Location": "https://next.example.test/b"}),
                    FakeResponse(b"done"),
                ]
            )
            exporter.download_to_store(
                "https://first.example.test/a",
                Path(temporary),
                allowed_hosts=None,
                opener=opener,
                url_validator=lambda url, hosts: validated.append(url),
            )
        self.assertEqual(
            validated,
            ["https://first.example.test/a", "https://next.example.test/b"],
        )

    def test_private_loopback_and_unapproved_host_are_rejected(self) -> None:
        with mock.patch.object(
            exporter.socket,
            "getaddrinfo",
            return_value=[(2, 1, 6, "", ("127.0.0.1", 443))],
        ):
            with self.assertRaisesRegex(exporter.SnapshotFailure, "unsafe_download_address"):
                exporter.validate_download_url("https://files.example.test/a", None)
        with mock.patch.object(
            exporter.socket,
            "getaddrinfo",
            return_value=[(2, 1, 6, "", ("203.0.113.10", 443))],
        ):
            with self.assertRaisesRegex(exporter.SnapshotFailure, "public_host_review_required"):
                exporter.validate_download_url(
                    "https://files.example.test/a", frozenset({"other.example.test"})
                )

    def test_non_global_shared_address_space_is_rejected(self) -> None:
        with mock.patch.object(
            exporter.socket,
            "getaddrinfo",
            return_value=[(2, 1, 6, "", ("100.64.0.1", 443))],
        ):
            with self.assertRaisesRegex(exporter.SnapshotFailure, "unsafe_download_address"):
                exporter.validate_download_url("https://files.example.test/a", None)

        with mock.patch.object(
            exporter.socket,
            "getaddrinfo",
            return_value=[(2, 1, 6, "", ("8.8.8.8", 443))],
        ):
            parsed = exporter.validate_download_url("https://files.example.test/a", None)
        self.assertEqual(parsed.hostname, "files.example.test")

    def test_default_transport_uses_the_validated_address_without_second_dns_lookup(self) -> None:
        public_result = [(2, 1, 6, "", ("8.8.8.8", 443))]
        private_rebind = [(2, 1, 6, "", ("127.0.0.1", 443))]
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(
            exporter.socket,
            "getaddrinfo",
            side_effect=[public_result, private_rebind],
        ) as resolver, mock.patch.object(
            exporter,
            "_open_pinned_request",
            return_value=FakeResponse(b"fixture"),
        ) as pinned_open:
            exporter.download_to_store(
                "https://files.example.test/item",
                Path(temporary),
                allowed_hosts=frozenset({"files.example.test"}),
            )
        self.assertEqual(resolver.call_count, 1)
        self.assertEqual(pinned_open.call_args.args[1], ("8.8.8.8",))

    def test_pinned_connection_preserves_tls_hostname(self) -> None:
        tls_context = mock.Mock()
        raw_socket = mock.Mock()
        wrapped_socket = mock.Mock()
        tls_context.wrap_socket.return_value = wrapped_socket
        connection = exporter._PinnedHTTPSConnection(
            "files.example.test",
            pinned_address="8.8.8.8",
            context=tls_context,
        )
        connection._create_connection = mock.Mock(return_value=raw_socket)
        connection.connect()
        connection._create_connection.assert_called_once_with(
            ("8.8.8.8", 443), connection.timeout, connection.source_address
        )
        tls_context.wrap_socket.assert_called_once_with(
            raw_socket, server_hostname="files.example.test"
        )
        self.assertIs(connection.sock, wrapped_socket)

    def test_allowlist_is_absolute_private_canonical_and_immutable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "allowlist.json"
            path.write_text('{"hosts":["b.example.test","a.example.test"]}', encoding="utf-8")
            hosts, digest, count = exporter.load_public_host_allowlist(path)
            self.assertEqual(hosts, frozenset({"a.example.test", "b.example.test"}))
            self.assertEqual(count, 2)
            self.assertEqual(
                digest,
                exporter.sha256_bytes(exporter.canonical_json_bytes(["a.example.test", "b.example.test"])),
            )

    def test_duplicate_and_malformed_allowlist_hosts_fail(self) -> None:
        values = (["a.example.test", "a.example.test"], ["A.example.test"], ["127.0.0.1"])
        for hosts in values:
            with self.subTest(hosts=hosts), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "allowlist.json"
                path.write_text(json.dumps(hosts), encoding="utf-8")
                with self.assertRaises(exporter.SnapshotFailure):
                    exporter.load_public_host_allowlist(path)


class BridgeProtocolTests(unittest.TestCase):
    def test_static_stdin_program_uses_canonical_request_environment_and_strict_sentinel(self) -> None:
        captured: dict[str, object] = {}

        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            captured["command"] = command
            captured.update(kwargs)
            payload = {"ok": True, "result": {"records": [{"id": "fixture"}]}}
            stdout = f"status\n{exporter.BRIDGE_BEGIN}{json.dumps(payload)}{exporter.BRIDGE_END}\n"
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="private stderr sentinel")

        bridge = exporter.Base44CliBridge(
            runner=runner, environment={exporter.APP_ID_ENVIRONMENT_KEY: "private-app-fixture"}
        )
        self.assertEqual(bridge.list_page("Client", 10, 0), [{"id": "fixture"}])
        program = str(captured["input"])
        self.assertIn(exporter.BRIDGE_MARKER, program)
        self.assertNotIn('"entity":"Client"', program)
        command = captured["command"]
        self.assertNotIn("private-app-fixture", command)
        self.assertIn("--privileged", command)
        self.assertEqual(command[-2:], ["--data-env", "prod"])
        self.assertEqual(captured["encoding"], "utf-8")
        self.assertEqual(captured["errors"], "replace")
        environment = captured["env"]
        self.assertEqual(
            environment[exporter.REQUEST_ENVIRONMENT_KEY],
            '{"entity":"Client","limit":10,"operation":"list_page","skip":0}',
        )
        self.assertEqual(environment[exporter.DENO_NO_PACKAGE_JSON_ENVIRONMENT_KEY], "1")
        self.assertIn("auditflow-base44-cli-deno-cache-2.9.5", environment[exporter.DENO_DIR_ENVIRONMENT_KEY])

    def test_signing_response_is_returned_only_to_memory(self) -> None:
        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            payload = {"ok": True, "result": {"signedUrl": "https://signed.example.test/a?secret=x"}}
            stdout = f"{exporter.BRIDGE_BEGIN}{json.dumps(payload)}{exporter.BRIDGE_END}"
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

        bridge = exporter.Base44CliBridge(
            runner=runner, environment={exporter.APP_ID_ENVIRONMENT_KEY: "fixture"}
        )
        self.assertIn("?secret=", bridge.sign_file("private/fixture"))

    def test_signing_batch_stays_within_one_existing_operation(self) -> None:
        captured: dict[str, object] = {}

        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            captured.update(kwargs)
            payload = {
                "ok": True,
                "result": {
                    "signatures": [
                        {"ok": True, "signedUrl": "https://signed.example.test/a?secret=x"},
                        {"ok": False, "status": 404},
                    ]
                },
            }
            stdout = f"{exporter.BRIDGE_BEGIN}{json.dumps(payload)}{exporter.BRIDGE_END}"
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

        bridge = exporter.Base44CliBridge(
            runner=runner, environment={exporter.APP_ID_ENVIRONMENT_KEY: "fixture"}
        )
        results = bridge.sign_files(["private/one", "mp/private/two"])
        self.assertIsNotNone(results[0].signed_url)
        self.assertEqual(results[1].failure, "source_file_missing")
        request = json.loads(captured["env"][exporter.REQUEST_ENVIRONMENT_KEY])
        self.assertEqual(request["operation"], "sign_file")
        self.assertEqual(len(request["sourceReferences"]), 2)

    def test_page_size_one_probe_is_exhausted_inside_one_cli_process(self) -> None:
        captured: dict[str, object] = {}

        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            captured.update(kwargs)
            payload = {"ok": True, "result": {"records": [{"id": "one"}, {"id": "two"}]}}
            stdout = f"{exporter.BRIDGE_BEGIN}{json.dumps(payload)}{exporter.BRIDGE_END}"
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

        bridge = exporter.Base44CliBridge(
            runner=runner, environment={exporter.APP_ID_ENVIRONMENT_KEY: "fixture"}
        )
        self.assertEqual(
            bridge.list_all_page_size_one("Client"), [{"id": "one"}, {"id": "two"}]
        )
        self.assertIn(
            '"exhaust":true,"limit":1,"operation":"list_page","skip":0',
            captured["env"][exporter.REQUEST_ENVIRONMENT_KEY],
        )

    def test_cli_or_protocol_failure_exposes_only_static_category(self) -> None:
        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(command, 1, stdout="raw-id", stderr="secret-token")

        bridge = exporter.Base44CliBridge(
            runner=runner, environment={exporter.APP_ID_ENVIRONMENT_KEY: "fixture"}
        )
        with self.assertRaisesRegex(exporter.SnapshotFailure, "base44_cli_failed") as raised:
            bridge.list_page("Client", 1, 0)
        self.assertNotIn("secret-token", str(raised.exception))

    def test_signing_not_found_status_maps_to_static_missing_category(self) -> None:
        def runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            payload = {"ok": False, "error": "bridge_operation_failed", "status": 404}
            stdout = f"{exporter.BRIDGE_BEGIN}{json.dumps(payload)}{exporter.BRIDGE_END}"
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="private detail")

        bridge = exporter.Base44CliBridge(
            runner=runner, environment={exporter.APP_ID_ENVIRONMENT_KEY: "fixture"}
        )
        with self.assertRaisesRegex(exporter.SnapshotFailure, "source_file_missing"):
            bridge.sign_file("mp/private/fixture")


class ReadOnlySurfaceTests(unittest.TestCase):
    def test_bridge_has_exact_marker_and_only_read_sign_sdk_calls(self) -> None:
        source = exporter.BRIDGE_PATH.read_text(encoding="utf-8")
        self.assertEqual(source.count(exporter.BRIDGE_MARKER), 1)
        self.assertIn('.list("id", limit, skip)', source)
        self.assertIn("CreateFileSignedUrl", source)
        for forbidden in (
            ".create(",
            ".update(",
            ".delete(",
            "bulkCreate",
            "UploadPrivateFile",
            "asServiceRole",
            "functions.invoke",
            "fetch(",
            "connector",
            ".sync",
        ):
            self.assertNotIn(forbidden, source)

    def test_bridge_does_not_accept_an_sdk_method_name(self) -> None:
        source = exporter.BRIDGE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("value.method", source)
        self.assertIn('value.operation === "list_page"', source)
        self.assertIn('value.operation === "sign_file"', source)


class CliTests(unittest.TestCase):
    def test_sensitive_options_and_signed_query_urls_are_rejected_before_parse(self) -> None:
        for argv in (
            ["doctor", "--token", "do-not-print"],
            ["verify", "--snapshot", "https://signed.example.test/a?secret=value"],
            ["doctor", "--app-id=private"],
        ):
            with self.subTest(argv=argv), self.assertRaisesRegex(
                exporter.SnapshotFailure, "sensitive_argument_rejected"
            ):
                exporter.parse_args(argv)

    def test_production_confirmation_is_mandatory(self) -> None:
        args = exporter.parse_args(["doctor"])
        with self.assertRaisesRegex(exporter.SnapshotFailure, "production_confirmation_required"):
            exporter._require_confirmation(args)

    def test_main_redacts_invalid_argument_value(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            result = exporter.main(["verify", "--unknown", "sentinel-private-value"])
        self.assertEqual(result, 1)
        self.assertNotIn("sentinel-private-value", stderr.getvalue())
        self.assertIn("invalid_arguments", stderr.getvalue())

    def test_main_redacts_unexpected_exception_details(self) -> None:
        stderr = io.StringIO()
        with mock.patch.object(
            exporter,
            "parse_args",
            side_effect=RuntimeError("sentinel-private-runtime-detail"),
        ), contextlib.redirect_stderr(stderr):
            result = exporter.main([])
        self.assertEqual(result, 1)
        self.assertNotIn("sentinel-private-runtime-detail", stderr.getvalue())
        self.assertIn("unexpected_safe_failure", stderr.getvalue())

    def test_summary_outputs_are_fixed_to_approved_repository_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(exporter.SnapshotFailure, "summary_output_not_approved"):
                exporter.render_summary(
                    Path(temporary), Path(temporary) / "summary.json", Path(temporary) / "summary.md"
                )


class DiagnoseTests(unittest.TestCase):
    def test_exact_source_rechecks_are_batched_at_the_bridge_limit(self) -> None:
        class CappedBridge(FakeBridge):
            def __init__(self) -> None:
                super().__init__()
                self.batch_sizes: list[int] = []

            def sign_files(self, source_references: list[str]) -> list[exporter.SigningResult]:
                self.batch_sizes.append(len(source_references))
                if len(source_references) > 50:
                    raise AssertionError("bridge batch limit exceeded")
                return [exporter.SigningResult(None, "sign_failed") for _ in source_references]

        references = [
            {
                "referenceFingerprint": f"fingerprint-{index}",
                "sourceReference": f"mp/invented-{index}",
            }
            for index in range(51)
        ]
        findings = [
            {
                "reason": "sign_failed",
                "referenceFingerprint": item["referenceFingerprint"],
            }
            for item in references
        ]
        manifest = {"references": references, "findings": findings}
        with tempfile.TemporaryDirectory() as temporary:
            run_root = Path(temporary) / "failed-run"
            run_root.mkdir()
            (run_root / "state.json").write_text(
                '{"status":"failed","completedAt":"2026-08-23T00:00:00+00:00"}',
                encoding="utf-8",
            )
            (run_root / "manifest.json").write_text("{}", encoding="utf-8")
            bridge = CappedBridge()
            with mock.patch.object(
                exporter,
                "verify_snapshot",
                return_value=({"status": "failed"}, manifest),
            ):
                result = exporter.diagnose_failed_snapshot(bridge, Path(temporary))
        self.assertEqual(bridge.batch_sizes, [50, 1])
        self.assertEqual(result["exactOutcomeByReason"], {"sign_failed": 51})


class SnapshotIntegrationTests(unittest.TestCase):
    def test_end_to_end_snapshot_verify_summary_and_tamper_detection(self) -> None:
        sentinels = (
            "fixture@example.test",
            "Invented Fixture",
            "fixture-token-not-production",
            "private/submission-fixture",
            "client-fixture-0001",
            "files.example.test",
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowlist = root / "allowlist.json"
            allowlist.write_text('["files.example.test"]', encoding="utf-8")
            run_root, manifest = exporter.export_snapshot(
                FakeBridge(),
                root,
                page_size=2,
                public_host_allowlist=allowlist,
                downloader=synthetic_downloader,
            )
            _, verified = exporter.verify_snapshot(run_root)
            self.assertEqual(verified["totals"], manifest["totals"])
            self.assertTrue(all(verified["gates"].values()))
            summary_json = root / "summary.json"
            summary_markdown = root / "summary.md"
            with mock.patch.object(exporter, "SUMMARY_JSON_PATH", summary_json), mock.patch.object(
                exporter, "SUMMARY_MARKDOWN_PATH", summary_markdown
            ):
                summary = exporter.render_summary(
                    run_root, summary_json, summary_markdown
                )
            self.assertTrue(summary["passed"])
            sanitized = summary_json.read_text(encoding="utf-8") + summary_markdown.read_text(encoding="utf-8")
            for sentinel in sentinels:
                self.assertNotIn(sentinel, sanitized)
            file_path = exporter.contained_path(run_root, verified["files"][0]["path"])
            file_path.write_bytes(b"changed")
            with self.assertRaises(exporter.SnapshotFailure):
                exporter.verify_snapshot(run_root)

    def test_verify_recomputes_totals_even_if_state_checksum_is_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowlist = root / "allowlist.json"
            allowlist.write_text('["files.example.test"]', encoding="utf-8")
            run_root, _ = exporter.export_snapshot(
                FakeBridge(),
                root,
                public_host_allowlist=allowlist,
                downloader=synthetic_downloader,
            )
            manifest_path = run_root / "manifest.json"
            manifest = exporter.load_json(manifest_path)
            manifest["totals"]["objects"] += 1
            manifest_content = exporter.canonical_json_bytes(manifest) + b"\n"
            exporter.atomic_write_bytes(manifest_path, manifest_content)
            state_path = run_root / "state.json"
            state = exporter.load_json(state_path)
            state["artifacts"]["manifest.json"] = {
                "sha256": exporter.sha256_bytes(manifest_content),
                "byteLength": len(manifest_content),
            }
            exporter.write_json(state_path, state)
            with self.assertRaisesRegex(exporter.SnapshotFailure, "manifest_totals_mismatch"):
                exporter.verify_snapshot(run_root)

    def test_transient_download_failure_is_retried_without_an_unresolved_finding(self) -> None:
        attempts: dict[str, int] = {}

        def flaky_downloader(
            url: str,
            run_root: Path,
            *,
            allowed_hosts: frozenset[str] | None,
        ) -> exporter.DownloadResult:
            attempts[url] = attempts.get(url, 0) + 1
            if attempts[url] == 1:
                raise exporter.SnapshotFailure("download_failed")
            return synthetic_downloader(url, run_root, allowed_hosts=allowed_hosts)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowlist = root / "allowlist.json"
            allowlist.write_text('["files.example.test"]', encoding="utf-8")
            _, manifest = exporter.export_snapshot(
                FakeBridge(),
                root,
                public_host_allowlist=allowlist,
                downloader=flaky_downloader,
            )
            self.assertTrue(all(manifest["gates"].values()))
            self.assertTrue(all(count >= 2 for count in attempts.values()))

    def test_expired_later_batch_url_is_refreshed_before_retry(self) -> None:
        class ExpiringBatchBridge(FakeBridge):
            def __init__(self) -> None:
                super().__init__()
                self.refreshed: list[str] = []

            def sign_files(
                self, source_references: list[str]
            ) -> list[exporter.SigningResult]:
                return [
                    exporter.SigningResult(
                        f"https://signed.example.test/original-{index}", None
                    )
                    for index, _ in enumerate(source_references)
                ]

            def sign_file(self, source_reference: str) -> str:
                self.refreshed.append(source_reference)
                return "https://signed.example.test/refreshed"

        attempts: list[str] = []

        def expiry_aware_downloader(
            url: str,
            run_root: Path,
            *,
            allowed_hosts: frozenset[str] | None,
        ) -> exporter.DownloadResult:
            attempts.append(url)
            if url.endswith("original-1"):
                raise exporter.SnapshotFailure("download_failed")
            return synthetic_downloader(url, run_root, allowed_hosts=allowed_hosts)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowlist = root / "allowlist.json"
            allowlist.write_text('["files.example.test"]', encoding="utf-8")
            bridge = ExpiringBatchBridge()
            _, manifest = exporter.export_snapshot(
                bridge,
                root,
                public_host_allowlist=allowlist,
                downloader=expiry_aware_downloader,
            )
            self.assertTrue(all(manifest["gates"].values()))
            self.assertEqual(len(bridge.refreshed), 1)
            self.assertIn("https://signed.example.test/original-1", attempts)
            self.assertIn("https://signed.example.test/refreshed", attempts)

    def test_public_host_review_pause_resumes_with_immutable_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(exporter.SnapshotPause, "awaiting_public_host_review"):
                exporter.export_snapshot(FakeBridge(), root, page_size=2, downloader=synthetic_downloader)
            allowlist = root / "allowlist.json"
            allowlist.write_text('["files.example.test"]', encoding="utf-8")
            run_root, manifest = exporter.export_snapshot(
                FakeBridge(),
                root,
                page_size=2,
                resume=True,
                public_host_allowlist=allowlist,
                downloader=synthetic_downloader,
            )
            self.assertTrue(all(manifest["gates"].values()))
            allowlist.write_text('["other.example.test"]', encoding="utf-8")
            with self.assertRaises(exporter.SnapshotFailure):
                exporter._initialize_or_resume(
                    root,
                    FakeBridge(),
                    2,
                    exporter.load_public_host_allowlist(allowlist)[1],
                    1,
                    True,
                )

    def test_redirect_host_review_pauses_before_private_signing_and_resumes(self) -> None:
        calls: list[tuple[bool, bool]] = []

        def redirecting_downloader(
            url: str,
            run_root: Path,
            *,
            allowed_hosts: frozenset[str] | None,
        ) -> exporter.DownloadResult:
            is_public = allowed_hosts is not None
            calls.append((is_public, allowed_hosts is not None and "cdn.example.test" in allowed_hosts))
            if is_public and "cdn.example.test" not in allowed_hosts:
                raise exporter.PublicHostReviewRequired("cdn.example.test")
            return synthetic_downloader(url, run_root, allowed_hosts=allowed_hosts)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowlist = root / "allowlist.json"
            allowlist.write_text('["files.example.test"]', encoding="utf-8")
            bridge = FakeBridge()
            with self.assertRaisesRegex(exporter.SnapshotPause, "awaiting_public_host_review"):
                exporter.export_snapshot(
                    bridge,
                    root,
                    public_host_allowlist=allowlist,
                    downloader=redirecting_downloader,
                )
            run_root = exporter._resolve_resume_run(root)
            state = exporter.load_json(run_root / "state.json", "state_invalid")
            candidate = run_root / state["pendingPublicHostAllowlist"]["artifact"]
            private_calls_before_resume = sum(not is_public for is_public, _ in calls)
            _, manifest = exporter.export_snapshot(
                bridge,
                root,
                resume=True,
                public_host_allowlist=candidate,
                downloader=redirecting_downloader,
            )
            self.assertTrue(all(manifest["gates"].values()))
            self.assertEqual(private_calls_before_resume, 0)
            self.assertGreater(sum(not is_public for is_public, _ in calls), 0)

    def test_failed_rehearsal_still_has_sanitizable_evidence(self) -> None:
        records = fixture_records()
        records["User"] = records["User"][:1]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowlist = root / "allowlist.json"
            allowlist.write_text('["files.example.test"]', encoding="utf-8")
            _, manifest = exporter.export_snapshot(
                FakeBridge(records),
                root,
                public_host_allowlist=allowlist,
                downloader=synthetic_downloader,
            )
            summary = exporter.sanitized_summary(manifest)
            self.assertFalse(summary["passed"])
            self.assertFalse(summary["gates"]["twoAdminUsers"])


if __name__ == "__main__":
    unittest.main()
