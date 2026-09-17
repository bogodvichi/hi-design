from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import PatternPageError, compile_pattern_page
from core import build_capability_bundle
from validate_pattern_page import extract_frozen_json, validate_pattern_html


class ShellStructureParser(HTMLParser):
    VOID_ELEMENTS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, set[str]]] = []
        self.parents: dict[str, set[str]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        parent_classes = self.stack[-1][1] if self.stack else set()
        for class_name in classes:
            self.parents.setdefault(class_name, set()).update(parent_classes)
        if tag not in self.VOID_ELEMENTS:
            self.stack.append((tag, classes))

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break


class IscPersonnelShellTest(unittest.TestCase):
    def test_isc_3_shell_registers_all_framework_variants(self) -> None:
        product_root = (
            ROOT / "design-systems/industry-products/general/products/isc"
        )
        product = json.loads((product_root / "product.json").read_text(encoding="utf-8"))
        standard = product["portal_shell_standards"]["isc-3.0.0"]
        personnel_knowledge = product["knowledge"][
            "isc-3.0.0.personnel-management"
        ]
        self.assertEqual(
            personnel_knowledge["json_pointer"], "/personnel_management"
        )
        self.assertEqual(
            personnel_knowledge["page_ids"],
            ["list", "add_form", "detail", "field_configuration"],
        )
        contract = json.loads(
            (product_root / standard["contract"]).read_text(encoding="utf-8")
        )
        frameworks = contract["framework_variants"]

        self.assertEqual(
            frameworks["source"]["url"],
            "http://isc-design-page.dev.hikhub.net/framework/regular-09",
        )
        self.assertEqual(frameworks["selection_strategy"]["variant_count"], 12)
        self.assertEqual(
            frameworks["selection_strategy"]["verified_navigation_preset_order"],
            ["single", "left-selector", "top-card-tabs"],
        )
        self.assertEqual(
            frameworks["selection_strategy"]["navigation_feature_order"],
            ["show_left_selector", "show_top_tabs"],
        )
        self.assertEqual(
            frameworks["selection_strategy"]["business_header_order"],
            ["none", "intro", "intro-actions", "intro-actions-extra"],
        )
        expected_combinations = [
            ("regular-01", False, False, "none"),
            ("regular-02", False, False, "intro"),
            ("regular-03", False, False, "intro-actions"),
            ("regular-04", False, False, "intro-actions-extra"),
            ("regular-05", True, False, "none"),
            ("regular-06", True, False, "intro"),
            ("regular-07", True, False, "intro-actions"),
            ("regular-08", True, False, "intro-actions-extra"),
            ("regular-09", False, True, "none"),
            ("regular-10", False, True, "intro"),
            ("regular-11", False, True, "intro-actions"),
            ("regular-12", False, True, "intro-actions-extra"),
        ]
        self.assertEqual(
            [
                (
                    variant["id"],
                    variant["show_left_selector"],
                    variant["show_top_tabs"],
                    variant["business_header"],
                )
                for variant in frameworks["variants"]
            ],
            expected_combinations,
        )
        self.assertEqual(
            frameworks["unified_tree"]["nodes"],
            [
                {"id": "left-selector", "parent": "framework", "display_when": "show_left_selector"},
                {"id": "main-column", "parent": "framework", "required": True},
                {"id": "business-header", "parent": "main-column", "display_when": "business_header != none"},
                {"id": "top-card-tabs", "parent": "main-column", "display_when": "show_top_tabs"},
                {"id": "content", "parent": "main-column", "required": True},
            ],
        )
        self.assertEqual(
            frameworks["unified_tree"]["combination_status"][-1],
            {
                "show_left_selector": True,
                "show_top_tabs": True,
                "status": "not-covered-by-regular-catalog",
            },
        )
        self.assertTrue(
            all(
                variant.get("selector_variant") == "tree"
                for variant in frameworks["variants"]
                if variant["navigation_layout"] == "left-selector"
            )
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-framework-card-tabs-height"],
            "48px",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-framework-card-tab-padding-inline"],
            "16px",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-collection-toolbar-height"],
            "64px",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-collection-toolbar-padding"],
            "16px",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-collection-table-content-margin"],
            "0 16px",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-collection-table-content-padding"],
            "0",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-collection-card-content-margin"],
            contract["geometry_roles"]["portal-collection-table-content-margin"],
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-collection-card-content-padding"],
            contract["geometry_roles"]["portal-collection-table-content-padding"],
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-collection-expanded-filter-margin"],
            "0 16px 16px",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-framework-card-tab-icon-size"],
            "24px",
        )
        self.assertEqual(
            contract["colors"]["framework-selector-background"],
            "#ffffff",
        )
        self.assertEqual(
            contract["collection_table"],
            {
                "applies_to_page_kinds": ["table", "switch"],
                "striped": False,
                "row_fill_policy": "single-color",
                "default_row_background_role": "bg-primary",
                "default_row_background": "#ffffff",
                "interactive_state_policy": "retain-hui-hover-active-selected",
                "content_spacing": {
                    "policy": "outer-margin-only",
                    "margin_role": "portal-collection-table-content-margin",
                    "padding_role": "portal-collection-table-content-padding",
                },
            },
        )
        self.assertEqual(
            contract["collection_card"],
            {
                "applies_to_page_kinds": ["card", "card-tabs", "switch"],
                "content_spacing": {
                    "policy": "outer-margin-only",
                    "alignment": "same-as-collection-table",
                    "margin_role": "portal-collection-card-content-margin",
                    "padding_role": "portal-collection-card-content-padding",
                },
            },
        )
        self.assertEqual(
            contract["collection_detail_drawer"],
            {
                "entry_action": "details",
                "component": "el-drawer",
                "direction": "rtl",
                "default_size": "480px",
                "append_to_body": True,
                "modal": True,
                "wrapper_closable": True,
                "field_source": "page_spec.detail_drawer.fields",
                "selected_row_source": "selectedDetailRow",
                "content_component": "el-form",
                "form_mode": "read-only",
                "label_position": "top",
                "preserve_collection_state": True,
            },
        )
        personnel = contract["personnel_management"]
        self.assertEqual(personnel["schema_version"], "isc-personnel-management.v1")
        self.assertEqual(
            list(personnel["pages"]),
            ["list", "add_form", "detail", "field_configuration"],
        )
        breadcrumb_tabs = personnel["shared"]["breadcrumb_tabs"]
        self.assertEqual(breadcrumb_tabs["item_inline_padding_px"], 12)
        self.assertEqual(
            breadcrumb_tabs["active_indicator_total_extension_px"], 24
        )
        self.assertFalse(breadcrumb_tabs["hover_text_underline"])
        self.assertTrue(breadcrumb_tabs["active_indicator_visible"])
        self.assertEqual(
            personnel["shared"]["operation_icons"]["style"], "linear"
        )
        self.assertEqual(
            personnel["shared"]["operation_icons"]["classification_ref"],
            "hui-icon-catalog.v1#/font_style_classification",
        )
        self.assertEqual(
            personnel["shared"]["operation_icons"]["applies_to"],
            ["toolbar_actions", "row_actions"],
        )
        add_form = personnel["pages"]["add_form"]
        self.assertEqual(
            add_form["field_grid"]["default_columns_when_many_fields"], 3
        )
        self.assertEqual(add_form["field_grid"]["full_row_field_ids"], [])
        self.assertTrue(add_form["anchor"]["outside_content_surface"])
        self.assertEqual(
            add_form["anchor"]["surface_context"], "page-gray-background"
        )
        detail = personnel["pages"]["detail"]
        self.assertTrue(detail["content_surface"]["cross_axis_stretch"])
        self.assertEqual(detail["anchor"]["reserved_width_px"], 180)
        field_configuration = personnel["pages"]["field_configuration"]
        self.assertEqual(
            field_configuration["framework"],
            {
                "variant": "regular-11",
                "navigation_layout": "top-card-tabs",
                "business_header": "intro-actions",
                "tab_source": "table_tabs",
                "intro_source": "field_configuration.description",
                "global_action_source": "toolbar_actions.label",
                "global_action_icon_source": "toolbar_actions.icon",
            },
        )
        self.assertEqual(
            field_configuration["layout"]["left_sidebar_width_role"],
            "portal-context-sidebar-width",
        )
        self.assertEqual(field_configuration["layout"]["dialog_width_px"], 400)
        self.assertEqual(
            field_configuration["library"]["add_action"]["appearance"],
            "default",
        )
        self.assertEqual(
            field_configuration["configured"]["add_action"]["appearance"],
            "primary",
        )
        selector_state = contract["live_evidence"][
            "framework_selector_selected_state"
        ]
        self.assertEqual(
            selector_state["source_url"],
            "http://isc-design-page.dev.hikhub.net/framework/regular-07",
        )
        self.assertEqual(
            selector_state["dom"]["current_content_selector"],
            ".left-selector__tree .h-tree-node.is-current > .h-tree-node__content",
        )
        self.assertEqual(
            selector_state["brand_indicator"],
            {
                "implementation": "inset-box-shadow",
                "edge": "left",
                "width": "2px",
                "color_role": "brand-default",
            },
        )
        self.assertEqual(
            selector_state["hui_runtime_adapter"]["inherited_border"],
            "2px solid transparent",
        )
        self.assertEqual(
            selector_state["hui_runtime_adapter"]["required_override"],
            "border: 0 !important",
        )
        card_tabs = contract["live_evidence"]["card_tabs"]
        self.assertEqual(
            card_tabs["source_url"],
            "http://isc-design-page.dev.hikhub.net/framework/regular-09",
        )
        self.assertEqual(card_tabs["dom"]["root_selector"], ".card-tabs")
        self.assertEqual(
            card_tabs["source_assets"]["component_css"],
            "FrameworkRenderer-CEsy2Rkf.css",
        )
        self.assertEqual(
            card_tabs["runtime_adapter"]["content_wrapper_selector"],
            ".card-tabs > .card-tabs__item.el-button > span",
        )
        self.assertEqual(
            card_tabs["indicator"]["positioning"],
            "active-item-offsetWidth-and-offsetLeft",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-framework-left-selector-main-padding"],
            "16px 16px 0",
        )
        self.assertEqual(
            contract["framework_variants"]["content_padding_policy"],
            "outer-framework-only",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-framework-content-padding"],
            "0",
        )
        self.assertEqual(
            contract["geometry_roles"]["portal-side-collapsed-icon-wrapper-padding"],
            "0",
        )
        self.assertEqual(
            contract["interaction"]["sidebar_collapsed_icon_alignment"],
            "centered-in-item-via-zero-padding-collapse-wrapper",
        )
        motion = contract["interaction"]["motion"]
        self.assertEqual(
            motion["source_url"],
            "http://isc-design-page.dev.hikhub.net/framework/regular-01",
        )
        self.assertEqual(
            motion["sidebar_collapse_expand"],
            {
                "selector": ".sidebar",
                "property": "width",
                "from": "240px",
                "to": "48px",
                "duration": "220ms",
                "timing_function": "ease",
                "delay": "0ms",
                "applies_to": ["collapse", "expand"],
            },
        )
        self.assertEqual(motion["toggle_icons"]["duration"], "180ms")
        self.assertEqual(motion["menu_item_state"]["duration"], "160ms")
        self.assertEqual(motion["submenu_item_state"]["duration"], "160ms")
        self.assertEqual(
            motion["collapsed_content_visibility"],
            {
                "menu_label": "display:none",
                "submenu": "display:none",
                "transition": "none",
            },
        )
        collapsed_icon_evidence = contract["live_evidence"][
            "sidebar_collapsed_icon_alignment"
        ]
        self.assertEqual(collapsed_icon_evidence["sidebar_center_x"], "24.5px")
        self.assertEqual(collapsed_icon_evidence["observed_icon_center_x"], "29-29.5px")
        self.assertEqual(collapsed_icon_evidence["observed_offset"], "4.5-5px right")
        self.assertEqual(collapsed_icon_evidence["required_wrapper_padding"], "0")

    def test_semantic_framework_selection_normalizes_to_legacy_variant(self) -> None:
        spec = json.loads(
            (
                ROOT
                / "tests/generation/personnel-permission-details-shell.json"
            ).read_text(encoding="utf-8")
        )
        spec["framework"].pop("variant")
        spec["framework"].update({
            "show_left_selector": False,
            "show_top_tabs": True,
            "business_header": "intro",
        })
        html = compile_pattern_page(spec)
        framework = extract_frozen_json(html, "PAGE_CONFIG")["framework"]
        self.assertEqual(framework["variant"], "regular-10")
        self.assertFalse(framework["show_left_selector"])
        self.assertTrue(framework["show_top_tabs"])
        self.assertEqual(framework["business_header"], "intro")

    def test_framework_selection_rejects_conflicting_legacy_and_semantic_values(self) -> None:
        spec = json.loads(
            (
                ROOT
                / "tests/generation/personnel-permission-details-shell.json"
            ).read_text(encoding="utf-8")
        )
        spec["framework"].update({
            "show_left_selector": False,
            "show_top_tabs": True,
            "business_header": "intro",
        })
        with self.assertRaisesRegex(PatternPageError, "语义选择与兼容变量"):
            compile_pattern_page(spec)

    def test_uncovered_combined_navigation_state_is_not_silently_compiled(self) -> None:
        spec = json.loads(
            (
                ROOT
                / "tests/generation/personnel-permission-details-shell.json"
            ).read_text(encoding="utf-8")
        )
        spec["framework"].pop("variant")
        spec["framework"].update({
            "show_left_selector": True,
            "show_top_tabs": True,
            "business_header": "none",
        })
        with self.assertRaisesRegex(PatternPageError, "regular目录未覆盖"):
            compile_pattern_page(spec)

    def test_generates_all_framework_variants_with_permission_details(self) -> None:
        base_spec = json.loads(
            (
                ROOT
                / "tests/generation/personnel-permission-details-shell.json"
            ).read_text(encoding="utf-8")
        )
        expected = [
            ("regular-01", "single", False, False, "none", 0, False),
            ("regular-02", "single", False, False, "intro", 0, False),
            ("regular-03", "single", False, False, "intro-actions", 2, False),
            ("regular-04", "single", False, False, "intro-actions-extra", 2, True),
            ("regular-05", "left-selector", True, False, "none", 0, False),
            ("regular-06", "left-selector", True, False, "intro", 0, False),
            ("regular-07", "left-selector", True, False, "intro-actions", 2, False),
            ("regular-08", "left-selector", True, False, "intro-actions-extra", 2, True),
            ("regular-09", "top-card-tabs", False, True, "none", 0, False),
            ("regular-10", "top-card-tabs", False, True, "intro", 0, False),
            ("regular-11", "top-card-tabs", False, True, "intro-actions", 2, False),
            ("regular-12", "top-card-tabs", False, True, "intro-actions-extra", 2, True),
        ]

        with tempfile.TemporaryDirectory() as directory:
            for variant_id, layout, show_left, show_top, header, action_count, show_extra in expected:
                with self.subTest(variant=variant_id):
                    spec = copy.deepcopy(base_spec)
                    spec["id"] = f"isc3-personnel-permission-details-{variant_id}"
                    spec["framework"]["variant"] = variant_id
                    output_path = Path(directory) / f"{variant_id}.html"
                    output_path.write_text(
                        compile_pattern_page(spec, output_path), encoding="utf-8"
                    )
                    html = output_path.read_text(encoding="utf-8")
                    page_config = extract_frozen_json(html, "PAGE_CONFIG")

                    self.assertIsNotNone(page_config)
                    self.assertEqual(
                        page_config["portal"]["breadcrumb_placement"],
                        "portal-body",
                    )
                    self.assertEqual(page_config["detail_presentation"], "flat")
                    self.assertFalse(page_config["pattern_parameters"]["pagination"])
                    self.assertEqual(
                        page_config["pattern_parameters"]["content_inline_padding"],
                        "80px",
                    )
                    self.assertEqual(
                        page_config["product_page_kind_policy"],
                        {"pagination": False},
                    )
                    framework = page_config["framework"]
                    self.assertEqual(framework["variant"], variant_id)
                    self.assertEqual(framework["navigation_layout"], layout)
                    self.assertEqual(framework["show_left_selector"], show_left)
                    self.assertEqual(framework["show_top_tabs"], show_top)
                    self.assertEqual(framework["business_header"], header)
                    self.assertEqual(len(framework["global_actions"]), action_count)
                    self.assertEqual(framework["show_extra_info"], show_extra)
                    self.assertEqual(
                        [item["id"] for item in framework["variant_menu"]],
                        [f"regular-{index:02d}" for index in range(1, 13)],
                    )
                    self.assertTrue(
                        all(item["href"].endswith(".html") for item in framework["variant_menu"])
                    )
                    self.assertIn('class="isc-personnel-framework"', html)
                    shell_breadcrumb = (
                        "v-if=\"config.portal.breadcrumb_placement === "
                        "'portal-body'\" class=\"page-breadcrumb "
                        "isc-personnel-portal-breadcrumb\""
                    )
                    self.assertIn(shell_breadcrumb, html)
                    self.assertLess(
                        html.index(shell_breadcrumb),
                        html.index('class="isc-personnel-framework"'),
                    )
                    self.assertIn(
                        "v-if=\"config.portal.breadcrumb_placement !== "
                        "'portal-body'\" class=\"page-breadcrumb\"",
                        html,
                    )
                    self.assertIn(
                        'class="isc-personnel-body" '
                        ':class="{\'has-context-sidebar\':config.portal.show_context_sidebar}"',
                        html,
                    )
                    self.assertIn(
                        "'has-portal-breadcrumb':config.portal.breadcrumb_placement === 'portal-body'",
                        html,
                    )
                    self.assertIn(
                        ".page-frame.has-external-master-media.has-portal-breadcrumb { "
                        "grid-template-rows: minmax(0, 1fr); }",
                        html,
                    )
                    self.assertIn(
                        '<el-nav-item v-for="item in config.framework.variant_menu"',
                        html,
                    )
                    self.assertNotIn('<el-subnav v-for="group in config.framework.variant_menu"', html)
                    self.assertIn('@click="selectFrameworkVariant(item)"', html)
                    self.assertNotIn('class="menu-bar"', html)
                    self.assertIn(
                        'v-if="config.framework.show_left_selector" '
                        'class="isc-framework-selector"',
                        html,
                    )
                    self.assertIn(
                        "--d2c-portal-framework-selector-background: #ffffff !important;",
                        html,
                    )
                    self.assertIn(
                        ".isc-framework-selector__tree .el-tree-node__content { height: "
                        "var(--d2c-portal-context-tree-item-height); border: 0 !important; "
                        "border-radius: 2px; }",
                        html,
                    )
                    self.assertIn(
                        ".isc-framework-selector__tree .el-tree-node.is-current > "
                        ".el-tree-node__content::before {",
                        html,
                    )
                    self.assertIn(
                        "box-shadow: inset "
                        "var(--d2c-portal-context-active-indicator-width) 0 0 "
                        "var(--d2c-portal-context-tree-active-indicator);",
                        html,
                    )
                    self.assertIn(
                        ".isc-framework-selector__tree .el-tree-node.is-current > "
                        ".el-tree-node__content > * { position: relative; z-index: 1; }",
                        html,
                    )
                    self.assertIn(
                        'v-if="config.framework.show_top_tabs" '
                        'class="isc-framework-card-tabs"',
                        html,
                    )
                    self.assertIn(
                        'class="card-tabs" role="tablist" aria-label="内容标签页"',
                        html,
                    )
                    self.assertIn('class="card-tabs__indicator"', html)
                    self.assertIn('ref="frameworkTabButtons"', html)
                    self.assertIn("updateFrameworkCardTabsIndicator", html)
                    self.assertIn(
                        "activeButton.$el || activeButton",
                        html,
                    )
                    self.assertIn(
                        "nextButton.$el || nextButton",
                        html,
                    )
                    self.assertIn(
                        ".card-tabs > .card-tabs__item.el-button {",
                        html,
                    )
                    self.assertIn(
                        ".card-tabs > .card-tabs__item.el-button > span {",
                        html,
                    )
                    self.assertIn("overflow: visible !important", html)
                    self.assertIn("display: inline-flex", html)
                    self.assertNotIn(
                        '<el-tabs v-model="activeFrameworkTab" type="card">',
                        html,
                    )
                    self.assertIn(
                        "v-if=\"config.framework.business_header !== 'none'\"",
                        html,
                    )
                    self.assertNotIn(
                        "config.framework.navigation_layout === 'left-selector'",
                        html,
                    )
                    self.assertNotIn(
                        "config.framework.navigation_layout === 'top-card-tabs'",
                        html,
                    )
                    structure = ShellStructureParser()
                    structure.feed(html)
                    self.assertIn(
                        "isc-personnel-body",
                        structure.parents["isc-personnel-sidebar"],
                    )
                    self.assertIn(
                        "isc-personnel-body",
                        structure.parents["isc-personnel-portal-breadcrumb"],
                    )
                    self.assertIn(
                        "isc-personnel-body",
                        structure.parents["isc-personnel-framework"],
                    )
                    self.assertIn(
                        "isc-personnel-framework",
                        structure.parents["isc-framework-selector"],
                    )
                    self.assertIn(
                        "isc-personnel-framework",
                        structure.parents["isc-personnel-framework__stage"],
                    )
                    self.assertIn(
                        "isc-personnel-framework__stage",
                        structure.parents["isc-framework-business-header"],
                    )
                    self.assertIn(
                        "isc-personnel-framework__stage",
                        structure.parents["isc-framework-card-tabs"],
                    )
                    self.assertIn(
                        "isc-personnel-framework__stage",
                        structure.parents["content-shell"],
                    )
                    self.assertIn("研发园区员工通行权限", html)
                    self.assertIn("已授权人员", html)
                    self.assertIn(
                        "'is-flat':config.detail_presentation === 'flat'",
                        html,
                    )
                    self.assertIn(
                        ".details-page.is-flat .details-main { background: "
                        "var(--h-color-bg-primary); }",
                        html,
                    )
                    self.assertIn(
                        "--d2c-page-details-content-inline-padding: 80px !important;",
                        html,
                    )
                    self.assertIn(
                        "padding-right: var(--d2c-page-details-content-inline-padding, 80px);",
                        html,
                    )
                    self.assertIn(
                        "padding-left: var(--d2c-page-details-content-inline-padding, 80px);",
                        html,
                    )
                    self.assertNotIn(':wrap-scroll="true"', html)
                    self.assertIn(
                        "--d2c-portal-side-collapsed-icon-wrapper-padding: 0 !important;",
                        html,
                    )
                    self.assertIn(
                        ".isc-personnel-side-menu.el-nav--collapse .el-nav-item__collapse {\n"
                        "      display: flex; align-items: center; justify-content: center; "
                        "padding: var(--d2c-portal-side-collapsed-icon-wrapper-padding);\n"
                        "    }",
                        html,
                    )
                    self.assertEqual(validate_pattern_html(spec, output_path), [])

    def test_standard_is_registered_and_compiles_permission_form(self) -> None:
        product_root = (
            ROOT / "design-systems/industry-products/general/products/isc"
        )
        product = json.loads((product_root / "product.json").read_text(encoding="utf-8"))
        standard = product["portal_shell_standards"]["personnel-management"]
        self.assertEqual(
            product["page_kind_policies"]["details"],
            {"pagination": False},
        )
        contract = json.loads(
            (product_root / standard["contract"]).read_text(encoding="utf-8")
        )
        self.assertEqual(
            contract["source"]["url"],
            "http://isc-design-page.dev.hikhub.net/home",
        )
        self.assertEqual(contract["geometry_roles"]["portal-header-height"], "48px")
        self.assertEqual(contract["geometry_roles"]["portal-sidebar-width"], "240px")
        self.assertEqual(contract["geometry_roles"]["portal-sidebar-collapsed-width"], "48px")
        self.assertEqual(contract["geometry_roles"]["portal-sidebar-toggle-height"], "56px")
        self.assertEqual(contract["geometry_roles"]["portal-side-menu-padding"], "0 8px 24px")
        self.assertEqual(contract["geometry_roles"]["portal-side-item-width"], "224px")
        self.assertEqual(contract["geometry_roles"]["portal-side-collapsed-item-size"], "40px")
        self.assertEqual(contract["geometry_roles"]["portal-context-sidebar-width"], "256px")
        self.assertEqual(contract["geometry_roles"]["portal-context-tree-icon-size"], "24px")
        self.assertEqual(
            contract["portal"]["context_menu"]["default_active_node"],
            "区域557449",
        )
        self.assertEqual(
            contract["portal"]["context_menu"]["tree_icon"],
            {"mode": "business-svg", "name": "SvgGroup"},
        )
        self.assertEqual(
            contract["portal"]["breadcrumb_placement"],
            "portal-body",
        )
        self.assertEqual(
            contract["portal"]["breadcrumb_sibling_of"],
            ["portal.sidebar", "framework"],
        )
        self.assertEqual(
            contract["colors"]["context-tree-selected-background"],
            "var(--h-color-item-bg-selected)",
        )
        self.assertEqual(
            contract["colors"]["context-tree-selected-text"],
            "var(--h-color-item-text-selected)",
        )
        self.assertEqual(
            contract["interaction"]["context_tree_current_state"],
            "brand-10-fill-with-primary-text",
        )
        self.assertEqual(
            contract["live_evidence"]["context_tree_selected_state"],
            {
                "source_url": "http://isc-design-page.dev.hikhub.net/framework/regular-06",
                "selected_node": "区域557449",
                "tree_class": "h-tree h-tree--highlight-current",
                "node_class": "h-tree-node is-current is-focusable isc-tree-node--level-2",
                "content_class": "h-tree-node__content",
                "background_surface": "content-pseudo-before",
                "background_variable": "--h-tree-highlight-normal-bg-color",
                "background": "#FFEAE8",
                "text": "rgba(0, 4, 32, 0.73)",
            },
        )
        theme = json.loads(
            (product_root / "theme/tokens.json").read_text(encoding="utf-8")
        )["overrides"]
        self.assertEqual(
            theme["--h-color-item-bg-selected"],
            "var(--h-color-brand-10)",
        )
        self.assertEqual(
            theme["--h-color-item-text-selected"],
            "var(--h-color-text-primary)",
        )

        spec = json.loads(
            (ROOT / "tests/generation/personnel-permission-form.json").read_text(
                encoding="utf-8"
            )
        )
        output_path = ROOT / "output/personnel-permission-form.html"
        html = compile_pattern_page(spec, output_path)
        output_path.write_text(html, encoding="utf-8")
        self.assertEqual(spec["product_version"], "3.0.0")
        self.assertIn('"product_shell_standard": "isc-3.0.0"', html)
        self.assertIn('"product_shell_source": "product:isc/personnel-management"', html)
        self.assertIn('class="isc-personnel-sidebar"', html)
        self.assertIn('class="isc-personnel-sidebar__toggle"', html)
        self.assertIn(
            "isc-personnel-sidebar__toggle-icon is-expanded h-icon-menu_leftbar",
            html,
        )
        self.assertIn(
            "isc-personnel-sidebar__toggle-icon is-collapsed h-icon-menu_leftbar",
            html,
        )
        self.assertIn('class="isc-personnel-sidebar__scrollbar"', html)
        self.assertIn('v-if="config.portal.show_context_sidebar"', html)
        self.assertIn("isc-personnel-brand__name", html)
        self.assertIn("isc-personnel-brand__mark", html)
        self.assertIn("width: var(--d2c-portal-logo-width); height: var(--d2c-portal-logo-height);", html)
        self.assertIn('class="el-alert__closebtn h-icon-close_sm"', html)
        self.assertIn(".isc-personnel-primary-nav { display: flex; align-items: center; height: 100%; min-width: 0; flex: 1; gap: var(--d2c-portal-top-nav-gap);", html)
        self.assertIn(".isc-personnel-primary-nav__item.is-active { color: var(--d2c-portal-navigation-text-active); background: var(--d2c-portal-navigation-active-background); }", html)
        self.assertIn(".isc-personnel-primary-nav__divider { width: 1px; height: 16px; margin: 0 4px;", html)
        self.assertIn("background: var(--h-color-bg-secondary);", html)
        self.assertIn(":class=\"{'is-collapsed':sidebarCollapsed}\"", html)
        self.assertIn('<el-nav class="isc-personnel-side-menu" mode="vertical" :collapse="sidebarCollapsed"', html)
        self.assertNotIn(':wrap-scroll="true"', html)
        self.assertIn('{{ item.label }}</el-nav-item>', html)
        self.assertNotIn('class="isc-personnel-icon-sidebar__item"', html)
        self.assertIn('.isc-personnel-header-actions .el-button + .el-button { margin-left: 0; }', html)
        self.assertIn('"sidebar_collapsed": false', html)
        self.assertIn('--d2c-portal-sidebar-width: 240px !important;', html)
        self.assertIn(
            '--d2c-portal-sidebar-motion-duration: 220ms !important;',
            html,
        )
        self.assertIn(
            '--d2c-portal-sidebar-toggle-icon-motion-duration: 180ms !important;',
            html,
        )
        self.assertIn(
            '--d2c-portal-sidebar-menu-item-motion-duration: 160ms !important;',
            html,
        )
        self.assertIn('--d2c-portal-side-menu-padding: 0 8px 24px !important;', html)
        self.assertIn('--d2c-portal-side-item-width: 224px !important;', html)
        self.assertIn('--d2c-portal-framework-content-padding: 0 !important;', html)
        self.assertIn('--d2c-portal-framework-business-header-min-height: 28px !important;', html)
        self.assertIn('--d2c-portal-framework-content-min-height: 420px !important;', html)
        self.assertIn(
            '.isc-personnel-framework .page-workspace { padding: '
            'var(--d2c-portal-framework-content-padding); }',
            html,
        )
        self.assertIn('--d2c-portal-sidebar-background: rgba(247, 249, 252, 0.96) !important;', html)
        self.assertIn('border-color: var(--d2c-portal-side-selected-border,', html)
        self.assertIn('box-shadow: var(--d2c-portal-side-selected-shadow,', html)
        self.assertIn('.isc-personnel-side-menu.el-nav--collapse .el-nav-item {', html)
        self.assertIn(
            "border-right: 0 !important; background: transparent; transition: none;",
            html,
        )
        self.assertNotIn(
            "transition: width .22s ease, padding .22s ease;",
            html,
        )
        self.assertIn(
            ".isc-personnel-side-menu.el-nav--collapse .el-nav-item .el-nav-item--text { display: none; }",
            html,
        )
        self.assertIn(
            ".isc-personnel-side-menu.el-nav--collapse .el-nav-item .el-nav-icon {\n"
            "      position: static; display: inline-flex; align-items: center; justify-content: center; margin: 0 !important;\n"
            "    }",
            html,
        )
        self.assertIn(
            ".isc-personnel-side-menu.el-nav--collapse .el-nav-item__collapse {\n"
            "      display: flex; align-items: center; justify-content: center; "
            "padding: var(--d2c-portal-side-collapsed-icon-wrapper-padding);\n"
            "    }",
            html,
        )
        self.assertIn('<el-tree ref="portalContextTree"', html)
        self.assertIn('"show_context_sidebar": false', html)
        self.assertIn('<el-breadcrumb separator-class="h-icon-angle_right_sm">', html)
        self.assertIn('<el-breadcrumb-item>{{ config.portal.section }}</el-breadcrumb-item>', html)
        self.assertIn('.isc-personnel-shell .form-area__footer { justify-content: flex-start; padding-left: var(--d2c-page-form-content-inline-padding); }', html)
        self.assertIn(':default-active="activeIconMenu"', html)
        self.assertIn('@click="selectIconMenu(item)"', html)
        self.assertIn('selectIconMenu: function (item)', html)
        self.assertNotIn("hui-svg-icon.umd.js", html)
        self.assertEqual(
            validate_pattern_html(
                spec, output_path
            ),
            [],
        )

    def test_personnel_collection_toolbar_keeps_four_screenshot_variants(self) -> None:
        portal = json.loads(
            (
                ROOT
                / "design-systems/industry-products/general/products/isc/portal-shell/personnel-management.json"
            ).read_text(encoding="utf-8")
        )
        toolbar = portal["collection_toolbar"]

        self.assertEqual(toolbar["source"]["kind"], "user-supplied-screenshot")
        self.assertEqual(toolbar["source"]["frame_id"], "150:5")
        self.assertEqual(toolbar["source"]["image_size"], [1919, 713])
        self.assertEqual(
            toolbar["source"]["sha256"],
            "624e4659434c8fcf02c72db1cb7aa19dab617242e8b7cda004a1c62c97eac2e0",
        )
        self.assertEqual(toolbar["variant_count"], 4)
        self.assertEqual(toolbar["applies_to_page_kinds"], ["table", "card"])
        self.assertTrue(
            toolbar["selection_strategy"][
                "product_toolbar_precedes_hui_collection_filter"
            ]
        )
        self.assertEqual(
            toolbar["selection_strategy"]["explicit_variant_required_when"],
            ["toolbar-actions-present", "filters-present"],
        )
        self.assertEqual(
            toolbar["selection_strategy"]["keyword_only_query_region"],
            "scoped-keyword",
        )
        self.assertEqual(
            toolbar["selection_strategy"]["hui_filter_variant_conflict"],
            "reject",
        )
        self.assertEqual(
            [variant["id"] for variant in toolbar["variants"]],
            [
                "actions-structured-query",
                "actions-scoped-keyword",
                "summary-structured-query",
                "summary-scoped-keyword",
            ],
        )
        self.assertEqual(
            toolbar["expanded_filter_box"]["demonstrated_from_variant"],
            "actions-scoped-keyword",
        )
        self.assertEqual(
            toolbar["expanded_filter_box"]["field_count_by_row"],
            [6, 5],
        )
        self.assertEqual(
            toolbar["expanded_filter_box"]["visibility_policy"],
            {
                "basis": "remaining-fields-after-inline-controls",
                "inline_field_source": "selected-query-region.controls[*].field_key",
                "show_trigger_when": "remaining-field-count>0",
                "show_box_when": "trigger-visible-and-expanded",
                "hide_when_remaining_field_count": 0,
            },
        )
        for region_id in ("structured-query", "scoped-keyword"):
            controls = toolbar["regions"][region_id]["controls"]
            keyword = next(item for item in controls if item["role"] == "keyword-search")
            trigger = next(item for item in controls if item["role"] == "filter-trigger")
            self.assertEqual(keyword["field_key"], "keyword")
            self.assertEqual(trigger["visibility"], "remaining-filter-count>0")
        self.assertNotIn("toolbar_background", toolbar["shared_visual_style"])
        self.assertEqual(
            toolbar["shared_visual_style"]["background_policy"],
            "transparent-on-page-surface",
        )
        self.assertEqual(
            toolbar["shared_visual_style"]["padding_role"],
            "portal-collection-toolbar-padding",
        )
        self.assertEqual(
            toolbar["shared_visual_style"]["height_role"],
            "portal-collection-toolbar-height",
        )
        self.assertEqual(
            toolbar["shared_visual_style"]["primary_color_state"],
            "default",
        )
        self.assertEqual(
            toolbar["shared_visual_style"]["primary_color_token"],
            "--h-color-brand",
        )
        self.assertNotIn("primary_color", toolbar["shared_visual_style"])
        self.assertEqual(
            toolbar["expanded_filter_box"]["margin_role"],
            "portal-collection-expanded-filter-margin",
        )
        view_modes = toolbar["shared_visual_style"]["view_mode_controls"]
        self.assertEqual(view_modes["implementation"], "hui-iconfont")
        self.assertEqual(view_modes["list_icon"], "h-icon-menu_leftbar")
        self.assertEqual(view_modes["card_icon"], "h-icon-menu")
        self.assertEqual(view_modes["component"], "el-button")
        self.assertEqual(view_modes["runtime_binding"], "collectionToolbarView")
        self.assertEqual(view_modes["list_value"], "list")
        self.assertEqual(view_modes["card_value"], "card")
        self.assertEqual(view_modes["card_page_default"], "card")
        self.assertEqual(view_modes["card_page_list_source"], "page_spec.columns")
        self.assertEqual(view_modes["shared_row_source"], "preview.rows")
        self.assertEqual(view_modes["button_size"], "32px")
        self.assertEqual(view_modes["icon_size_role"], "--h-button-icon-size")
        self.assertEqual(view_modes["icon_size"], "24px")
        form_controls = toolbar["shared_visual_style"]["form_controls"]
        self.assertEqual(form_controls["component_source"], "HUI")
        self.assertEqual(form_controls["component_size"], "medium")
        self.assertEqual(form_controls["height_role"], "--h-component-height-md")
        self.assertEqual(form_controls["height"], "32px")
        self.assertEqual(form_controls["border_role"], "--h-input-border")
        self.assertEqual(
            form_controls["border_color_role"], "--h-color-border-primary"
        )
        self.assertNotIn("filter_input_border", toolbar["shared_visual_style"])

        batch_actions = toolbar["regions"]["batch-actions"]
        self.assertNotIn("actions", batch_actions)
        self.assertEqual(batch_actions["action_source"], "page_spec.toolbar_actions")
        self.assertTrue(
            batch_actions["generation_policy"]["derive_from_page_requirements"]
        )
        self.assertTrue(
            batch_actions["generation_policy"]["must_not_inject_unrequested_actions"]
        )
        self.assertEqual(
            batch_actions["overflow_policy"]["behavior"],
            "move-trailing-actions-to-more-dropdown",
        )
        self.assertEqual(batch_actions["overflow_policy"]["more_label"], "更多")
        self.assertFalse(batch_actions["overflow_policy"]["horizontal_scroll"])

        filter_content = toolbar["expanded_filter_box"]["content_policy"]
        self.assertEqual(filter_content["field_source"], "page_spec.filters")
        self.assertTrue(filter_content["derive_from_page_requirements"])
        self.assertTrue(filter_content["must_not_synthesize_generic_placeholders"])
        self.assertTrue(
            filter_content["screenshot_field_count_by_row_is_evidence_only"]
        )
        self.assertNotIn("field_label", toolbar["expanded_filter_box"])
        self.assertNotIn("field_placeholder", toolbar["expanded_filter_box"])

    def test_personnel_list_keeps_organization_tree(self) -> None:
        spec = json.loads(
            (ROOT / "output/isc3-access-personnel-list.spec.json").read_text(
                encoding="utf-8"
            )
        )
        output_path = ROOT / "output/isc3-access-personnel-list.html"
        html = compile_pattern_page(spec, output_path)
        output_path.write_text(html, encoding="utf-8")
        page_config = extract_frozen_json(html, "PAGE_CONFIG")

        self.assertTrue(spec["portal"]["show_context_sidebar"])
        self.assertEqual(
            spec["collection_toolbar_variant"],
            "actions-scoped-keyword",
        )
        self.assertEqual(
            page_config["collection_toolbar"]["variant"]["id"],
            "actions-scoped-keyword",
        )
        self.assertTrue(
            page_config["collection_toolbar"]["initial_filter_expanded"]
        )
        self.assertTrue(
            page_config["collection_toolbar"]["expanded_filter_box"]["visible"]
        )
        self.assertEqual(
            page_config["collection_toolbar"]["expanded_filter_box"]["field_keys"],
            [field["key"] for field in spec["filters"]],
        )
        self.assertEqual(
            [action["id"] for action in spec["toolbar_actions"]],
            [
                "add",
                "delete-selected",
                "move-organization",
                "sync-biometric",
                "card-operation",
                "import",
                "export",
            ],
        )
        self.assertEqual(
            next(
                action["icon"]
                for action in spec["toolbar_actions"]
                if action["id"] == "card-operation"
            ),
            "h-icon-associate",
        )
        self.assertEqual(page_config["personnel_page_policy"]["page"], "list")
        self.assertEqual(
            page_config["personnel_page_policy"]["contract"][
                "toolbar_action_icons"
            ]["card-operation"],
            "h-icon-associate",
        )
        self.assertEqual(
            spec["row_detail_href"],
            "isc3-access-personnel-detail.html",
        )
        self.assertIn(
            'window.location.href = this.config.row_detail_href + \'?id=\' + encodeURIComponent(row.id);',
            html,
        )
        self.assertEqual(
            [field["label"] for field in spec["filters"]],
            [
                "姓名",
                "性别",
                "所属组织",
                "证件类型",
                "证件号码",
                "工号",
                "手机号",
                "凭证信息",
                "人员有效期",
            ],
        )
        self.assertEqual(page_config["filters"], spec["filters"])
        self.assertIn("visibleCollectionToolbarActions", html)
        self.assertIn("overflowCollectionToolbarActions", html)
        self.assertIn('class="isc-collection-toolbar__more"', html)
        self.assertIn("<el-dropdown", html)
        self.assertIn("h-icon-more_hori", html)

        wrong_icon = copy.deepcopy(spec)
        next(
            action
            for action in wrong_icon["toolbar_actions"]
            if action["id"] == "card-operation"
        )["icon"] = "h-icon-info_card"
        with self.assertRaisesRegex(
            PatternPageError, "toolbar_action_icons.card-operation"
        ):
            compile_pattern_page(wrong_icon)
        filled_operation_icon = copy.deepcopy(spec)
        next(
            action
            for action in filled_operation_icon["toolbar_actions"]
            if action["id"] == "add"
        )["icon"] = "h-icon-menu_f"
        with self.assertRaisesRegex(
            PatternPageError,
            r"操作图标必须使用linear风格: toolbar_actions\.add=h-icon-menu_f",
        ):
            compile_pattern_page(filled_operation_icon)
        self.assertIn(
            'class="isc-collection-toolbar__overflow-menu"',
            html,
        )
        self.assertIn(
            'class="isc-collection-toolbar__overflow-item-icon" '
            ':class="action.icon"',
            html,
        )
        self.assertIn(
            ".isc-collection-toolbar__overflow-item-icon { "
            "font-size: var(--h-dropdown-menu-item-angle-icon-size);",
            html,
        )
        self.assertIn("h-icon-menu_leftbar", html)
        self.assertIn("h-icon-menu", html)
        self.assertIn('title="卡片视图"', html)

        self.assertIn(
            '<el-button type="text" size="small" '
            'class="isc-collection-toolbar__view-button"',
            html,
        )
        self.assertIn(
            "return (this.config.filters || []).filter(function (field) { return keys.indexOf(field.key) !== -1; });",
            html,
        )
        self.assertNotIn(
            ".isc-collection-toolbar__view-button > i { font-size: 16px;",
            html,
        )
        self.assertNotIn("field.label || '过滤条件'", html)
        self.assertNotIn("field.placeholder || '请输入'", html)
        self.assertNotIn(
            'v-model="collectionToolbarKeyword" size="small"',
            html,
        )
        self.assertNotIn(
            'v-model="collectionToolbarAdvancedFilters[field.key]" size="small"',
            html,
        )
        self.assertNotIn("--isc-collection-toolbar-filter-input-border", html)
        self.assertNotIn(
            ".isc-collection-toolbar__advanced-field .el-input__inner { border-color:",
            html,
        )
        self.assertNotIn("collectionToolbarActionStyle", html)
        self.assertNotIn("--isc-collection-toolbar-background", html)
        self.assertNotIn("isc-collection-toolbar__view-list", html)
        self.assertNotIn("isc-collection-toolbar__view-grid", html)
        self.assertNotIn(
            ".isc-collection-toolbar__left { min-width: 0; overflow-x: auto;",
            html,
        )
        self.assertIn(
            'class="isc-collection-toolbar"',
            html,
        )
        self.assertIn(
            'class="isc-collection-toolbar__advanced-filter"',
            html,
        )
        self.assertIn(
            'v-model="collectionToolbarIncludeDescendants"',
            html,
        )
        self.assertIn(
            ':placeholder="collectionToolbarKeywordPlaceholder"',
            html,
        )
        self.assertIn("collectionToolbarKeywordPlaceholder: function ()", html)
        self.assertFalse(page_config["collection_table"]["striped"])
        self.assertEqual(
            page_config["collection_table"]["default_row_background"],
            "#ffffff",
        )
        self.assertIn(
            '<el-table :data="pagedRows" height="100%" '
            ':stripe="config.collection_table.striped" row-key="id"',
            html,
        )
        self.assertIn(
            '--d2c-portal-collection-toolbar-height: 64px !important;',
            html,
        )
        self.assertIn(
            '--d2c-portal-collection-toolbar-padding: 16px !important;',
            html,
        )
        self.assertIn(
            '--d2c-portal-collection-table-content-margin: 0 16px !important;',
            html,
        )
        self.assertIn(
            '--d2c-portal-collection-table-content-padding: 0 !important;',
            html,
        )
        self.assertIn(
            '--d2c-portal-collection-expanded-filter-margin: 0 16px 16px !important;',
            html,
        )
        self.assertIn(
            'height: var(--d2c-portal-collection-toolbar-height);',
            html,
        )
        self.assertIn(
            'padding: var(--d2c-portal-collection-toolbar-padding);',
            html,
        )
        self.assertIn(
            'margin: var(--d2c-portal-collection-table-content-margin);',
            html,
        )
        self.assertIn(
            'padding: var(--d2c-portal-collection-table-content-padding);',
            html,
        )
        self.assertIn(
            'margin: var(--d2c-portal-collection-expanded-filter-margin);',
            html,
        )
        self.assertNotIn(
            '<el-table :data="pagedRows" height="100%" stripe row-key="id"',
            html,
        )
        self.assertIn('"show_context_sidebar": true', html)
        self.assertIn('class="isc-personnel-context-sidebar"', html)
        self.assertIn('<el-tree ref="portalContextTree"', html)
        self.assertIn("区域557449", html)
        self.assertIn(':icon="config.portal.context_menu.tree_icon"', html)
        self.assertIn('"name": "SvgGroup"', html)
        self.assertIn("hui-svg-icon.umd.js", html)
        self.assertIn(
            ".isc-personnel-context-search .el-input__suffix { top: 4px; }",
            html,
        )
        self.assertIn(
            "border: 0 !important; border-radius: 2px;",
            html,
        )
        self.assertIn(
            "width: var(--d2c-portal-context-tree-icon-size); height: var(--d2c-portal-context-tree-icon-size);",
            html,
        )
        self.assertNotIn('size="small" suffix-icon="h-icon-search"', html)
        self.assertIn(
            "--d2c-portal-context-tree-selected-background: var(--h-color-item-bg-selected) !important;",
            html,
        )
        self.assertIn(
            "--d2c-portal-context-tree-selected-text: var(--h-color-item-text-selected) !important;",
            html,
        )
        self.assertIn(
            "--h-color-item-bg-selected: var(--h-color-brand-10) !important;",
            html,
        )
        self.assertIn(
            "--h-color-item-text-selected: var(--h-color-text-primary) !important;",
            html,
        )

        self.assertIn(
            ':filter-node-method="filterContextTreeNode" highlight-current',
            html,
        )
        self.assertNotIn("--h-tree-item-selected-bg-color: transparent;", html)
        self.assertIn(".isc-personnel-context-tree__tree {", html)
        self.assertNotIn("--h-tree-item-selected-bg-color:", html)
        self.assertNotIn(
            "--h-tree-item-selected-bg-color: var(--h-color-brand-60);",
            html,
        )
        self.assertNotIn(
            "--d2c-portal-context-tree-selected-background: var(--h-color-brand-60)",
            html,
        )
        self.assertNotIn("--h-tree-item-selected-text-color:", html)
        self.assertNotIn(
            ".el-tree-node.is-current:not(.is-drag) > .el-tree-node__content {\n      background-color:",
            html,
        )
        self.assertEqual(validate_pattern_html(spec, output_path), [])

    def test_personnel_field_configuration_uses_card_tabs_and_dual_lists(self) -> None:
        spec = json.loads(
            (ROOT / "output/isc3-personnel-field-config.spec.json").read_text(
                encoding="utf-8"
            )
        )
        output_path = ROOT / "output/isc3-personnel-field-config.html"
        html = compile_pattern_page(spec, output_path)
        output_path.write_text(html, encoding="utf-8")
        page_config = extract_frozen_json(html, "PAGE_CONFIG")
        fixtures = extract_frozen_json(html, "PREVIEW_FIXTURES")

        self.assertEqual(
            [(tab["id"], tab["label"]) for tab in spec["table_tabs"]],
            [("personnel", "人员信息"), ("vehicle", "车辆信息")],
        )
        self.assertEqual(page_config["pattern_parameters"]["tab_style"], "card")
        self.assertEqual(page_config["framework"]["variant"], "regular-11")
        self.assertEqual(
            page_config["framework"]["navigation_layout"], "top-card-tabs"
        )
        self.assertEqual(
            page_config["framework"]["business_header"], "intro-actions"
        )
        self.assertTrue(page_config["framework"]["show_top_tabs"])
        self.assertEqual(
            page_config["framework"]["intro"],
            "字段配置：通过添加字段进行参数配置",
        )
        self.assertEqual(
            page_config["framework"]["global_actions"],
            ["导入字段", "导出字段"],
        )
        self.assertEqual(
            page_config["framework"]["global_overflow_actions"],
            ["采集设备参数配置"],
        )
        self.assertNotIn("generation_defaults_applied", page_config)
        self.assertEqual(
            page_config["field_configuration"]["description"],
            "字段配置：通过添加字段进行参数配置",
        )
        self.assertEqual(
            page_config["field_configuration"]["library_add_action"]["appearance"],
            "default",
        )
        self.assertEqual(
            page_config["field_configuration"]["add_action"]["appearance"],
            "primary",
        )
        self.assertEqual(
            page_config["field_configuration"]["dialog_area"], 400
        )
        self.assertEqual(
            [action["label"] for action in page_config["toolbar_actions"]],
            ["导入字段", "导出字段", "采集设备参数配置"],
        )
        self.assertEqual(
            [action["icon"] for action in page_config["toolbar_actions"][:2]],
            ["h-icon-import", "h-icon-export"],
        )
        self.assertEqual(
            [column["prop"] for column in page_config["columns"]],
            ["name", "key", "type", "source", "required", "order"],
        )
        self.assertEqual(
            page_config["personnel_page_policy"]["page"],
            "field_configuration",
        )
        self.assertEqual(len(fixtures["fieldLibraryByTab"]["personnel"]), 5)
        self.assertEqual(len(fixtures["fieldLibraryByTab"]["vehicle"]), 4)
        self.assertIn('class="field-configuration-workspace"', html)
        self.assertIn('class="field-configuration-library"', html)
        self.assertIn('class="field-configuration-configured"', html)
        self.assertIn('class="isc-framework-business-header"', html)
        self.assertIn('class="isc-framework-card-tabs"', html)
        self.assertIn('@click="frameworkGlobalAction(action)"', html)
        self.assertIn(':icon="frameworkGlobalActionIcon(action)"', html)
        self.assertIn("frameworkGlobalActionIcon: function", html)
        self.assertIn(
            'v-if="config.framework.global_overflow_actions.length"', html
        )
        self.assertIn(
            "grid-template-columns: var(--d2c-portal-context-sidebar-width, 256px)",
            html,
        )
        self.assertIn(
            "height: var(--d2c-portal-collection-toolbar-height, 64px)",
            html,
        )
        self.assertNotIn('class="field-configuration-toolbar"', html)
        self.assertIn(
            ':type="config.field_configuration.library_add_action.appearance"',
            html,
        )
        self.assertIn(
            ".field-configuration-panel__header > div > span { color: "
            "var(--h-color-text-tertiary); }",
            html,
        )
        self.assertNotIn(
            ".field-configuration-panel__header span { color: "
            "var(--h-color-text-tertiary); }",
            html,
        )
        self.assertNotIn("field-configuration-panel__add-action", html)
        self.assertIn(
            ':type="config.field_configuration.add_action.appearance"',
            html,
        )
        self.assertNotIn(
            '<el-button type="text" size="small" icon="h-icon-add" '
            '@click="openFieldEditor()">添加字段</el-button>',
            html,
        )
        self.assertIn("fieldLibraryAction: function", html)
        self.assertIn("saveFieldDefinition: function", html)
        self.assertIn("deleteFieldDefinition: function", html)
        self.assertIn("addConfiguredField: function", html)
        self.assertEqual(
            html.count(':area="config.field_configuration.dialog_area"'), 2
        )
        self.assertNotIn(':width="config.field_configuration', html)
        self.assertEqual(validate_pattern_html(spec, output_path), [])

        with tempfile.TemporaryDirectory() as directory:
            package_dir = Path(directory) / "field-config-package"
            package_dir.mkdir()
            logo_source = (output_path.parent / page_config["product_logo"]).resolve()
            logo_name = logo_source.name
            (package_dir / logo_name).write_bytes(logo_source.read_bytes())
            package_html = package_dir / output_path.name
            package_html.write_text(
                html.replace(
                    f'"product_logo": "{page_config["product_logo"]}"',
                    f'"product_logo": "./{logo_name}"',
                ),
                encoding="utf-8",
            )
            self.assertEqual(validate_pattern_html(spec, package_html), [])

        wrong_description = copy.deepcopy(spec)
        wrong_description["field_configuration"]["description"] = "字段配置"
        with self.assertRaisesRegex(PatternPageError, "description"):
            compile_pattern_page(wrong_description)

        wrong_library_button = copy.deepcopy(spec)
        wrong_library_button["field_configuration"]["library_add_action"][
            "appearance"
        ] = "primary"
        with self.assertRaisesRegex(PatternPageError, "library.add_action"):
            compile_pattern_page(wrong_library_button)

    def test_personnel_group_card_uses_isc_toolbar_before_hui_filter(self) -> None:
        spec = json.loads(
            (ROOT / "output/isc3-personnel-group-list.spec.json").read_text(
                encoding="utf-8"
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "isc3-personnel-group-list.html"
            html = compile_pattern_page(spec, output_path)
            output_path.write_text(html, encoding="utf-8")
            page_config = extract_frozen_json(html, "PAGE_CONFIG")

            self.assertEqual(spec["pattern_contract"], "card/text.json")
            self.assertEqual(
                spec["collection_toolbar_variant"],
                "actions-scoped-keyword",
            )
            self.assertEqual(
                page_config["collection_toolbar"]["variant"]["id"],
                "actions-scoped-keyword",
            )
            self.assertFalse(
                page_config["collection_toolbar"]["expanded_filter_box"]["visible"]
            )
            self.assertEqual(
                page_config["collection_toolbar"]["expanded_filter_box"]["field_keys"],
                [],
            )
            self.assertEqual(
                page_config["collection_toolbar"]["expanded_filter_box"]["field_count"],
                0,
            )
            self.assertFalse(
                page_config["collection_toolbar"]["initial_filter_expanded"]
            )
            self.assertEqual(
                page_config["pattern_family"],
                "hui.tpp.family.card-basic",
            )
            self.assertEqual(
                [(column["prop"], column["label"]) for column in page_config["columns"]],
                [
                    ("title", "分组名称"),
                    ("personCount", "人数"),
                    ("creator", "创建人员"),
                    ("createdAt", "创建时间"),
                ],
            )
            self.assertEqual(page_config["detail_drawer"]["title"], "分组详情")
            self.assertEqual(page_config["detail_drawer"]["section_title"], "基本信息")
            self.assertEqual(page_config["detail_drawer"]["component"], "el-drawer")
            self.assertEqual(page_config["detail_drawer"]["direction"], "rtl")
            self.assertEqual(page_config["detail_drawer"]["size"], "480px")
            self.assertTrue(page_config["detail_drawer"]["append_to_body"])
            self.assertEqual(
                [(field["key"], field["label"], field["control"]) for field in page_config["detail_drawer"]["fields"]],
                [
                    ("title", "分组名称", "input"),
                    ("groupCode", "分组编号", "input"),
                    ("groupType", "分组类型", "input"),
                    ("personCount", "人数", "input"),
                    ("permissionMode", "权限配置方式", "input"),
                    ("status", "启用状态", "input"),
                    ("creator", "创建人员", "input"),
                    ("createdAt", "创建时间", "input"),
                    ("description", "备注", "textarea"),
                ],
            )
            for row in spec["preview"]["rows"]:
                self.assertTrue(
                    {
                        "title",
                        "groupCode",
                        "groupType",
                        "personCount",
                        "permissionMode",
                        "status",
                        "creator",
                        "createdAt",
                        "description",
                    }.issubset(row)
                )
            self.assertNotIn("filter_placement", page_config["pattern_parameters"])
            self.assertIn(
                ':placeholder="collectionToolbarKeywordPlaceholder"', html
            )
            self.assertIn(
                'v-if="hasCollectionToolbarAdvancedFilters" class="isc-collection-toolbar__icon-button isc-collection-toolbar__filter-trigger"',
                html,
            )
            self.assertIn(
                'v-if="hasCollectionToolbar && hasCollectionToolbarAdvancedFilters && collectionToolbarExpanded"',
                html,
            )
            self.assertIn(
                "hasCollectionToolbarAdvancedFilters: function () { return this.collectionToolbarAdvancedFields.length > 0; }",
                html,
            )
            self.assertIn(
                "this.collectionToolbarView = this.config.page_kind === 'card' ? 'card' : 'list';",
                html,
            )
            self.assertIn(
                "this.config.page_kind === 'card' && this.hasCollectionToolbar && (this.config.columns || []).length > 0 && this.collectionToolbarView === 'list'",
                html,
            )
            self.assertIn(
                "@click=\"collectionToolbarView='list'\"",
                html,
            )
            self.assertIn(
                "@click=\"collectionToolbarView='card'\"",
                html,
            )
            self.assertIn(
                '<el-table-column v-for="column in config.columns"',
                html,
            )
            self.assertIn(
                '<div v-if="hasDetailDrawer" class="collection-detail-drawer-host" data-zone="detail.content" data-component="detail.details-pane">',
                html,
            )
            self.assertIn('<el-drawer :visible.sync="detailDrawerVisible"', html)
            self.assertIn('custom-class="collection-detail-drawer"', html)
            self.assertIn('<el-form class="collection-detail-drawer__form"', html)
            self.assertIn(
                '<el-form-item v-for="field in config.detail_drawer.fields"',
                html,
            )
            self.assertIn("field.control==='textarea'", html)
            self.assertNotIn("<el-descriptions", html)
            self.assertIn(
                "hasDetailDrawer: function () { return !!(this.config.detail_drawer && (this.config.detail_drawer.fields || []).length); }",
                html,
            )
            self.assertIn("this.detailDrawerVisible = true;", html)
            self.assertIn(
                "!this.hasTableDetailsPane && !this.hasDetailDrawer",
                html,
            )
            self.assertIn(
                ".collection-detail-drawer .el-drawer__body { padding: 24px; }",
                html,
            )
            self.assertEqual(
                page_config["collection_toolbar"]["shared_visual_style"][
                    "primary_color_state"
                ],
                "default",
            )
            self.assertEqual(
                page_config["collection_toolbar"]["shared_visual_style"][
                    "primary_color_token"
                ],
                "--h-color-brand",
            )
            self.assertIn(
                "var primaryColorToken=style.primary_color_token || '--h-color-brand';",
                html,
            )
            self.assertIn(
                "'--isc-collection-toolbar-primary':'var(' + primaryColorToken + ')'",
                html,
            )
            self.assertNotIn("#ca242f", html)
            self.assertEqual(
                page_config["collection_card"]["content_spacing"]["alignment"],
                "same-as-collection-table",
            )
            self.assertIn(
                "--d2c-portal-collection-card-content-margin: 0 16px !important;",
                html,
            )
            self.assertIn(
                ".isc-personnel-shell .collection-page:not(.is-table-page) .data-region {",
                html,
            )
            self.assertIn(
                "margin: var(--d2c-portal-collection-card-content-margin);",
                html,
            )
            self.assertIn("var hasAppliedFilters = Object.keys", html)
            self.assertEqual(validate_pattern_html(spec, output_path), [])

        extra_filter = copy.deepcopy(spec)
        extra_filter["filters"].append(
            {
                "key": "creator",
                "label": "创建人员",
                "kind": "input",
                "placeholder": "请输入创建人员",
            }
        )
        extra_filter_html = compile_pattern_page(extra_filter)
        extra_filter_config = extract_frozen_json(extra_filter_html, "PAGE_CONFIG")
        self.assertTrue(
            extra_filter_config["collection_toolbar"]["expanded_filter_box"]["visible"]
        )
        self.assertEqual(
            extra_filter_config["collection_toolbar"]["expanded_filter_box"]["field_keys"],
            ["creator"],
        )

        missing_variant = copy.deepcopy(spec)
        missing_variant.pop("collection_toolbar_variant")
        with self.assertRaisesRegex(
            PatternPageError, "必须从四类collection_toolbar_variant中显式选择"
        ):
            compile_pattern_page(missing_variant)

        hui_filter_conflict = copy.deepcopy(spec)
        hui_filter_conflict["pattern_contract"] = (
            "card/regular-filter-box-high-low.json"
        )
        with self.assertRaisesRegex(
            PatternPageError, "不能与HUI过滤型页面Variant同时使用"
        ):
            compile_pattern_page(hui_filter_conflict)

        wrong_left_region = copy.deepcopy(spec)
        wrong_left_region["collection_toolbar_variant"] = (
            "summary-scoped-keyword"
        )
        with self.assertRaisesRegex(PatternPageError, "左侧区域与页面内容不匹配"):
            compile_pattern_page(wrong_left_region)

        wrong_query_region = copy.deepcopy(spec)
        wrong_query_region["collection_toolbar_variant"] = (
            "actions-structured-query"
        )
        with self.assertRaisesRegex(PatternPageError, "仅关键词查询必须选择"):
            compile_pattern_page(wrong_query_region)

    def test_personnel_group_add_form_and_list_action_are_linked(self) -> None:
        list_spec = json.loads(
            (ROOT / "output/isc3-personnel-group-list.spec.json").read_text(
                encoding="utf-8"
            )
        )
        add_spec = json.loads(
            (ROOT / "output/isc3-personnel-group-add.spec.json").read_text(
                encoding="utf-8"
            )
        )
        add_action = next(
            action for action in list_spec["toolbar_actions"] if action["id"] == "add"
        )

        self.assertEqual(add_action["href"], "isc3-personnel-group-add.html")
        self.assertEqual(add_spec["pattern_contract"], "form/fixed-width-one-column.json")
        self.assertEqual(add_spec["framework"], {"variant": "regular-01"})
        self.assertEqual(add_spec["form_actions"], ["保存", "取消"])
        self.assertEqual(
            add_spec["form_return_href"],
            "isc3-personnel-group-list.html",
        )
        self.assertEqual(
            [field["key"] for field in add_spec["form_sections"][0]["fields"]],
            [
                "groupName",
                "groupCode",
                "groupType",
                "permissionMode",
                "enabled",
                "description",
            ],
        )
        self.assertTrue(add_spec["form_sections"][0]["fields"][0]["required"])
        self.assertTrue(add_spec["form_sections"][0]["fields"][1]["required"])
        self.assertTrue(add_spec["form_sections"][0]["fields"][2]["readonly"])
        self.assertTrue(add_spec["form_sections"][0]["fields"][3]["readonly"])
        self.assertEqual(
            add_spec["preview"]["formModel"]["permissionMode"],
            "按人员分组配置权限",
        )

        with tempfile.TemporaryDirectory() as directory:
            list_output = Path(directory) / "isc3-personnel-group-list.html"
            add_output = Path(directory) / "isc3-personnel-group-add.html"
            list_html = compile_pattern_page(list_spec, list_output)
            add_html = compile_pattern_page(add_spec, add_output)
            list_output.write_text(list_html, encoding="utf-8")
            add_output.write_text(add_html, encoding="utf-8")
            list_config = extract_frozen_json(list_html, "PAGE_CONFIG")
            add_config = extract_frozen_json(add_html, "PAGE_CONFIG")

            self.assertEqual(
                next(
                    action["href"]
                    for action in list_config["toolbar_actions"]
                    if action["id"] == "add"
                ),
                "isc3-personnel-group-add.html",
            )
            self.assertEqual(add_config["pattern_family"], "hui.tpp.family.form-basic")
            self.assertEqual(add_config["framework"]["variant"], "regular-01")
            self.assertFalse(add_config["framework"]["show_intro"])
            self.assertEqual(add_config["form_actions"], ["保存", "取消"])
            self.assertIn(
                "'is-one-column':config.pattern_parameters && config.pattern_parameters.columns === 1",
                add_html,
            )
            self.assertIn(
                ".isc-personnel-shell .form-area.is-one-column .form-area__footer { justify-content: center; padding-left: 12px; }",
                add_html,
            )
            self.assertIn('class="permission-form"', add_html)
            self.assertIn(
                'v-for="(action,index) in config.form_actions"',
                add_html,
            )
            self.assertIn('@click="formAction(action)"', add_html)
            self.assertIn(
                "if (action && action.href) window.location.href = action.href;",
                list_html,
            )
            self.assertIn(
                "if (this.config.form_return_href) window.location.href = this.config.form_return_href;",
                add_html,
            )
            self.assertEqual(validate_pattern_html(list_spec, list_output), [])
            self.assertEqual(validate_pattern_html(add_spec, add_output), [])

    def test_add_person_form_consumes_personnel_product_knowledge(self) -> None:
        spec = json.loads(
            (ROOT / "tests/generation/add-person-form.json").read_text(
                encoding="utf-8"
            )
        )
        html = compile_pattern_page(spec)
        page_config = extract_frozen_json(html, "PAGE_CONFIG")
        policy = page_config["personnel_page_policy"]

        self.assertEqual(policy["knowledge_id"], "isc-3.0.0.personnel-management")
        self.assertEqual(policy["page"], "add_form")
        self.assertEqual(
            policy["shared"]["breadcrumb_tabs"]["item_inline_padding_px"], 12
        )
        self.assertFalse(
            policy["shared"]["breadcrumb_tabs"]["hover_text_underline"]
        )
        self.assertEqual(
            policy["contract"]["field_grid"]["default_columns_when_many_fields"],
            3,
        )
        self.assertTrue(policy["contract"]["anchor"]["outside_content_surface"])
        self.assertEqual(
            policy["contract"]["anchor"]["surface_context"],
            "page-gray-background",
        )
        self.assertEqual(spec["portal"]["active_icon_menu"], "personnel")
        self.assertEqual(spec["portal"]["active_side_menu"], "personnel-list")
        self.assertEqual(
            [
                field["key"]
                for section in spec["form_sections"]
                for field in section["fields"]
                if field.get("wide")
            ],
            [],
        )
        self.assertIn(
            "employeeNo",
            [field["key"] for field in spec["form_sections"][0]["fields"]],
        )

        wrong_span = copy.deepcopy(spec)
        wrong_span["form_sections"][1]["fields"][2]["wide"] = True
        with self.assertRaisesRegex(PatternPageError, "full_row_field_ids"):
            compile_pattern_page(wrong_span)

    def test_personnel_detail_uses_four_tabs_and_three_columns(self) -> None:
        spec = json.loads(
            (ROOT / "output/isc3-access-personnel-detail.spec.json").read_text(
                encoding="utf-8"
            )
        )
        output_path = ROOT / "output/isc3-access-personnel-detail.html"
        html = compile_pattern_page(spec, output_path)
        output_path.write_text(html, encoding="utf-8")
        page_config = extract_frozen_json(html, "PAGE_CONFIG")
        personnel_contract = json.loads(
            (
                ROOT
                / "design-systems/industry-products/general/products/isc/portal-shell/personnel-management.json"
            ).read_text(encoding="utf-8")
        )
        detail_contract = personnel_contract["personnel_management"]["pages"][
            "detail"
        ]
        anchor_contract = detail_contract["anchor"]

        self.assertEqual(
            spec["pattern_contract"],
            "details/resident-anchor-point.json",
        )
        self.assertEqual(
            page_config["pattern_family"],
            "hui.tpp.family.details-anchored",
        )
        self.assertEqual(
            page_config["pattern_parameters"]["anchor_mode"],
            "resident",
        )
        self.assertEqual(
            page_config["pattern_parameters"]["anchor_position"],
            "right",
        )
        self.assertEqual(
            page_config["pattern_parameters"]["text_align"],
            "left",
        )
        self.assertEqual(page_config["detail_columns"], 3)
        self.assertEqual(page_config["personnel_page_policy"]["page"], "detail")
        self.assertEqual(
            page_config["detail_page_policy"]["tab_bar"]["placement"],
            "breadcrumb",
        )
        self.assertEqual(
            page_config["detail_page_policy"]["anchor"]["content_gap_px"],
            24,
        )
        self.assertTrue(
            page_config["detail_page_policy"]["content_surface"][
                "cross_axis_stretch"
            ]
        )
        self.assertEqual(anchor_contract["reserved_width_px"], 180)
        self.assertEqual(anchor_contract["content_gap_px"], 24)
        self.assertEqual(anchor_contract["top_offset_px"], 48)
        self.assertEqual(anchor_contract["surface"], "transparent")
        self.assertEqual(
            [tab["label"] for tab in page_config["detail_tabs"]],
            ["基础信息", "凭证信息", "车辆信息", "人员通行权限"],
        )
        self.assertEqual(
            [section["title"] for section in page_config["detail_tabs"][0]["sections"]],
            ["个人信息", "证件信息", "联系信息", "关系人信息", "自定义信息"],
        )
        self.assertIn(
            'v-for="tab in config.detail_tabs"',
            html,
        )
        self.assertIn(
            '<div v-if="detailsTabsInBreadcrumb" class="page-breadcrumb__tabs"',
            html,
        )
        self.assertIn(
            'v-if="hasDetailsPageTabs && !detailsTabsInBreadcrumb" class="details-page-tabs"',
            html,
        )
        self.assertIn(
            "detailsTabsInBreadcrumb: function ()",
            html,
        )
        self.assertIn(
            'v-for="section in visibleDetailSections"',
            html,
        )
        self.assertIn(
            "'is-three-column':config.detail_columns===3",
            html,
        )
        self.assertIn(
            ".details-page.is-three-column .details-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
            html,
        )
        self.assertEqual(
            html.count(
                'class="details-anchor details-side" '
                'data-zone="navigation.detail-tabs" '
                'data-component="navigation.anchor-nav"'
            ),
            1,
        )
        self.assertIn(
            '<h-anchor :style="{ textAlign: config.pattern_parameters.text_align }" '
            ':affix="true" container=".details-page"><h-anchor-link '
            'v-for="section in visibleDetailSections"',
            html,
        )
        self.assertIn(
            ':href="\'#detail-section-\' + section.id" :title="section.title"',
            html,
        )
        self.assertIn(
            ':id="\'detail-section-\' + section.id"',
            html,
        )
        self.assertIn(
            ".details-anchor.details-side {\n"
            "      width: 180px; align-self: flex-start; margin-bottom: 0; "
            "padding: 48px 0 0; background: transparent;\n"
            "    }",
            html,
        )
        self.assertIn(
            ".details-page.is-three-column.is-flat .details-main { "
            "align-self: stretch; }",
            html,
        )
        self.assertNotIn(
            ".details-anchor { margin-bottom: 16px; padding: 0 24px; "
            "background: var(--h-color-bg-primary); }",
            html,
        )
        self.assertIn("人员通行权限", html)
        self.assertEqual(validate_pattern_html(spec, output_path), [])

    def test_isc_3_version_alias_automatically_selects_new_shell(self) -> None:
        spec = json.loads(
            (ROOT / "tests/generation/personnel-permission-form.json").read_text(
                encoding="utf-8"
            )
        )
        spec["product_version"] = "3.0"
        html = compile_pattern_page(spec, ROOT / "output/personnel-permission-form.html")
        self.assertIn('"product_shell_standard": "isc-3.0.0"', html)
        self.assertIn('class="isc-personnel-sidebar__scrollbar"', html)
        bundle = build_capability_bundle("general", "isc", "form", "3.0.0")
        self.assertEqual(bundle["selection"]["shell_standard"], "isc-3.0.0")
        framework = bundle["shell_capabilities"]["framework"]
        self.assertEqual(
            framework["model"],
            "unified-tree-with-independent-navigation-features",
        )
        self.assertEqual(
            [preset["id"] for preset in framework["verified_presets"]],
            ["single", "left-selector", "top-card-tabs"],
        )
        self.assertEqual(len(framework["variant_aliases"]), 12)
        self.assertEqual(
            framework["business_header_modes"],
            ["none", "intro", "intro-actions", "intro-actions-extra"],
        )
        toolbar = bundle["shell_capabilities"]["collection_toolbar"]
        self.assertEqual(
            toolbar["page_spec_field"], "collection_toolbar_variant"
        )
        self.assertEqual(toolbar["applies_to_page_kinds"], ["table", "card"])
        self.assertEqual(
            [variant["id"] for variant in toolbar["variants"]],
            [
                "actions-structured-query",
                "actions-scoped-keyword",
                "summary-structured-query",
                "summary-scoped-keyword",
            ],
        )
        personnel = bundle["shell_capabilities"]["personnel_management"]
        self.assertEqual(
            personnel["schema_version"], "isc-personnel-management.v1"
        )
        self.assertEqual(
            personnel["page_ids"],
            ["list", "add_form", "detail", "field_configuration"],
        )
        self.assertEqual(
            personnel["shared"]["operation_icons"]["style"], "linear"
        )


if __name__ == "__main__":
    unittest.main()
