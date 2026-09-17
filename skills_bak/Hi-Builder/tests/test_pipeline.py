#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_page import compile_page, RENDERERS
from build_product_acceptance import build_product_acceptance
from compile_generation_test import (
    GenerationTestError,
    compile_test,
)
from compile_pattern_page import (
    PatternPageError,
    compile_pattern_page,
    resolve_renderer_template,
)
from core import (
    build_capability_bundle,
    ContractError,
    load_context,
    load_json,
    resolve_design_system,
    SPEC_RESOLVERS,
    validate_product_tokens,
)
from import_hui_contracts import preserve_curated_d2c_usage
from generate_component_pattern_catalog import (
    build_component_pattern_catalog,
    render_catalog,
)
from semantic_registry import (
    load_component_pattern_registry,
    load_zone_registry,
    validate_semantic_html,
)
from validate_page import VALIDATORS
from validate_pattern_page import extract_frozen_json, validate_pattern_html
from renderer_registry import (
    PAGE_RENDERER_IDS,
    PATTERN_KIND_RENDERERS,
    RENDERER_CONTRACTS,
    renderer_for_hui_pattern,
    template_for_renderer,
)
from validate_skill import (
    validate_generation_templates,
    validate_knowledge_index_maintenance,
)


class PipelineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec_path = ROOT / "tests" / "generation" / "device-list-table.json"
        self.spec = load_json(self.spec_path)
        self.spec["row_actions"] = [
            {"id": "detail", "label": "详情", "icon": "h-icon-details"}
        ]
        self.output_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.output_dir.cleanup)
        self.html_path = Path(self.output_dir.name) / "page.html"
        self.html = compile_pattern_page(self.spec, self.html_path)
        self.html_path.write_text(self.html, encoding="utf-8")

    def validate_source(self, source: str) -> list[str]:
        self.html_path.write_text(source, encoding="utf-8")
        return validate_pattern_html(self.spec, self.html_path)

    def test_default_page_passes(self) -> None:
        self.assertEqual(self.validate_source(self.html), [])
        self.assertNotIn("data-component-instance", self.html)
        self.assertNotIn("data-origin", self.html)

    def test_portal_search_binding_is_declared_in_vue_data(self) -> None:
        self.assertIn('v-model="portalKeyword"', self.html)
        self.assertIn("portalKeyword: ''", self.html)

    def test_hui_pattern_uses_current_isc_product_shell(self) -> None:
        self.assertIn('"product_shell_source": "product:isc"', self.html)
        self.assertIn("问题反馈", self.html)
        self.assertIn("演示指南", self.html)
        self.assertIn("h-icon-qrcode", self.html)
        self.assertIn("张工", self.html)
        self.assertNotIn("李四演示", self.html)
        self.assertNotIn("h-icon-star", self.html)

    def test_page_spec_v2_is_a_generic_envelope(self) -> None:
        schema = load_json(ROOT / "schemas" / "page-spec.schema.json")
        self.assertEqual(schema["properties"]["schema_version"]["const"], "page-spec.v2")
        self.assertIn("payload", schema["properties"])
        for event_specific in ("filter", "toolbar", "table", "sidebar", "data"):
            self.assertNotIn(event_specific, schema["properties"])

    def test_removed_event_search_payload_schema_is_not_resolved(self) -> None:
        removed = load_json(
            ROOT / "tests" / "fixtures" / "event-search.default.json"
        )
        with self.assertRaises(ContractError):
            load_context(removed)

    def test_legacy_page_spec_shape_is_rejected(self) -> None:
        invalid = json.loads(json.dumps(self.spec))
        invalid["schema_version"] = "page-spec.v1"
        with self.assertRaises(PatternPageError):
            compile_pattern_page(invalid)

    def test_renderer_registries_are_aligned_and_page_independent(self) -> None:
        self.assertEqual(set(RENDERERS), set(VALIDATORS))
        self.assertEqual(set(RENDERERS), set(SPEC_RESOLVERS))
        self.assertEqual(RENDERERS, {})

    def test_removed_event_search_composition_is_not_loadable(self) -> None:
        removed = load_json(ROOT / "tests" / "fixtures" / "event-search.default.json")
        with self.assertRaises(ContractError):
            compile_page(removed)

    def test_removed_device_detail_composition_is_not_loadable(self) -> None:
        removed = load_json(ROOT / "tests" / "fixtures" / "device-detail.default.json")
        with self.assertRaises(ContractError):
            compile_page(removed)

    def test_device_detail_content_is_not_smuggled_through_rows(self) -> None:
        spec = load_json(ROOT / "tests" / "fixtures" / "device-detail.default.json")
        self.assertNotIn("rows", spec["payload"]["content"])
        self.assertIn("device", spec["payload"]["content"])

    def test_product_pages_use_explicit_page_manifests(self) -> None:
        product_root = (
            ROOT / "design-systems" / "industry-products" / "general" / "products" / "isc"
        )
        product = load_json(product_root / "product.json")
        self.assertIsInstance(product["pages"], dict)
        for page_type, relative in product["pages"].items():
            page_manifest_path = product_root / relative
            page_manifest = load_json(page_manifest_path)
            self.assertEqual(page_manifest["page_type"], page_type)
            for key in (
                "capability", "payload_schema", "composition", "fixture", "golden"
            ):
                self.assertTrue(
                    (page_manifest_path.parent / page_manifest[key]).is_file(),
                    f"{page_type}:{key}",
                )

    def test_isc_product_acceptance_suite_covers_registered_pages(self) -> None:
        product_root = (
            ROOT / "design-systems" / "industry-products" / "general" / "products" / "isc"
        )
        product = load_json(product_root / "product.json")
        suite = load_json(ROOT / "tests" / "product-pages" / "isc" / "cases.json")
        self.assertEqual(suite["industry"], "general")
        self.assertEqual(suite["product"], "isc")
        self.assertEqual(
            {case["page_type"] for case in suite["cases"]},
            set(product["pages"]),
        )
        self.assertEqual(suite["cases"], [])

    def test_isc_product_acceptance_suite_builds_previewable_outputs(self) -> None:
        suite = load_json(ROOT / "tests" / "product-pages" / "isc" / "cases.json")
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "isc"
            outputs = build_product_acceptance(suite, output_root)
            self.assertEqual(outputs, [])

    def test_composition_and_fixture_have_single_responsibilities(self) -> None:
        product_root = (
            ROOT / "design-systems" / "industry-products" / "general" / "products" / "isc"
        )
        product = load_json(product_root / "product.json")
        for page_type, relative in product["pages"].items():
            page_root = (product_root / relative).parent
            page_manifest = load_json(product_root / relative)
            composition = load_json(page_root / page_manifest["composition"])
            fixture = load_json(page_root / page_manifest["fixture"])
            self.assertEqual(composition["schema_version"], "page-composition.v1")
            self.assertNotIn("defaults", composition)
            self.assertEqual(fixture["schema_version"], "preview-fixture.v1")
            self.assertEqual(fixture["page_type"], page_type)
            self.assertIsInstance(fixture["values"], dict)

    def test_context_does_not_load_unregistered_page_files(self) -> None:
        removed = load_json(ROOT / "tests" / "fixtures" / "event-search.default.json")
        with self.assertRaises(ContractError):
            load_context(removed)

    def test_runtime_profile_is_exact_and_full_import(self) -> None:
        manifest = load_json(
            ROOT / "design-systems" / "HUI" / "manifest.json"
        )
        profile = manifest["runtime_profile"]
        self.assertEqual(profile["vue"]["version"], "2.7.16")
        self.assertEqual(profile["hui"]["version"], "2.61.3")
        self.assertEqual(profile["vue"]["module_mode"], "full")
        self.assertEqual(profile["hui"]["module_mode"], "full")
        self.assertEqual(
            manifest["optional_resources"]["svg_icons"]["url"],
            "https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/"
            "webresources/libs/hui-svg-icon.umd.js",
        )

    def test_skill_runtime_reference_is_project_local(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("本项目`references/hui-vue-runtime-contract.md`", skill)
        self.assertNotIn("读取根目录`references/hui-vue-runtime-contract.md`", skill)
        self.assertTrue((ROOT / "references" / "hui-vue-runtime-contract.md").is_file())

    def test_skill_routes_architecture_contracts(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        for reference in (
            "architecture.md",
            "knowledge-resolution.md",
            "generation-contract.md",
        ):
            path = ROOT / "references" / reference
            self.assertTrue(path.is_file(), reference)
            self.assertIn(f"`references/{reference}`", skill)

    def test_knowledge_indexes_explain_maintenance_in_place(self) -> None:
        self.assertEqual(validate_knowledge_index_maintenance(), [])

    def test_architecture_keeps_semantics_with_the_only_hui_target(self) -> None:
        architecture = (
            ROOT / "references" / "architecture.md"
        ).read_text(encoding="utf-8")
        self.assertIn("HUI/zones/", architecture)
        self.assertIn("HUI/common-domain/fields/catalog.json", architecture)
        self.assertNotIn("├── semantics/", architecture)

    def test_product_tokens_use_explicit_pointer_and_hui_contract(self) -> None:
        product_root = (
            ROOT / "design-systems" / "industry-products" / "general" / "products" / "isc"
        )
        product = load_json(product_root / "product.json")
        profile = load_json(product_root / product["profile"])
        product_tokens = load_json(product_root / product["theme"])
        manifest = load_json(
            ROOT / "design-systems" / "HUI" / "manifest.json"
        )
        token_contract = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / manifest["theme"]["token_contract"]
        )
        self.assertNotIn("theme_overrides", profile)
        validate_product_tokens(product_tokens, token_contract)
        invalid = json.loads(json.dumps(product_tokens))
        invalid["overrides"]["--h-invented-token"] = "red"
        with self.assertRaises(ContractError):
            validate_product_tokens(invalid, token_contract)

    def test_industry_fields_extend_without_copying_hui_common_fields(self) -> None:
        common = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "common-domain"
            / "fields"
            / "catalog.json"
        )
        industry = load_json(
            ROOT
            / "design-systems"
            / "industry-products"
            / "general"
            / "domain"
            / "fields"
            / "catalog.json"
        )
        self.assertEqual(industry["extends"], common["id"])
        self.assertFalse(set(common["fields"]) & set(industry["fields"]))

    def test_removed_event_search_capability_is_non_compilable(self) -> None:
        bundle = build_capability_bundle("general", "isc", "event-search")
        self.assertEqual(bundle["schema_version"], "capability-bundle.v1")
        self.assertFalse(bundle["matched"])
        self.assertFalse(bundle["can_compile"])
        self.assertEqual(bundle["allowed_zone_ids"], [])
        self.assertIsNone(bundle["selection"]["compile_route"])
        self.assertIsNone(bundle["selection"]["renderer"])
        self.assertEqual(
            bundle["knowledge_gaps"],
            ["product-page-composition-or-hui-renderer"],
        )

    def test_fallback_bundle_reports_non_compilable_knowledge_gap(self) -> None:
        bundle = build_capability_bundle(
            "public-security", "pvia", "event-search"
        )
        self.assertFalse(bundle["can_compile"])
        self.assertEqual(bundle["allowed_zone_ids"], [])
        self.assertIn("filter", bundle["page_region_roles"])
        self.assertEqual(
            bundle["knowledge_gaps"],
            ["product-page-composition-or-hui-renderer"],
        )

    def test_verified_hui_detail_family_is_a_compilable_product_fallback(self) -> None:
        bundle = build_capability_bundle(
            "general", "isc", "总分结构详情"
        )
        self.assertFalse(bundle["matched"])
        self.assertTrue(bundle["can_compile"])
        self.assertEqual(bundle["resolution_level"], "hui-fallback")
        self.assertEqual(
            bundle["selection"]["compile_route"], "hui-pattern-fallback"
        )
        self.assertEqual(bundle["selection"]["renderer"], "hui.tpp.details")
        self.assertEqual(bundle["selection"]["input_contract"], "pattern-page-spec.v2")
        self.assertEqual(len(bundle["pattern_variants"]), 3)
        self.assertEqual(bundle["knowledge_gaps"], [])

    def test_registered_hui_family_fallback_is_not_detail_specific(self) -> None:
        expected = {
            "grouped-form": "hui.tpp.form",
            "manual-filter-table": "hui.tpp.table",
            "卡片页手动过滤": "hui.tpp.card",
        }
        for page_type, renderer in expected.items():
            bundle = build_capability_bundle(
                "general", "isc", page_type
            )
            self.assertTrue(bundle["can_compile"])
            self.assertEqual(
                bundle["selection"]["compile_route"], "hui-pattern-fallback"
            )
            self.assertEqual(bundle["selection"]["renderer"], renderer)
            self.assertTrue(bundle["pattern_variants"])

    def test_generated_page_has_runtime_data_layers_without_vuex(self) -> None:
        self.assertIn("const PAGE_CONFIG =", self.html)
        self.assertIn("const PREVIEW_FIXTURES =", self.html)
        self.assertIn("config: PAGE_CONFIG", self.html)
        self.assertIn("created: function ()", self.html)
        self.assertIn("loadPreviewFixtures: function ()", self.html)
        self.assertNotIn("cloneRuntimeValue(PAGE_CONFIG)", self.html)
        self.assertNotIn("this.spec =", self.html)
        self.assertNotIn("vuex.min.js", self.html)

    def test_three_generation_templates_follow_the_contract(self) -> None:
        self.assertEqual(validate_generation_templates(ROOT), [])

    def test_template_contract_rejects_resource_and_data_regressions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied_root = Path(directory)
            copied_templates = copied_root / "assets" / "templates"
            copied_templates.parent.mkdir(parents=True)
            shutil.copytree(ROOT / "assets" / "templates", copied_templates)
            page_start = copied_templates / "HUI" / "shells" / "page-start.html"
            changed = page_start.read_text(encoding="utf-8").replace(
                "__HUI_CSS__",
                "https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/"
                "public/webresources/libs/hui.css",
                1,
            )
            page_start.write_text(changed, encoding="utf-8")
            page_end = copied_templates / "HUI" / "shells" / "page-end.html"
            changed = page_end.read_text(encoding="utf-8").replace(
                "config: PAGE_CONFIG",
                "cloneRuntimeValue(PAGE_CONFIG)",
                1,
            )
            page_end.write_text(changed, encoding="utf-8")
            errors = validate_generation_templates(copied_root)
            self.assertTrue(any("不得复制Manifest资源URL" in error for error in errors), errors)
            self.assertTrue(any("重新混合配置与预览数据" in error for error in errors), errors)

    def test_forbidden_global_service_is_rejected(self) -> None:
        changed = self.html.replace("this.$message.success", "ElMessage.success", 1)
        errors = self.validate_source(changed)
        self.assertTrue(any("禁止使用HUI全局服务" in error for error in errors), errors)

    def test_element_icon_prefix_is_rejected(self) -> None:
        changed = self.html.replace("h-icon-search", "el-icon-search", 1)
        errors = self.validate_source(changed)
        self.assertTrue(any("禁止使用el-icon" in error for error in errors), errors)

    def test_unverified_hui_font_icon_is_rejected(self) -> None:
        changed = self.html.replace("h-icon-search", "h-icon-video", 1)
        errors = self.validate_source(changed)
        self.assertTrue(any("未验证的字体图标类" in error for error in errors), errors)

    def test_external_font_icon_css_is_rejected(self) -> None:
        changed = self.html.replace(
            "</head>",
            '<link rel="stylesheet" href="../../assets/fonts/h-icon/h-icon.css"></head>',
            1,
        )
        errors = self.validate_source(changed)
        self.assertTrue(any("禁止加载独立字体图标CSS" in error for error in errors), errors)

    def test_icon_v2_requires_svg_resource_and_registration(self) -> None:
        changed = self.html.replace(
            "</main>",
            "<h-icon><add></add></h-icon></main>",
            1,
        )
        errors = self.validate_source(changed)
        self.assertTrue(any("SVG图标资源必须出现一次" in error for error in errors), errors)
        self.assertTrue(any("必须在创建Vue实例前注册" in error for error in errors), errors)

    def test_icon_v2_cdn_resource_and_registration_pass(self) -> None:
        changed = self.html.replace(
            'data-component="filter.search-form">',
            'data-component="filter.search-form"><h-icon><add></add></h-icon>',
            1,
        )
        resource = (
            '<script src="https://pixso.hikvision.com.cn/hik-plugin/'
            'ai-builder-web/public/webresources/libs/hui-svg-icon.umd.js"></script>\n'
            "<script>Vue.use(window['hui-svg-icon'])</script>\n"
        )
        changed = changed.replace(
            "  <script>\n    const PAGE_CONFIG =",
            "  " + resource + "  <script>\n    const PAGE_CONFIG =",
            1,
        )
        self.assertEqual(self.validate_source(changed), [])

    def test_h_svg_icon_only_accepts_svg_components(self) -> None:
        changed = self.html.replace(
            "</main>",
            "<h-svg-icon><div></div></h-svg-icon></main>",
            1,
        )
        errors = self.validate_source(changed)
        self.assertTrue(any("只允许官方svg-*组件" in error for error in errors), errors)

    def test_dialog_must_use_visible_sync(self) -> None:
        changed = self.html.replace(
            "</main>",
            '<el-dialog v-model="dialogVisible"></el-dialog></main>',
            1,
        )
        errors = self.validate_source(changed)
        self.assertTrue(any("Dialog必须使用:visible.sync" in error for error in errors), errors)

    def test_unused_vuex_is_rejected(self) -> None:
        vuex = (
            '<script src="https://pixso.hikvision.com.cn/hik-plugin/'
            'ai-builder-web/public/webresources/libs/vuex.min.js"></script>'
        )
        changed = self.html.replace("</body>", vuex + "</body>", 1)
        errors = self.validate_source(changed)
        self.assertTrue(any("未使用Vuex却引入" in error for error in errors), errors)

    def test_deprecated_data_origin_is_rejected(self) -> None:
        changed = self.html.replace(
            'data-zone="portal.header"',
            'data-zone="portal.header" data-origin="strict"',
            1,
        )
        errors = self.validate_source(changed)
        self.assertTrue(
            any("不得输出废弃属性data-origin" in error for error in errors),
            errors,
        )

    def test_removed_device_detail_fixture_cannot_compile(self) -> None:
        removed = load_json(
            ROOT / "tests" / "fixtures" / "device-detail.default.json"
        )
        with self.assertRaises(ContractError):
            compile_page(removed)

    def test_removed_device_detail_has_no_compile_route(self) -> None:
        bundle = build_capability_bundle("general", "isc", "device-detail")
        self.assertFalse(bundle["matched"])
        self.assertFalse(bundle["can_compile"])
        self.assertIsNone(bundle["selection"]["compile_route"])

    def test_pattern_row_actions_are_driven_by_page_config(self) -> None:
        self.assertIn('v-for="action in config.row_actions"', self.html)
        self.assertIn('"id": "detail"', self.html)

    def test_pattern_row_actions_use_the_registered_hui_renderer(self) -> None:
        self.assertIn('@click.stop="rowAction(action, scope.row)"', self.html)
        self.assertIn('type="text" size="mini"', self.html)

    def test_spec_rejects_visual_px(self) -> None:
        invalid = json.loads(json.dumps(self.spec, ensure_ascii=False))
        invalid["gap"] = "16px"
        with self.assertRaises(PatternPageError):
            compile_pattern_page(invalid)

    def test_removed_event_search_extension_cannot_compile(self) -> None:
        removed = load_json(
            ROOT / "tests" / "fixtures" / "event-search.extended.json"
        )
        with self.assertRaises(ContractError):
            compile_page(removed)

    def test_removed_event_search_does_not_win_over_hui_fallback(self) -> None:
        resolution = resolve_design_system("general", "isc", "event-search")
        self.assertFalse(resolution["matched"])
        self.assertEqual(resolution["resolution_level"], "hui-fallback")
        self.assertEqual(
            resolution["hui_page_pattern"]["contract"]["id"],
            "hui.page-pattern.list-search",
        )

    def test_unknown_product_uses_hui_page_pattern(self) -> None:
        resolution = resolve_design_system(
            "public-security", "pvia", "event-search"
        )
        self.assertFalse(resolution["matched"])
        self.assertEqual(resolution["resolution_level"], "hui-fallback")
        self.assertEqual(
            resolution["hui_page_pattern"]["contract"]["id"],
            "hui.page-pattern.list-search",
        )

    def test_fixed_width_form_uses_hui_form_page_pattern(self) -> None:
        resolution = resolve_design_system(
            "public-security", "pvia", "fixed-width-1-column"
        )
        self.assertFalse(resolution["matched"])
        self.assertEqual(resolution["resolution_level"], "hui-fallback")
        self.assertEqual(
            resolution["hui_page_pattern"]["contract"]["id"],
            "hui.page-pattern.form.fixed-width-one-column",
        )

    def test_hui_official_catalog_is_complete(self) -> None:
        manifest = load_json(
            ROOT / "design-systems" / "HUI" / "manifest.json"
        )
        entries = [
            item
            for items in manifest["official_catalog"].values()
            for item in items
        ]
        self.assertEqual(len(entries), 60)
        self.assertEqual(
            {key: len(value) for key, value in manifest["official_catalog"].items()},
            manifest["catalog_source"]["category_counts"],
        )

    def test_hui_basic_form_runtime_contracts_are_verified(self) -> None:
        manifest = load_json(
            ROOT / "design-systems" / "HUI" / "manifest.json"
        )
        batch = manifest["runtime_contract_batches"]["basic-form"]
        self.assertEqual(batch["status"], "verified")
        self.assertEqual(len(batch["component_ids"]), 19)
        runtime = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / manifest["runtime_contracts"]["index"]
        )["entries"]
        button = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / runtime["el-button"]["contract_files"][0]
        )
        input_contract = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / runtime["el-input"]["contract_files"][0]
        )
        form = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / runtime["el-form"]["contract_files"][0]
        )
        self.assertIn(
            "loading",
            {
                row["template_name"]
                for row in button["runtime"]["el-button"]["props"]
            },
        )
        self.assertIn(
            "clearable-show-suffix",
            {
                row["template_name"]
                for row in input_contract["runtime"]["el-input"]["props"]
            },
        )
        self.assertIn(
            "validate",
            {
                row["template_name"]
                for row in form["runtime"]["el-form"]["methods"]
            },
        )
        self.assertEqual(
            runtime["el-radio-group"]["interface_counts"]["events"],
            1,
        )
        self.assertEqual(
            runtime["el-date-picker"]["component_ids"],
            ["date-picker", "date-time-picker"],
        )

    def test_hui_runtime_batches_cover_all_official_components(self) -> None:
        manifest = load_json(
            ROOT / "design-systems" / "HUI" / "manifest.json"
        )
        official = {
            item["id"]
            for items in manifest["official_catalog"].values()
            for item in items
        }
        covered = [
            component_id
            for batch in manifest["runtime_contract_batches"].values()
            for component_id in batch["component_ids"]
        ]
        self.assertEqual(set(covered), official)
        self.assertEqual(len(covered), len(set(covered)))
        runtime = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / manifest["runtime_contracts"]["index"]
        )["entries"]
        for tag in (
            "h-ip-input",
            "h-stats",
            "h-color-picker",
            "h-anchor",
            "h-subanchor",
            "el-layout-page-header",
            "el-descriptions-row",
        ):
            self.assertIn(tag, runtime)
        for invalid_tag in (
            "el-ip-input",
            "el-stats",
            "el-color-picker",
            "el-anchor",
            "el-page-header",
            "el-descriptions-item",
        ):
            self.assertNotIn(invalid_tag, runtime)

    def test_hui_card_runtime_contract_has_visual_profiles(self) -> None:
        contract = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "runtime-contracts"
            / "others"
            / "card.json"
        )
        usage = contract["d2c_usage"]
        self.assertNotIn("semantic_component", usage)
        self.assertEqual(
            set(usage["visual_profiles"]),
            {
                "vehicle-card",
                "face-card",
                "similarity-card",
                "text-card",
                "data-list",
            },
        )
        self.assertEqual(
            usage["visual_profiles"]["data-list"]["root"]["display"],
            "flex",
        )
        self.assertEqual(
            usage["visual_profiles"]["similarity-card"]["header"]["media_layout"],
            "two-equal-columns",
        )
        serialized = json.dumps(usage, ensure_ascii=False)
        for product_field in ("deviceName", "captureCode", "ISC"):
            self.assertNotIn(product_field, serialized)
        for relative in usage["source_page_patterns"]:
            self.assertTrue(
                (
                    ROOT
                    / "design-systems"
                    / "HUI"
                    / relative
                ).is_file()
            )

    def test_hui_contract_import_preserves_curated_d2c_usage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "card.json"
            path.write_text(
                json.dumps({"d2c_usage": {"visual_profiles": {"custom": {}}}}),
                encoding="utf-8",
            )
            refreshed = preserve_curated_d2c_usage(
                {"runtime": {"el-card": {"props": []}}}, path
            )
        self.assertIn("custom", refreshed["d2c_usage"]["visual_profiles"])

    def test_tpp_catalog_and_form_batch_are_complete(self) -> None:
        catalog = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
            / "catalog.json"
        )
        self.assertEqual(catalog["source"]["page_count"], 80)
        self.assertEqual(
            catalog["source"]["category_counts"],
            {
                "表单页": 13,
                "表格页": 18,
                "卡片页": 19,
                "详情页": 14,
                "结果页": 8,
                "缺省页": 8,
            },
        )
        verified_forms = [
            page
            for page in catalog["pages"]
            if page["status"] == "evidence-verified"
            and page["category"][0] == "表单页"
        ]
        self.assertEqual(len(verified_forms), 13)
        self.assertEqual(
            {
                key: value["variant_count"]
                for key, value in catalog["families"].items()
                if key.startswith("form-")
            },
            {
                "form-basic": 4,
                "form-grouped": 2,
                "form-stepped": 2,
                "form-anchored": 3,
                "form-complex": 2,
            },
        )

    def test_tpp_table_batch_is_complete(self) -> None:
        catalog = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
            / "catalog.json"
        )
        verified_tables = [
            page
            for page in catalog["pages"]
            if page["status"] == "evidence-verified"
            and page["category"][0] == "表格页"
        ]
        self.assertEqual(len(verified_tables), 18)
        expected = {
            "table-basic": 2,
            "table-manual-filter": 5,
            "table-realtime-filter": 2,
            "table-tabs": 4,
            "table-tree": 3,
            "table-statistics": 1,
            "table-details-pane": 1,
        }
        self.assertEqual(
            {
                key: catalog["families"][key]["variant_count"]
                for key in expected
            },
            expected,
        )
        mapping = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
            / "mappings"
            / "table.json"
        )
        strategy = mapping["selection_strategy"]
        self.assertTrue(strategy["selection_required_before_render"])
        self.assertEqual(strategy["required_variant_count"], 18)
        self.assertEqual(len(mapping["pages"]), 18)
        self.assertEqual(
            [item["order"] for item in strategy["priority"]],
            list(range(1, 9)),
        )
        self.assertEqual(strategy["priority"][-1]["family"], "table-basic")
        filter_dimensions = strategy["filter_dimensions"]
        self.assertEqual(
            filter_dimensions["evaluation_order"],
            [
                "trigger_mode",
                "option_density",
                "control_shape",
                "collapse_behavior",
            ],
        )
        self.assertIn("5个及以上选项", filter_dimensions["option_density"]["dense"])
        self.assertIn("horizontal-bar", filter_dimensions["option_density"]["dense"])

    def test_tpp_table_variant_preserves_filter_geometry(self) -> None:
        contract = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
            / "pages"
            / "table"
            / "horizontal-filter-high-low.json"
        )
        self.assertEqual(
            contract["parameters"],
            {
                "filter_placement": "horizontal-bar",
                "collapse_mode": "high-low-frequency",
            },
        )
        self.assertEqual(
            contract["geometry"]["key_regions"]["filter"]["padding"],
            "24px 0px",
        )
        self.assertEqual(
            contract["geometry"]["key_regions"]["pagination"]["rect"]["height"],
            56,
        )
        self.assertIn("el-table", contract["composition"]["hui_components"])
        self.assertIn(
            "h-page-button-group",
            contract["composition"]["page_framework_components"],
        )
        self.assertIn(
            "el-select-menu",
            contract["composition"]["unindexed_runtime_components"],
        )

    def test_tpp_card_batch_is_complete(self) -> None:
        catalog = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
            / "catalog.json"
        )
        verified_cards = [
            page
            for page in catalog["pages"]
            if page["status"] == "evidence-verified"
            and page["category"][0] == "卡片页"
        ]
        self.assertEqual(len(verified_cards), 19)
        expected = {
            "card-basic": 5,
            "card-manual-filter": 5,
            "card-realtime-filter": 2,
            "card-tabs": 4,
            "card-tree": 3,
        }
        self.assertEqual(
            {
                key: catalog["families"][key]["variant_count"]
                for key in expected
            },
            expected,
        )

    def test_tpp_card_variant_preserves_repeat_layout(self) -> None:
        card_root = (
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
            / "pages"
            / "card"
        )
        vehicle = load_json(card_root / "vehicle.json")
        vehicle_layout = vehicle["geometry"]["repeat_layout"]
        self.assertEqual(vehicle_layout["columns_in_first_row"], 5)
        self.assertEqual(vehicle_layout["horizontal_gap"], 16)
        self.assertEqual(vehicle_layout["vertical_gap"], 16)
        self.assertEqual(vehicle_layout["sample_rects"][0]["width"], 307.19)
        self.assertEqual(vehicle_layout["sample_rects"][0]["height"], 285)

        data_list = load_json(card_root / "data-list.json")
        data_list_layout = data_list["geometry"]["repeat_layout"]
        self.assertEqual(data_list_layout["columns_in_first_row"], 1)
        self.assertEqual(data_list_layout["sample_rects"][0]["width"], 1615)
        self.assertEqual(data_list_layout["sample_rects"][0]["height"], 131)

        filtered = load_json(card_root / "horizontal-filter-high-low.json")
        self.assertEqual(
            filtered["geometry"]["key_regions"]["filter"]["padding"],
            "24px 0px",
        )
        self.assertEqual(
            filtered["geometry"]["key_regions"]["pagination"]["rect"]["height"],
            56,
        )
        self.assertIn("el-card", filtered["composition"]["hui_components"])

    def test_tpp_details_fill_up_is_collected_from_real_page(self) -> None:
        tpp_root = (
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
        )
        catalog = load_json(tpp_root / "catalog.json")
        page = next(
            item
            for item in catalog["pages"]
            if item["route"] == "/pages/details/fillUp"
        )
        self.assertEqual(page["status"], "evidence-verified")
        self.assertEqual(page["family"], "hui.tpp.family.details-basic")
        self.assertEqual(catalog["families"]["details-basic"]["variant_count"], 2)

        contract_path = tpp_root / page["contract"]
        contract = load_json(contract_path)
        self.assertEqual(contract["parameters"]["container_width"], "fluid")
        self.assertEqual(contract["parameters"]["group_count"], 4)
        self.assertEqual(contract["parameters"]["description_columns"], 4)
        self.assertEqual(contract["parameters"]["description_item_count"], 18)
        self.assertEqual(
            contract["parameters"]["embedded_tables"],
            ["key-value", "data-table"],
        )
        self.assertEqual(
            contract["geometry"]["key_regions"]["content"]["padding"],
            "48px 80px 58px",
        )
        self.assertEqual(
            contract["geometry"]["key_regions"]["pagination"]["rect"]["height"],
            56,
        )
        self.assertEqual(contract["composition"]["hui_components"]["el-table"], 2)
        self.assertTrue(
            (contract_path.parent / contract["source"]["evidence"]).resolve().is_file()
        )

        fixed_page = next(
            item
            for item in catalog["pages"]
            if item["route"] == "/pages/details/fixedWidth"
        )
        self.assertEqual(fixed_page["status"], "evidence-verified")
        self.assertEqual(fixed_page["family"], "hui.tpp.family.details-basic")
        fixed_contract_path = tpp_root / fixed_page["contract"]
        fixed_contract = load_json(fixed_contract_path)
        self.assertEqual(fixed_contract["parameters"]["container_width"], "fixed")
        self.assertEqual(fixed_contract["parameters"]["container_width_px"], 1280)
        self.assertEqual(
            fixed_contract["geometry"]["key_regions"]["content"]["rect"]["width"],
            1280,
        )
        self.assertEqual(
            fixed_contract["geometry"]["key_regions"]["groups"]["rect"]["width"],
            1120,
        )
        self.assertEqual(fixed_contract["composition"]["hui_components"]["el-table"], 2)
        self.assertTrue(
            (
                fixed_contract_path.parent
                / fixed_contract["source"]["evidence"]
            ).resolve().is_file()
        )

        family = load_json(
            tpp_root / "families" / "details-basic" / "contract.json"
        )
        self.assertEqual(len(family["variants"]), 2)
        self.assertEqual(
            family["invariants"]["evidence_scope"],
            "two-verified-width-variants",
        )
        self.assertNotIn(
            "width",
            family["invariants"]["regions"]["content"],
        )

    def test_basic_details_resolves_to_verified_tpp_family(self) -> None:
        resolution = resolve_design_system(
            "public-security", "pvia", "basic-details"
        )
        self.assertEqual(
            resolution["hui_page_pattern"]["contract"]["id"],
            "hui.tpp.family.details-basic",
        )

    def test_all_tpp_details_pages_are_evidence_verified(self) -> None:
        tpp_root = (
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
        )
        catalog = load_json(tpp_root / "catalog.json")
        detail_pages = [
            page for page in catalog["pages"] if page["category"][0] == "详情页"
        ]
        self.assertEqual(len(detail_pages), 14)
        self.assertTrue(
            all(page["status"] == "evidence-verified" for page in detail_pages)
        )
        for page in detail_pages:
            contract_path = tpp_root / page["contract"]
            contract = load_json(contract_path)
            self.assertEqual(contract["family"], page["family"])
            self.assertTrue(
                (
                    contract_path.parent
                    / contract["source"]["evidence"]
                ).resolve().is_file()
            )

        expected_families = {
            "details-basic": 2,
            "details-grouped": 2,
            "details-master-detail": 3,
            "details-parallel": 1,
            "details-text-image": 2,
            "details-anchored": 3,
            "details-simulation-file": 1,
        }
        for family_id, variant_count in expected_families.items():
            self.assertEqual(
                catalog["families"][family_id]["variant_count"],
                variant_count,
            )
            family = load_json(
                tpp_root / catalog["families"][family_id]["contract"]
            )
            self.assertEqual(len(family["variants"]), variant_count)

        horizontal_anchor = load_json(
            tpp_root / "pages" / "details" / "horizontal-anchor-point.json"
        )
        self.assertEqual(
            horizontal_anchor["parameters"]["anchor_mode"],
            "horizontal-tabs",
        )
        text_image = load_json(
            tpp_root
            / "pages"
            / "details"
            / "left-and-right-layout-text-image.json"
        )
        self.assertEqual(text_image["parameters"]["media_width_px"], 1008)
        simulation = load_json(
            tpp_root / "pages" / "details" / "simulation-file.json"
        )
        self.assertEqual(simulation["parameters"]["key_label_width_px"], 220)

    def test_remaining_details_families_resolve_from_page_intent(self) -> None:
        cases = {
            "grouped-details": "hui.tpp.family.details-grouped",
            "master-detail": "hui.tpp.family.details-master-detail",
            "parallel-details": "hui.tpp.family.details-parallel",
            "text-image-details": "hui.tpp.family.details-text-image",
            "anchored-details": "hui.tpp.family.details-anchored",
            "simulation-file-details": "hui.tpp.family.details-simulation-file",
        }
        for page_intent, expected_id in cases.items():
            with self.subTest(page_intent=page_intent):
                resolution = resolve_design_system(
                    "public-security", "pvia", page_intent
                )
                self.assertEqual(
                    resolution["hui_page_pattern"]["contract"]["id"],
                    expected_id,
                )

    def test_tpp_form_variant_separates_hui_and_page_framework(self) -> None:
        contract = load_json(
            ROOT
            / "design-systems"
            / "HUI"
            / "page-patterns"
            / "tpp"
            / "pages"
            / "form"
            / "fixed-width-two-column.json"
        )
        self.assertEqual(contract["parameters"]["columns"], 2)
        self.assertEqual(
            contract["geometry"]["key_regions"]["content"]["padding"],
            "48px 80px 58px",
        )
        self.assertEqual(
            contract["geometry"]["key_regions"]["footer"]["rect"]["height"],
            57,
        )
        self.assertIn("el-form", contract["composition"]["hui_components"])
        self.assertIn(
            "h-page-content",
            contract["composition"]["page_framework_components"],
        )

    def test_form_anchor_navigation_requires_anchored_family(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-permission-form.json"
        )
        html = compile_pattern_page(spec)
        self.assertIn(
            'v-if="isAnchoredForm && !isWorkOrderForm && visibleFormSections.length"',
            html,
        )
        self.assertIn(
            "isAnchoredForm: function () { return this.config.pattern_family === 'hui.tpp.family.form-anchored'; }",
            html,
        )
        self.assertIn('"pattern_family": "hui.tpp.family.form-complex"', html)

    def test_grouped_form_resolves_to_tpp_family(self) -> None:
        resolution = resolve_design_system(
            "public-security", "pvia", "grouped-form"
        )
        self.assertEqual(
            resolution["hui_page_pattern"]["contract"]["id"],
            "hui.tpp.family.form-grouped",
        )

    def test_manual_filter_table_resolves_to_tpp_family(self) -> None:
        resolution = resolve_design_system(
            "public-security", "pvia", "manual-filter-table"
        )
        self.assertEqual(
            resolution["hui_page_pattern"]["contract"]["id"],
            "hui.tpp.family.table-manual-filter",
        )

    def test_manual_filter_card_resolves_to_card_family(self) -> None:
        resolution = resolve_design_system(
            "public-security", "pvia", "卡片页手动过滤"
        )
        self.assertEqual(
            resolution["hui_page_pattern"]["contract"]["id"],
            "hui.tpp.family.card-manual-filter",
        )

    def test_generation_examples_compile_from_tpp_contracts(self) -> None:
        expected_patterns = {
            "device-permission-form": "hui.tpp.page.form.multi-level-nesting",
            "device-list-table": "hui.tpp.page.table.regular-filter-box-high-low",
            "device-capture-card": "hui.tpp.page.card.vehicle",
            "device-capture-switch": "hui.tpp.page.table.only-title",
            "capture-card-tabs": "hui.tpp.page.card.card-tabs",
            "device-details-master-detail": "hui.tpp.page.details.left-and-right-layout",
        }
        for name, expected_pattern in expected_patterns.items():
            spec = load_json(ROOT / "tests" / "generation" / f"{name}.json")
            with tempfile.TemporaryDirectory() as directory:
                html_path = Path(directory) / f"{name}.html"
                html = compile_test(spec, html_path)
                html_path.write_text(html, encoding="utf-8")
                self.assertIn(expected_pattern, html)
                self.assertIn("hui.umd.js", html)
                self.assertNotIn("vuex.min.js", html)
                self.assertIn("const PAGE_CONFIG =", html)
                self.assertIn("const PREVIEW_FIXTURES =", html)
                self.assertIn("config: PAGE_CONFIG", html)
                self.assertIn("loadPreviewFixtures: function ()", html)
                self.assertEqual(extract_frozen_json(html, "PREVIEW_FIXTURES"), spec["preview"])
                self.assertNotIn("preview", extract_frozen_json(html, "PAGE_CONFIG"))
                self.assertIn("Object.prototype.hasOwnProperty.call(vm.$data, key)", html)
                self.assertIn("key !== 'config'", html)
                self.assertNotIn("cloneRuntimeValue(PAGE_CONFIG)", html)
                self.assertNotIn("this.spec =", html)
                self.assertNotIn("__PAGE_SPEC__", html)
                self.assertNotIn(
                    ".portal-side-item { padding-right: var(--h-space-md) !important; }",
                    html,
                )
                if spec["page_kind"] != "table":
                    self.assertNotIn(
                        "--d2c-renderer-page-actions-padding: 0px 24px", html
                    )
                self.assertEqual(validate_pattern_html(spec, html_path), [])
            if name == "device-permission-form":
                self.assertIn("--d2c-page-form-width: 1264px", html)
                self.assertIn("<el-slider", html)
                self.assertIn("matchesCondition(field.condition)", html)
                self.assertIn("<el-steps", html)
                self.assertIn("activeFormSectionIndex", html)
                self.assertIn("margin-right: var(--d2c-page-form-steps-form-gap, 0)", html)
                self.assertIn('class="form-area__content-head"', html)
                self.assertNotIn('class="work-order-head"', html)
                self.assertNotIn(
                    "padding: 16px 80px; border-bottom: 1px solid",
                    html,
                )
            if name == "capture-card-tabs":
                self.assertIn("hui.tpp.page.card.similarity", html)
                self.assertIn("hui.tpp.page.card.text", html)
                self.assertIn("<el-tabs", html)
                self.assertIn('data-component="navigation.tabs"', html)
                self.assertIn('"card_tab_style": "card"', html)
                self.assertIn('"media_column_gap": "2px"', html)
                self.assertIn('"title_status_gap": "8px"', html)
                self.assertNotIn('"row_height"', html)
            if name == "device-details-master-detail":
                self.assertIn('"renderer": "hui.tpp.details"', html)
                self.assertIn(".details-side .details-fields { grid-template-columns: minmax(0, 1fr); }", html)
                self.assertIn("has-stretched-master", html)
                self.assertIn("has-separate-master-detail", html)
                self.assertIn("has-separate-scroll", html)
                self.assertIn("has-external-master-media", html)
                self.assertIn("isCredentialVisual(field)", html)
                self.assertNotIn(".details-panel-tabs .credential-item { min-height: 112px; }", html)
                self.assertIn(".details-primary-group-title { padding-bottom: 0; border-bottom: 0; }", html)
                self.assertIn('data-zone="detail.content"', html)
                self.assertIn('data-component="detail.details-pane"', html)
                self.assertIn("relatedTableRows", html)

    def test_detail_renderer_covers_all_verified_detail_families(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-details-master-detail.json"
        )
        contracts = [
            "details/fill-up.json",
            "details/fixed-width.json",
            "details/first-group.json",
            "details/secondary-grouping.json",
            "details/left-and-right-layout.json",
            "details/up-and-down-layout.json",
            "details/up-and-down-layout-single-container.json",
            "details/coordination.json",
            "details/left-and-right-layout-text-image.json",
            "details/up-down-left-right-layout-text-image.json",
            "details/horizontal-anchor-point.json",
            "details/resident-anchor-point.json",
            "details/retracted-anchor-point.json",
            "details/simulation-file.json",
        ]
        families = set()
        for relative in contracts:
            variant = dict(spec, pattern_contract=relative)
            html = compile_pattern_page(variant)
            self.assertIn('"renderer": "hui.tpp.details"', html)
            family = load_json(
                ROOT
                / "design-systems"
                / "HUI"
                / "page-patterns"
                / "tpp"
                / "pages"
                / relative
            )["family"]
            families.add(family)
            self.assertIn(f'"pattern_family": "{family}"', html)
        self.assertEqual(len(families), 7)
        self.assertEqual(len(contracts), 14)

    def test_tpp_is_a_formal_pattern_page_pipeline(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-list-table.json"
        )
        self.assertEqual(spec["schema_version"], "pattern-page-spec.v2")
        html = compile_pattern_page(spec, self.html_path)
        self.html_path.write_text(html, encoding="utf-8")
        self.assertIn('"renderer": "hui.tpp.table"', html)
        self.assertIn("logo_综合安防管理平台iSecure_Center.svg", html)
        self.assertIn("data-d2c-product-brand", html)
        self.assertNotIn("portal-logo-mark", html)
        self.assertIn("--d2c-portal-brand-menu-offset: 80px", html)
        self.assertIn("--d2c-portal-search-width: 240px", html)
        self.assertIn("--d2c-portal-tab-width: 174px", html)
        self.assertIn("--d2c-portal-tools-width: 748px", html)
        self.assertIn('class="portal-pill"', html)
        self.assertIn('class="portal-side-collapse"', html)
        self.assertIn('class="portal-side-submenu"', html)
        self.assertIn('class="h-icon-menu_leftbar"', html)
        self.assertIn('class="h-icon-qrcode"', html)
        self.assertIn('class="h-icon-share"', html)
        self.assertIn("text-decoration: none !important;", html)
        self.assertIn(
            ".query-filter__form .el-form-item { margin-bottom: 0; }",
            html,
        )
        self.assertNotIn(
            ".query-filter__form .el-form-item { margin-bottom: 16px; }",
            html,
        )
        self.assertEqual(validate_pattern_html(spec, self.html_path), [])

    def test_pattern_page_rejects_legacy_or_unrouted_preview_data(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-list-table.json"
        )
        legacy = json.loads(json.dumps(spec))
        legacy["schema_version"] = "pattern-page-spec.v1"
        with self.assertRaises(PatternPageError):
            compile_pattern_page(legacy)

        unrouted = json.loads(json.dumps(spec))
        unrouted["rows"] = unrouted.pop("preview")["rows"]
        with self.assertRaises(PatternPageError):
            compile_pattern_page(unrouted)

        unknown_state = json.loads(json.dumps(spec))
        unknown_state["preview"]["businessPayload"] = {}
        with self.assertRaises(PatternPageError):
            compile_pattern_page(unknown_state)

    def test_anchored_form_tabs_and_groups_use_global_rules(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-permission-form.json"
        )
        spec["pattern_contract"] = "form/persistent-anchor-single-container.json"
        spec["form_tabs"] = [
            {"id": "basic", "label": "基础信息", "section_ids": ["basic"]},
            {"id": "other", "label": "其他信息", "section_ids": ["permission"]},
        ]
        html = compile_pattern_page(spec)
        self.assertIn("page-breadcrumb__tab.is-active::after", html)
        self.assertIn("margin: 0 !important; padding: 0 12px", html)
        self.assertIn("right: 0; bottom: 0; left: 0", html)
        self.assertNotIn("overflow: visible !important", html)
        self.assertIn(".page-breadcrumb__tab:hover,", html)
        self.assertIn("text-decoration: none !important", html)
        self.assertNotIn("page-breadcrumb__separator", html)
        self.assertIn('v-for="section in visibleFormSections"', html)
        self.assertIn(
            'v-if="isAnchoredForm && !isWorkOrderForm && visibleFormSections.length"',
            html,
        )
        self.assertIn(
            '<h-anchor :affix="true" container=".permission-form-scroll">', html
        )
        self.assertIn(
            '<h-anchor-link v-for="section in visibleFormSections"', html
        )
        self.assertNotIn("activateFormSection: function", html)
        self.assertIn("'is-anchored-form':isAnchoredForm", html)
        self.assertIn("--d2c-page-form-title-field-gap: 24px", html)
        self.assertIn("--d2c-page-form-group-gap: 48px", html)
        self.assertIn('"columns": 3', html)
        self.assertIn(
            "var columns = Number((this.config.pattern_parameters || {}).columns) || 3;",
            html,
        )
        self.assertIn(".form-area.is-anchored-form .permission-form__section", html)
        self.assertIn(
            ".permission-form .el-row { display: flex; flex-wrap: wrap; align-items: flex-start; }",
            html,
        )
        self.assertIn(".permission-form .el-row > .el-col { float: none; }", html)
        self.assertIn(
            ".form-area.is-anchored-form { gap: 24px; }", html
        )
        self.assertIn(
            "flex: 1 1 auto; width: min(1280px, calc(100% - 204px))",
            html,
        )
        self.assertIn(
            "position: static; z-index: 2; width: 180px; flex: none; align-self: start",
            html,
        )
        self.assertIn(
            "padding: 48px 0 0; background: transparent; box-shadow: none",
            html,
        )
        self.assertIn(
            "margin-right: calc(-1 * var(--d2c-page-form-content-inline-padding))",
            html,
        )
        self.assertIn(
            "margin-top: calc(-1 * var(--d2c-page-form-content-padding-top))",
            html,
        )

    def test_sidebar_step_form_uses_vertical_step_layout(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-permission-form.json"
        )
        spec["pattern_contract"] = "form/sidebar-step-bar.json"
        html = compile_pattern_page(spec)
        self.assertIn("parameters.step_placement === 'left-sidebar'", html)
        self.assertIn(':direction="formStepDirection"', html)
        self.assertIn("? 'vertical'", html)
        self.assertIn('<div v-if="isWorkOrderForm" class="work-order-steps">', html)
        self.assertIn('<el-tabs v-if="isWorkOrderForm"', html)
        self.assertNotIn(
            "margin-bottom: calc(-1 * var(--d2c-page-form-content-padding-bottom))",
            html,
        )
        self.assertIn("position: relative; z-index: 1", html)
        self.assertGreater(
            html.find('class="form-anchor-nav"'),
            html.find("</el-form>", html.find('ref="permissionForm"')),
        )
        self.assertIn("border: var(--d2c-page-form-group-title-border, 0)", html)

    def test_table_details_pane_renders_selection_linked_detail_module(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-list-table.json"
        )
        spec["pattern_contract"] = "table/with-details-pane.json"
        spec["detail_tabs"] = [
            {
                "id": "basic",
                "label": "基本信息",
                "sections": [
                    {
                        "id": "device",
                        "title": "设备信息",
                        "fields": [
                            {"key": "deviceName", "label": "设备名称"},
                            {"key": "deviceCode", "label": "设备编号"},
                        ],
                    }
                ],
            }
        ]
        html = compile_pattern_page(spec, self.html_path)
        self.html_path.write_text(html, encoding="utf-8")
        self.assertIn('"pattern_family": "hui.tpp.family.table-details-pane"', html)
        self.assertIn("--d2c-page-table-details-width: 431px", html)
        self.assertIn('class="table-detail-pane"', html)
        self.assertIn('data-component="detail.details-pane"', html)
        self.assertIn('@row-click="selectDetailRow"', html)
        self.assertIn("table-detail-pane.has-master-divider::before", html)
        self.assertIn('"token": "--h-color-border-tertiary"', html)
        self.assertIn("--d2c-page-table-details-tabs-content-padding: 8px 0px", html)
        self.assertIn("--d2c-page-table-details-pane-padding: 8px 0px 40px 24px", html)
        self.assertIn("--d2c-page-table-details-pane-width: 455px", html)
        self.assertIn("--d2c-page-table-details-content-end-padding: 24px", html)
        self.assertIn("--d2c-page-table-details-container-margin: 0px -20px", html)
        self.assertIn("--d2c-page-table-details-item-padding: 0px 0px 0px 20px", html)
        self.assertIn("--d2c-page-table-details-item-margin: 0px 0px 24px", html)
        self.assertNotIn("table-detail-pane__summary", html)
        self.assertIn("--d2c-renderer-table-content-padding: 0px 12px", html)
        self.assertIn("--d2c-renderer-page-actions-margin: 0px", html)
        self.assertIn("--d2c-renderer-page-actions-padding: 0px 24px", html)
        self.assertIn("--d2c-renderer-page-actions-border: none", html)
        self.assertIn(
            "padding: var(--d2c-renderer-page-actions-padding, 0 24px);",
            html,
        )
        self.assertEqual(validate_pattern_html(spec, self.html_path), [])

    def test_renderer_registry_covers_both_pipelines(self) -> None:
        self.assertEqual(set(RENDERERS), PAGE_RENDERER_IDS)
        self.assertEqual(set(VALIDATORS), PAGE_RENDERER_IDS)
        self.assertEqual(set(SPEC_RESOLVERS), PAGE_RENDERER_IDS)
        self.assertEqual(
            set(PATTERN_KIND_RENDERERS),
            {"form", "table", "card", "switch", "card-tabs", "details"},
        )
        self.assertTrue(
            all(
                contract["input_contract"]
                and contract["template"]
                and (ROOT / contract["template"]).is_file()
                for contract in RENDERER_CONTRACTS.values()
            )
        )
        with self.assertRaises(ValueError):
            template_for_renderer("hui.list-search")
        self.assertEqual(
            template_for_renderer("hui.tpp.card"),
            "assets/templates/HUI/renderers/card.html",
        )
        self.assertEqual(
            renderer_for_hui_pattern("hui.tpp.family.details-basic"),
            "hui.tpp.details",
        )

    def test_pattern_renderers_use_hui_with_optional_product_override(self) -> None:
        pattern_templates = {
            contract["template"]
            for contract in RENDERER_CONTRACTS.values()
            if contract["pipeline"] == "pattern-page"
        }
        self.assertEqual(len(pattern_templates), 5)
        self.assertTrue(
            all(path.startswith("assets/templates/HUI/renderers/") for path in pattern_templates)
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            hui_path = root / "assets/templates/HUI/renderers/form.html"
            hui_path.parent.mkdir(parents=True)
            hui_path.write_text("HUI form", encoding="utf-8")
            resolved, source = resolve_renderer_template("hui.tpp.form", "isc", root)
            self.assertEqual((resolved, source), (hui_path, "HUI"))
            product_path = root / "assets/templates/products/isc/renderers/form.html"
            product_path.parent.mkdir(parents=True)
            product_path.write_text("ISC form", encoding="utf-8")
            resolved, source = resolve_renderer_template("hui.tpp.form", "isc", root)
            self.assertEqual((resolved, source), (product_path, "product:isc"))

    def test_pattern_renderer_bodies_and_styles_are_isolated(self) -> None:
        form_spec = load_json(
            ROOT / "tests" / "generation" / "device-permission-form.json"
        )
        form_html = compile_pattern_page(form_spec)
        self.assertIn('class="form-area"', form_html)
        self.assertNotIn('class="details-page"', form_html)
        self.assertNotIn('class="collection-page"', form_html)
        self.assertIn(".permission-form__section", form_html)
        self.assertNotIn(".knowledge-card", form_html)
        self.assertNotIn(".credential-grid", form_html)

        table_spec = load_json(
            ROOT / "tests" / "generation" / "device-list-table.json"
        )
        table_html = compile_pattern_page(table_spec)
        self.assertIn('class="collection-page"', table_html)
        self.assertNotIn('class="form-area"', table_html)
        self.assertNotIn('class="details-page"', table_html)
        self.assertIn(".query-filter", table_html)
        self.assertNotIn(".permission-form__section", table_html)
        self.assertNotIn(".credential-grid", table_html)

    def test_isc_portal_shell_is_owned_by_the_product_layer(self) -> None:
        hui_start = (
            ROOT / "assets/templates/HUI/shells/page-start.html"
        ).read_text(encoding="utf-8")
        self.assertNotIn("portal-main-menu", hui_start)
        self.assertNotIn("portal-app-sidebar", hui_start)
        isc_start = (
            ROOT / "assets/templates/products/isc/shells/portal-start.html"
        ).read_text(encoding="utf-8")
        isc_styles = (
            ROOT / "assets/templates/products/isc/styles/portal.css"
        ).read_text(encoding="utf-8")
        self.assertIn("portal-main-menu", isc_start)
        self.assertIn("portal-app-sidebar", isc_start)
        self.assertIn(".portal-main-menu", isc_styles)
        spec = load_json(
            ROOT / "tests" / "generation" / "device-permission-form.json"
        )
        html = compile_pattern_page(spec)
        self.assertIn('"product_shell_source": "product:isc"', html)
        self.assertIn('class="portal-main-menu"', html)
        self.assertNotIn("hui-tpp-shell product-context", html)

    def test_unmatched_product_falls_back_to_hui_renderer_and_shell(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-permission-form.json"
        )
        spec["industry"] = "unmatched-industry"
        spec["product"] = "unmatched-product"
        html = compile_pattern_page(spec, self.html_path)
        self.html_path.write_text(html, encoding="utf-8")
        self.assertIn('"renderer_source": "HUI"', html)
        self.assertIn('"product_shell_source": "HUI"', html)
        self.assertIn('"level": "hui-fallback"', html)
        self.assertIn("hui-tpp-shell product-context", html)
        self.assertIn("hui-logo.png", html)
        self.assertIn(".tpp-h-layout__nav a.is-active", html)
        self.assertIn("font-size: 16px", html)
        self.assertIn("width: 112px", html)
        self.assertIn("<el-nav mode=\"vertical\"", html)
        self.assertIn('v-for="item in config.top_menus"', html)
        self.assertIn('v-for="item in config.portal.side_menus"', html)
        self.assertNotIn('<i :class="item.icon"></i>{{ item.label }}', html)
        self.assertIn(":collapse-btn=\"true\"", html)
        self.assertIn(":default-openeds=\"huiShellOpenMenus\"", html)
        self.assertIn(".hui-tpp-page.is-menu-collapsed { padding-left: 48px; }", html)
        self.assertIn(".h-page-menu.is-collapsed { width: 48px; }", html)
        self.assertIn("border-right: 1px solid var(--h-color-border-tertiary)", html)
        self.assertIn(".h-page-menu.is-collapsed .el-submenu__icon-arrow { opacity: 0; transition: none; }", html)
        self.assertIn(".el-scrollbar__view { min-height: 100%; }", html)
        self.assertIn(".el-nav { border-right: 0; }", html)
        self.assertIn(".el-menu { border-right: 0; }", html)
        self.assertIn(".el-scrollbar__view ul { padding-inline-start: 0 !important; }", html)
        self.assertIn(".el-menu-item--text { padding-left: 0; }", html)
        self.assertNotIn(".hui-tpp-menu-text", html)
        self.assertNotIn("huiShellMenuGroups", html)
        self.assertNotIn('class="portal-main-menu"', html)
        self.assertNotIn('class="portal-app-sidebar"', html)
        self.assertEqual(validate_pattern_html(spec, self.html_path), [])

        invalid_html = html.replace(
            "{{ item.label }}</el-nav-item>",
            '<i :class="item.icon"></i>{{ item.label }}</el-nav-item>',
            1,
        )
        self.html_path.write_text(invalid_html, encoding="utf-8")
        self.assertIn(
            "HUI叶子菜单不得手工渲染图标；一级分组图标必须通过el-subnav的icon API输出",
            validate_pattern_html(spec, self.html_path),
        )

    def test_pvia_profile_uses_product_logo_with_hui_shell(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "pvia-face-alarm-regular-high-low.json"
        )
        html = compile_pattern_page(spec, self.html_path)
        self.html_path.write_text(html, encoding="utf-8")
        self.assertIn('"product_shell_source": "HUI"', html)
        self.assertIn("hui-tpp-shell product-context", html)
        self.assertIn("logo_视频图像综合应用平台Infovision_PVIA.svg", html)
        self.assertEqual(validate_pattern_html(spec, self.html_path), [])

    def test_pattern_page_requires_explicit_product_context(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-list-table.json"
        )
        del spec["product"]
        with self.assertRaises(GenerationTestError):
            compile_test(spec)

    def test_card_tabs_generation_uses_zone_component_atom_hierarchy(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "capture-card-tabs.json"
        )
        html = compile_test(spec)
        self.assertEqual(validate_semantic_html(html), [])
        self.assertIn('data-zone="navigation.view-tabs"', html)
        self.assertIn('data-component="navigation.tabs"', html)
        self.assertIn('data-component="collection.card-grid"', html)
        self.assertNotIn('data-component="card.data-card"', html)

    def test_hui_registry_replaces_product_dictionaries(self) -> None:
        self.assertGreaterEqual(len(load_zone_registry()), 10)
        self.assertGreaterEqual(len(load_component_pattern_registry()), 10)
        self.assertFalse(
            (
                ROOT
                / "design-systems"
                / "industry-products"
                / "general"
                / "products"
                / "isc"
                / "component-dictionary.json"
            ).exists()
        )

    def test_component_ids_have_no_product_prefix(self) -> None:
        for component_id in load_component_pattern_registry():
            self.assertNotIn(component_id.split(".", 1)[0], {"hui", "isc", "pvia"})

    def test_component_patterns_define_split_mode_and_vue_mapping(self) -> None:
        patterns = load_component_pattern_registry()
        mappings = {pattern["vue_component"] for pattern in patterns.values()}
        self.assertEqual(len(mappings), len(patterns))
        self.assertEqual(patterns["filter.search-form"]["split_mode"], "composite")
        self.assertEqual(patterns["filter.search-form"]["vue_component"], "SearchForm")
        self.assertEqual(patterns["pagination.page-navigation"]["split_mode"], "single")
        self.assertEqual(patterns["collection.card-grid"]["split_mode"], "repeat-item")

    def test_page_knowledge_component_patterns_are_registered(self) -> None:
        patterns = load_component_pattern_registry()
        expected = {
            "header.dialog-title",
            "media.image-viewer",
            "navigation.tree-panel",
            "feedback.context-notice",
            "summary.metric-strip",
            "navigation.stepper",
            "navigation.anchor-nav",
            "detail.details-pane",
            "filter.instant-filter",
        }
        self.assertTrue(expected.issubset(patterns))
        self.assertEqual(patterns["summary.metric-strip"]["split_mode"], "repeat-item")
        self.assertEqual(patterns["filter.instant-filter"]["vue_component"], "InstantFilter")

    def test_component_pattern_catalog_is_complete_and_reproducible(self) -> None:
        catalog = build_component_pattern_catalog()
        patterns = load_component_pattern_registry()
        self.assertEqual(catalog["schema_version"], "data-component-catalog.v1.0.2")
        self.assertEqual(catalog["entry_count"], len(patterns))
        self.assertEqual(set(catalog["entries"]), set(patterns))
        self.assertEqual(
            set(catalog["split_modes"]),
            {"single", "composite", "repeat-item"},
        )
        self.assertEqual(
            set(catalog["entries"]["filter.search-form"]),
            {"name", "split_mode", "vue_component", "description", "use_when"},
        )
        self.assertEqual(
            catalog["entries"]["filter.search-form"]["vue_component"],
            "SearchForm",
        )
        catalog_path = (
            ROOT
            / "design-systems"
            / "HUI"
            / "component-patterns"
            / "catalog.json"
        )
        self.assertEqual(catalog_path.read_text(encoding="utf-8"), render_catalog())

    def test_generation_page_uses_registered_semantics(self) -> None:
        card_spec = load_json(
            ROOT / "tests" / "generation" / "device-capture-card.json"
        )
        html = compile_test(card_spec)
        self.assertEqual(validate_semantic_html(html), [])
        self.assertIn('data-zone="data.results"', html)
        self.assertIn('data-component="collection.card-grid"', html)

    def test_unregistered_data_component_fails_semantic_validation(self) -> None:
        changed = self.html.replace("filter.search-form", "filter.random-name", 1)
        errors = validate_semantic_html(changed)
        self.assertTrue(any("未登记Component Pattern" in error for error in errors))

    def test_hui_atoms_cannot_skip_component_layer(self) -> None:
        changed = self.html.replace(
            'data-component="filter.search-form"',
            'data-removed-component="filter.search-form"',
            1,
        )
        errors = validate_semantic_html(changed)
        self.assertTrue(any("必须位于data-component内" in error for error in errors))

    def test_generation_spec_rejects_visual_values(self) -> None:
        spec = load_json(
            ROOT / "tests" / "generation" / "device-capture-card.json"
        )
        spec["width"] = "320px"
        with self.assertRaises(GenerationTestError):
            compile_test(spec)


if __name__ == "__main__":
    unittest.main()
