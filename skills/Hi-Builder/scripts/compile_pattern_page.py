#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from core import (
    ContractError,
    load_json,
    load_product_context,
    validate_json_contract,
)
from renderer_registry import (
    contract_for_renderer,
    renderer_for_pattern_kind,
    template_for_renderer,
)
from semantic_registry import SemanticRegistryError, assert_semantic_html

ROOT = Path(__file__).resolve().parents[1]
HUI_ROOT = ROOT / "design-systems" / "HUI"
PAGE_PATTERN_ROOT = (
    ROOT
    / "design-systems"
    / "HUI"
    / "page-patterns"
    / "tpp"
    / "pages"
)
CARD_RUNTIME_CONTRACT = (
    ROOT
    / "design-systems"
    / "HUI"
    / "runtime-contracts"
    / "others"
    / "card.json"
)
COMPOSITION_REGISTRY = (
    HUI_ROOT / "page-patterns" / "tpp" / "mappings" / "composition.json"
)
FAMILY_PATTERN_ROOT = HUI_ROOT / "page-patterns" / "tpp" / "families"
ICON_CATALOG = HUI_ROOT / "icons" / "catalog.json"
FILTER_SEARCH_FORM_CONTRACT = (
    HUI_ROOT / "component-patterns" / "filter.search-form" / "contract.json"
)


class PatternPageError(ValueError):
    pass


def iter_icon_refs(value: Any, key: str = ""):
    if key == "icon" and isinstance(value, (str, dict)):
        yield value
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            yield from iter_icon_refs(child_value, child_key)
    elif isinstance(value, list):
        for child in value:
            yield from iter_icon_refs(child)


def icon_mode(icon: str | dict[str, Any]) -> str:
    return "font" if isinstance(icon, str) else icon.get("mode", "")


def classify_font_icon_style(
    icon_name: str, catalog: dict[str, Any]
) -> str:
    rule = catalog.get("font_style_classification", {})
    if (
        rule.get("method") != "name-suffix"
        or not isinstance(rule.get("filled_suffix"), str)
        or not rule.get("filled_suffix")
        or not isinstance(rule.get("filled_style"), str)
        or not isinstance(rule.get("default_style"), str)
    ):
        raise PatternPageError("HUI字体图标目录缺少有效的风格命名分类规则")
    if icon_name.endswith(rule["filled_suffix"]):
        return rule["filled_style"]
    return rule["default_style"]


def validate_icons(spec: dict[str, Any]) -> None:
    catalog = load_json(ICON_CATALOG)
    allowed = {
        "font": set(catalog.get("font", [])),
        "icon-v2": set(catalog.get("icon_v2", [])),
        "business-svg": set(catalog.get("business_svg", [])),
    }
    for icon in iter_icon_refs(spec):
        mode = icon_mode(icon)
        name = icon if isinstance(icon, str) else icon.get("name", "")
        if mode not in allowed:
            raise PatternPageError(f"未知图标模式: {mode}")
        if name not in allowed[mode]:
            raise PatternPageError(f"图标未在HUI目录登记: {mode}/{name}")
    common_icons = [
        item.get("icon")
        for item in spec.get("portal", {}).get("side_menus", [])
    ] + [
        action.get("icon") for action in spec.get("toolbar_actions", [])
    ]
    if any(icon is not None and not isinstance(icon, str) for icon in common_icons):
        raise PatternPageError("菜单和工具栏等普通图标必须使用HUI字体图标")


def load_pattern(relative: str) -> dict[str, Any]:
    path = (PAGE_PATTERN_ROOT / relative).resolve()
    if PAGE_PATTERN_ROOT.resolve() not in path.parents:
        raise PatternPageError(f"页面模式越界: {relative}")
    contract = load_json(path)
    if contract.get("schema_version") != "hui-page-variant.v1":
        raise PatternPageError(f"页面模式版本无效: {relative}")
    return contract


def resolve_collection_toolbar(
    spec: dict[str, Any], portal: dict[str, Any]
) -> dict[str, Any]:
    knowledge = portal.get("collection_toolbar", {})
    applies_to = knowledge.get("applies_to_page_kinds", [])
    strategy = knowledge.get("selection_strategy", {})
    variant_id = spec.get("collection_toolbar_variant")
    if not variant_id:
        signals = {
            "toolbar-actions-present": bool(spec.get("toolbar_actions")),
            "filters-present": bool(spec.get("filters")),
        }
        required_when = strategy.get("explicit_variant_required_when", [])
        if (
            spec.get("page_kind") in applies_to
            and required_when
            and all(signals.get(signal, False) for signal in required_when)
        ):
            raise PatternPageError(
                "ISC 3.0集合页包含操作和查询时，必须从四类collection_toolbar_variant中显式选择"
            )
        return {}
    if spec.get("page_kind") not in applies_to:
        raise PatternPageError(
            f"ISC集合工具栏不适用于页面类型: {spec.get('page_kind')}"
        )
    variants = knowledge.get("variants", [])
    variant = next(
        (item for item in variants if item.get("id") == variant_id),
        None,
    )
    if not variant:
        raise PatternPageError(f"ISC集合工具栏Variant未登记: {variant_id}")
    expected_left_region = (
        strategy.get("left_region_selection", {}).get(
            "toolbar_actions_present"
            if spec.get("toolbar_actions")
            else "toolbar_actions_absent"
        )
    )
    if expected_left_region and variant.get("left_region") != expected_left_region:
        raise PatternPageError(
            f"ISC集合工具栏左侧区域与页面内容不匹配: 应为{expected_left_region}"
        )
    filters = spec.get("filters", [])
    keyword_only = len(filters) == 1 and filters[0].get("key") == "keyword"
    expected_keyword_region = strategy.get("keyword_only_query_region")
    if (
        keyword_only
        and expected_keyword_region
        and variant.get("query_region") != expected_keyword_region
    ):
        raise PatternPageError(
            f"仅关键词查询必须选择{expected_keyword_region}工具栏区域"
        )
    region_ids = {
        variant.get("left_region"),
        variant.get("query_region"),
    }
    regions = {
        key: copy.deepcopy(value)
        for key, value in knowledge.get("regions", {}).items()
        if key in region_ids
    }
    query_region = regions.get(variant.get("query_region"), {})
    inline_filter_keys = {
        control["field_key"]
        for control in query_region.get("controls", [])
        if control.get("field_key")
    }
    advanced_filter_fields = [
        field for field in filters if field.get("key") not in inline_filter_keys
    ]
    expanded_filter_box = copy.deepcopy(
        knowledge.get("expanded_filter_box", {})
    )
    expanded_filter_box["field_keys"] = [
        field.get("key") for field in advanced_filter_fields
    ]
    expanded_filter_box["field_count"] = len(advanced_filter_fields)
    expanded_filter_box["visible"] = bool(advanced_filter_fields)
    return {
        "variant": copy.deepcopy(variant),
        "regions": regions,
        "shared_visual_style": copy.deepcopy(
            knowledge.get("shared_visual_style", {})
        ),
        "expanded_filter_box": expanded_filter_box,
        "initial_filter_expanded": bool(
            spec.get("collection_toolbar_filter_expanded", False)
            and advanced_filter_fields
        ),
    }


def resolve_personnel_page_policy(
    spec: dict[str, Any], portal: dict[str, Any], pattern: dict[str, Any]
) -> dict[str, Any]:
    knowledge = portal.get("personnel_management", {})
    pages = knowledge.get("pages", {})
    matches = [
        (page_id, page)
        for page_id, page in pages.items()
        if spec.get("id") in page.get("spec_ids", [])
    ]
    if not matches:
        return {}
    if len(matches) != 1:
        raise PatternPageError("人员管理PageSpec匹配到多个产品页面Composition")
    page_id, page = matches[0]

    def require_equal(actual: Any, expected: Any, label: str) -> None:
        if actual != expected:
            raise PatternPageError(
                f"人员管理{page_id}与产品知识不一致: {label} {actual!r} != {expected!r}"
            )

    require_equal(spec.get("page_kind"), page.get("page_kind"), "page_kind")
    require_equal(
        spec.get("pattern_contract"), page.get("pattern_contract"),
        "pattern_contract",
    )
    page_portal = page.get("portal", {})
    for portal_key in (
        "active_icon_menu", "active_side_menu", "show_context_sidebar"
    ):
        actual = spec.get("portal", {}).get(portal_key)
        if portal_key == "show_context_sidebar":
            actual = bool(actual)
        require_equal(actual, page_portal.get(portal_key), f"portal.{portal_key}")

    operation_icon_policy = knowledge.get("shared", {}).get(
        "operation_icons", {}
    )
    expected_icon_style = operation_icon_policy.get("style")
    icon_catalog = load_json(ICON_CATALOG)
    for action_group in operation_icon_policy.get("applies_to", []):
        for action in spec.get(action_group, []):
            icon = action.get("icon")
            if (
                isinstance(icon, str)
                and classify_font_icon_style(icon, icon_catalog)
                != expected_icon_style
            ):
                raise PatternPageError(
                    "人员管理操作图标必须使用"
                    f"{expected_icon_style}风格: {action_group}."
                    f"{action.get('id')}={icon}"
                )

    if page_id == "list":
        require_equal(
            spec.get("collection_toolbar_variant"),
            page.get("collection_toolbar_variant"),
            "collection_toolbar_variant",
        )
        require_equal(
            bool(spec.get("collection_toolbar_filter_expanded")),
            page.get("initial_filter_expanded"),
            "initial_filter_expanded",
        )
        require_equal(
            [item.get("key") for item in spec.get("filters", [])],
            page.get("filter_order"), "filter_order",
        )
        require_equal(
            [item.get("prop") for item in spec.get("columns", [])],
            page.get("column_order"), "column_order",
        )
        require_equal(
            [item.get("id") for item in spec.get("toolbar_actions", [])],
            page.get("toolbar_action_order"), "toolbar_action_order",
        )
        require_equal(
            [item.get("id") for item in spec.get("row_actions", [])],
            page.get("row_action_order"), "row_action_order",
        )
        toolbar_actions = {
            item.get("id"): item for item in spec.get("toolbar_actions", [])
        }
        for action_id, icon in page.get("toolbar_action_icons", {}).items():
            require_equal(
                toolbar_actions.get(action_id, {}).get("icon"), icon,
                f"toolbar_action_icons.{action_id}",
            )
        for action_id, label in page.get("toolbar_action_labels", {}).items():
            require_equal(
                toolbar_actions.get(action_id, {}).get("label"), label,
                f"toolbar_action_labels.{action_id}",
            )
        for action_id, icon in page.get("toolbar_action_icons", {}).items():
            require_equal(
                toolbar_actions.get(action_id, {}).get("icon"), icon,
                f"toolbar_action_icons.{action_id}",
            )
        require_equal(
            toolbar_actions.get("add", {}).get("href"), page.get("add_href"),
            "add_href",
        )
        require_equal(
            spec.get("row_detail_href"), page.get("row_detail_href"),
            "row_detail_href",
        )
    elif page_id == "add_form":
        tabs = spec.get("form_tabs", [])
        require_equal(
            [item.get("id") for item in tabs], page.get("tab_order"),
            "tab_order",
        )
        require_equal(
            [item.get("label") for item in tabs], page.get("tab_labels"),
            "tab_labels",
        )
        require_equal(
            {item.get("id"): item.get("section_ids", []) for item in tabs},
            page.get("tab_section_ids"), "tab_section_ids",
        )
        sections = spec.get("form_sections", [])
        require_equal(
            [item.get("id") for item in sections], page.get("section_order"),
            "section_order",
        )
        require_equal(
            {
                section.get("id"): [
                    field.get("key") for field in section.get("fields", [])
                ]
                for section in sections
            },
            page.get("field_order_by_section"), "field_order_by_section",
        )
        require_equal(
            [
                field.get("key")
                for section in sections
                for field in section.get("fields", [])
                if field.get("wide")
            ],
            page.get("field_grid", {}).get("full_row_field_ids", []),
            "full_row_field_ids",
        )
        parameters = pattern.get("parameters", {})
        require_equal(
            parameters.get("columns"),
            page.get("field_grid", {}).get("default_columns_when_many_fields"),
            "default_columns_when_many_fields",
        )
        require_equal(
            parameters.get("anchor_behavior"),
            page.get("anchor", {}).get("behavior"), "anchor.behavior",
        )
        for parameter, policy_key in (
            ("form_item_gap", "form_item_gap_px"),
            ("title_field_gap", "title_field_gap_px"),
            ("group_gap", "group_gap_px"),
        ):
            require_equal(
                parameters.get(parameter),
                f'{page.get("spacing", {}).get(policy_key)}px',
                f"spacing.{policy_key}",
            )
        require_equal(
            spec.get("form_actions"), page.get("action_order"), "action_order",
        )
        require_equal(
            spec.get("form_return_href"), page.get("return_href"), "return_href",
        )
    elif page_id == "detail":
        tabs = spec.get("detail_tabs", [])
        require_equal(
            [item.get("label") for item in tabs], page.get("tab_order"),
            "tab_order",
        )
        require_equal(
            {
                tab.get("label"): [
                    section.get("title") for section in tab.get("sections", [])
                ]
                for tab in tabs
            },
            page.get("section_order_by_tab"), "section_order_by_tab",
        )
        require_equal(
            spec.get("detail_columns"), page.get("description_columns"),
            "description_columns",
        )
    elif page_id == "field_configuration":
        require_equal(
            [item.get("id") for item in spec.get("table_tabs", [])],
            page.get("tab_order"), "tab_order",
        )
        require_equal(
            [item.get("label") for item in spec.get("table_tabs", [])],
            page.get("tab_labels"), "tab_labels",
        )
        field_configuration = spec.get("field_configuration", {})
        framework = spec.get("framework", {})
        framework_policy = page.get("framework", {})
        require_equal(
            framework.get("variant"), framework_policy.get("variant"),
            "framework.variant",
        )
        require_equal(
            framework.get("tabs"), spec.get("table_tabs"),
            "framework.tabs",
        )
        require_equal(
            framework.get("active_tab"), page.get("tab_order", [None])[0],
            "framework.active_tab",
        )
        require_equal(
            field_configuration.get("description"),
            page.get("description"), "description",
        )
        require_equal(
            framework.get("intro"), field_configuration.get("description"),
            "framework.intro",
        )
        require_equal(
            [item.get("id") for item in spec.get("toolbar_actions", [])],
            page.get("toolbar_action_order"), "toolbar_action_order",
        )
        toolbar_actions = {
            item.get("id"): item for item in spec.get("toolbar_actions", [])
        }
        for action_id, label in page.get("toolbar_action_labels", {}).items():
            require_equal(
                toolbar_actions.get(action_id, {}).get("label"), label,
                f"toolbar_action_labels.{action_id}",
            )
        require_equal(
            framework.get("global_actions"),
            [item.get("label") for item in spec.get("toolbar_actions", [])],
            "framework.global_actions",
        )
        require_equal(
            field_configuration.get("library_title"),
            page.get("library", {}).get("title"), "library.title",
        )
        require_equal(
            [item.get("id") for item in spec.get("row_actions", [])],
            page.get("library", {}).get("action_order"),
            "library.action_order",
        )
        require_equal(
            field_configuration.get("library_add_action"),
            page.get("library", {}).get("add_action"),
            "library.add_action",
        )
        require_equal(
            field_configuration.get("configured_title"),
            page.get("configured", {}).get("title"), "configured.title",
        )
        require_equal(
            field_configuration.get("add_action"),
            page.get("configured", {}).get("add_action"),
            "configured.add_action",
        )
        require_equal(
            [item.get("prop") for item in spec.get("columns", [])],
            page.get("configured", {}).get("column_order"),
            "configured.column_order",
        )

    return {
        "knowledge_id": "isc-3.0.0.personnel-management",
        "page": page_id,
        "shared": copy.deepcopy(knowledge.get("shared", {})),
        "contract": copy.deepcopy(page),
    }


def materialize_pattern_spec(spec: dict[str, Any]) -> dict[str, Any]:
    materialized = copy.deepcopy(spec)
    pattern_contract = materialized.get("pattern_contract")
    if not isinstance(pattern_contract, str):
        return materialized
    pattern = load_pattern(pattern_contract)
    if pattern.get("family") != "hui.tpp.family.table-tabs":
        return materialized
    if materialized.get("field_configuration"):
        return materialized
    family = load_json(FAMILY_PATTERN_ROOT / "table-tabs" / "contract.json")
    defaults_path = family.get("invariants", {}).get("generation_defaults")
    if not defaults_path:
        raise PatternPageError("table-tabs页面族缺少generation_defaults")
    defaults = load_json((FAMILY_PATTERN_ROOT / "table-tabs" / defaults_path).resolve())
    if defaults.get("schema_version") != "hui-pattern-demo-fixture.v1":
        raise PatternPageError("table-tabs典型演示数据合同版本无效")
    config_defaults = defaults.get("config", {})
    for key in ("filters", "toolbar_actions", "columns", "page_size"):
        if not materialized.get(key):
            materialized[key] = copy.deepcopy(config_defaults[key])
    if not materialized.get("table_tabs"):
        materialized["table_tabs"] = copy.deepcopy(config_defaults["table_tabs"])
    if pattern.get("parameters", {}).get("tree"):
        if not materialized.get("tree_nodes"):
            materialized["tree_nodes"] = copy.deepcopy(config_defaults["tree_nodes"])
        if not materialized.get("default_tree_node"):
            materialized["default_tree_node"] = config_defaults["default_tree_node"]
    preview = materialized.setdefault("preview", {})
    if not preview.get("tableTabRows") and materialized["table_tabs"] == config_defaults["table_tabs"]:
        preview["tableTabRows"] = copy.deepcopy(defaults["preview"]["tableTabRows"])
    return materialized


def resolve_knowledge_composition(
    spec: dict[str, Any], primary: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    composition = spec.get("knowledge_composition")
    if not composition:
        return None
    registry = load_json(COMPOSITION_REGISTRY)
    page_kind = spec["page_kind"]
    if page_kind not in registry.get("supported_page_kinds", []):
        raise PatternPageError(f"当前页面类型不支持TPP知识组合: {page_kind}")
    secondary_path = composition["secondary_pattern_contract"]
    if secondary_path == spec["pattern_contract"]:
        raise PatternPageError("主Variant与辅助Variant不得相同")
    secondary = load_pattern(secondary_path)
    expected_family_prefix = f"hui.tpp.family.{page_kind}-"
    if not primary.get("family", "").startswith(expected_family_prefix):
        raise PatternPageError("主Variant与page_kind不一致")
    if not secondary.get("family", "").startswith(expected_family_prefix):
        raise PatternPageError("辅助Variant必须与主Variant属于相同page_kind")
    primary_parameters = primary.get("parameters", {})
    secondary_parameters = secondary.get("parameters", {})
    for key in registry.get("exclusive_parameter_keys", []):
        if (
            key in primary_parameters
            and key in secondary_parameters
            and primary_parameters[key] != secondary_parameters[key]
        ):
            raise PatternPageError(
                "TPP组合参数冲突: "
                f"{key}={primary_parameters[key]} vs {secondary_parameters[key]}"
            )
    rule = registry.get("secondary_exports", {}).get(secondary_path)
    if not rule:
        raise PatternPageError(f"辅助Variant未登记可组合能力: {secondary_path}")
    renderer = renderer_for_pattern_kind(page_kind)
    if rule.get("page_kind") != page_kind or rule.get("renderer") != renderer:
        raise PatternPageError("辅助Variant与主页面Renderer不兼容")
    expected = composition["expected_contribution"]
    if expected != rule.get("contribution"):
        raise PatternPageError(
            f"辅助能力声明不一致: {expected} != {rule.get('contribution')}"
        )
    missing_spec = [
        key for key in rule.get("required_spec_fields", []) if not spec.get(key)
    ]
    if missing_spec:
        raise PatternPageError(
            f"辅助Variant缺少PageSpec变量: {', '.join(missing_spec)}"
        )
    preview = spec.get("preview", {})
    missing_preview = [
        key for key in rule.get("required_preview_fields", []) if key not in preview
    ]
    if missing_preview:
        raise PatternPageError(
            f"辅助Variant缺少preview变量: {', '.join(missing_preview)}"
        )
    return secondary, rule


def validate_spec(spec: dict[str, Any]) -> list[dict[str, Any]]:
    schema = load_json(ROOT / "schemas" / "pattern-page-spec.schema.json")
    schema_errors = validate_json_contract(spec, schema)
    if schema_errors:
        raise PatternPageError("\n".join(schema_errors))
    if spec.get("schema_version") != "pattern-page-spec.v2":
        raise PatternPageError("schema_version必须是pattern-page-spec.v2")
    validate_icons(spec)
    page_kind = spec.get("page_kind")
    try:
        renderer_for_pattern_kind(page_kind)
    except ValueError as exc:
        raise PatternPageError(str(exc)) from exc
    for key in (
        "industry", "product", "id", "title", "pattern_contract", "portal"
    ):
        if not spec.get(key):
            raise PatternPageError(f"缺少必要字段: {key}")
    side_menu_ids = set()
    for item in spec["portal"].get("side_menus", []):
        side_menu_ids.add(item.get("id"))
        side_menu_ids.update(
            child.get("id") for child in item.get("children", [])
        )
    if spec["portal"].get("active_side_menu") not in side_menu_ids:
        raise PatternPageError("active_side_menu必须存在于side_menus")
    patterns = [load_pattern(spec["pattern_contract"])]
    if (
        patterns[0].get("family") == "hui.tpp.family.table-details-pane"
        and not spec.get("detail_tabs")
    ):
        raise PatternPageError("详情栏表格页必须声明detail_tabs")
    composition_resolution = resolve_knowledge_composition(spec, patterns[0])
    if composition_resolution:
        patterns.append(composition_resolution[0])
    if page_kind == "details":
        family = patterns[0].get("family", "")
        if not family.startswith("hui.tpp.family.details-"):
            raise PatternPageError(
                "details页面必须引用已验证的HUI详情页Variant合同"
            )
    alternate = spec.get("alternate_pattern_contract")
    if page_kind == "switch":
        if not alternate:
            raise PatternPageError("switch页面必须声明alternate_pattern_contract")
        patterns.append(load_pattern(alternate))
    elif alternate:
        raise PatternPageError("只有switch页面允许alternate_pattern_contract")
    if page_kind == "card-tabs":
        tabs = spec.get("card_tabs")
        if not isinstance(tabs, list) or len(tabs) < 2:
            raise PatternPageError("card-tabs页面至少声明两个card_tabs")
        card_usage = load_json(CARD_RUNTIME_CONTRACT).get("d2c_usage", {})
        profiles = card_usage.get("visual_profiles", {})
        tab_ids = set()
        for tab in tabs:
            for key in ("id", "label", "card_profile", "pattern_contract"):
                if key not in tab:
                    raise PatternPageError(f"card_tabs缺少字段: {key}")
            if tab["id"] in tab_ids:
                raise PatternPageError(f"card_tabs存在重复id: {tab['id']}")
            tab_ids.add(tab["id"])
            if tab["card_profile"] not in profiles:
                raise PatternPageError(
                    f"未知Card视觉Profile: {tab['card_profile']}"
                )
            pattern = load_pattern(tab["pattern_contract"])
            if (
                pattern.get("parameters", {}).get("collection_presentation")
                != tab["card_profile"]
            ):
                raise PatternPageError(
                    f"Card Profile与页面契约不一致: {tab['id']}"
                )
            patterns.append(pattern)
    if (
        page_kind == "table"
        and patterns[0].get("family") == "hui.tpp.family.table-tabs"
    ):
        tabs = spec.get("table_tabs")
        if not isinstance(tabs, list) or len(tabs) < 2:
            raise PatternPageError("标签页表格页至少声明两个table_tabs")
        tab_ids = [tab.get("id") for tab in tabs]
        if len(tab_ids) != len(set(tab_ids)):
            raise PatternPageError("table_tabs存在重复id")
        if set(tab_ids) != set(spec.get("preview", {}).get("tableTabRows", {})):
            raise PatternPageError("table_tabs必须与preview.tableTabRows一一对应")
        for group_name in ("filters", "toolbar_actions", "row_actions", "columns"):
            for item in spec.get(group_name, []):
                unknown_tabs = set(item.get("tabs", [])) - set(tab_ids)
                if unknown_tabs:
                    raise PatternPageError(
                        f"{group_name}引用未知table_tabs: {', '.join(sorted(unknown_tabs))}"
                    )
        for action in spec.get("toolbar_actions", []):
            if not action.get("requires_selection"):
                continue
            missing = [
                key
                for key in ("selectable_key", "stale_key", "confirm")
                if not action.get(key)
            ]
            if missing:
                raise PatternPageError(
                    "批量选择动作缺少配置: " + ", ".join(missing)
                )
        if patterns[0].get("parameters", {}).get("tree"):
            if not spec.get("tree_nodes") or not spec.get("default_tree_node"):
                raise PatternPageError("带树控件的标签页表格必须声明tree_nodes和default_tree_node")
    forbidden = ("px", "color", "font-size", "gap", "width", "height", "align")
    serialized = json.dumps(spec, ensure_ascii=False).lower()
    for word in forbidden:
        if f'"{word}"' in serialized:
            raise PatternPageError(f"Pattern PageSpec不得声明视觉字段: {word}")
    return patterns


def css_variables(values: dict[str, Any], prefix: str = "") -> str:
    lines = []
    for name, value in values.items():
        key = name if name.startswith("--") else f"--d2c-{prefix}{name}"
        lines.append(f"      {key}: {value} !important;")
    return "\n".join(lines)


def pattern_css_variables(pattern: dict[str, Any]) -> str:
    regions = pattern.get("geometry", {}).get("key_regions", {})
    values: dict[str, Any] = {}
    content = regions.get("content", {})
    form = regions.get("form", {})
    footer = regions.get("footer", {})
    content_head = regions.get("content_head", {})
    group_title = regions.get("group_title", {})
    detail_tabs = regions.get("tabs", {})
    if content.get("padding"):
        values["form-content-padding"] = content["padding"]
    if form.get("rect", {}).get("width"):
        values["form-width"] = f'{form["rect"]["width"]}px'
    if footer.get("rect", {}).get("height"):
        values["form-footer-height"] = f'{footer["rect"]["height"]}px'
    if content_head.get("rect", {}).get("height"):
        values["form-content-head-height"] = f'{content_head["rect"]["height"]}px'
    if content_head.get("padding"):
        values["form-content-head-padding"] = content_head["padding"]
    for key in ("margin", "padding", "border"):
        if group_title.get(key):
            values[f"form-group-title-{key}"] = group_title[key]
    if detail_tabs.get("rect", {}).get("width"):
        values["table-details-width"] = f'{detail_tabs["rect"]["width"]}px'
    details_spacing = pattern.get("parameters", {}).get("details_spacing", {})
    for key, value in details_spacing.items():
        values[f"table-details-{key.replace('_', '-')}"] = value
    details_content_inline_padding = pattern.get("parameters", {}).get(
        "content_inline_padding"
    )
    if details_content_inline_padding:
        values["details-content-inline-padding"] = details_content_inline_padding
    steps_form_gap = pattern.get("parameters", {}).get("steps_form_gap")
    if steps_form_gap:
        values["form-steps-form-gap"] = steps_form_gap
    for parameter in ("form_item_gap", "title_field_gap", "group_gap"):
        value = pattern.get("parameters", {}).get(parameter)
        if value:
            values[f"form-{parameter.replace('_', '-')}"] = value
    return css_variables(values, "page-")


def renderer_css_variables(renderer: str) -> str:
    return css_variables(
        contract_for_renderer(renderer).get("layout_roles", {}), "renderer-"
    )


def replace_once(source: str, marker: str, value: str) -> str:
    if source.count(marker) != 1:
        raise PatternPageError(f"模板哨兵必须唯一: {marker}")
    return source.replace(marker, value, 1)


INCLUDE_PATTERN = re.compile(r"<!--\s*@include\s+([^\s]+)\s*-->")


def load_template(path: Path, stack: tuple[Path, ...] = ()) -> str:
    path = path.resolve()
    if path in stack:
        chain = " -> ".join(item.as_posix() for item in (*stack, path))
        raise PatternPageError(f"模板include循环引用: {chain}")
    if not path.is_file():
        raise PatternPageError(f"模板不存在: {path}")
    source = path.read_text(encoding="utf-8")

    def expand(match: re.Match[str]) -> str:
        return load_template(path.parent / match.group(1), (*stack, path))

    return INCLUDE_PATTERN.sub(expand, source)


def resolve_renderer_template(renderer: str, product: str, root: Path = ROOT) -> tuple[Path, str]:
    default_path = root / template_for_renderer(renderer)
    renderer_name = default_path.name
    product_path = root / "assets" / "templates" / "products" / product / "renderers" / renderer_name
    if product_path.is_file():
        return product_path, f"product:{product}"
    return default_path, "HUI"


def renderer_styles(renderer: str, product: str) -> str:
    sources = []
    for relative in contract_for_renderer(renderer).get("styles", []):
        hui_path = ROOT / relative
        product_path = (
            ROOT / "assets" / "templates" / "products" / product
            / "styles" / hui_path.name
        )
        sources.append((product_path if product_path.is_file() else hui_path).read_text(encoding="utf-8"))
    return "\n".join(sources)


def product_shell_assets(
    product: str, template_bundle: str | None = None, product_contract_root: Path | None = None
) -> tuple[str, str, str, str]:
    product_template_root = ROOT / "assets" / "templates" / "products" / product
    source_suffix = ""
    if template_bundle:
        if product_contract_root is None:
            raise PatternPageError("Portal Shell标准缺少产品根目录")
        product_template_root = (product_contract_root / template_bundle).resolve()
        if ROOT.resolve() not in product_template_root.parents:
            raise PatternPageError("Portal Shell模板路径越界")
        source_suffix = "/" + product_template_root.name
    hui_root = ROOT / "assets" / "templates" / "HUI"
    requested = {
        "styles": (product_template_root / "portal.css", hui_root / "styles/portal.css") if template_bundle else (product_template_root / "styles/portal.css", hui_root / "styles/portal.css"),
        "start": (product_template_root / "portal-start.html", hui_root / "shells/portal-start.html") if template_bundle else (product_template_root / "shells/portal-start.html", hui_root / "shells/portal-start.html"),
        "end": (product_template_root / "portal-end.html", hui_root / "shells/portal-end.html") if template_bundle else (product_template_root / "shells/portal-end.html", hui_root / "shells/portal-end.html"),
    }
    selected = {
        key: product_path if product_path.is_file() else hui_path
        for key, (product_path, hui_path) in requested.items()
    }
    source = f"product:{product}{source_suffix}" if all(path == requested[key][0] for key, path in selected.items()) else "HUI"
    return (
        selected["styles"].read_text(encoding="utf-8"),
        load_template(selected["start"]),
        load_template(selected["end"]),
        source,
    )


def hui_fallback_context(spec: dict[str, Any], reason: str) -> dict[str, Any]:
    manifest = load_json(HUI_ROOT / "manifest.json")
    token_contract = load_json(HUI_ROOT / manifest["theme"]["token_contract"])
    return {
        "manifest": manifest,
        "profile": {
            "brand": {
                "name": "HUI 通用管理平台",
                "logo": "../assets/imgs/hui-logo.png",
            }
        },
        "product_tokens": {
            "schema_version": "product-theme-tokens.v1",
            "id": "hui.fallback.theme",
            "extends": token_contract["id"],
            "overrides": {},
        },
        "portal_shell": {
            "geometry_roles": {},
            "breakpoints": {},
            "portal": {"top_menus": [spec["portal"]["active_top_menu"]]},
        },
        "token_contract": token_contract,
        "resolution": {
            "matched": False,
            "level": "hui-fallback",
            "reason": reason,
        },
    }


def product_logo_for_output(logo: str, output_path: Path | None) -> str:
    if output_path is None:
        return logo
    logo_source = (ROOT / "output" / logo).resolve()
    if ROOT.resolve() not in logo_source.parents or not logo_source.is_file():
        raise PatternPageError(f"产品Logo本地资源不存在: {logo}")
    return Path(os.path.relpath(logo_source, output_path.resolve().parent)).as_posix()


def portal_motion_roles(portal_shell: dict[str, Any]) -> dict[str, Any]:
    motion = portal_shell.get("interaction", {}).get("motion", {})
    sidebar = motion.get("sidebar_collapse_expand", {})
    toggle_icons = motion.get("toggle_icons", {})
    menu_item = motion.get("submenu_item_state", {})
    if not sidebar:
        return {}
    return {
        "portal-sidebar-motion-duration": sidebar["duration"],
        "portal-sidebar-motion-timing-function": sidebar["timing_function"],
        "portal-sidebar-motion-delay": sidebar["delay"],
        "portal-sidebar-toggle-icon-motion-duration": toggle_icons["duration"],
        "portal-sidebar-toggle-icon-motion-timing-function": toggle_icons[
            "timing_function"
        ],
        "portal-sidebar-menu-item-motion-duration": menu_item["duration"],
        "portal-sidebar-menu-item-motion-timing-function": menu_item[
            "timing_function"
        ],
    }


def normalize_framework_selection(
    requested: dict[str, Any], catalog: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    semantic_keys = (
        "show_left_selector",
        "show_top_tabs",
        "business_header",
    )
    provided_semantic_keys = [key for key in semantic_keys if key in requested]
    if provided_semantic_keys and len(provided_semantic_keys) != len(semantic_keys):
        raise PatternPageError(
            "framework语义选择必须同时提供show_left_selector、"
            "show_top_tabs和business_header"
        )

    variant_id = requested.get("variant")
    variant = next(
        (
            item
            for item in catalog.get("variants", [])
            if item.get("id") == variant_id
        ),
        None,
    )
    if variant_id and variant is None:
        raise PatternPageError(f"产品Portal Shell未登记框架变量: {variant_id}")

    if provided_semantic_keys:
        semantic_selection = {
            key: requested[key]
            for key in semantic_keys
        }
        if variant is not None:
            variant_selection = {
                key: variant[key]
                for key in semantic_keys
            }
            if semantic_selection != variant_selection:
                raise PatternPageError(
                    f"framework语义选择与兼容变量{variant_id}不一致"
                )
        else:
            variant = next(
                (
                    item
                    for item in catalog.get("variants", [])
                    if all(
                        item.get(key) == semantic_selection[key]
                        for key in semantic_keys
                    )
                ),
                None,
            )
            if variant is None:
                raise PatternPageError(
                    "当前ISC 3.0.0 regular目录未覆盖该框架开关组合"
                )
            variant_id = variant["id"]

    if variant is None:
        raise PatternPageError("framework必须提供variant或完整语义选择")

    preset_id = variant["navigation_layout"]
    preset = catalog["navigation_presets"][preset_id]
    header = catalog["business_headers"][variant["business_header"]]
    return variant, preset, header


def resolve_framework_config(
    spec: dict[str, Any], portal_shell: dict[str, Any]
) -> dict[str, Any] | None:
    catalog = portal_shell.get("framework_variants")
    requested = copy.deepcopy(spec.get("framework"))
    if not catalog:
        if requested:
            raise PatternPageError("当前产品Portal Shell未登记框架变量")
        return None

    requested = requested or {"variant": "regular-01"}
    variant, layout, header = normalize_framework_selection(requested, catalog)
    variant_id = variant["id"]
    layout_id = variant["navigation_layout"]
    header_id = variant["business_header"]
    show_left_selector = variant["show_left_selector"]
    show_top_tabs = variant["show_top_tabs"]
    if header.get("show_intro") and not requested.get("intro"):
        raise PatternPageError(f"{variant_id}需要framework.intro")

    action_count = header.get("global_secondary_action_count", 0)
    actions = requested.get("global_actions", [])
    if len(actions) < action_count:
        raise PatternPageError(
            f"{variant_id}需要{action_count}个framework.global_actions"
        )
    if header.get("show_extra_info") and not requested.get("extra_info"):
        raise PatternPageError(f"{variant_id}需要framework.extra_info")
    overflow_actions = (
        actions[action_count:]
        if header.get("global_secondary_action_overflow") == "dropdown"
        else []
    )

    tabs = requested.get("tabs", [])
    if show_top_tabs and not tabs:
        raise PatternPageError(f"{variant_id}需要framework.tabs")
    active_tab = requested.get("active_tab")
    if tabs and active_tab not in {item.get("id") for item in tabs}:
        raise PatternPageError("framework.active_tab必须存在于framework.tabs")

    selector_nodes = requested.get("selector_nodes", [])
    selector_active_node = requested.get("selector_active_node")
    if show_left_selector:
        if not selector_nodes:
            raise PatternPageError(f"{variant_id}需要framework.selector_nodes")
        if not selector_active_node:
            raise PatternPageError(f"{variant_id}需要framework.selector_active_node")

    variant_menu = []
    if requested.get("show_variant_menu"):
        layout_icons = {
            "single": "h-icon-menu",
            "left-selector": "h-icon-folder",
            "top-card-tabs": "h-icon-liveview",
        }
        variant_menu = [
            {
                "id": item["id"],
                "label": item["name"],
                "icon": layout_icons[item["navigation_layout"]],
                "href": f'{item["id"]}.html',
            }
            for item in catalog["variants"]
        ]

    return {
        **requested,
        "variant": variant_id,
        "name": variant["name"],
        "navigation_layout": layout_id,
        "show_left_selector": show_left_selector,
        "show_top_tabs": show_top_tabs,
        "business_header": header_id,
        "show_intro": header.get("show_intro", False),
        "global_actions": actions[:action_count],
        "global_overflow_actions": overflow_actions,
        "show_extra_info": header.get("show_extra_info", False),
        "show_extra_info_separator": header.get(
            "show_extra_info_separator", False
        ),
        "data_layout_region": layout["data_layout_region"],
        "variant_menu": variant_menu,
    }


def compile_pattern_page(
    spec: dict[str, Any], output_path: Path | None = None
) -> str:
    requested_spec = copy.deepcopy(spec)
    spec = materialize_pattern_spec(spec)
    patterns = validate_spec(spec)
    try:
        context = load_product_context(
            spec["industry"], spec["product"], spec.get("shell_standard"),
            spec.get("product_version")
        )
    except (ContractError, KeyError) as exc:
        context = hui_fallback_context(spec, str(exc))
    manifest = context["manifest"]
    profile = context["profile"]
    product_tokens = context["product_tokens"]
    portal = context["portal_shell"]
    if spec["portal"]["active_top_menu"] not in portal["portal"]["top_menus"]:
        raise PatternPageError("active_top_menu必须存在于产品Portal Shell的top_menus")
    personnel_page_policy = resolve_personnel_page_policy(
        spec, portal, patterns[0]
    )
    renderer = renderer_for_pattern_kind(spec["page_kind"])
    template_path, renderer_source = resolve_renderer_template(renderer, spec["product"])
    source = load_template(template_path)
    shell_styles, shell_start, shell_end, shell_source = product_shell_assets(
        spec["product"],
        context.get("portal_shell_template_bundle"),
        context.get("product_root"),
    )
    resources = manifest["resources"]
    source = replace_once(source, "__HUI_CSS__", resources["css"])
    source = replace_once(source, "__VUE_JS__", resources["vue"])
    source = replace_once(source, "__HUI_JS__", resources["hui"])
    show_context_sidebar = spec["portal"].get("show_context_sidebar", False)
    context_tree_icon = portal["portal"].get("context_menu", {}).get("tree_icon")
    uses_icon_v2 = any(
        icon_mode(icon) in {"icon-v2", "business-svg"}
        for icon in iter_icon_refs(spec)
    ) or (
        show_context_sidebar
        and context_tree_icon
        and icon_mode(context_tree_icon) in {"icon-v2", "business-svg"}
    )
    icon_v2_runtime = ""
    if uses_icon_v2:
        svg_icons = manifest["optional_resources"]["svg_icons"]
        icon_v2_runtime = (
            f'  <script src="{svg_icons["url"]}"></script>\n'
            f"  <script>Vue.use(window['{svg_icons['global']}']);</script>"
        )
    source = replace_once(source, "<!-- __ICON_V2_RUNTIME__ -->", icon_v2_runtime)
    source = replace_once(
        source,
        "/* __PRODUCT_TOKENS__ */",
        css_variables(product_tokens["overrides"]),
    )
    source = replace_once(
        source,
        "/* __PORTAL_GEOMETRY__ */",
        css_variables({
            **portal["geometry_roles"],
            **portal_motion_roles(portal),
            **{
                f"portal-{name}": value
                for name, value in portal.get("colors", {}).items()
            },
        }),
    )
    source = replace_once(
        source,
        "/* __PAGE_PATTERN_GEOMETRY__ */",
        "\n".join((
            pattern_css_variables(patterns[0]),
            renderer_css_variables(renderer),
        )),
    )
    source = replace_once(
        source,
        "/* __RENDERER_STYLES__ */",
        renderer_styles(renderer, spec["product"]),
    )
    source = replace_once(source, "/* __PRODUCT_SHELL_STYLES__ */", shell_styles)
    source = replace_once(source, "<!-- __PRODUCT_SHELL_START__ -->", shell_start)
    source = replace_once(source, "<!-- __PRODUCT_SHELL_END__ -->", shell_end)
    runtime_spec = dict(spec)
    default_active_icon_menu = next(
        (
            item.get("id")
            for item in portal["portal"].get("icon_menus", [])
            if item.get("active")
        ),
        None,
    )
    runtime_spec["portal"] = {
        **portal["portal"],
        **spec["portal"],
        "active_icon_menu": spec["portal"].get(
            "active_icon_menu", default_active_icon_menu
        ),
        "show_context_sidebar": show_context_sidebar,
        "context_menu": portal["portal"].get("context_menu", {}) if show_context_sidebar else {},
        "context_toolbar_actions": portal["portal"].get("context_menu", {}).get("toolbar_actions", []) if show_context_sidebar else [],
    }
    runtime_spec["framework"] = resolve_framework_config(spec, portal)
    runtime_spec["collection_table"] = {
        "striped": True,
        **portal.get("collection_table", {}),
    }
    runtime_spec["collection_card"] = copy.deepcopy(
        portal.get("collection_card", {})
    )
    detail_drawer = spec.get("detail_drawer")
    if detail_drawer:
        drawer_policy = portal.get("collection_detail_drawer", {})
        runtime_spec["detail_drawer"] = {
            "component": drawer_policy.get("component", "el-drawer"),
            "direction": drawer_policy.get("direction", "rtl"),
            "size": drawer_policy.get("default_size", "480px"),
            "append_to_body": drawer_policy.get("append_to_body", True),
            "modal": drawer_policy.get("modal", True),
            "wrapper_closable": drawer_policy.get("wrapper_closable", True),
            **copy.deepcopy(detail_drawer),
        }
    runtime_spec["collection_toolbar"] = resolve_collection_toolbar(spec, portal)
    toolbar_strategy = portal.get("collection_toolbar", {}).get(
        "selection_strategy", {}
    )
    if (
        runtime_spec["collection_toolbar"]
        and toolbar_strategy.get("hui_filter_variant_conflict") == "reject"
        and any(
            key in patterns[0].get("parameters", {})
            for key in ("filter_placement", "trigger", "collapse_mode")
        )
    ):
        raise PatternPageError(
            "ISC集合工具栏不能与HUI过滤型页面Variant同时使用，请选择基础集合Variant"
        )
    personnel_detail = (
        personnel_page_policy.get("contract", {})
        if personnel_page_policy.get("page") == "detail"
        else {}
    )
    runtime_spec["detail_page_policy"] = {
        "tab_bar": copy.deepcopy(personnel_detail.get("tab_bar", {})),
        "content_surface": copy.deepcopy(
            personnel_detail.get("content_surface", {})
        ),
        "anchor": {
            "content_gap_px": personnel_detail.get("anchor", {}).get(
                "content_gap_px"
            )
        },
    }
    runtime_spec["personnel_page_policy"] = personnel_page_policy
    field_configuration_policy = (
        personnel_page_policy.get("contract", {})
        if personnel_page_policy.get("page") == "field_configuration"
        else {}
    )
    dialog_width_px = field_configuration_policy.get("layout", {}).get(
        "dialog_width_px"
    )
    if runtime_spec.get("field_configuration") and dialog_width_px:
        runtime_spec["field_configuration"] = {
            **runtime_spec["field_configuration"],
            "dialog_area": dialog_width_px,
        }
    preview_fixtures = runtime_spec.pop("preview")
    runtime_spec["renderer"] = renderer
    runtime_spec["renderer_source"] = renderer_source
    runtime_spec["product_shell_source"] = shell_source
    runtime_spec["product_shell_standard"] = context.get("portal_shell_standard")
    runtime_spec["design_system_resolution"] = context.get("resolution", {"matched": True, "level": "product"})
    runtime_spec["product_name"] = profile["brand"]["name"]
    runtime_spec["product_logo"] = product_logo_for_output(
        profile["brand"]["logo"], output_path
    )
    runtime_spec["top_menus"] = portal["portal"]["top_menus"]
    runtime_spec["pattern_ids"] = [pattern["id"] for pattern in patterns]
    runtime_spec["pattern_geometry"] = [pattern["geometry"] for pattern in patterns]
    runtime_spec["pattern_family"] = patterns[0]["family"]
    product_page_kind_policy = (
        context.get("product", {})
        .get("page_kind_policies", {})
        .get(spec["page_kind"], {})
    )
    runtime_spec["pattern_parameters"] = {
        **patterns[0].get("parameters", {}),
        **product_page_kind_policy,
    }
    runtime_spec["product_page_kind_policy"] = product_page_kind_policy
    defaulted_fields = [
        key
        for key in (
            "filters", "toolbar_actions", "columns", "table_tabs",
            "tree_nodes", "default_tree_node", "page_size",
        )
        if not requested_spec.get(key) and spec.get(key)
    ]
    if not requested_spec.get("preview", {}).get("tableTabRows") and spec.get("preview", {}).get("tableTabRows"):
        defaulted_fields.append("preview.tableTabRows")
    if defaulted_fields:
        runtime_spec["generation_defaults_applied"] = {
            "profile": "table-tabs-default",
            "fields": defaulted_fields,
        }
    if spec["page_kind"] in {"card", "card-tabs"}:
        runtime_spec["card_status_tag_semantics"] = load_json(
            CARD_RUNTIME_CONTRACT
        )["d2c_usage"]["status_tag_semantics"]
    composition_resolution = resolve_knowledge_composition(spec, patterns[0])
    if composition_resolution:
        secondary, rule = composition_resolution
        runtime_spec["composition_resolution"] = {
            "status": "verified",
            "primary_pattern_id": patterns[0]["id"],
            "secondary_pattern_id": secondary["id"],
            "contribution": rule["contribution"],
        }
        runtime_spec["auxiliary_pattern_family"] = secondary["family"]
        runtime_spec["auxiliary_pattern_parameters"] = {
            key: secondary.get("parameters", {}).get(key)
            for key in rule.get("merge_parameter_keys", [])
            if key in secondary.get("parameters", {})
        }
        runtime_spec["pattern_parameters"].update(
            runtime_spec["auxiliary_pattern_parameters"]
        )
    if (
        spec.get("filters")
        and runtime_spec["pattern_parameters"].get("trigger") != "realtime"
    ):
        runtime_spec["filter_search_form_behavior"] = load_json(
            FILTER_SEARCH_FORM_CONTRACT
        )["fixed_behavior"]
    if spec["page_kind"] == "card-tabs":
        card_usage = load_json(CARD_RUNTIME_CONTRACT)["d2c_usage"]
        enriched_tabs = []
        used_profiles = {}
        for tab, pattern in zip(spec["card_tabs"], patterns[1:]):
            regions = pattern["geometry"]["key_regions"]
            repeat = pattern["geometry"]["repeat_layout"]
            enriched = dict(tab)
            enriched["pattern_id"] = pattern["id"]
            enriched["layout"] = {
                "columns": repeat["columns_in_first_row"],
                "collection_gap": f'{repeat["horizontal_gap"]}px',
                "body_height": f'{regions["card_body"]["rect"]["height"]}px',
            }
            if tab["card_profile"] != "vehicle-card":
                enriched["layout"].update(
                    {
                        "card_height": f'{regions["card"]["rect"]["height"]}px',
                        "header_height": f'{regions["card_header"]["rect"]["height"]}px',
                    }
                )
            enriched_tabs.append(enriched)
            used_profiles[tab["card_profile"]] = card_usage["visual_profiles"][
                tab["card_profile"]
            ]
        runtime_spec["card_tabs"] = enriched_tabs
        runtime_spec["card_visual_profiles"] = used_profiles
        runtime_spec["card_tab_style"] = patterns[0]["parameters"]["tab_style"]
    page_config = runtime_spec
    source = replace_once(
        source,
        "/* __PAGE_CONFIG__ */ {}",
        json.dumps(page_config, ensure_ascii=False, indent=10),
    )
    source = replace_once(
        source,
        "/* __PREVIEW_FIXTURES__ */ {}",
        json.dumps(preview_fixtures, ensure_ascii=False, indent=10),
    )
    try:
        assert_semantic_html(source)
    except SemanticRegistryError as exc:
        raise PatternPageError(str(exc)) from exc
    return source


def main() -> int:
    parser = argparse.ArgumentParser(description="编译HUI TPP页面族Pattern PageSpec")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        spec = load_json(args.spec.resolve())
        output = args.out.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        html = compile_pattern_page(spec, output)
        output.write_text(html, encoding="utf-8")
    except (PatternPageError, ContractError, SemanticRegistryError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
