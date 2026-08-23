#!/usr/bin/env python3
"""Create and verify a deterministic, read-only Base44 production snapshot."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import ipaddress
import json
import math
import os
import re
import socket
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping, Protocol, Sequence


SCHEMA_VERSION = 1
SUMMARY_SCHEMA_VERSION = 1
TOOL_VERSION = "1.0.0"
BASE44_CLI_VERSION = "0.1.10"
DENO_VERSION = "2.9.5"
MINIMUM_NODE_VERSION = (20, 19, 0)
DEFAULT_PAGE_SIZE = 1000
DEFAULT_MAX_BYTES = 512 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 30.0
MAX_REDIRECTS = 5
ENTITIES = (
    "Client",
    "Submission",
    "QuestionnaireTemplate",
    "PdfTemplate",
    "SyncedDriveFile",
    "User",
)
KNOWN_JSON_FIELDS = {
    "responses",
    "pdf_inputs",
    "signed_pdfs",
    "cpa_audit_log",
    "template_json",
    "steps",
}
PRIVATE_PREFIXES = ("private://", "private/", "mp/")
BRIDGE_MARKER = "/*__AUDITFLOW_REQUEST__*/"
REQUEST_ENVIRONMENT_KEY = "AUDITFLOW_REQUEST_JSON"
BRIDGE_BEGIN = "__AUDITFLOW_EXPORT_JSON_BEGIN__"
BRIDGE_END = "__AUDITFLOW_EXPORT_JSON_END__"
APP_ID_ENVIRONMENT_KEY = "BASE44_APP_ID"
DENO_DIR_ENVIRONMENT_KEY = "DENO_DIR"
DENO_NO_PACKAGE_JSON_ENVIRONMENT_KEY = "DENO_NO_PACKAGE_JSON"
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BRIDGE_PATH = REPOSITORY_ROOT / "tooling" / "base44_export_bridge.ts"
SUMMARY_JSON_PATH = REPOSITORY_ROOT / "docs" / "migration" / "base44-rehearsal-summary.json"
SUMMARY_MARKDOWN_PATH = REPOSITORY_ROOT / "docs" / "migration" / "base44-rehearsal-summary.md"
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
SAFE_RUN_ID = re.compile(r"^[0-9TZ-]+-[0-9a-f]{8}$")


class SnapshotFailure(RuntimeError):
    """Expected failure carrying only a static, non-sensitive category."""

    def __init__(self, category: str):
        super().__init__(category)
        self.category = category


class SnapshotPause(SnapshotFailure):
    """Expected operator pause after durable private progress."""


class PublicHostReviewRequired(SnapshotFailure):
    """Private-only redirect detail paired with a static public failure category."""

    def __init__(self, host: str):
        super().__init__("public_host_review_required")
        self.host = host


class Base44Reader(Protocol):
    def list_page(self, entity: str, limit: int, skip: int) -> list[dict[str, Any]]: ...

    def sign_file(self, source_reference: str) -> str: ...


@dataclass(frozen=True)
class Inventory:
    entity: str
    records: tuple[dict[str, Any], ...]
    record_hashes: Mapping[str, str]
    aggregate_sha256: str
    page_count: int


@dataclass(frozen=True)
class DownloadResult:
    sha256: str
    byte_length: int
    relative_path: str


@dataclass(frozen=True)
class SigningResult:
    signed_url: str | None
    failure: str | None


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _validate_json_value(value: Any, *, depth: int = 0) -> None:
    if depth > 100:
        raise SnapshotFailure("json_depth_exceeded")
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise SnapshotFailure("non_finite_number")
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(item, depth=depth + 1)
        return
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise SnapshotFailure("non_string_json_key")
        for item in value.values():
            _validate_json_value(item, depth=depth + 1)
        return
    raise SnapshotFailure("unsupported_json_value")


def canonical_json_bytes(value: Any) -> bytes:
    """Return deterministic UTF-8 JSON without changing embedded JSON strings."""
    _validate_json_value(value)
    try:
        text = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError, RecursionError) as exc:
        raise SnapshotFailure("canonical_json_failed") from exc
    return text.encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
    except OSError as exc:
        raise SnapshotFailure("artifact_read_failed") from exc
    return digest.hexdigest(), size


def secret_fingerprint(value: str) -> str:
    if not value:
        raise SnapshotFailure("missing_app_id")
    return sha256_bytes(value.encode("utf-8"))


def safe_relative_path(raw_path: str) -> str:
    path = PurePosixPath(raw_path)
    if (
        not raw_path
        or path.is_absolute()
        or "\\" in raw_path
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise SnapshotFailure("unsafe_relative_path")
    return path.as_posix()


def contained_path(root: Path, relative_path: str) -> Path:
    relative = safe_relative_path(relative_path)
    target = (root / Path(*PurePosixPath(relative).parts)).resolve(strict=False)
    try:
        target.relative_to(root.resolve(strict=True))
    except (ValueError, FileNotFoundError) as exc:
        raise SnapshotFailure("path_containment_failed") from exc
    return target


def require_absolute_outside_repository(path: Path, *, must_exist: bool) -> Path:
    if not path.is_absolute():
        raise SnapshotFailure("absolute_path_required")
    try:
        resolved = path.resolve(strict=must_exist)
        repository = REPOSITORY_ROOT.resolve(strict=True)
    except OSError as exc:
        raise SnapshotFailure("path_resolution_failed") from exc
    try:
        resolved.relative_to(repository)
    except ValueError:
        pass
    else:
        raise SnapshotFailure("path_inside_repository")
    try:
        repository.relative_to(resolved)
    except ValueError:
        pass
    else:
        raise SnapshotFailure("path_contains_repository")
    return resolved


def _restrictive_mode(path: Path) -> None:
    try:
        path.chmod(0o600 if path.is_file() else 0o700)
    except OSError:
        pass


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor: int | None = None
    try:
        descriptor = os.open(path, os.O_RDONLY)
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        if descriptor is not None:
            os.close(descriptor)


def atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _restrictive_mode(path.parent)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=".auditflow-", suffix=".tmp", dir=path.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
            _restrictive_mode(temporary)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
        _restrictive_mode(path)
        _fsync_directory(path.parent)
    except OSError as exc:
        raise SnapshotFailure("atomic_write_failed") from exc
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def publish_immutable(path: Path, content: bytes) -> None:
    if path.exists():
        try:
            existing = path.read_bytes()
        except OSError as exc:
            raise SnapshotFailure("artifact_read_failed") from exc
        if existing != content:
            raise SnapshotFailure("immutable_artifact_drift")
        return
    atomic_write_bytes(path, content)


def load_json(path: Path, category: str = "invalid_json_artifact") -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SnapshotFailure(category) from exc


def write_json(path: Path, value: Any, *, immutable: bool = False) -> bytes:
    content = canonical_json_bytes(value) + b"\n"
    if immutable:
        publish_immutable(path, content)
    else:
        atomic_write_bytes(path, content)
    return content


def _entity(entity: str) -> str:
    if entity not in ENTITIES:
        raise SnapshotFailure("unknown_entity")
    return entity


def validate_page_size(page_size: int) -> int:
    if isinstance(page_size, bool) or not isinstance(page_size, int) or not 1 <= page_size <= 5000:
        raise SnapshotFailure("invalid_page_size")
    return page_size


def inventory_records(
    bridge: Base44Reader,
    entity: str,
    page_size: int,
    *,
    on_page: Callable[[int, Sequence[dict[str, Any]]], None] | None = None,
) -> Inventory:
    """Read one complete, totally ordered inventory."""
    _entity(entity)
    validate_page_size(page_size)
    records: list[dict[str, Any]] = []
    offset = 0
    pages = 0
    while True:
        try:
            page = bridge.list_page(entity, page_size, offset)
        except SnapshotFailure:
            raise
        except Exception as exc:
            raise SnapshotFailure("entity_read_failed") from exc
        if not isinstance(page, list) or len(page) > page_size:
            raise SnapshotFailure("invalid_page_response")
        if on_page is not None:
            on_page(offset, page)
        pages += 1
        records.extend(page)
        offset += len(page)
        if len(page) < page_size:
            break
    return inventory_from_complete_records(entity, records, pages)


def inventory_from_complete_records(
    entity: str, records: Sequence[dict[str, Any]], page_count: int
) -> Inventory:
    """Validate and hash a complete ordered record sequence returned by a page probe."""
    _entity(entity)
    record_hashes: dict[str, str] = {}
    previous_id: str | None = None
    preserved: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            raise SnapshotFailure("invalid_record")
        record_id = record.get("id")
        if not isinstance(record_id, str) or not record_id:
            raise SnapshotFailure("missing_record_id")
        if previous_id is not None and record_id <= previous_id:
            raise SnapshotFailure("non_increasing_record_id")
        if record_id in record_hashes:
            raise SnapshotFailure("duplicate_record_id")
        record_hashes[record_id] = sha256_bytes(canonical_json_bytes(record))
        preserved.append(record)
        previous_id = record_id
    aggregate_pairs = [[record_id, record_hashes[record_id]] for record_id in sorted(record_hashes)]
    aggregate = sha256_bytes(canonical_json_bytes(aggregate_pairs))
    return Inventory(entity, tuple(preserved), record_hashes, aggregate, page_count)


def assert_same_inventory(first: Inventory, second: Inventory) -> None:
    if first.entity != second.entity or dict(first.record_hashes) != dict(second.record_hashes):
        raise SnapshotFailure("source_inventory_drift")


def assert_same_id_set(first: Inventory, second: Inventory) -> None:
    if set(first.record_hashes) != set(second.record_hashes):
        raise SnapshotFailure("pagination_id_set_mismatch")


def admin_user_count(inventory: Inventory) -> int:
    if inventory.entity != "User":
        raise SnapshotFailure("invalid_user_inventory")
    return sum(record.get("role") == "admin" for record in inventory.records)


def ndjson_bytes(inventory: Inventory) -> bytes:
    by_id = {str(record["id"]): record for record in inventory.records}
    return b"".join(canonical_json_bytes(by_id[record_id]) + b"\n" for record_id in sorted(by_id))


def json_pointer(parts: Sequence[str]) -> str:
    if not parts:
        return ""
    return "/" + "/".join(part.replace("~", "~0").replace("/", "~1") for part in parts)


def classify_reference(value: str) -> str | None:
    if value.startswith(PRIVATE_PREFIXES):
        return "private"
    if value.startswith("data:") or value.startswith("blob:"):
        return None
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme.lower() == "https" and parsed.netloc:
        return "public"
    if parsed.scheme or value.startswith("//"):
        return "unsupported"
    return None


def discover_references(
    inventories: Mapping[str, Inventory],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Walk raw and decoded-JSON views without altering preserved records."""
    references: dict[str, dict[str, Any]] = {}
    findings: list[dict[str, Any]] = []

    def finding(reason: str, entity: str, record_id: str, pointer: str) -> None:
        findings.append(
            {"reason": reason, "entity": entity, "recordId": record_id, "jsonPointer": pointer}
        )

    def occurrence(
        source: str,
        classification: str,
        container_type: str,
        entity: str,
        record_id: str,
        pointer: str,
    ) -> None:
        fingerprint = sha256_bytes(source.encode("utf-8"))
        item = references.setdefault(
            fingerprint,
            {
                "referenceFingerprint": fingerprint,
                "sourceReference": source,
                "classification": classification,
                "occurrences": [],
            },
        )
        if item["classification"] != classification:
            raise SnapshotFailure("reference_classification_drift")
        item["occurrences"].append(
            {
                "entity": entity,
                "recordId": record_id,
                "jsonPointer": pointer,
                "containerType": container_type,
            }
        )

    def walk(
        value: Any,
        parts: list[str],
        entity: str,
        record_id: str,
        field_name: str | None,
        decoded_depth: int,
    ) -> None:
        pointer = json_pointer(parts)
        if isinstance(value, dict):
            typed = value.get("__type") == "file_uri" and isinstance(value.get("value"), str)
            if typed:
                source = value["value"]
                classification = classify_reference(source)
                if classification in {"private", "public"}:
                    occurrence(source, classification, "typed_file_uri", entity, record_id, pointer)
                elif classification == "unsupported":
                    finding("unsupported_reference", entity, record_id, pointer)
            for key, child in value.items():
                if typed and key == "value":
                    continue
                walk(child, [*parts, key], entity, record_id, key, decoded_depth)
            return
        if isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, [*parts, str(index)], entity, record_id, field_name, decoded_depth)
            return
        if not isinstance(value, str):
            return
        classification = classify_reference(value)
        if classification in {"private", "public"}:
            occurrence(value, classification, "string", entity, record_id, pointer)
        elif classification == "unsupported":
            finding("unsupported_reference", entity, record_id, pointer)
        stripped = value.strip()
        if not stripped or stripped[0] not in "[{":
            if field_name in KNOWN_JSON_FIELDS and value:
                finding("malformed_known_json", entity, record_id, pointer)
            return
        try:
            decoded = json.loads(value)
        except (json.JSONDecodeError, RecursionError):
            if field_name in KNOWN_JSON_FIELDS:
                finding("malformed_known_json", entity, record_id, pointer)
            return
        if isinstance(decoded, (dict, list)):
            if decoded_depth >= 8:
                finding("json_decode_depth_exceeded", entity, record_id, pointer)
                return
            walk(decoded, [*parts, "$decoded"], entity, record_id, None, decoded_depth + 1)

    for entity in ENTITIES:
        inventory = inventories[entity]
        for record in inventory.records:
            walk(record, [], entity, str(record["id"]), None, 0)
    for item in references.values():
        item["occurrences"].sort(
            key=lambda entry: (
                entry["entity"], entry["recordId"], entry["jsonPointer"], entry["containerType"]
            )
        )
    findings.sort(key=lambda entry: (entry["reason"], entry["entity"], entry["recordId"], entry["jsonPointer"]))
    return dict(sorted(references.items())), findings


def load_public_host_allowlist(path: Path | None) -> tuple[frozenset[str], str | None, int]:
    if path is None:
        return frozenset(), None, 0
    resolved = require_absolute_outside_repository(path, must_exist=True)
    raw = load_json(resolved, "invalid_public_host_allowlist")
    values = raw.get("hosts") if isinstance(raw, dict) else raw
    if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
        raise SnapshotFailure("invalid_public_host_allowlist")
    normalized: list[str] = []
    for value in values:
        host = value.strip().rstrip(".").lower()
        if not host or host != value or ":" in host or "/" in host:
            raise SnapshotFailure("invalid_public_host_allowlist")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise SnapshotFailure("invalid_public_host_allowlist")
        if host in normalized:
            raise SnapshotFailure("duplicate_public_host")
        normalized.append(host)
    normalized.sort()
    return frozenset(normalized), sha256_bytes(canonical_json_bytes(normalized)), len(normalized)


def _validate_public_addresses(host: str) -> None:
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise SnapshotFailure("host_resolution_failed") from exc
    if not addresses:
        raise SnapshotFailure("host_resolution_failed")
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address[4][0].split("%", 1)[0])
        except ValueError as exc:
            raise SnapshotFailure("host_resolution_failed") from exc
        if not ip.is_global:
            raise SnapshotFailure("unsafe_download_address")


def validate_download_url(url: str, allowed_hosts: frozenset[str] | None) -> urllib.parse.SplitResult:
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise SnapshotFailure("invalid_download_url") from exc
    host = (parsed.hostname or "").rstrip(".").lower()
    if (
        parsed.scheme.lower() != "https"
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or port not in {None, 443}
    ):
        raise SnapshotFailure("invalid_download_url")
    if allowed_hosts is not None and host not in allowed_hosts:
        raise PublicHostReviewRequired(host)
    _validate_public_addresses(host)
    return parsed


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


def download_to_store(
    url: str,
    run_root: Path,
    *,
    allowed_hosts: frozenset[str] | None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    opener: Any | None = None,
    url_validator: Callable[[str, frozenset[str] | None], Any] = validate_download_url,
) -> DownloadResult:
    if max_bytes < 1 or timeout_seconds <= 0:
        raise SnapshotFailure("invalid_download_limits")
    opener = opener or urllib.request.build_opener(_NoRedirect())
    current = url
    response: Any = None
    for redirect_count in range(MAX_REDIRECTS + 1):
        url_validator(current, allowed_hosts)
        request = urllib.request.Request(current, method="GET", headers={"User-Agent": "AuditFlowSnapshot/1"})
        try:
            response = opener.open(request, timeout=timeout_seconds)
        except urllib.error.HTTPError as exc:
            if 300 <= exc.code < 400 and exc.headers.get("Location"):
                response = exc
            elif exc.code in {404, 410}:
                raise SnapshotFailure("source_file_missing") from exc
            else:
                raise SnapshotFailure("download_failed") from exc
        except (OSError, urllib.error.URLError, TimeoutError) as exc:
            raise SnapshotFailure("download_failed") from exc
        status = int(getattr(response, "status", getattr(response, "code", 200)))
        if 300 <= status < 400:
            location = response.headers.get("Location")
            response.close()
            if redirect_count >= MAX_REDIRECTS or not location:
                raise SnapshotFailure("redirect_rejected")
            current = urllib.parse.urljoin(current, location)
            continue
        if status < 200 or status >= 300:
            response.close()
            raise SnapshotFailure("download_failed")
        break
    if response is None:
        raise SnapshotFailure("download_failed")
    content_length: int | None = None
    raw_length = response.headers.get("Content-Length")
    if raw_length is not None:
        try:
            content_length = int(raw_length)
        except ValueError as exc:
            response.close()
            raise SnapshotFailure("content_length_mismatch") from exc
        if content_length < 0 or content_length > max_bytes:
            response.close()
            raise SnapshotFailure("size_limit_exceeded")
    temporary_directory = run_root / "files" / "sha256"
    temporary_directory.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    digest = hashlib.sha256()
    total = 0
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=".download-", suffix=".part", dir=temporary_directory, delete=False
        ) as handle:
            temporary = Path(handle.name)
            _restrictive_mode(temporary)
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise SnapshotFailure("size_limit_exceeded")
                digest.update(chunk)
                handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
    except SnapshotFailure:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    except (OSError, TimeoutError) as exc:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        raise SnapshotFailure("download_failed") from exc
    finally:
        response.close()
        if temporary is not None and not temporary.exists():
            temporary = None
    if content_length is not None and content_length != total:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise SnapshotFailure("content_length_mismatch")
    content_sha = digest.hexdigest()
    relative = f"files/sha256/{content_sha[:2]}/{content_sha}"
    target = contained_path(run_root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        if target.exists():
            existing_hash, existing_size = sha256_file(target)
            if existing_hash != content_sha or existing_size != total:
                raise SnapshotFailure("content_store_tamper")
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        else:
            if temporary is None:
                raise SnapshotFailure("download_failed")
            os.replace(temporary, target)
            temporary = None
            _restrictive_mode(target)
            _fsync_directory(target.parent)
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    return DownloadResult(content_sha, total, relative)


class Base44CliBridge:
    """Captured adapter for the fixed Base44 CLI script protocol."""

    def __init__(
        self,
        *,
        data_env: str = "prod",
        bridge_path: Path = BRIDGE_PATH,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        environment: Mapping[str, str] | None = None,
    ):
        if data_env != "prod":
            raise SnapshotFailure("invalid_data_environment")
        self.data_env = data_env
        self.bridge_path = bridge_path
        self.runner = runner
        self.environment = dict(os.environ if environment is None else environment)
        self.environment[DENO_NO_PACKAGE_JSON_ENVIRONMENT_KEY] = "1"
        self.environment[DENO_DIR_ENVIRONMENT_KEY] = str(
            Path(tempfile.gettempdir()) / f"auditflow-base44-cli-deno-cache-{DENO_VERSION}"
        )
        app_id = self.environment.get(APP_ID_ENVIRONMENT_KEY, "")
        self.app_fingerprint = secret_fingerprint(app_id)
        try:
            self.source = bridge_path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise SnapshotFailure("bridge_source_unavailable") from exc
        if self.source.count(BRIDGE_MARKER) != 1:
            raise SnapshotFailure("bridge_marker_invalid")
        self.source_sha256 = sha256_bytes(self.source.encode("utf-8"))

    @property
    def command(self) -> list[str]:
        executable = "npx.cmd" if os.name == "nt" else "npx"
        return [
            executable,
            "--yes",
            f"base44@{BASE44_CLI_VERSION}",
            "--json",
            "exec",
            "--privileged",
            "--data-env",
            self.data_env,
        ]

    def _request(self, request: dict[str, Any]) -> dict[str, Any]:
        request_environment = dict(self.environment)
        request_environment[REQUEST_ENVIRONMENT_KEY] = canonical_json_bytes(request).decode("utf-8")
        try:
            result = self.runner(
                self.command,
                input=self.source,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                check=False,
                timeout=180,
                env=request_environment,
                cwd=REPOSITORY_ROOT,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SnapshotFailure("base44_cli_failed") from exc
        if result.returncode != 0:
            raise SnapshotFailure("base44_cli_failed")
        stdout = result.stdout or ""
        if stdout.count(BRIDGE_BEGIN) != 1 or stdout.count(BRIDGE_END) != 1:
            raise SnapshotFailure("bridge_protocol_failed")
        start = stdout.index(BRIDGE_BEGIN) + len(BRIDGE_BEGIN)
        end = stdout.index(BRIDGE_END, start)
        try:
            response = json.loads(stdout[start:end])
        except json.JSONDecodeError as exc:
            raise SnapshotFailure("bridge_protocol_failed") from exc
        if not isinstance(response, dict):
            raise SnapshotFailure("bridge_protocol_failed")
        if response.get("ok") is not True:
            status = response.get("status")
            if request.get("operation") == "sign_file" and status in {404, 410}:
                raise SnapshotFailure("source_file_missing")
            raise SnapshotFailure("bridge_operation_failed")
        payload = response.get("result")
        if not isinstance(payload, dict):
            raise SnapshotFailure("bridge_protocol_failed")
        return payload

    def list_page(self, entity: str, limit: int, skip: int) -> list[dict[str, Any]]:
        _entity(entity)
        validate_page_size(limit)
        if isinstance(skip, bool) or not isinstance(skip, int) or skip < 0:
            raise SnapshotFailure("invalid_page_offset")
        payload = self._request(
            {"operation": "list_page", "entity": entity, "limit": limit, "skip": skip}
        )
        records = payload.get("records")
        if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
            raise SnapshotFailure("bridge_protocol_failed")
        return records

    def list_all_page_size_one(self, entity: str) -> list[dict[str, Any]]:
        """Run the complete page-size-one probe inside one authenticated CLI process."""
        _entity(entity)
        payload = self._request(
            {"operation": "list_page", "entity": entity, "limit": 1, "skip": 0, "exhaust": True}
        )
        records = payload.get("records")
        if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
            raise SnapshotFailure("bridge_protocol_failed")
        return records

    def sign_file(self, source_reference: str) -> str:
        if not isinstance(source_reference, str) or not source_reference:
            raise SnapshotFailure("invalid_private_reference")
        payload = self._request(
            {"operation": "sign_file", "sourceReference": source_reference}
        )
        signed_url = payload.get("signedUrl")
        if not isinstance(signed_url, str) or not signed_url:
            raise SnapshotFailure("bridge_protocol_failed")
        return signed_url

    def sign_files(self, source_references: Sequence[str]) -> list[SigningResult]:
        if (
            not isinstance(source_references, Sequence)
            or isinstance(source_references, (str, bytes))
            or not 1 <= len(source_references) <= 50
            or any(not isinstance(item, str) or not item for item in source_references)
        ):
            raise SnapshotFailure("invalid_private_reference_batch")
        payload = self._request(
            {"operation": "sign_file", "sourceReferences": list(source_references)}
        )
        signatures = payload.get("signatures")
        if not isinstance(signatures, list) or len(signatures) != len(source_references):
            raise SnapshotFailure("bridge_protocol_failed")
        results: list[SigningResult] = []
        for item in signatures:
            if not isinstance(item, dict):
                raise SnapshotFailure("bridge_protocol_failed")
            if item.get("ok") is True and isinstance(item.get("signedUrl"), str):
                results.append(SigningResult(item["signedUrl"], None))
            elif item.get("ok") is False:
                failure = "source_file_missing" if item.get("status") in {404, 410} else "sign_failed"
                results.append(SigningResult(None, failure))
            else:
                raise SnapshotFailure("bridge_protocol_failed")
        return results


def _parse_semver(raw: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?\s*", raw)
    if not match:
        raise SnapshotFailure("runtime_version_invalid")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def runtime_versions(
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, str]:
    executable = "npx.cmd" if os.name == "nt" else "npx"
    deno_executable = "deno"
    try:
        node = runner(
            ["node", "--version"],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SnapshotFailure("runtime_probe_failed") from exc
    try:
        deno = runner(
            [deno_executable, "--version"],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SnapshotFailure("deno_runtime_unavailable") from exc
    try:
        cli = runner(
            [executable, "--yes", f"base44@{BASE44_CLI_VERSION}", "--version"],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SnapshotFailure("runtime_probe_failed") from exc
    if node.returncode or _parse_semver(node.stdout or "") < MINIMUM_NODE_VERSION:
        raise SnapshotFailure("node_version_unsupported")
    deno_lines = (deno.stdout or "").splitlines()
    deno_first_line = deno_lines[0] if deno_lines else ""
    if deno.returncode or not re.fullmatch(
        rf"deno {re.escape(DENO_VERSION)}(?:\s+\([^\r\n]+\))?", deno_first_line.strip()
    ):
        raise SnapshotFailure("deno_version_mismatch")
    if cli.returncode or (cli.stdout or "").strip() != BASE44_CLI_VERSION:
        raise SnapshotFailure("base44_cli_version_mismatch")
    return {
        "node": (node.stdout or "").strip(),
        "deno": DENO_VERSION,
        "base44Cli": BASE44_CLI_VERSION,
    }


def _state_config(
    bridge: Base44CliBridge,
    page_size: int,
    allowlist_hash: str | None,
    allowlist_count: int,
) -> dict[str, Any]:
    return {
        "entitySet": list(ENTITIES),
        "dataEnvironment": bridge.data_env,
        "appFingerprint": bridge.app_fingerprint,
        "pageSize": page_size,
        "base44CliVersion": BASE44_CLI_VERSION,
        "bridgeSha256": bridge.source_sha256,
        "publicHostAllowlist": (
            None if allowlist_hash is None else {"sha256": allowlist_hash, "entryCount": allowlist_count}
        ),
    }


def _new_run_id() -> str:
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{timestamp}-{uuid.uuid4().hex[:8]}"


def _save_state(run_root: Path, state: dict[str, Any]) -> None:
    state["updatedAt"] = utc_now()
    write_json(run_root / "state.json", state)


def _checkpoint_artifact(
    run_root: Path, state: dict[str, Any], relative: str, content: bytes
) -> None:
    relative = safe_relative_path(relative)
    state.setdefault("artifacts", {})[relative] = {
        "sha256": sha256_bytes(content),
        "byteLength": len(content),
    }
    _save_state(run_root, state)


def _checkpoint_existing_artifact(
    run_root: Path,
    state: dict[str, Any],
    relative: str,
    expected_sha256: str,
    expected_size: int,
) -> None:
    relative = safe_relative_path(relative)
    actual_sha256, actual_size = sha256_file(contained_path(run_root, relative))
    if actual_sha256 != expected_sha256 or actual_size != expected_size:
        raise SnapshotFailure("download_artifact_tamper")
    state.setdefault("artifacts", {})[relative] = {
        "sha256": expected_sha256,
        "byteLength": expected_size,
    }
    _save_state(run_root, state)


def _checkpoint_resolution(
    run_root: Path,
    state: dict[str, Any],
    fingerprint: str,
    result: DownloadResult,
) -> None:
    _checkpoint_existing_artifact(
        run_root, state, result.relative_path, result.sha256, result.byte_length
    )
    state.setdefault("resolvedReferences", {})[fingerprint] = {
        "sha256": result.sha256,
        "byteLength": result.byte_length,
        "path": result.relative_path,
    }
    _save_state(run_root, state)


def _load_checkpointed_resolution(
    state: Mapping[str, Any], fingerprint: str
) -> DownloadResult | None:
    resolutions = state.get("resolvedReferences", {})
    if not isinstance(resolutions, dict):
        raise SnapshotFailure("state_resolutions_invalid")
    item = resolutions.get(fingerprint)
    if item is None:
        return None
    if not isinstance(item, dict):
        raise SnapshotFailure("state_resolution_invalid")
    sha256 = item.get("sha256")
    byte_length = item.get("byteLength")
    relative = item.get("path")
    if (
        not isinstance(sha256, str)
        or not HEX_64.fullmatch(sha256)
        or not isinstance(byte_length, int)
        or byte_length < 0
        or not isinstance(relative, str)
    ):
        raise SnapshotFailure("state_resolution_invalid")
    relative = safe_relative_path(relative)
    artifact = state.get("artifacts", {}).get(relative)
    if artifact != {"sha256": sha256, "byteLength": byte_length}:
        raise SnapshotFailure("state_resolution_artifact_mismatch")
    return DownloadResult(sha256, byte_length, relative)


def _pause_for_public_host_review(
    run_root: Path,
    state: dict[str, Any],
    hosts: Sequence[str],
    reference_count: int,
) -> None:
    normalized = sorted(set(hosts))
    digest = sha256_bytes(canonical_json_bytes(normalized))
    candidate = {
        "schemaVersion": SCHEMA_VERSION,
        "hosts": normalized,
        "referenceCount": reference_count,
    }
    relative = f"public-host-candidates-{digest[:12]}.json"
    content = canonical_json_bytes(candidate) + b"\n"
    publish_immutable(contained_path(run_root, relative), content)
    _checkpoint_artifact(run_root, state, relative, content)
    state["status"] = "awaiting_public_host_review"
    state["publicHostCandidateCount"] = len(normalized)
    state["pendingPublicHostAllowlist"] = {
        "sha256": digest,
        "entryCount": len(normalized),
        "artifact": relative,
    }
    _save_state(run_root, state)
    raise SnapshotPause("awaiting_public_host_review")


def verify_checkpoint_artifacts(run_root: Path, state: Mapping[str, Any]) -> None:
    artifacts = state.get("artifacts")
    if not isinstance(artifacts, dict):
        raise SnapshotFailure("state_artifacts_invalid")
    for relative, expected in artifacts.items():
        if not isinstance(relative, str) or not isinstance(expected, dict):
            raise SnapshotFailure("state_artifacts_invalid")
        path = contained_path(run_root, relative)
        actual_hash, actual_size = sha256_file(path)
        if actual_hash != expected.get("sha256") or actual_size != expected.get("byteLength"):
            raise SnapshotFailure("checkpoint_artifact_tamper")


def cleanup_partial_downloads(run_root: Path) -> None:
    """Remove only exporter-owned partial downloads after checkpoint verification."""
    partial_root = contained_path(run_root, "files/sha256")
    if not partial_root.exists():
        return
    try:
        candidates = list(partial_root.glob(".download-*.part"))
    except OSError as exc:
        raise SnapshotFailure("partial_download_scan_failed") from exc
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(partial_root.resolve(strict=True))
            if not resolved.is_file() or not resolved.name.startswith(".download-"):
                raise SnapshotFailure("partial_download_invalid")
            resolved.unlink()
        except SnapshotFailure:
            raise
        except (OSError, ValueError) as exc:
            raise SnapshotFailure("partial_download_cleanup_failed") from exc


def _resume_config_compatible(state: Mapping[str, Any], desired_config: Mapping[str, Any]) -> bool:
    stored_config = state.get("config")
    if not isinstance(stored_config, dict):
        return False
    if stored_config == desired_config:
        return True
    if state.get("status") != "awaiting_public_host_review":
        return False
    pending = state.get("pendingPublicHostAllowlist")
    if not isinstance(pending, dict):
        return False
    expanded = dict(stored_config)
    expanded["publicHostAllowlist"] = {
        "sha256": pending.get("sha256"),
        "entryCount": pending.get("entryCount"),
    }
    return expanded == desired_config


def _resolve_resume_run(
    output_root: Path, desired_config: Mapping[str, Any] | None = None
) -> Path:
    candidates: list[Path] = []
    active_candidates: list[Path] = []
    try:
        for child in output_root.iterdir():
            if child.is_dir() and (child / "state.json").is_file():
                state = load_json(child / "state.json", "state_invalid")
                if (
                    isinstance(state, dict)
                    and state.get("status") not in {"complete", "failed"}
                ):
                    resolved = child.resolve(strict=True)
                    active_candidates.append(resolved)
                    if desired_config is None or _resume_config_compatible(state, desired_config):
                        candidates.append(resolved)
    except OSError as exc:
        raise SnapshotFailure("output_root_read_failed") from exc
    if len(candidates) == 1:
        return candidates[0]
    if not candidates and len(active_candidates) == 1:
        return active_candidates[0]
    raise SnapshotFailure("resume_run_ambiguous")


def _initialize_or_resume(
    output_root: Path,
    bridge: Base44CliBridge,
    page_size: int,
    allowlist_hash: str | None,
    allowlist_count: int,
    resume: bool,
) -> tuple[Path, dict[str, Any]]:
    root = require_absolute_outside_repository(output_root, must_exist=True)
    if not root.is_dir():
        raise SnapshotFailure("output_root_invalid")
    _restrictive_mode(root)
    desired_config = _state_config(bridge, page_size, allowlist_hash, allowlist_count)
    if resume:
        run_root = _resolve_resume_run(root, desired_config)
        state = load_json(run_root / "state.json", "state_invalid")
        if not isinstance(state, dict) or state.get("schemaVersion") != SCHEMA_VERSION:
            raise SnapshotFailure("state_schema_mismatch")
        stored_config = state.get("config")
        if not isinstance(stored_config, dict):
            raise SnapshotFailure("state_config_invalid")
        desired_allowlist = desired_config.get("publicHostAllowlist")
        if state.get("status") == "awaiting_public_host_review":
            pending_allowlist = state.get("pendingPublicHostAllowlist")
            if not isinstance(pending_allowlist, dict):
                raise SnapshotFailure("pending_public_host_allowlist_invalid")
            expected_allowlist = {
                "sha256": pending_allowlist.get("sha256"),
                "entryCount": pending_allowlist.get("entryCount"),
            }
            if desired_allowlist != expected_allowlist:
                raise SnapshotFailure("public_host_allowlist_review_mismatch")
            stored_config["publicHostAllowlist"] = desired_allowlist
        if stored_config != desired_config:
            raise SnapshotFailure("resume_config_drift")
        verify_checkpoint_artifacts(run_root, state)
        cleanup_partial_downloads(run_root)
        if state.get("status") == "awaiting_public_host_review":
            state["status"] = "inventory"
            state.pop("pendingPublicHostAllowlist", None)
            _save_state(run_root, state)
        return run_root, state
    run_id = _new_run_id()
    if not SAFE_RUN_ID.fullmatch(run_id):
        raise SnapshotFailure("run_id_invalid")
    run_root = root / run_id
    try:
        run_root.mkdir(mode=0o700)
    except OSError as exc:
        raise SnapshotFailure("run_create_failed") from exc
    state = {
        "schemaVersion": SCHEMA_VERSION,
        "toolVersion": TOOL_VERSION,
        "runId": run_id,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "status": "inventory",
        "config": desired_config,
        "artifacts": {},
        "entities": {},
    }
    _save_state(run_root, state)
    return run_root.resolve(strict=True), state


def _persist_page(
    run_root: Path,
    state: dict[str, Any],
    entity: str,
    offset: int,
    page: Sequence[dict[str, Any]],
) -> None:
    relative = f"entities/{entity}/pages/{offset:012d}.json"
    content = canonical_json_bytes(list(page)) + b"\n"
    publish_immutable(contained_path(run_root, relative), content)
    _checkpoint_artifact(run_root, state, relative, content)
    entity_state = state.setdefault("entities", {}).setdefault(entity, {})
    entity_state["lastDurableOffset"] = offset
    entity_state["lastPageCount"] = len(page)
    _save_state(run_root, state)


def export_snapshot(
    bridge: Base44CliBridge,
    output_root: Path,
    *,
    page_size: int = DEFAULT_PAGE_SIZE,
    resume: bool = False,
    public_host_allowlist: Path | None = None,
    downloader: Callable[..., DownloadResult] = download_to_store,
) -> tuple[Path, dict[str, Any]]:
    page_size = validate_page_size(page_size)
    allowed_hosts, allowlist_hash, allowlist_count = load_public_host_allowlist(public_host_allowlist)
    run_root, state = _initialize_or_resume(
        output_root, bridge, page_size, allowlist_hash, allowlist_count, resume
    )
    inventories: dict[str, Inventory] = {}
    for entity in ENTITIES:
        first = inventory_records(
            bridge,
            entity,
            page_size,
            on_page=lambda offset, page, entity=entity: _persist_page(
                run_root, state, entity, offset, page
            ),
        )
        relative = f"entities/{entity}.ndjson"
        content = ndjson_bytes(first)
        publish_immutable(contained_path(run_root, relative), content)
        _checkpoint_artifact(run_root, state, relative, content)
        second = inventory_records(bridge, entity, page_size)
        assert_same_inventory(first, second)
        inventories[entity] = first
        state["entities"][entity].update(
            {
                "status": "stable",
                "count": len(first.records),
                "aggregateSha256": first.aggregate_sha256,
                "pageCount": first.page_count,
            }
        )
        _save_state(run_root, state)

    references, findings = discover_references(inventories)
    public_hosts = sorted(
        {
            (urllib.parse.urlsplit(item["sourceReference"]).hostname or "").rstrip(".").lower()
            for item in references.values()
            if item["classification"] == "public"
        }
    )
    if public_hosts and allowlist_hash is None:
        _pause_for_public_host_review(
            run_root,
            state,
            public_hosts,
            sum(1 for item in references.values() if item["classification"] == "public"),
        )

    files: dict[str, dict[str, Any]] = {}
    unresolved = list(findings)
    safe_resolution_failures = {
        "source_file_missing",
        "sign_failed",
        "download_failed",
        "redirect_rejected",
        "size_limit_exceeded",
        "content_length_mismatch",
        "invalid_download_url",
        "unsafe_download_address",
        "host_resolution_failed",
    }

    def download_with_retries(
        url: str, *, allowed: frozenset[str] | None
    ) -> DownloadResult:
        for attempt in range(3):
            try:
                return downloader(url, run_root, allowed_hosts=allowed)
            except SnapshotFailure as exc:
                if exc.category != "download_failed" or attempt == 2:
                    raise
        raise SnapshotFailure("download_failed")

    def record_failure(
        fingerprint: str, reference: dict[str, Any], category: str
    ) -> None:
        safe_reason = category if category in safe_resolution_failures else "download_failed"
        reference["status"] = "unresolved"
        reference["unresolvedReason"] = safe_reason
        unresolved.append({"reason": safe_reason, "referenceFingerprint": fingerprint})

    def record_result(
        fingerprint: str, reference: dict[str, Any], result: DownloadResult
    ) -> None:
        reference.update(
            {
                "status": "downloaded",
                "contentSha256": result.sha256,
                "byteLength": result.byte_length,
            }
        )
        if fingerprint not in state.get("resolvedReferences", {}):
            _checkpoint_resolution(run_root, state, fingerprint, result)
        file_item = files.setdefault(
            result.sha256,
            {
                "sha256": result.sha256,
                "byteLength": result.byte_length,
                "path": result.relative_path,
                "referenceFingerprints": [],
            },
        )
        if file_item["byteLength"] != result.byte_length:
            raise SnapshotFailure("content_hash_collision")
        file_item["referenceFingerprints"].append(fingerprint)

    public_references = sorted(
        (
            (fingerprint, reference)
            for fingerprint, reference in references.items()
            if reference["classification"] == "public"
        ),
        key=lambda item: item[0],
    )
    redirected_hosts: set[str] = set()
    redirected_reference_count = 0
    for fingerprint, reference in public_references:
        result = _load_checkpointed_resolution(state, fingerprint)
        try:
            if result is None:
                result = download_with_retries(
                    reference["sourceReference"], allowed=allowed_hosts
                )
        except PublicHostReviewRequired as exc:
            redirected_hosts.add(exc.host)
            redirected_reference_count += 1
            continue
        except SnapshotFailure as exc:
            record_failure(fingerprint, reference, exc.category)
            continue
        record_result(fingerprint, reference, result)

    if redirected_hosts:
        _pause_for_public_host_review(
            run_root,
            state,
            sorted(set(allowed_hosts or ()) | redirected_hosts),
            redirected_reference_count,
        )

    private_references = sorted(
        (
            (fingerprint, reference)
            for fingerprint, reference in references.items()
            if reference["classification"] == "private"
        ),
        key=lambda item: item[0],
    )
    for batch_start in range(0, len(private_references), 50):
        batch = private_references[batch_start : batch_start + 50]
        pending = [
            (fingerprint, reference)
            for fingerprint, reference in batch
            if _load_checkpointed_resolution(state, fingerprint) is None
        ]
        signing_results: dict[str, SigningResult] = {}
        if pending:
            try:
                outcomes = bridge.sign_files(
                    [reference["sourceReference"] for _, reference in pending]
                )
            except SnapshotFailure:
                outcomes = [SigningResult(None, "sign_failed") for _ in pending]
            signing_results = {
                fingerprint: outcome
                for (fingerprint, _), outcome in zip(pending, outcomes, strict=True)
            }
        for fingerprint, reference in batch:
            result = _load_checkpointed_resolution(state, fingerprint)
            if result is None:
                signing = signing_results[fingerprint]
                if signing.failure is not None or signing.signed_url is None:
                    record_failure(fingerprint, reference, signing.failure or "sign_failed")
                    continue
                try:
                    result = download_with_retries(signing.signed_url, allowed=None)
                except SnapshotFailure as exc:
                    record_failure(fingerprint, reference, exc.category)
                    continue
            record_result(fingerprint, reference, result)

    for file_item in files.values():
        file_item["referenceFingerprints"].sort()
    reference_values = list(references.values())
    occurrence_count = sum(len(item["occurrences"]) for item in reference_values)
    downloaded_references = sum(item.get("status") == "downloaded" for item in reference_values)
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "toolVersion": TOOL_VERSION,
        "base44CliVersion": BASE44_CLI_VERSION,
        "bridgeSha256": bridge.source_sha256,
        "createdAt": state["createdAt"],
        "completedAt": utc_now(),
        "config": state["config"],
        "entities": {
            entity: {
                "count": len(inventory.records),
                "aggregateSha256": inventory.aggregate_sha256,
                "ndjsonPath": f"entities/{entity}.ndjson",
                "records": [
                    {"id": record_id, "sha256": inventory.record_hashes[record_id]}
                    for record_id in sorted(inventory.record_hashes)
                ],
            }
            for entity, inventory in inventories.items()
        },
        "references": reference_values,
        "files": list(files.values()),
        "findings": unresolved,
        "totals": {
            "objects": sum(len(inventory.records) for inventory in inventories.values()),
            "uniqueReferences": len(reference_values),
            "referenceOccurrences": occurrence_count,
            "downloadedReferences": downloaded_references,
            "uniqueFiles": len(files),
            "bytes": sum(item["byteLength"] for item in files.values()),
            "duplicateReferences": occurrence_count - len(reference_values),
            "duplicateContent": downloaded_references - len(files),
            "unresolved": len(unresolved),
        },
        "gates": {
            "stableInventories": True,
            "sixEntities": len(inventories) == len(ENTITIES),
            "twoAdminUsers": admin_user_count(inventories["User"]) == 2,
            "allReferencesClosed": len(unresolved) == 0,
        },
    }
    manifest_relative = "manifest.json"
    manifest_content = canonical_json_bytes(manifest) + b"\n"
    publish_immutable(run_root / manifest_relative, manifest_content)
    _checkpoint_artifact(run_root, state, manifest_relative, manifest_content)
    passed = all(manifest["gates"].values())
    state["status"] = "complete" if passed else "failed"
    state["completedAt"] = manifest["completedAt"]
    _save_state(run_root, state)
    return run_root, manifest


def verify_snapshot(snapshot: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    run_root = require_absolute_outside_repository(snapshot, must_exist=True)
    if not run_root.is_dir():
        raise SnapshotFailure("snapshot_invalid")
    state = load_json(run_root / "state.json", "state_invalid")
    manifest = load_json(run_root / "manifest.json", "manifest_invalid")
    if not isinstance(state, dict) or state.get("schemaVersion") != SCHEMA_VERSION:
        raise SnapshotFailure("state_schema_mismatch")
    if state.get("status") not in {"complete", "failed"}:
        raise SnapshotFailure("snapshot_incomplete")
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise SnapshotFailure("manifest_schema_mismatch")
    verify_checkpoint_artifacts(run_root, state)
    entities = manifest.get("entities")
    if not isinstance(entities, dict) or set(entities) != set(ENTITIES):
        raise SnapshotFailure("manifest_entities_invalid")
    verified_inventories: dict[str, Inventory] = {}
    for entity in ENTITIES:
        item = entities[entity]
        if not isinstance(item, dict):
            raise SnapshotFailure("manifest_entity_invalid")
        path = contained_path(run_root, str(item.get("ndjsonPath", "")))
        record_values: list[dict[str, Any]] = []
        try:
            lines = path.read_bytes().splitlines()
        except OSError as exc:
            raise SnapshotFailure("artifact_read_failed") from exc
        for line in lines:
            try:
                record = json.loads(line)
            except (UnicodeError, json.JSONDecodeError) as exc:
                raise SnapshotFailure("ndjson_invalid") from exc
            if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not record["id"]:
                raise SnapshotFailure("ndjson_invalid")
            record_values.append(record)
        inventory = inventory_from_complete_records(entity, record_values, 0)
        expected_records = item.get("records")
        if not isinstance(expected_records, list) or any(
            not isinstance(entry, dict)
            or not isinstance(entry.get("id"), str)
            or not entry["id"]
            or not isinstance(entry.get("sha256"), str)
            or not HEX_64.fullmatch(entry["sha256"])
            for entry in expected_records
        ):
            raise SnapshotFailure("manifest_entity_invalid")
        expected = {
            entry["id"]: entry["sha256"]
            for entry in expected_records
        }
        if (
            len(expected) != len(expected_records)
            or dict(inventory.record_hashes) != expected
            or len(inventory.records) != item.get("count")
        ):
            raise SnapshotFailure("record_inventory_tamper")
        if inventory.aggregate_sha256 != item.get("aggregateSha256"):
            raise SnapshotFailure("entity_aggregate_tamper")
        verified_inventories[entity] = inventory

    files = manifest.get("files")
    if not isinstance(files, list):
        raise SnapshotFailure("manifest_files_invalid")
    files_by_sha256: dict[str, dict[str, Any]] = {}
    for item in files:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("sha256"), str)
            or not HEX_64.fullmatch(item["sha256"])
            or isinstance(item.get("byteLength"), bool)
            or not isinstance(item.get("byteLength"), int)
            or item["byteLength"] < 0
            or not isinstance(item.get("path"), str)
            or not isinstance(item.get("referenceFingerprints"), list)
            or any(not isinstance(value, str) for value in item["referenceFingerprints"])
            or item["sha256"] in files_by_sha256
        ):
            raise SnapshotFailure("manifest_files_invalid")
        path = contained_path(run_root, item["path"])
        digest, size = sha256_file(path)
        if digest != item.get("sha256") or size != item.get("byteLength"):
            raise SnapshotFailure("file_content_tamper")
        files_by_sha256[item["sha256"]] = item

    references = manifest.get("references")
    findings = manifest.get("findings")
    if not isinstance(references, list) or not isinstance(findings, list):
        raise SnapshotFailure("manifest_references_invalid")
    if any(
        not isinstance(item, dict) or not isinstance(item.get("reason"), str)
        for item in findings
    ):
        raise SnapshotFailure("manifest_findings_invalid")

    discovered_references, discovered_findings = discover_references(verified_inventories)
    references_by_fingerprint: dict[str, dict[str, Any]] = {}
    downloaded_by_content: dict[str, list[str]] = collections.defaultdict(list)
    resolution_findings: list[dict[str, Any]] = []
    for reference in references:
        if not isinstance(reference, dict):
            raise SnapshotFailure("manifest_references_invalid")
        fingerprint = reference.get("referenceFingerprint")
        source_reference = reference.get("sourceReference")
        if (
            not isinstance(fingerprint, str)
            or not HEX_64.fullmatch(fingerprint)
            or not isinstance(source_reference, str)
            or sha256_bytes(source_reference.encode("utf-8")) != fingerprint
            or fingerprint in references_by_fingerprint
        ):
            raise SnapshotFailure("manifest_references_invalid")
        discovered = discovered_references.get(fingerprint)
        if discovered is None or any(
            reference.get(key) != discovered[key]
            for key in ("sourceReference", "classification", "occurrences")
        ):
            raise SnapshotFailure("reference_inventory_tamper")
        status = reference.get("status")
        if status == "downloaded":
            content_sha256 = reference.get("contentSha256")
            file_item = files_by_sha256.get(content_sha256)
            if (
                file_item is None
                or reference.get("byteLength") != file_item["byteLength"]
            ):
                raise SnapshotFailure("reference_file_mapping_invalid")
            downloaded_by_content[content_sha256].append(fingerprint)
        elif status == "unresolved":
            reason = reference.get("unresolvedReason")
            if not isinstance(reason, str):
                raise SnapshotFailure("manifest_references_invalid")
            resolution_findings.append(
                {"reason": reason, "referenceFingerprint": fingerprint}
            )
        else:
            raise SnapshotFailure("manifest_references_invalid")
        references_by_fingerprint[fingerprint] = reference
    if set(references_by_fingerprint) != set(discovered_references):
        raise SnapshotFailure("reference_inventory_tamper")

    manifest_discovery_findings = [
        item for item in findings if "referenceFingerprint" not in item
    ]
    manifest_resolution_findings = [
        item for item in findings if "referenceFingerprint" in item
    ]
    if (
        manifest_discovery_findings != discovered_findings
        or sorted(
            manifest_resolution_findings,
            key=lambda item: (str(item.get("referenceFingerprint")), str(item.get("reason"))),
        )
        != sorted(
            resolution_findings,
            key=lambda item: (str(item.get("referenceFingerprint")), str(item.get("reason"))),
        )
    ):
        raise SnapshotFailure("manifest_findings_invalid")

    for content_sha256, file_item in files_by_sha256.items():
        expected_fingerprints = sorted(downloaded_by_content.get(content_sha256, []))
        if file_item["referenceFingerprints"] != expected_fingerprints:
            raise SnapshotFailure("reference_file_mapping_invalid")

    occurrence_count = sum(
        len(reference["occurrences"]) for reference in references_by_fingerprint.values()
    )
    downloaded_count = sum(
        reference.get("status") == "downloaded"
        for reference in references_by_fingerprint.values()
    )
    expected_totals = {
        "objects": sum(len(inventory.records) for inventory in verified_inventories.values()),
        "uniqueReferences": len(references_by_fingerprint),
        "referenceOccurrences": occurrence_count,
        "downloadedReferences": downloaded_count,
        "uniqueFiles": len(files_by_sha256),
        "bytes": sum(item["byteLength"] for item in files_by_sha256.values()),
        "duplicateReferences": occurrence_count - len(references_by_fingerprint),
        "duplicateContent": downloaded_count - len(files_by_sha256),
        "unresolved": len(findings),
    }
    expected_gates = {
        "stableInventories": True,
        "sixEntities": True,
        "twoAdminUsers": admin_user_count(verified_inventories["User"]) == 2,
        "allReferencesClosed": len(findings) == 0,
    }
    if manifest.get("totals") != expected_totals:
        raise SnapshotFailure("manifest_totals_mismatch")
    if manifest.get("gates") != expected_gates:
        raise SnapshotFailure("manifest_gates_mismatch")
    expected_status = "complete" if all(expected_gates.values()) else "failed"
    if state.get("status") != expected_status or state.get("completedAt") != manifest.get("completedAt"):
        raise SnapshotFailure("snapshot_status_mismatch")
    return state, manifest


def sanitized_summary(manifest: Mapping[str, Any]) -> dict[str, Any]:
    entities = manifest["entities"]
    reason_counts = collections.Counter(
        item.get("reason", "unknown")
        for item in manifest.get("findings", [])
        if isinstance(item, dict)
    )
    parse_count = reason_counts.get("malformed_known_json", 0) + reason_counts.get(
        "json_decode_depth_exceeded", 0
    )
    gates = dict(manifest["gates"])
    passed = bool(gates) and all(value is True for value in gates.values())
    return {
        "schemaVersion": SUMMARY_SCHEMA_VERSION,
        "status": "pass" if passed else "fail",
        "passed": passed,
        "toolVersion": manifest["toolVersion"],
        "base44CliVersion": manifest["base44CliVersion"],
        "createdAt": manifest["createdAt"],
        "completedAt": manifest["completedAt"],
        "entities": {
            entity: {
                "count": entities[entity]["count"],
                "aggregateSha256": entities[entity]["aggregateSha256"],
            }
            for entity in ENTITIES
        },
        "totals": dict(manifest["totals"]),
        "unresolvedByReason": dict(sorted(reason_counts.items())),
        "jsonParseFindings": parse_count,
        "gates": gates,
    }


def summary_markdown(summary: Mapping[str, Any]) -> str:
    rows = "\n".join(
        f"| {entity} | {summary['entities'][entity]['count']} | "
        f"`{summary['entities'][entity]['aggregateSha256']}` |"
        for entity in ENTITIES
    )
    totals = summary["totals"]
    reasons = summary["unresolvedByReason"]
    reason_lines = (
        "\n".join(f"- `{reason}`: {count}" for reason, count in reasons.items())
        if reasons
        else "- None"
    )
    gate_lines = "\n".join(
        f"- `{gate}`: {'PASS' if value else 'FAIL'}" for gate, value in summary["gates"].items()
    )
    return (
        "# Base44 rehearsal summary\n\n"
        f"**Status:** {summary['status'].upper()}\n\n"
        f"**Completed:** {summary['completedAt']}\n\n"
        f"**Exporter:** {summary['toolVersion']} · **Base44 CLI:** {summary['base44CliVersion']}\n\n"
        "## Entity reconciliation\n\n"
        "| Entity | Count | Aggregate SHA-256 |\n| --- | ---: | --- |\n"
        f"{rows}\n\n"
        "## Aggregate totals\n\n"
        f"- Objects: {totals['objects']}\n"
        f"- Reference occurrences: {totals['referenceOccurrences']}\n"
        f"- Unique references: {totals['uniqueReferences']}\n"
        f"- Downloaded references: {totals['downloadedReferences']}\n"
        f"- Unique files: {totals['uniqueFiles']}\n"
        f"- Bytes: {totals['bytes']}\n"
        f"- Duplicate reference occurrences: {totals['duplicateReferences']}\n"
        f"- Duplicate file content: {totals['duplicateContent']}\n"
        f"- JSON parse findings: {summary['jsonParseFindings']}\n"
        f"- Unresolved findings: {totals['unresolved']}\n\n"
        "## Unresolved reasons\n\n"
        f"{reason_lines}\n\n"
        "## Gates\n\n"
        f"{gate_lines}\n"
    )


def render_summary(snapshot: Path, json_path: Path, markdown_path: Path) -> dict[str, Any]:
    if json_path.resolve(strict=False) != SUMMARY_JSON_PATH.resolve(strict=False):
        raise SnapshotFailure("summary_output_not_approved")
    if markdown_path.resolve(strict=False) != SUMMARY_MARKDOWN_PATH.resolve(strict=False):
        raise SnapshotFailure("summary_output_not_approved")
    _, manifest = verify_snapshot(snapshot)
    summary = sanitized_summary(manifest)
    write_json(SUMMARY_JSON_PATH, summary)
    atomic_write_bytes(SUMMARY_MARKDOWN_PATH, summary_markdown(summary).encode("utf-8"))
    return summary


def doctor(bridge: Base44CliBridge, *, page_size: int = DEFAULT_PAGE_SIZE) -> dict[str, Any]:
    versions = runtime_versions()
    inventories: dict[str, Inventory] = {}
    for entity in ENTITIES:
        normal = inventory_records(bridge, entity, page_size)
        page_one_records = bridge.list_all_page_size_one(entity)
        page_one = inventory_from_complete_records(
            entity, page_one_records, len(page_one_records) + 1
        )
        assert_same_id_set(normal, page_one)
        inventories[entity] = normal
    references, _ = discover_references(inventories)
    private = next(
        (item for item in references.values() if item["classification"] == "private"), None
    )
    signing_probed = False
    if private is not None:
        bridge.sign_file(private["sourceReference"])
        signing_probed = True
    admin_count = admin_user_count(inventories["User"])
    if admin_count != 2:
        raise SnapshotFailure("admin_user_count_mismatch")
    return {
        "versions": versions,
        "entityCounts": {entity: len(inventories[entity].records) for entity in ENTITIES},
        "sixEntitiesReadable": True,
        "paginationStable": True,
        "adminUserCount": admin_count,
        "twoAdminUsers": True,
        "privateSigningProbed": signing_probed,
        "privateReferencePresent": private is not None,
    }


def private_reference_variants(source_reference: str) -> list[tuple[str, str]]:
    """Return evidence-backed equivalent legacy prefix spellings, never arbitrary paths."""
    if source_reference.startswith("private://"):
        return [("private_scheme_to_path", f"private/{source_reference[len('private://'):]}")]
    if source_reference.startswith("private/"):
        return [("private_path_to_scheme", f"private://{source_reference[len('private/'):]}")]
    return []


def diagnose_failed_snapshot(bridge: Base44CliBridge, output_root: Path) -> dict[str, Any]:
    """Probe only alternate private-URI spellings and return aggregate-safe evidence."""
    root = require_absolute_outside_repository(output_root, must_exist=True)
    failed_runs: list[tuple[str, Path]] = []
    try:
        for child in root.iterdir():
            state_path = child / "state.json"
            manifest_path = child / "manifest.json"
            if not state_path.is_file() or not manifest_path.is_file():
                continue
            state = load_json(state_path, "state_invalid")
            if isinstance(state, dict) and state.get("status") == "failed":
                failed_runs.append((str(state.get("completedAt", "")), child))
    except OSError as exc:
        raise SnapshotFailure("output_root_read_failed") from exc
    if not failed_runs:
        raise SnapshotFailure("failed_snapshot_not_found")
    _, run_root = max(failed_runs, key=lambda item: item[0])
    _, manifest = verify_snapshot(run_root)
    references = {
        item.get("referenceFingerprint"): item
        for item in manifest.get("references", [])
        if isinstance(item, dict)
    }
    failures = [
        item
        for item in manifest.get("findings", [])
        if isinstance(item, dict) and item.get("reason") == "sign_failed"
    ]
    unresolved_by_reason = collections.Counter(
        item.get("reason")
        for item in manifest.get("findings", [])
        if isinstance(item, dict) and isinstance(item.get("reason"), str)
    )
    eligible = 0
    succeeded = 0
    by_variant: collections.Counter[str] = collections.Counter()
    exact_failures: collections.Counter[str] = collections.Counter()
    failed_sources: list[str] = []
    for finding in failures:
        reference = references.get(finding.get("referenceFingerprint"))
        if not isinstance(reference, dict):
            raise SnapshotFailure("failed_snapshot_reference_missing")
        source = reference.get("sourceReference")
        if not isinstance(source, str):
            raise SnapshotFailure("failed_snapshot_reference_invalid")
        failed_sources.append(source)
        variants = private_reference_variants(source)
        if not variants:
            continue
        eligible += 1
        label, candidate = variants[0]
        try:
            signed_url = bridge.sign_file(candidate)
            validate_download_url(signed_url, None)
        except SnapshotFailure:
            continue
        succeeded += 1
        by_variant[label] += 1
    if failed_sources:
        for batch_start in range(0, len(failed_sources), 50):
            for outcome in bridge.sign_files(failed_sources[batch_start : batch_start + 50]):
                exact_failures[outcome.failure or "now_succeeds"] += 1
    return {
        "status": "diagnosed",
        "signFailures": len(failures),
        "unresolvedByReason": dict(sorted(unresolved_by_reason.items())),
        "alternateEligible": eligible,
        "alternateSigningSucceeded": succeeded,
        "exactOutcomeByReason": dict(sorted(exact_failures.items())),
        "successByVariant": dict(sorted(by_variant.items())),
    }


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise SnapshotFailure("invalid_arguments")


def _reject_sensitive_argv(argv: Sequence[str]) -> None:
    forbidden = {"--token", "--password", "--credential", "--credentials", "--signed-url", "--app-id"}
    for value in argv:
        lower = value.lower()
        if lower.split("=", 1)[0] in forbidden:
            raise SnapshotFailure("sensitive_argument_rejected")
        if (lower.startswith("http://") or lower.startswith("https://")) and "?" in lower:
            raise SnapshotFailure("sensitive_argument_rejected")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    values = list(sys.argv[1:] if argv is None else argv)
    _reject_sensitive_argv(values)
    parser = SafeArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    doctor_parser = commands.add_parser("doctor", help="Run a non-writing production capability probe")
    doctor_parser.add_argument("--data-env", default="prod")
    doctor_parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    doctor_parser.add_argument("--confirm-production-read-only", action="store_true")

    export_parser = commands.add_parser("export", help="Create or resume a private snapshot")
    export_parser.add_argument("--data-env", default="prod")
    export_parser.add_argument("--output-root", type=Path, required=True)
    export_parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    export_parser.add_argument("--resume", action="store_true")
    export_parser.add_argument("--public-host-allowlist", type=Path)
    export_parser.add_argument("--confirm-production-read-only", action="store_true")

    verify_parser = commands.add_parser("verify", help="Verify a snapshot offline")
    verify_parser.add_argument("--snapshot", type=Path, required=True)

    summary_parser = commands.add_parser("summarize", help="Render aggregate-only rehearsal evidence")
    summary_parser.add_argument("--snapshot", type=Path, required=True)
    summary_parser.add_argument("--json", type=Path, required=True)
    summary_parser.add_argument("--markdown", type=Path, required=True)

    diagnose_parser = commands.add_parser(
        "diagnose", help="Probe aggregate-safe legacy signing compatibility on the latest failed run"
    )
    diagnose_parser.add_argument("--data-env", default="prod")
    diagnose_parser.add_argument("--output-root", type=Path, required=True)
    diagnose_parser.add_argument("--confirm-production-read-only", action="store_true")
    return parser.parse_args(values)


def _require_confirmation(args: argparse.Namespace) -> None:
    if not getattr(args, "confirm_production_read_only", False):
        raise SnapshotFailure("production_confirmation_required")
    if getattr(args, "data_env", "prod") != "prod":
        raise SnapshotFailure("invalid_data_environment")


def run_command(args: argparse.Namespace) -> int:
    if args.command == "doctor":
        _require_confirmation(args)
        result = doctor(Base44CliBridge(data_env=args.data_env), page_size=args.page_size)
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    if args.command == "export":
        _require_confirmation(args)
        runtime_versions()
        _, manifest = export_snapshot(
            Base44CliBridge(data_env=args.data_env),
            args.output_root,
            page_size=args.page_size,
            resume=args.resume,
            public_host_allowlist=args.public_host_allowlist,
        )
        passed = all(manifest["gates"].values())
        print(
            json.dumps(
                {
                    "status": "pass" if passed else "fail",
                    "objects": manifest["totals"]["objects"],
                    "references": manifest["totals"]["uniqueReferences"],
                    "files": manifest["totals"]["uniqueFiles"],
                    "unresolved": manifest["totals"]["unresolved"],
                },
                sort_keys=True,
                separators=(",", ":"),
            )
        )
        return 0 if passed else 1
    if args.command == "verify":
        _, manifest = verify_snapshot(args.snapshot)
        print(
            json.dumps(
                {"status": "verified", "objects": manifest["totals"]["objects"]},
                sort_keys=True,
                separators=(",", ":"),
            )
        )
        return 0
    if args.command == "summarize":
        summary = render_summary(args.snapshot, args.json, args.markdown)
        print(json.dumps({"status": summary["status"]}, separators=(",", ":")))
        return 0 if summary["passed"] else 1
    if args.command == "diagnose":
        _require_confirmation(args)
        runtime_versions()
        result = diagnose_failed_snapshot(
            Base44CliBridge(data_env=args.data_env), args.output_root
        )
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    raise SnapshotFailure("unknown_command")


def main(argv: Sequence[str] | None = None) -> int:
    try:
        return run_command(parse_args(argv))
    except SnapshotPause as exc:
        print(f"Base44 snapshot paused: {exc.category}", file=sys.stderr)
        return 2
    except Exception as exc:
        category = exc.category if isinstance(exc, SnapshotFailure) else "unexpected_safe_failure"
        print(f"Base44 snapshot failed: {category}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
