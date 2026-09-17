#!/usr/bin/env python3
from __future__ import annotations

import sys
import copy
import os
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import compile_pattern_page, materialize_pattern_spec
from core import load_json
from validate_pattern_page import extract_frozen_json


class CardKnowledgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = load_json(
            ROOT / "design-systems/HUI/runtime-contracts/others/card.json"
        )["d2c_usage"]
        self.template = (
            ROOT / "assets/templates/HUI/fragments/collection/page.html"
        ).read_text(encoding="utf-8")
        self.styles = (
            ROOT / "assets/templates/HUI/styles/collection.css"
        ).read_text(encoding="utf-8")

    def test_face_profile_keeps_media_and_body_content_separate(self) -> None:
        profile = self.contract["visual_profiles"]["face-card"]
        self.assertEqual(profile["header"]["padding"], "0px")
        self.assertEqual(profile["header"]["media_fit"], "cover")
        self.assertEqual(profile["primary"]["placement"], "body")
        self.assertEqual(profile["body"]["padding"], "12px 16px")
        self.assertIn(
            '<div slot="header"><img class="basic-card-media"', self.template
        )

    def test_vehicle_profile_records_spacing_and_icon_rules(self) -> None:
        profile = self.contract["visual_profiles"]["vehicle-card"]
        self.assertNotIn("height", profile["header"])
        self.assertEqual(profile["primary"]["placement"], "body")
        self.assertEqual(profile["primary"]["presentation"], "body-title")
        self.assertEqual(profile["body"]["padding"], "12px")
        self.assertEqual(profile["primary"]["metadata_gap"], "12px")
        self.assertEqual(profile["body"]["row_gap"], "4px")
        self.assertEqual(profile["body"]["icon_size"], "20px")
        self.assertIn("h-icon-info_location", self.template)
        self.assertIn("h-icon-info_time", self.template)
        self.assertIn(
            ".knowledge-card__vehicle-title { margin-bottom: 12px; }",
            self.styles,
        )
        vehicle_header = '<div slot="header" class="vehicle-basic-card__header"><img :src="row.image" :alt="row.title"></div>'
        self.assertIn(vehicle_header, self.template)
        self.assertIn(
            '<div class="vehicle-basic-card__title">{{ row.title }}</div>',
            self.template,
        )
        self.assertNotIn(
            'class="vehicle-basic-card__header"><img :src="row.image" :alt="row.title"><strong>{{ row.title }}</strong>',
            self.template,
        )
        vehicle_root_rule = re.search(
            r"\.vehicle-basic-card\s*\{([^}]*)\}", self.styles
        )
        vehicle_header_rule = re.search(
            r"\.vehicle-basic-card \.el-card__header\s*\{([^}]*)\}",
            self.styles,
        )
        self.assertIsNotNone(vehicle_root_rule)
        self.assertIsNotNone(vehicle_header_rule)
        self.assertNotIn("height:", vehicle_root_rule.group(1))
        self.assertNotIn("height:", vehicle_header_rule.group(1))
        shell = (
            ROOT / "assets/templates/HUI/shells/page-end.html"
        ).read_text(encoding="utf-8")
        self.assertNotIn("body.row_height", shell)
        for card_profile in self.contract["visual_profiles"].values():
            self.assertNotIn("row_height", card_profile.get("body", {}))

    def test_similarity_profile_records_fill_divider_and_body_title(self) -> None:
        profile = self.contract["visual_profiles"]["similarity-card"]
        self.assertTrue(profile["header"]["divider"])
        self.assertEqual(profile["header"]["media_fit"], "cover")
        self.assertEqual(profile["primary"]["placement"], "body")
        self.assertIn("bottom: 1px", self.styles)
        self.assertIn("object-fit: cover", self.styles)

    def test_tag_semantics_are_machine_owned_and_compiler_injected(self) -> None:
        semantics = self.contract["status_tag_semantics"]
        self.assertEqual(semantics["variant"], "primary")
        self.assertEqual(set(semantics["floods"]), {"red", "green", "orange"})
        spec = load_json(ROOT / "tests/generation/capture-card-tabs.json")
        html = compile_pattern_page(spec)
        self.assertIn('"card_status_tag_semantics"', html)
        self.assertIn('data-variant="primary"', html)
        self.assertIn(':data-flood="cardTagFlood', html)

    def test_realtime_card_variants_use_contract_filter_placement(self) -> None:
        family = load_json(
            ROOT
            / "design-systems/HUI/page-patterns/tpp/families/card-realtime-filter/contract.json"
        )
        clear_action = family["invariants"]["selected_filter_clear_action"]
        self.assertEqual(clear_action["tone"], "brand")
        self.assertEqual(clear_action["interactive_tone"], "brand-stable")
        horizontal = load_json(
            ROOT / "tests/generation/realtime-card-horizontal.json"
        )
        sidebar = load_json(ROOT / "tests/generation/realtime-card-sidebar.json")
        horizontal_html = compile_pattern_page(horizontal)
        sidebar_html = compile_pattern_page(sidebar)
        self.assertIn('"filter_placement": "horizontal-bar"', horizontal_html)
        self.assertIn('v-if="isHorizontalRealtimeFilter"', horizontal_html)
        self.assertIn('"filter_placement": "left-sidebar"', sidebar_html)
        self.assertIn('v-if="isSidebarRealtimeFilter" class="realtime-filter-sidebar"', sidebar_html)
        self.assertIn('href": "realtime-card-sidebar.html"', horizontal_html)
        self.assertIn('href": "realtime-card-horizontal.html"', sidebar_html)
        self.assertIn(
            ".realtime-filter-sidebar__selected { display: flex; align-items: center; flex-wrap: wrap; gap: 8px;",
            sidebar_html,
        )
        self.assertIn(
            ".realtime-filter-sidebar__selected .realtime-filter__clear { color: var(--h-color-brand) !important; }",
            sidebar_html,
        )

    def test_data_list_card_header_has_no_bottom_divider(self) -> None:
        profile = self.contract["visual_profiles"]["data-list"]
        self.assertFalse(profile["header"]["divider"])
        self.assertNotIn("padding", profile["header"])
        self.assertNotIn("padding", profile["body"])
        spec = load_json(ROOT / "tests/generation/realtime-card-horizontal.json")
        html = compile_pattern_page(spec)
        self.assertIn('slot="header" class="data-list-card__media"', html)
        self.assertIn(
            ".data-list-card>.el-card__header { display: flex; align-items: center; justify-content: center; width: 128px; flex: none; border-bottom: 0; }",
            html,
        )
        self.assertIn(
            ".data-list-card>.el-card__body { min-width: 0; flex: 1; }",
            html,
        )
        header_rule = re.search(
            r"\.data-list-card>\.el-card__header\s*\{([^}]*)\}", html
        )
        body_rule = re.search(
            r"\.data-list-card>\.el-card__body\s*\{([^}]*)\}", html
        )
        self.assertIsNotNone(header_rule)
        self.assertIsNotNone(body_rule)
        self.assertNotIn("padding:", header_rule.group(1))
        self.assertNotIn("padding:", body_rule.group(1))

    def test_card_tabs_with_tree_renders_registered_tree_panel(self) -> None:
        spec = load_json(ROOT / "tests/generation/card-tabs-with-tree.json")
        html = compile_pattern_page(spec)
        self.assertIn('"tree": true', html)
        self.assertIn('data-component="navigation.tree-panel"', html)
        self.assertIn('<el-tree ref="cardTree"', html)
        self.assertIn("cardTreeNodeChanged", html)
        self.assertIn("row[node.filter_key]", html)

    def test_table_tabs_render_exact_style_and_optional_tree(self) -> None:
        linear = load_json(ROOT / "tests/generation/table-linear-tabs.json")
        tree = load_json(ROOT / "tests/generation/table-card-tabs-with-tree.json")
        linear_html = compile_pattern_page(linear)
        tree_html = compile_pattern_page(tree)
        self.assertIn('"tab_style": "linear"', linear_html)
        self.assertIn('v-if="hasTableTabs && !usesFrameworkTableTabs"', linear_html)
        self.assertIn(':type="tableTabType"', linear_html)
        self.assertIn('"tree": true', tree_html)
        self.assertIn('v-if="hasTableTree"', tree_html)
        self.assertIn('class="collection-main h-layout"', tree_html)
        self.assertIn('class="h-page-sidebar"', tree_html)
        self.assertIn('v-if="isTableTabsSearch"', tree_html)
        self.assertIn('.table-tabs-navigation .el-tabs__content { display: none; }', tree_html)

    def test_table_tabs_materialize_missing_demo_configuration(self) -> None:
        spec = load_json(ROOT / "tests/generation/table-card-tabs-with-tree.json")
        materialized = materialize_pattern_spec(spec)
        self.assertEqual(len(materialized["filters"]), 3)
        self.assertTrue(materialized["tree_nodes"])
        self.assertEqual(materialized["default_tree_node"], "all")
        html = compile_pattern_page(spec)
        self.assertIn('"profile": "table-tabs-default"', html)
        self.assertIn('"filters"', html)

    def test_table_tabs_reuse_default_search_form_collapse_behavior(self) -> None:
        spec = load_json(ROOT / "tests/generation/table-linear-tabs.json")
        html = compile_pattern_page(spec)
        self.assertIn('"collapsed_visible_fields": 3', html)
        self.assertIn('"collapse_threshold": 3', html)
        self.assertIn('v-for="field in visibleFilters"', html)
        self.assertIn('v-if="hasCollapsibleFilters"', html)
        self.assertIn(
            "visibleFilters: function () { var count=Number((this.config.filter_search_form_behavior || {}).collapsed_visible_fields);",
            html,
        )
        self.assertNotIn(
            "visibleFilters: function () { return this.hasCollapsibleFilters && !this.filterExpanded ? this.config.filters.slice(0, 3)",
            html,
        )

    def test_table_card_tabs_composes_common_instant_filter(self) -> None:
        spec = load_json(ROOT / "tests/generation/table-card-tabs.json")
        html = compile_pattern_page(spec)
        config = extract_frozen_json(html, "PAGE_CONFIG")
        self.assertIsNotNone(config)
        self.assertEqual(
            config["composition_resolution"]["contribution"],
            "filter.instant-filter",
        )
        self.assertEqual(config["pattern_parameters"]["trigger"], "realtime")
        self.assertEqual(
            config["pattern_parameters"]["filter_placement"],
            "horizontal-bar",
        )
        self.assertNotIn("filter_search_form_behavior", config)
        self.assertIn(
            ".realtime-filter-sidebar__selected .el-button { font-size: 14px; }",
            html,
        )
        self.assertIn(
            "isTableTabsSearch: function () { return this.hasTableTabs && !this.isRealtimeFilter",
            html,
        )

    def test_basic_card_style_pages_use_exact_variants_and_shared_menu(self) -> None:
        cases = {
            "vehicle": ("vehicle-card", "vehicle-basic-card__header"),
            "face": ("face-card", "face-basic-card"),
            "similarity": ("similarity-card", "similarity-basic-card__media"),
            "text": ("text-card", "text-basic-card__header"),
            "data-list": ("data-list", "data-list-card__content"),
        }
        for name, (presentation, marker) in cases.items():
            spec = load_json(ROOT / f"tests/generation/card-style-{name}.json")
            pattern = load_json(
                ROOT
                / "design-systems/HUI/page-patterns/tpp/pages"
                / spec["pattern_contract"]
            )
            self.assertEqual(
                pattern["parameters"]["collection_presentation"], presentation
            )
            html = compile_pattern_page(spec)
            self.assertIn(marker, html)
            for action in ("添加", "编辑", "删除"):
                self.assertIn(f'"label": "{action}"', html)
            for icon in ("h-icon-add", "h-icon-edit", "h-icon-delete"):
                self.assertIn(f'"icon": "{icon}"', html)
            self.assertIn('type="ghost" size="small" :icon="action.icon"', html)
            for target in (
                "vehicle-card.html",
                "face-card.html",
                "similarity-card.html",
                "text-card.html",
                "data-list.html",
            ):
                self.assertIn(f'"href": "{target}"', html)

    def test_empty_card_toolbar_collapses_and_nested_output_rebases_logo(self) -> None:
        spec = copy.deepcopy(
            load_json(ROOT / "tests/generation/card-style-vehicle.json")
        )
        spec.pop("toolbar_actions")
        with tempfile.TemporaryDirectory(dir=ROOT / "output") as directory:
            output = Path(directory) / "nested" / "vehicle-card.html"
            html = compile_pattern_page(spec, output)
            self.assertIn('v-if="showPageToolbar" class="page-toolbar"', html)
            self.assertIn('showPageToolbar: function ()', html)
            expected_logo = Path(
                os.path.relpath(
                    ROOT
                    / "assets/imgs/hik-product-logos/logo_综合安防管理平台iSecure_Center.svg",
                    output.parent,
                )
            ).as_posix()
            self.assertIn(f'"product_logo": "{expected_logo}"', html)

if __name__ == "__main__":
    unittest.main()
