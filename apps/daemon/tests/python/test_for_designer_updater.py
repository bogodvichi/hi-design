import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


def load_module(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, REPOSITORY_ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


updater = load_module("for_designer_updater", "for-designer/scripts/update_collector.py")
release_builder = load_module("for_designer_release_builder", "for-designer/build_release.py")


class FakeResponse(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(body)
        self.status = status
        self.headers = {"Content-Length": str(len(body))}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()


class FakeOpener:
    def __init__(self, metadata, archive):
        self.metadata = metadata
        self.archive = archive
        self.calls = []

    def __call__(self, request, timeout):
        self.calls.append((request.full_url, timeout))
        if "/latest/metadata.json" in request.full_url:
            return FakeResponse(json.dumps(self.metadata).encode("utf-8"))
        return FakeResponse(self.archive)


def make_archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)
    return output.getvalue()


class ForDesignerUpdaterTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="for-designer-python-test-")
        self.target_dir = os.path.join(self.temp_dir, "for-designer")
        os.makedirs(os.path.join(self.target_dir, "scripts"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def write(self, relative_path, content):
        target = os.path.join(self.target_dir, relative_path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(content)

    def read(self, relative_path):
        with open(os.path.join(self.target_dir, relative_path), "r", encoding="utf-8") as handle:
            return handle.read()

    def test_updates_scripts_and_preserves_config_and_data(self):
        self.write("scripts/collect_cowork.py", "old collector")
        self.write("scripts/obsolete.py", "obsolete")
        self.write("config/identity.json", '{"user":"designer"}')
        self.write("data/usage.jsonl", "keep this\n")
        self.write("version.json", '{"version":"1.0.0"}\n')
        archive = make_archive(
            {
                "for-designer/scripts/collect_cowork.py": "new collector",
                "for-designer/scripts/update_collector.py": "new updater",
                "for-designer/config/identity.json": "do not install",
                "for-designer/data/usage.jsonl": "do not install",
            }
        )
        archive_url = "https://updates.example/stable/versions/v1.0.1/for-designer-1.0.1.zip"
        opener = FakeOpener(
            {
                "version": "1.0.1",
                "url": archive_url,
                "sha256": hashlib.sha256(archive).hexdigest(),
            },
            archive,
        )

        result = updater.check_for_updates(
            root_dir=self.target_dir,
            metadata_url="https://updates.example/stable/latest/metadata.json",
            opener=opener,
        )

        self.assertEqual(result, {"status": "updated", "previous_version": "1.0.0", "version": "1.0.1"})
        self.assertEqual(self.read("scripts/collect_cowork.py"), "new collector")
        self.assertEqual(self.read("scripts/update_collector.py"), "new updater")
        self.assertFalse(os.path.exists(os.path.join(self.target_dir, "scripts", "obsolete.py")))
        self.assertEqual(self.read("config/identity.json"), '{"user":"designer"}')
        self.assertEqual(self.read("data/usage.jsonl"), "keep this\n")
        self.assertEqual(json.loads(self.read("version.json"))["version"], "1.0.1")

    def test_skips_archive_when_local_semantic_version_is_current(self):
        self.write("version.json", '{"version":"1.0.10"}\n')
        opener = FakeOpener(
            {"version": "1.0.9", "url": "not-needed", "sha256": "not-needed"},
            b"",
        )

        result = updater.check_for_updates(
            root_dir=self.target_dir,
            metadata_url="https://updates.example/stable/latest/metadata.json",
            opener=opener,
        )

        self.assertEqual(result["status"], "current")
        self.assertEqual(len(opener.calls), 1)

    def test_checksum_failure_leaves_installed_scripts_untouched(self):
        self.write("scripts/collect_cowork.py", "old collector")
        self.write("version.json", '{"version":"1.0.0"}\n')
        archive = make_archive({"scripts/collect_cowork.py": "untrusted collector"})
        opener = FakeOpener(
            {
                "version": "1.0.1",
                "url": "https://updates.example/stable/versions/v1.0.1/for-designer-1.0.1.zip",
                "sha256": "0" * 64,
            },
            archive,
        )

        with self.assertRaisesRegex(RuntimeError, "SHA-256 does not match"):
            updater.check_for_updates(
                root_dir=self.target_dir,
                metadata_url="https://updates.example/stable/latest/metadata.json",
                opener=opener,
            )

        self.assertEqual(self.read("scripts/collect_cowork.py"), "old collector")
        self.assertEqual(json.loads(self.read("version.json"))["version"], "1.0.0")


class ForDesignerReleaseBuilderTest(unittest.TestCase):
    def test_builds_zip_and_writes_matching_sha256_metadata(self):
        temp_dir = tempfile.mkdtemp(prefix="for-designer-release-test-")
        try:
            source_dir = os.path.join(temp_dir, "source")
            output_dir = os.path.join(temp_dir, "output")
            os.makedirs(os.path.join(source_dir, "scripts"))
            with open(os.path.join(source_dir, "version.json"), "w", encoding="utf-8") as handle:
                json.dump({"version": "1.2.3"}, handle)
            with open(os.path.join(source_dir, "scripts", "collect_cowork.py"), "w", encoding="utf-8") as handle:
                handle.write("collector")

            result = release_builder.build_release(output_dir, root_dir=source_dir)

            with open(result["archive"], "rb") as handle:
                actual_sha256 = hashlib.sha256(handle.read()).hexdigest()
            with open(result["metadata"], "r", encoding="utf-8") as handle:
                metadata = json.load(handle)
            self.assertEqual(result["sha256"], actual_sha256)
            self.assertEqual(metadata["sha256"], actual_sha256)
            self.assertEqual(metadata["version"], "1.2.3")
            with zipfile.ZipFile(result["archive"], "r") as bundle:
                self.assertEqual(bundle.namelist(), ["scripts/collect_cowork.py"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
