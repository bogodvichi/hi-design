# -*- coding: utf-8 -*-
"""ForDesigner 静态组织映射和静默升级回归测试，兼容 Python 3.7+。"""
import hashlib
import importlib
import io
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import collect_cowork
import static_org_map
import update_collector


class StaticOrgMapTests(unittest.TestCase):
    def test_member_counts_and_groups(self):
        expected = {
            "云产品设计组": 5,
            "EBG软件产品设计组": 25,
            "PBG软件产品设计组": 13,
            "通用软件产品设计组": 9,
            "智能设计效能组": 5,
            "基础平台设计组": 9,
        }
        self.assertEqual({k: len(v) for k, v in static_org_map.GROUP_MEMBERS.items()}, expected)
        self.assertEqual(len(static_org_map.MEMBER_TO_GROUP), 66)
        with (ROOT / 'config' / 'member-groups.json').open('r', encoding='utf-8') as handle:
            packaged_map = json.load(handle)
        self.assertEqual(packaged_map, static_org_map.MEMBER_TO_GROUP)
        with (ROOT / 'version.json').open('r', encoding='utf-8') as handle:
            self.assertEqual(json.load(handle)['version'], '1.0.2')

    def test_all_names_and_duplicate_prefix_aliases(self):
        for group, members in static_org_map.GROUP_MEMBERS.items():
            for member in members:
                self.assertEqual(static_org_map.lookup_group(member), group)
                # 兼容看板中首字重复的中文写法，但映射本身只存正确姓名。
                if "\u3400" <= member[0] <= "\u9fff":
                    self.assertEqual(static_org_map.lookup_group(member[0] + member), group)
        self.assertEqual(static_org_map.lookup_group("LLILEI84"), "EBG软件产品设计组")
        self.assertEqual(static_org_map.lookup_group("llilei84"), "EBG软件产品设计组")

    def test_unknown_members_do_not_get_assigned_implicitly(self):
        for user in ("", "未知成员", "另外一个组", "lilei84", None):
            self.assertIsNone(static_org_map.lookup_group(user))

    def test_existing_identity_group_is_overridden_only_for_known_user(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            cfg = root / "config"
            cfg.mkdir()
            (cfg / "server.json").write_text('{"url":"https://example.invalid/report"}', encoding="utf-8")
            identity = cfg / "identity.json"
            for user, recorded_group, expected_group in (
                ("翁文秀", "云产品设计组", "智能设计效能组"),
                ("翁翁文秀", "云产品设计组", "智能设计效能组"),
                ("周菁16", "通用软件产品设计组", "云产品设计组"),
                ("未知新成员", "PBG软件产品设计组", "PBG软件产品设计组"),
            ):
                identity.write_text(
                    json.dumps({"user": user, "group": recorded_group, "machine": "PC-1"}, ensure_ascii=False),
                    encoding="utf-8",
                )
                with mock.patch.object(collect_cowork, "IDENTITY", str(identity)), \
                     mock.patch.object(collect_cowork, "SERVER_CONF", str(cfg / "server.json")):
                    url, actual_user, actual_group, machine = collect_cowork.get_config()
                self.assertEqual((url, actual_user, actual_group, machine),
                                 ("https://example.invalid/report", user, expected_group, "PC-1"))
                # user_name 保持原始 identity，避免与历史 session 归属字段不一致。

    def test_missing_mapping_does_not_stop_collector(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            identity = root / "identity.json"
            identity.write_text('{"user":"新同事","group":"基础平台设计组","machine":"M"}', encoding="utf-8")
            server = root / "server.json"
            server.write_text('{"url":"https://example.invalid/report"}', encoding="utf-8")
            with mock.patch.object(collect_cowork, "IDENTITY", str(identity)), \
                 mock.patch.object(collect_cowork, "SERVER_CONF", str(server)), \
                 mock.patch.object(static_org_map, "lookup_group", side_effect=RuntimeError("mapping broken")):
                self.assertEqual(collect_cowork.get_config()[2], "基础平台设计组")


class SilentUpdateTests(unittest.TestCase):
    def test_offline_upgrade_preserves_config_and_history(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            for name in ("scripts", "config", "data"):
                (root / name).mkdir()
            (root / "scripts/collect_cowork.py").write_text("old", encoding="utf-8")
            (root / "version.json").write_text('{"version":"1.0.1"}', encoding="utf-8")
            identity = '{"user":"张亚婷5","group":"云产品设计组"}'
            (root / "config/identity.json").write_text(identity, encoding="utf-8")
            existing_usage = "historical usage data\n"
            (root / "data/usage.jsonl").write_text(existing_usage, encoding="utf-8")
            (root / "data/report_retry_queue.json").write_text('{"old":"payload"}', encoding="utf-8")

            archive_bytes = io.BytesIO()
            with zipfile.ZipFile(archive_bytes, "w", zipfile.ZIP_DEFLATED) as bundle:
                for file in sorted(SCRIPTS.glob("*.py")):
                    bundle.write(str(file), "scripts/" + file.name)
            archive_bytes = archive_bytes.getvalue()
            metadata_url = "https://example.invalid/for-designer/stable/latest/metadata.json"
            metadata = json.dumps({
                "version": "1.0.2",
                "url": "https://example.invalid/for-designer/stable/versions/v1.0.2/for-designer-1.0.2.zip",
                "sha256": hashlib.sha256(archive_bytes).hexdigest(),
            }).encode("utf-8")

            class Response(io.BytesIO):
                status = 200
                def __init__(self, data):
                    super().__init__(data)
                    self.headers = {"Content-Length": str(len(data))}

            def fake_opener(request, timeout=10):
                if "metadata.json" in request.full_url:
                    return Response(metadata)
                return Response(archive_bytes)

            result = update_collector.check_for_updates(
                root_dir=str(root), metadata_url=metadata_url, opener=fake_opener,
            )
            self.assertEqual(result["status"], "updated")
            self.assertEqual(result["previous_version"], "1.0.1")
            self.assertEqual((root / "config/identity.json").read_text(encoding="utf-8"), identity)
            self.assertEqual((root / "data/usage.jsonl").read_text(encoding="utf-8"), existing_usage)
            self.assertEqual((root / "data/report_retry_queue.json").read_text(encoding="utf-8"), '{"old":"payload"}')
            self.assertTrue((root / "scripts/static_org_map.py").exists())
            self.assertEqual(json.loads((root / "version.json").read_text())["version"], "1.0.2")
            second = update_collector.check_for_updates(
                root_dir=str(root), metadata_url=metadata_url, opener=fake_opener,
            )
            self.assertEqual(second["status"], "current")


if __name__ == "__main__":
    unittest.main()
