#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hourly self-update for the for-designer collector scripts."""

import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
import zipfile


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_METADATA_URL = (
    "https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/"
    "webresources/download/for-designer/stable/latest/metadata.json"
)
VERSION_FILE = "version.json"
LOCK_FILE = ".for-designer-update.lock"
LOCK_STALE_SECONDS = 10 * 60
MAX_METADATA_BYTES = 64 * 1024
MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
MAX_SCRIPT_BYTES = 20 * 1024 * 1024
MAX_SCRIPT_FILES = 100
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def _version_parts(value):
    if not isinstance(value, str):
        return None
    match = VERSION_RE.match(value.strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def _read_local_version(root_dir):
    try:
        with open(os.path.join(root_dir, VERSION_FILE), "r", encoding="utf-8-sig") as handle:
            value = json.load(handle).get("version")
        return value.strip() if _version_parts(value) else None
    except Exception:
        return None


def _request_bytes(opener, url, accept, timeout, max_bytes):
    request = urllib.request.Request(
        url,
        headers={"Accept": accept, "Cache-Control": "no-cache"},
        method="GET",
    )
    with opener(request, timeout=timeout) as response:
        status = getattr(response, "status", None)
        if status is None and hasattr(response, "getcode"):
            status = response.getcode()
        if status is not None and not 200 <= int(status) < 300:
            raise RuntimeError("HTTP {} for {}".format(status, url))
        content_length = response.headers.get("Content-Length") if response.headers else None
        if content_length and int(content_length) > max_bytes:
            raise RuntimeError("update response exceeds {} bytes".format(max_bytes))
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise RuntimeError("update response exceeds {} bytes".format(max_bytes))
        return body


def _metadata_check_url(metadata_url):
    parts = urllib.parse.urlsplit(metadata_url)
    if parts.scheme != "https":
        raise RuntimeError("metadata URL must use HTTPS")
    separator = "&" if parts.query else "?"
    return metadata_url + separator + "_od_update_check={}".format(int(time.time() * 1000))


def _load_metadata(opener, metadata_url):
    body = _request_bytes(
        opener,
        _metadata_check_url(metadata_url),
        "application/json",
        5,
        MAX_METADATA_BYTES,
    )
    try:
        value = json.loads(body.decode("utf-8-sig"))
    except Exception as error:
        raise RuntimeError("metadata is not valid JSON") from error
    if not isinstance(value, dict) or not _version_parts(value.get("version")):
        raise RuntimeError("metadata.version must use x.y.z format")
    return value


def _validated_release(metadata, metadata_url):
    archive_url = metadata.get("url")
    sha256 = metadata.get("sha256")
    if not isinstance(archive_url, str):
        raise RuntimeError("metadata.url is required")
    metadata_parts = urllib.parse.urlsplit(metadata_url)
    archive_parts = urllib.parse.urlsplit(urllib.parse.urljoin(metadata_url, archive_url))
    if (
        archive_parts.scheme != "https"
        or archive_parts.scheme != metadata_parts.scheme
        or archive_parts.netloc != metadata_parts.netloc
    ):
        raise RuntimeError("archive must use HTTPS on the metadata origin")
    if not isinstance(sha256, str) or not re.match(r"^[a-fA-F0-9]{64}$", sha256.strip()):
        raise RuntimeError("metadata.sha256 must be a 64-character hex digest")
    return archive_parts.geturl(), sha256.strip().lower()


def _download_archive(opener, archive_url, expected_sha256):
    archive = _request_bytes(
        opener,
        archive_url,
        "application/zip",
        30,
        MAX_ARCHIVE_BYTES,
    )
    actual_sha256 = hashlib.sha256(archive).hexdigest()
    if actual_sha256 != expected_sha256:
        raise RuntimeError("archive SHA-256 does not match metadata")
    return archive


def _script_parts(entry_name):
    parts = entry_name.replace("\\", "/").split("/")
    try:
        scripts_index = parts.index("scripts")
    except ValueError:
        return None
    prefix = parts[:scripts_index]
    relative = parts[scripts_index + 1:]
    if scripts_index > 1 or any(part in ("", ".", "..") for part in prefix):
        raise RuntimeError("unsafe archive entry: {}".format(entry_name))
    if not relative or any(part in ("", ".", "..") for part in relative):
        raise RuntimeError("unsafe script path: {}".format(entry_name))
    return relative


def _extract_scripts(archive, root_dir):
    staging_dir = tempfile.mkdtemp(prefix=".scripts-update-", dir=root_dir)
    file_count = 0
    total_bytes = 0
    has_collector = False
    try:
        with zipfile.ZipFile(io.BytesIO(archive), "r") as bundle:
            for entry in bundle.infolist():
                if entry.is_dir():
                    continue
                relative_parts = _script_parts(entry.filename)
                if relative_parts is None:
                    continue
                file_count += 1
                if file_count > MAX_SCRIPT_FILES:
                    raise RuntimeError("archive contains too many script files")
                total_bytes += entry.file_size
                if total_bytes > MAX_SCRIPT_BYTES:
                    raise RuntimeError("extracted scripts exceed the size limit")
                destination = os.path.abspath(os.path.join(staging_dir, *relative_parts))
                if os.path.commonpath((staging_dir, destination)) != os.path.abspath(staging_dir):
                    raise RuntimeError("unsafe script destination")
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                written = 0
                with bundle.open(entry, "r") as source, open(destination, "wb") as target:
                    while True:
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > entry.file_size or total_bytes - entry.file_size + written > MAX_SCRIPT_BYTES:
                            raise RuntimeError("extracted scripts exceed the size limit")
                        target.write(chunk)
                if relative_parts == ["collect_cowork.py"]:
                    has_collector = True
        if not has_collector:
            raise RuntimeError("archive is missing scripts/collect_cowork.py")
        return staging_dir
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise


def _write_version(root_dir, version):
    target = os.path.join(root_dir, VERSION_FILE)
    temporary = target + ".{}.tmp".format(uuid.uuid4().hex)
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump({"version": version}, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, target)
    finally:
        try:
            os.remove(temporary)
        except FileNotFoundError:
            pass


def _replace_scripts(root_dir, staging_dir, version):
    scripts_dir = os.path.join(root_dir, "scripts")
    backup_dir = os.path.join(root_dir, ".scripts-backup-{}".format(uuid.uuid4().hex))
    had_scripts = os.path.isdir(scripts_dir)
    if had_scripts:
        os.replace(scripts_dir, backup_dir)
    try:
        os.replace(staging_dir, scripts_dir)
    except Exception:
        if had_scripts and os.path.isdir(backup_dir):
            os.replace(backup_dir, scripts_dir)
        raise
    try:
        _write_version(root_dir, version)
    except Exception:
        shutil.rmtree(scripts_dir, ignore_errors=True)
        if had_scripts and os.path.isdir(backup_dir):
            os.replace(backup_dir, scripts_dir)
        raise
    shutil.rmtree(backup_dir, ignore_errors=True)


def _acquire_lock(root_dir):
    lock_path = os.path.join(root_dir, LOCK_FILE)
    for attempt in range(2):
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(descriptor, str(os.getpid()).encode("ascii"))
            return lock_path, descriptor
        except FileExistsError:
            try:
                stale = time.time() - os.path.getmtime(lock_path) > LOCK_STALE_SECONDS
            except FileNotFoundError:
                continue
            if attempt == 0 and stale:
                try:
                    os.remove(lock_path)
                except FileNotFoundError:
                    pass
                continue
            return None
    return None


def _release_lock(lock):
    lock_path, descriptor = lock
    os.close(descriptor)
    try:
        os.remove(lock_path)
    except FileNotFoundError:
        pass


def check_for_updates(root_dir=ROOT_DIR, metadata_url=DEFAULT_METADATA_URL, opener=None):
    """Check once and update only scripts/. Returns a small status dictionary."""
    if not os.path.isdir(root_dir):
        return {"status": "not-installed"}
    lock = _acquire_lock(root_dir)
    if lock is None:
        return {"status": "busy"}
    try:
        active_opener = opener or urllib.request.urlopen
        metadata = _load_metadata(active_opener, metadata_url)
        remote_version = metadata["version"].strip()
        local_version = _read_local_version(root_dir)
        if local_version and _version_parts(remote_version) <= _version_parts(local_version):
            return {
                "status": "current",
                "version": local_version,
                "remote_version": remote_version,
            }
        archive_url, sha256 = _validated_release(metadata, metadata_url)
        archive = _download_archive(active_opener, archive_url, sha256)
        staging_dir = _extract_scripts(archive, root_dir)
        try:
            _replace_scripts(root_dir, staging_dir, remote_version)
        finally:
            shutil.rmtree(staging_dir, ignore_errors=True)
        return {
            "status": "updated",
            "previous_version": local_version,
            "version": remote_version,
        }
    finally:
        _release_lock(lock)

