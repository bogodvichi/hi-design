from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import compile_pattern_page
from validate_pattern_page import extract_frozen_json, validate_pattern_html


class PermissionApprovalListTest(unittest.TestCase):
    def test_isc3_permission_approval_tabs_and_batch_rules_compile(self) -> None:
        spec_path = ROOT / "output" / "isc3-permission-approval-list.spec.json"
        spec = json.loads(spec_path.read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "permission-approval-list.html"
            html = compile_pattern_page(spec, output)
            output.write_text(html, encoding="utf-8")
            config = extract_frozen_json(html, "PAGE_CONFIG")

            self.assertEqual(config["product_shell_standard"], "isc-3.0.0")
            self.assertEqual(config["pattern_family"], "hui.tpp.family.table-tabs")
            self.assertEqual(config["framework"]["variant"], "regular-09")
            self.assertTrue(config["framework"]["show_top_tabs"])
            self.assertEqual(config["framework"]["active_tab"], "pending")
            self.assertEqual(config["framework"]["tabs"], config["table_tabs"])
            self.assertEqual(config["table_tabs"][0]["id"], "pending")
            self.assertEqual(config["table_tabs"][1]["id"], "approved")

            batch_action = config["toolbar_actions"][0]
            self.assertTrue(batch_action["requires_selection"])
            self.assertEqual(batch_action["tabs"], ["pending"])
            self.assertEqual(batch_action["selectable_key"], "canApprove")
            self.assertEqual(batch_action["stale_key"], "stateChanged")
            self.assertIn("confirm", batch_action)

            pending_rows = spec["preview"]["tableTabRows"]["pending"]
            self.assertTrue(any(not row["canApprove"] for row in pending_rows))
            self.assertTrue(any(row["stateChanged"] for row in pending_rows))
            self.assertIn(':selectable="isRowSelectable"', html)
            self.assertIn("this.$confirm(message", html)
            self.assertIn("列表状态已发生变化，请刷新后重试", html)
            self.assertIn("appliesToActiveTableTab", html)
            self.assertIn('v-if="hasTableTabs && !usesFrameworkTableTabs"', html)
            self.assertIn("this.activeTableTab = tab.id", html)
            self.assertIn("Math.max(96, this.activeRowActions.length * 48 + 48)", html)
            self.assertEqual(validate_pattern_html(spec, output), [])


if __name__ == "__main__":
    unittest.main()
