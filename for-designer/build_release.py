#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a for-designer scripts ZIP and matching metadata.json."""

import argparse
import hashlib
import json
import os
import re
import zipfile


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
REPOSITORY_ROOT = os.path.dirname(ROOT_DIR)
PUBLIC_BASE_URL = (
    "https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/"
    "webresources/download/for-designer/stable"
)
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def read_version(root_dir=ROOT_DIR):
    with open(os.path.join(root_dir, "version.json"), "r", encoding="utf-8-sig") as handle:
        version = json.load(handle).get("version")
    if not isinstance(version, str) or not VERSION_RE.match(version.strip()):
        raise RuntimeError("version.json must contain an x.y.z version")
    return version.strip()


def build_release(output_dir, root_dir=ROOT_DIR, public_base_url=PUBLIC_BASE_URL):
    version = read_version(root_dir)
    scripts_dir = os.path.join(root_dir, "scripts")
    if not os.path.isfile(os.path.join(scripts_dir, "collect_cowork.py")):
        raise RuntimeError("scripts/collect_cowork.py is required")

    version_dir = os.path.join(output_dir, "versions", "v{}".format(version))
    latest_dir = os.path.join(output_dir, "latest")
    os.makedirs(version_dir, exist_ok=True)
    os.makedirs(latest_dir, exist_ok=True)
    archive_name = "for-designer-{}.zip".format(version)
    archive_path = os.path.join(version_dir, archive_name)

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for directory, names, files in os.walk(scripts_dir):
            names[:] = sorted(name for name in names if name != "__pycache__")
            for filename in sorted(files):
                if filename.endswith((".pyc", ".pyo")):
                    continue
                source = os.path.join(directory, filename)
                relative = os.path.relpath(source, root_dir).replace(os.sep, "/")
                bundle.write(source, relative)

    with open(archive_path, "rb") as handle:
        sha256 = hashlib.sha256(handle.read()).hexdigest()
    archive_url = "{}/versions/v{}/{}".format(public_base_url.rstrip("/"), version, archive_name)
    metadata = {"version": version, "url": archive_url, "sha256": sha256}
    metadata_path = os.path.join(latest_dir, "metadata.json")
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return {"archive": archive_path, "metadata": metadata_path, "sha256": sha256}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default=os.path.join(REPOSITORY_ROOT, ".tmp", "for-designer-release"),
        help="directory that receives versions/ and latest/",
    )
    args = parser.parse_args()
    result = build_release(os.path.abspath(args.output_dir))
    print("ZIP: {}".format(result["archive"]))
    print("SHA-256: {}".format(result["sha256"]))
    print("metadata: {}".format(result["metadata"]))


if __name__ == "__main__":
    main()
