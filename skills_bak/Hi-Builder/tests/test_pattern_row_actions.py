import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

import sys

sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import compile_pattern_page
from validate_pattern_page import validate_pattern_html


class PatternRowActionsTest(unittest.TestCase):
    def test_table_renders_configured_icon_row_actions(self) -> None:
        spec = {
            "schema_version": "pattern-page-spec.v2",
            "industry": "general",
            "product": "isc",
            "product_version": "3.0.0",
            "id": "row-actions-test",
            "title": "人员信息",
            "page_kind": "table",
            "pattern_contract": "table/with-operation-bar.json",
            "portal": {
                "active_top_menu": "门禁管理",
                "active_icon_menu": "personnel",
                "section": "人员管理",
                "tab_title": "人员信息",
                "active_side_menu": "personnel-list",
                "side_menus": [
                    {"id": "personnel-list", "label": "人员信息", "icon": "h-icon-user"}
                ],
            },
            "toolbar_actions": [{"label": "添加", "icon": "h-icon-add"}],
            "row_actions": [
                {"id": "edit", "label": "编辑", "icon": "h-icon-edit"},
                {"id": "details", "label": "详情", "icon": "h-icon-details"},
                {"id": "delete", "label": "删除", "icon": "h-icon-delete"},
            ],
            "columns": [{"prop": "name", "label": "姓名"}],
            "preview": {"rows": [{"id": 1, "name": "张伟"}], "total": 1},
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "row-actions.html"
            html = compile_pattern_page(spec, output)
            output.write_text(html, encoding="utf-8")
            self.assertIn('v-for="action in config.row_actions"', html)
            self.assertIn(':aria-label="action.label"', html)
            self.assertIn('"active_icon_menu": "personnel"', html)
            self.assertEqual(validate_pattern_html(spec, output), [])

    def test_text_cards_render_configured_row_actions(self) -> None:
        spec = {
            "schema_version": "pattern-page-spec.v2",
            "industry": "general",
            "product": "isc",
            "product_version": "3.0.0",
            "id": "card-row-actions-test",
            "title": "人员分组",
            "page_kind": "card",
            "pattern_contract": "card/text.json",
            "portal": {
                "active_top_menu": "门禁管理",
                "active_icon_menu": "personnel",
                "section": "人员管理",
                "tab_title": "人员分组",
                "active_side_menu": "personnel-group",
                "side_menus": [
                    {"id": "personnel-group", "label": "人员分组", "icon": "h-icon-users"}
                ],
            },
            "toolbar_actions": [{"label": "添加", "icon": "h-icon-add"}],
            "row_actions": [
                {"id": "details", "label": "查看", "icon": "h-icon-details"}
            ],
            "page_size": 20,
            "preview": {
                "rows": [
                    {
                        "id": 1,
                        "image": "http://tpp.dev.hikhub.net/tpp/img/text.0a734454.png",
                        "title": "研发中心员工组",
                        "tags": [{"label": "128人"}],
                        "location": "创建人：admin",
                        "time": "创建时间：2026-08-28 10:18",
                    }
                ],
                "total": 1,
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "card-row-actions.html"
            html = compile_pattern_page(spec, output)
            output.write_text(html, encoding="utf-8")
            self.assertIn('v-for="action in config.row_actions"', html)
            self.assertIn('@click.stop="rowAction(action, row)"', html)
            self.assertEqual(validate_pattern_html(spec, output), [])


if __name__ == "__main__":
    unittest.main()
