# -*- coding: utf-8 -*-
"""Mac 安装器迁移与 launchd 幂等回归；只使用临时 HOME，不碰真实用户资料。"""
import json
import os
import pathlib
import platform
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


@unittest.skipUnless(platform.system() == "Darwin", "requires a macOS runner")
class MacInstallerMigrationTests(unittest.TestCase):
    def test_relogin_does_not_clobber_newer_scripts_or_collector_data(self):
        with tempfile.TemporaryDirectory(prefix="fordesigner-migration-") as temp:
            home = pathlib.Path(temp)
            source = home / "Desktop" / "for-designer"
            target = home / "ai-usage-tracker"
            shutil.copytree(str(ROOT), str(source), ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            (source / "config" / "identity.json").write_text(
                '{"user":"错误的身份","group":"错误部门"}', encoding="utf-8"
            )
            (target / "scripts").mkdir(parents=True)
            (target / "config").mkdir()
            (target / "data").mkdir()
            shutil.copy2(str(source / "scripts" / "parse.py"), str(target / "scripts" / "parse.py"))
            current_collector = "newer v1.0.3 collector - do not overwrite"
            identity = '{"user":"翁文秀","group":"智能设计效能组","machine":"mac"}'
            version = '{"version":"1.0.3"}'
            retry = '{"session1":{"session_id":"one"},"pending":247}'
            state = '{"baselines":{"one":{"last_total":100}}}'
            log = "historical usage log"
            (target / "scripts" / "collect_cowork.py").write_text(current_collector, encoding="utf-8")
            (target / "config" / "identity.json").write_text(identity, encoding="utf-8")
            (target / "version.json").write_text(version, encoding="utf-8")
            (target / "data" / "report_retry_queue.json").write_text(retry, encoding="utf-8")
            (target / "data" / "collector_state.json").write_text(state, encoding="utf-8")
            (target / "data" / "cowork-collect.log").write_text(log, encoding="utf-8")
            fake_bin = home / "bin"
            fake_bin.mkdir()
            fake_launchctl = fake_bin / "launchctl"
            fake_launchctl.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake_launchctl.chmod(0o755)
            env = dict(os.environ)
            env["HOME"] = str(home)
            env["PATH"] = str(fake_bin) + os.pathsep + os.environ.get("PATH", "")
            plist = home / "Library" / "LaunchAgents" / "com.hik.ai-usage.cowork-collect.plist"
            def run_installer():
                result = subprocess.run(
                    ["bash", str(source / "install.command")],
                    cwd=str(source),
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    universal_newlines=True,
                    timeout=30,
                )
                self.assertEqual(result.returncode, 0, (result.stdout, result.stderr))
            run_installer()
            plist_mtime = plist.stat().st_mtime_ns
            run_installer()
            self.assertEqual(plist.stat().st_mtime_ns, plist_mtime)
            for path, expected in [
                (target / "scripts" / "collect_cowork.py", current_collector),
                (target / "config" / "identity.json", identity),
                (target / "version.json", version),
                (target / "data" / "report_retry_queue.json", retry),
                (target / "data" / "collector_state.json", state),
                (target / "data" / "cowork-collect.log", log),
            ]:
                self.assertEqual(path.read_text(encoding="utf-8"), expected, str(path))


if __name__ == "__main__":
    unittest.main()
