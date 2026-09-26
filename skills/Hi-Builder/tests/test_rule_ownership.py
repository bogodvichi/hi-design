#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from core import load_json
from validate_skill import (
    validate_filter_search_form_ownership,
    validate_renderer_geometry_ownership,
    validate_rule_ownership,
    validate_selection_column_ownership,
)


class RuleOwnershipTest(unittest.TestCase):
    def copy_skill(self, target: Path) -> Path:
        copied = target / "Hi-Design"
        shutil.copytree(ROOT, copied, ignore=shutil.ignore_patterns("output", "__pycache__", ".DS_Store"))
        return copied

    def test_current_rule_ownership_passes(self) -> None:
        self.assertEqual(validate_rule_ownership(ROOT), [])

    def test_skill_keeps_generated_output_in_client_project_root(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        generation_contract = (
            ROOT / "references" / "generation-contract.md"
        ).read_text(encoding="utf-8")

        self.assertIn('python3 "<skill-root>/scripts/compile_page.py"', skill)
        self.assertIn("--out ./output/<page>.html", skill)
        self.assertIn("不得`cd`到`<skill-root>`", skill)
        self.assertIn("不得写入`.od-skills/`", generation_contract)

    def test_duplicate_exclusive_rule_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            skill_path = copied / "SKILL.md"
            skill_path.write_text(skill_path.read_text(encoding="utf-8") + "\n禁止使用ElMessage。\n", encoding="utf-8")
            errors = validate_rule_ownership(copied)
            self.assertTrue(any("独占规则文本出现在非权威文档" in error for error in errors), errors)

    def test_copied_machine_fact_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            skill_path = copied / "SKILL.md"
            skill_path.write_text(skill_path.read_text(encoding="utf-8") + "\n运行版本为2.7.16。\n", encoding="utf-8")
            errors = validate_rule_ownership(copied)
            self.assertTrue(any("机器事实不得复制到治理文档" in error for error in errors), errors)

    def test_navigation_document_cannot_copy_exclusive_rule(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            readme_path = copied / "README.md"
            readme_path.write_text(
                readme_path.read_text(encoding="utf-8") + "\n禁止使用ElMessage。\n",
                encoding="utf-8",
            )
            errors = validate_rule_ownership(copied)
            self.assertTrue(
                any("独占规则文本不得复制到导航文档" in error for error in errors),
                errors,
            )

    def test_navigation_document_cannot_copy_machine_fact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            readme_path = copied / "README.md"
            readme_path.write_text(
                readme_path.read_text(encoding="utf-8") + "\n运行版本为2.7.16。\n",
                encoding="utf-8",
            )
            errors = validate_rule_ownership(copied)
            self.assertTrue(
                any("机器事实不得复制到导航文档" in error for error in errors),
                errors,
            )

    def test_current_renderer_geometry_ownership_passes(self) -> None:
        self.assertEqual(validate_renderer_geometry_ownership(ROOT), [])

    def test_renderer_cannot_hardcode_tpp_evidence_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            styles_path = copied / "assets/templates/HUI/styles/collection.css"
            source = styles_path.read_text(encoding="utf-8").replace(
                ".table-tabs-search { box-sizing: border-box; }",
                ".table-tabs-search { min-height: 109px; box-sizing: border-box; }",
            )
            styles_path.write_text(source, encoding="utf-8")
            errors = validate_renderer_geometry_ownership(copied)
            self.assertTrue(
                any("Renderer不得绑定TPP观测几何" in error for error in errors),
                errors,
            )

    def test_renderer_cannot_bind_tpp_height_through_variable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            styles_path = copied / "assets/templates/HUI/styles/collection.css"
            source = styles_path.read_text(encoding="utf-8").replace(
                ".table-tabs-search { box-sizing: border-box; }",
                ".table-tabs-search { min-height: var(--page-search-height); box-sizing: border-box; }",
            )
            styles_path.write_text(source, encoding="utf-8")
            errors = validate_renderer_geometry_ownership(copied)
            self.assertTrue(
                any("Renderer不得绑定TPP观测几何" in error for error in errors),
                errors,
            )

    def test_current_filter_search_form_ownership_passes(self) -> None:
        self.assertEqual(validate_filter_search_form_ownership(ROOT), [])

    def test_table_tabs_cannot_bypass_common_filter_visibility(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            template_path = copied / "assets/templates/HUI/fragments/collection/page.html"
            source = template_path.read_text(encoding="utf-8")
            marker = 'v-if="isTableTabsSearch"'
            start = source.index(marker)
            end = source.index('<div v-if="showPageToolbar"', start)
            block = source[start:end].replace(
                'v-for="field in visibleFilters"',
                'v-for="field in config.filters"',
                1,
            )
            template_path.write_text(source[:start] + block + source[end:], encoding="utf-8")
            errors = validate_filter_search_form_ownership(copied)
            self.assertTrue(
                any("不得绕过公共筛选项显隐逻辑" in error for error in errors),
                errors,
            )

    def test_filter_collapse_threshold_cannot_be_hardcoded_in_renderer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            shell_path = copied / "assets/templates/HUI/shells/page-end.html"
            source = shell_path.read_text(encoding="utf-8").replace(
                "Number((this.config.filter_search_form_behavior || {}).collapse_threshold)",
                "6",
                1,
            )
            shell_path.write_text(source, encoding="utf-8")
            errors = validate_filter_search_form_ownership(copied)
            self.assertTrue(
                any("折叠阈值必须消费公共合同" in error for error in errors),
                errors,
            )

    def test_current_selection_columns_use_hui_default_width(self) -> None:
        self.assertEqual(validate_selection_column_ownership(ROOT), [])

    def test_renderer_cannot_override_selection_column_width(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            template_path = copied / "assets/templates/HUI/fragments/collection/page.html"
            source = template_path.read_text(encoding="utf-8").replace(
                'type="selection"',
                'type="selection" width="48"',
                1,
            )
            template_path.write_text(source, encoding="utf-8")
            errors = validate_selection_column_ownership(copied)
            self.assertTrue(
                any("Renderer不得覆盖" in error for error in errors),
                errors,
            )

    def test_product_composition_cannot_override_selection_column_width(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            composition_path = copied / (
                "design-systems/industry-products/general/products/isc/"
                "pages/selection-width-regression/composition.json"
            )
            composition_path.parent.mkdir(parents=True)
            document = {
                "table_columns": {
                    "selection": {"kind": "selection", "width": "48"}
                }
            }
            composition_path.write_text(
                json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            errors = validate_selection_column_ownership(copied)
            self.assertTrue(
                any("产品Composition不得覆盖" in error for error in errors),
                errors,
            )

    def test_renderer_cannot_override_selection_column_alignment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            template_path = copied / "assets/templates/HUI/fragments/collection/page.html"
            source = template_path.read_text(encoding="utf-8").replace(
                'type="selection"',
                'type="selection" align="center" header-align="center"',
                1,
            )
            template_path.write_text(source, encoding="utf-8")
            errors = validate_selection_column_ownership(copied)
            self.assertTrue(
                any("完整使用HUI默认布局" in error for error in errors),
                errors,
            )

    def test_selection_must_not_override_hui_native_styles(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            styles_path = copied / "assets/templates/HUI/styles/collection.css"
            source = styles_path.read_text(encoding="utf-8") + (
                "\n.data-table-pattern .el-table-column--selection .cell { display: flex; }\n"
            )
            styles_path.write_text(source, encoding="utf-8")
            errors = validate_selection_column_ownership(copied)
            self.assertTrue(
                any("不得覆盖HUI原生样式" in error for error in errors),
                errors,
            )


if __name__ == "__main__":
    unittest.main()
