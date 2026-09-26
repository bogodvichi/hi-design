#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from renderer_registry import (
    PAGE_RENDERER_IDS,
    contract_for_renderer,
    renderer_for_hui_pattern,
)

ROOT = Path(__file__).resolve().parents[1]
DESIGN_SYSTEMS_ROOT = ROOT / "design-systems"


class ContractError(ValueError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ContractError(f"缺少知识文件: {path.relative_to(ROOT)}") from exc
    except json.JSONDecodeError as exc:
        raise ContractError(f"JSON格式错误: {path.relative_to(ROOT)}: {exc}") from exc


def resolve_declared_file(root: Path, relative: str, label: str) -> Path:
    if not isinstance(relative, str) or not relative:
        raise ContractError(f"{label}必须声明非空相对路径")
    root = root.resolve()
    path = (root / relative).resolve()
    if root != path.parent and root not in path.parents:
        raise ContractError(f"{label}路径越界: {relative}")
    if not path.is_file():
        raise ContractError(f"{label}不存在: {path.relative_to(ROOT)}")
    return path


def resolve_hui_page_pattern(page_type: str) -> dict[str, Any]:
    catalog = load_json(
        DESIGN_SYSTEMS_ROOT / "HUI" / "page-patterns" / "catalog.json"
    )
    normalized = page_type.lower()
    if normalized in catalog["patterns"]:
        selected = normalized
    else:
        selected = catalog["default"]
        selected_score = -1
        for pattern_id, entry in catalog["patterns"].items():
            matches = [
                keyword
                for keyword in entry.get("match", [])
                if keyword.lower() in normalized
            ]
            score = max((len(keyword) for keyword in matches), default=-1)
            if score > selected_score:
                selected = pattern_id
                selected_score = score
    entry = catalog["patterns"][selected]
    contract = load_json(DESIGN_SYSTEMS_ROOT / entry["contract"])
    return {
        "id": selected,
        "contract": contract,
        "path": entry["contract"],
    }


def resolve_design_system(
    industry: str, product: str, page_type: str
) -> dict[str, Any]:
    product_root = (
        DESIGN_SYSTEMS_ROOT / "industry-products" / industry / "products" / product
    )
    hui_pattern = resolve_hui_page_pattern(page_type)
    product_path = product_root / "product.json"
    if product_path.is_file():
        product_contract = load_json(product_path)
        declared = {
            "profile_path": product_contract.get("profile"),
            "theme_path": product_contract.get("theme"),
            "portal_shell_path": product_contract.get("portal_shell"),
        }
    else:
        product_contract = None
        declared = {}
    pages = product_contract.get("pages", {}) if isinstance(product_contract, dict) else {}
    page_manifest_relative = pages.get(page_type) if isinstance(pages, dict) else None
    has_product_page = (
        isinstance(product_contract, dict)
        and isinstance(page_manifest_relative, str)
        and bool(page_manifest_relative)
        and all(isinstance(value, str) and value for value in declared.values())
    )
    if has_product_page:
        declared_paths = {
            name: resolve_declared_file(product_root, relative, name)
            for name, relative in declared.items()
        }
        page_manifest_path = resolve_declared_file(
            product_root, page_manifest_relative, "product.pages"
        )
        page_root = page_manifest_path.parent
        page_manifest = load_json(page_manifest_path)
        if page_manifest.get("page_type") != page_type:
            raise ContractError(
                f"页面清单page_type不一致: {page_manifest.get('page_type')} != {page_type}"
            )
        page_files = {
            "capabilities_path": resolve_declared_file(
                page_root, page_manifest.get("capability"), "page.capability"
            ),
            "payload_schema_path": resolve_declared_file(
                page_root, page_manifest.get("payload_schema"), "page.payload_schema"
            ),
            "composition_path": resolve_declared_file(
                page_root, page_manifest.get("composition"), "page.composition"
            ),
            "fixture_path": resolve_declared_file(
                page_root, page_manifest.get("fixture"), "page.fixture"
            ),
            "golden_path": resolve_declared_file(
                page_root, page_manifest.get("golden"), "page.golden"
            ),
        }
        return {
            "resolution_level": "product-page",
            "matched": True,
            "industry": industry,
            "product": product,
            "page_type": page_type,
            "product_root": product_root,
            "page_root": page_root,
            "product_contract": product_contract,
            "page_manifest": page_manifest,
            "page_manifest_path": page_manifest_path,
            **declared_paths,
            **page_files,
            "hui_page_pattern": hui_pattern,
        }
    return {
        "resolution_level": "hui-fallback",
        "matched": False,
        "industry": industry,
        "product": product,
        "page_type": page_type,
        "hui_page_pattern": hui_pattern,
    }


def _load_hui_component_patterns(page_pattern: dict[str, Any]) -> list[dict[str, Any]]:
    contracts: list[dict[str, Any]] = []
    for component_id in page_pattern.get("component_patterns", []):
        contracts.append(
            load_json(
                DESIGN_SYSTEMS_ROOT
                / "HUI"
                / "component-patterns"
                / component_id
                / "contract.json"
            )
        )
    return contracts


def validate_composition_template_ownership(composition: dict[str, Any]) -> None:
    if "template" in composition:
        raise ContractError(
            "产品页面Composition不得声明template，模板由Renderer Registry选择"
        )


def load_context(spec: dict[str, Any]) -> dict[str, Any]:
    industry = spec.get("industry")
    product = spec.get("product")
    page_type = spec.get("page_type")
    product_version = spec.get("product_version")
    if not all(isinstance(value, str) and value for value in (industry, product, page_type)):
        raise ContractError("PageSpec必须包含industry、product和page_type")
    resolution = resolve_design_system(industry, product, page_type)
    if not resolution["matched"]:
        pattern = resolution["hui_page_pattern"]["contract"]["id"]
        raise ContractError(
            f"未匹配到{industry}/{product}/{page_type}产品页面知识；"
            f"能力检索已回退到{pattern}，但编译具体业务页仍需产品Composition"
        )
    product_root = resolution["product_root"]
    page_root = resolution["page_root"]
    profile = load_json(resolution["profile_path"])
    portal_shell = load_json(resolution["portal_shell_path"])
    resolved_shell_standard = None
    if product_version:
        version_context = load_product_context(
            industry, product, product_version=product_version
        )
        portal_shell = version_context["portal_shell"]
        resolved_shell_standard = version_context["portal_shell_standard"]
    product_tokens = load_json(resolution["theme_path"])
    composition = load_json(resolution["composition_path"])
    validate_composition_template_ownership(composition)
    fixture = load_json(resolution["fixture_path"])
    capabilities = load_json(resolution["capabilities_path"])
    if capabilities.get("spec_schema") != resolution["page_manifest"].get("payload_schema"):
        raise ContractError("Capability与页面清单引用的payload Schema不一致")
    payload_schema = load_json(resolution["payload_schema_path"])
    page_pattern = resolution["hui_page_pattern"]["contract"]
    expected_parent = page_pattern["id"]
    if composition.get("extends") != expected_parent:
        raise ContractError(
            f"产品页面Composition必须继承匹配的HUI页面模式: "
            f"{composition.get('extends')} != {expected_parent}"
        )
    if fixture.get("page_type") != page_type or not isinstance(fixture.get("values"), dict):
        raise ContractError("页面Fixture必须声明匹配的page_type和values对象")
    geometry_roles: dict[str, Any] = {}
    geometry_roles.update(page_pattern.get("geometry_roles", {}))
    for component_pattern in _load_hui_component_patterns(page_pattern):
        geometry_roles.update(component_pattern.get("geometry_roles", {}))
    geometry_roles.update(portal_shell.get("geometry_roles", {}))
    geometry_roles.update(composition.get("geometry_roles", {}))
    profile["geometry_roles"] = geometry_roles
    profile["breakpoints"] = portal_shell["breakpoints"]
    profile["portal"] = portal_shell["portal"]
    hui_root = DESIGN_SYSTEMS_ROOT / "HUI"
    manifest = load_json(hui_root / "manifest.json")
    token_contract = load_json(hui_root / manifest["theme"]["token_contract"])
    validate_product_tokens(product_tokens, token_contract)
    runtime_contracts = load_json(
        hui_root / manifest["runtime_contracts"]["index"]
    )["entries"]
    return {
        "manifest": manifest,
        "runtime_contracts": runtime_contracts,
        "profile": profile,
        "product_tokens": product_tokens,
        "token_contract": token_contract,
        "capabilities": capabilities,
        "payload_schema": payload_schema,
        "composition": composition,
        "fixture": fixture["values"],
        "golden": load_json(resolution["golden_path"]),
        "page_pattern": page_pattern,
        "resolution": resolution,
    }


def validate_product_tokens(
    product_tokens: dict[str, Any], token_contract: dict[str, Any]
) -> None:
    if product_tokens.get("schema_version") != "product-theme-tokens.v1":
        raise ContractError("产品tokens schema_version无效")
    if product_tokens.get("extends") != token_contract.get("id"):
        raise ContractError(
            "产品tokens必须继承HUI token合同: "
            f"{product_tokens.get('extends')} != {token_contract.get('id')}"
        )
    overrides = product_tokens.get("overrides")
    if not isinstance(overrides, dict):
        raise ContractError("产品tokens.overrides必须是对象")
    allowed = token_contract.get("tokens", {})
    unknown = sorted(set(overrides) - set(allowed))
    if unknown:
        raise ContractError(f"产品tokens包含HUI未登记变量: {unknown}")
    forbidden = sorted(
        name
        for name in overrides
        if not allowed[name].get("product_override")
    )
    if forbidden:
        raise ContractError(f"产品tokens禁止覆盖变量: {forbidden}")
    invalid = sorted(
        name
        for name, value in overrides.items()
        if not isinstance(value, str) or not value.strip()
    )
    if invalid:
        raise ContractError(f"产品token值必须是非空字符串: {invalid}")


def validate_personnel_management_knowledge(
    portal_shell: dict[str, Any]
) -> None:
    knowledge = portal_shell.get("personnel_management")
    if knowledge is None:
        return
    if knowledge.get("schema_version") != "isc-personnel-management.v1":
        raise ContractError("人员管理知识库schema_version无效")
    pages = knowledge.get("pages")
    if not isinstance(pages, dict) or set(pages) != {
        "list", "add_form", "detail", "field_configuration"
    }:
        raise ContractError(
            "人员管理知识库必须登记list、add_form、detail和field_configuration"
        )
    spec_ids: list[str] = []
    for page_id, page in pages.items():
        if not page.get("page_kind") or not page.get("pattern_contract"):
            raise ContractError(f"人员管理{page_id}缺少页面类型或HUI页面合同")
        page_portal = page.get("portal")
        if not isinstance(page_portal, dict) or not all(
            key in page_portal
            for key in (
                "active_icon_menu", "active_side_menu", "show_context_sidebar"
            )
        ):
            raise ContractError(f"人员管理{page_id}缺少页面导航Composition")
        ids = page.get("spec_ids")
        if not isinstance(ids, list) or not ids or not all(
            isinstance(item, str) and item for item in ids
        ):
            raise ContractError(f"人员管理{page_id}.spec_ids无效")
        spec_ids.extend(ids)
    if len(spec_ids) != len(set(spec_ids)):
        raise ContractError("人员管理知识库存在重复PageSpec id")
    tabs = knowledge.get("shared", {}).get("breadcrumb_tabs", {})
    inline_padding = tabs.get("item_inline_padding_px")
    indicator_extension = tabs.get("active_indicator_total_extension_px")
    if (
        not isinstance(inline_padding, int)
        or not isinstance(indicator_extension, int)
        or indicator_extension != inline_padding * 2
    ):
        raise ContractError("人员管理Tab指示器总延伸量必须等于两侧内边距之和")
    if tabs.get("hover_text_underline") is not False:
        raise ContractError("人员管理Tab悬浮态必须关闭文本下划线")
    if tabs.get("active_indicator_visible") is not True:
        raise ContractError("人员管理Tab激活指示器必须保留")
    operation_icons = knowledge.get("shared", {}).get("operation_icons", {})
    if operation_icons.get("style") != "linear":
        raise ContractError("人员管理操作图标必须使用线性风格")
    if (
        operation_icons.get("classification_ref")
        != "hui-icon-catalog.v1#/font_style_classification"
    ):
        raise ContractError("人员管理操作图标必须引用HUI字体图标风格分类规则")
    if operation_icons.get("applies_to") != ["toolbar_actions", "row_actions"]:
        raise ContractError("人员管理操作图标风格必须覆盖工具栏和行操作")


def load_product_context(
    industry: str,
    product: str,
    shell_standard: str | None = None,
    product_version: str | None = None,
) -> dict[str, Any]:
    product_root = (
        DESIGN_SYSTEMS_ROOT / "industry-products" / industry / "products" / product
    )
    product_contract = load_json(product_root / "product.json")
    profile = load_json(resolve_declared_file(
        product_root, product_contract.get("profile"), "product.profile"
    ))
    product_tokens = load_json(resolve_declared_file(
        product_root, product_contract.get("theme"), "product.theme"
    ))
    portal_shell_relative = product_contract.get("portal_shell")
    portal_shell_template_bundle = None
    resolved_shell_standard = shell_standard
    standards = product_contract.get("portal_shell_standards", {})
    if not resolved_shell_standard and product_version and isinstance(standards, dict):
        matches = [
            standard_id
            for standard_id, definition in standards.items()
            if isinstance(definition, dict)
            and not definition.get("alias_of")
            and product_version in definition.get("version_aliases", [])
        ]
        if len(matches) != 1:
            raise ContractError(
                f"产品版本未唯一匹配Portal Shell标准: {product_version}"
            )
        resolved_shell_standard = matches[0]
    if resolved_shell_standard:
        standard = standards.get(resolved_shell_standard) if isinstance(standards, dict) else None
        if not isinstance(standard, dict):
            raise ContractError(f"产品未登记Portal Shell标准: {resolved_shell_standard}")
        portal_shell_relative = standard.get("contract")
        portal_shell_template_bundle = standard.get("template_bundle")
    portal_shell = load_json(resolve_declared_file(
        product_root, portal_shell_relative, "product.portal_shell"
    ))
    validate_personnel_management_knowledge(portal_shell)
    if portal_shell.get("personnel_management"):
        personnel_entry = product_contract.get("knowledge", {}).get(
            "isc-3.0.0.personnel-management", {}
        )
        if (
            personnel_entry.get("contract") != portal_shell_relative
            or personnel_entry.get("json_pointer") != "/personnel_management"
            or personnel_entry.get("page_ids")
            != ["list", "add_form", "detail", "field_configuration"]
        ):
            raise ContractError("ISC 3.0人员管理知识未在产品入口正确登记")
    hui_root = DESIGN_SYSTEMS_ROOT / "HUI"
    manifest = load_json(hui_root / "manifest.json")
    token_contract = load_json(hui_root / manifest["theme"]["token_contract"])
    validate_product_tokens(product_tokens, token_contract)
    return {
        "product_root": product_root,
        "product": product_contract,
        "profile": profile,
        "product_tokens": product_tokens,
        "portal_shell": portal_shell,
        "portal_shell_standard": resolved_shell_standard,
        "portal_shell_template_bundle": portal_shell_template_bundle,
        "manifest": manifest,
        "token_contract": token_contract,
    }


def _load_business_field_catalogs(industry: str) -> dict[str, dict[str, Any]]:
    catalog = load_json(DESIGN_SYSTEMS_ROOT / "catalog.json")
    common_path = catalog["HUI"]["common_domain"]["field_catalog"]
    common = load_json(DESIGN_SYSTEMS_ROOT / common_path)
    fields = {
        field_id: {**definition, "source_scope": "HUI"}
        for field_id, definition in common.get("fields", {}).items()
    }
    industry_root = DESIGN_SYSTEMS_ROOT / "industry-products" / industry
    industry_contract_path = industry_root / "industry.json"
    if not industry_contract_path.is_file():
        return fields
    industry_contract = load_json(industry_contract_path)
    relative = industry_contract.get("domain_fields")
    if not relative:
        return fields
    industry_fields = load_json(resolve_declared_file(
        industry_root, relative, "industry.domain_fields"
    ))
    overlap = sorted(set(fields) & set(industry_fields.get("fields", {})))
    if overlap:
        raise ContractError(f"行业字段不得覆盖HUI通用字段: {overlap}")
    fields.update({
        field_id: {**definition, "source_scope": "industry"}
        for field_id, definition in industry_fields.get("fields", {}).items()
    })
    return fields


def _shell_capability_summary(portal_shell: dict[str, Any]) -> dict[str, Any]:
    portal = portal_shell.get("portal", {})
    summary: dict[str, Any] = {
        "id": portal_shell["id"],
        "top_menus": portal.get("top_menus", []),
        "side_menu_ids": [
            item["id"] for item in portal.get("side_menus", [])
        ],
    }
    catalog = portal_shell.get("framework_variants")
    if catalog:
        summary["framework"] = {
            "model": "unified-tree-with-independent-navigation-features",
            "feature_switches": catalog["unified_tree"]["feature_switches"],
            "combination_status": catalog["unified_tree"]["combination_status"],
            "business_header_modes": list(catalog["business_headers"]),
            "verified_presets": [
                {
                    "id": preset_id,
                    "show_left_selector": preset["show_left_selector"],
                    "show_top_tabs": preset["show_top_tabs"],
                }
                for preset_id, preset in catalog["navigation_presets"].items()
            ],
            "variant_aliases": [
                {
                    "id": variant["id"],
                    "show_left_selector": variant["show_left_selector"],
                    "show_top_tabs": variant["show_top_tabs"],
                    "business_header": variant["business_header"],
                }
                for variant in catalog["variants"]
            ],
            "input_requirements": {
                "left_selector": ["selector_nodes", "selector_active_node"],
                "top_tabs": ["tabs", "active_tab"],
                "business_header": {
                    "intro": ["intro"],
                    "intro-actions": ["intro", "global_actions"],
                    "intro-actions-extra": [
                        "intro", "global_actions", "extra_info"
                    ],
                },
            },
        }
    toolbar = portal_shell.get("collection_toolbar")
    if toolbar:
        summary["collection_toolbar"] = {
            "page_spec_field": "collection_toolbar_variant",
            "applies_to_page_kinds": toolbar.get("applies_to_page_kinds", []),
            "selection_strategy": toolbar.get("selection_strategy", {}),
            "variants": [
                {
                    "id": variant["id"],
                    "left_region": variant["left_region"],
                    "query_region": variant["query_region"],
                }
                for variant in toolbar.get("variants", [])
            ],
        }
    personnel = portal_shell.get("personnel_management")
    if personnel:
        summary["personnel_management"] = {
            "schema_version": personnel.get("schema_version"),
            "page_ids": list(personnel.get("pages", {})),
            "shared": personnel.get("shared", {}),
        }
    return summary


def build_capability_bundle(
    industry: str, product: str, page_type: str, product_version: str | None = None
) -> dict[str, Any]:
    resolution = resolve_design_system(industry, product, page_type)
    page_pattern = resolution["hui_page_pattern"]["contract"]
    if not resolution["matched"]:
        try:
            product_context = load_product_context(
                industry, product, product_version=product_version
            )
        except ContractError:
            product_context = None
        try:
            renderer = renderer_for_hui_pattern(page_pattern["id"])
        except ValueError:
            renderer = None
        variants = []
        if renderer:
            family_path = (
                DESIGN_SYSTEMS_ROOT / resolution["hui_page_pattern"]["path"]
            ).resolve()
            pages_root = (
                DESIGN_SYSTEMS_ROOT
                / "HUI"
                / "page-patterns"
                / "tpp"
                / "pages"
            ).resolve()
            for variant in page_pattern.get("variants", []):
                contract_path = (family_path.parent / variant["contract"]).resolve()
                if pages_root not in contract_path.parents:
                    raise ContractError(
                        f"HUI页面族Variant越界: {variant['contract']}"
                    )
                variants.append({
                    "id": variant["id"],
                    "name": variant["name"],
                    "pattern_contract": str(contract_path.relative_to(pages_root)),
                })
        can_compile = bool(renderer and product_context and variants)
        renderer_contract = contract_for_renderer(renderer) if renderer else {}
        portal_shell = product_context["portal_shell"] if product_context else {}
        portal = portal_shell.get("portal", {})
        return {
            "schema_version": "capability-bundle.v1",
            "resolution_level": resolution["resolution_level"],
            "matched": False,
            "can_compile": can_compile,
            "selection": {
                "industry": industry,
                "product": product,
                "product_version": product_version,
                "shell_standard": (
                    product_context.get("portal_shell_standard")
                    if product_context else None
                ),
                "product_name": (
                    product_context["profile"]["brand"]["name"]
                    if product_context else None
                ),
                "page_intent": page_type,
                "page_pattern": page_pattern["id"],
                "compile_route": "hui-pattern-fallback" if can_compile else None,
                "renderer": renderer,
                "input_contract": (
                    "pattern-page-spec.v2" if can_compile else None
                ),
            },
            "allowed_zone_ids": renderer_contract.get("allowed_zone_ids", []),
            "page_region_roles": page_pattern.get("zones", []),
            "allowed_component_pattern_ids": renderer_contract.get(
                "allowed_component_pattern_ids",
                page_pattern.get("component_patterns", []),
            ),
            "business_fields": [],
            "business_actions": [],
            "extension_kinds": [],
            "shell_capabilities": (
                _shell_capability_summary(portal_shell)
                if product_context else None
            ),
            "runtime_features": ["hui-vue", "cdn-preview"],
            "pattern_variants": variants,
            "knowledge_gaps": [] if can_compile else ["product-page-composition-or-hui-renderer"],
        }

    profile = load_json(resolution["profile_path"])
    portal_shell = load_json(resolution["portal_shell_path"])
    resolved_shell_standard = None
    if product_version:
        version_context = load_product_context(
            industry, product, product_version=product_version
        )
        portal_shell = version_context["portal_shell"]
        resolved_shell_standard = version_context["portal_shell_standard"]
    capabilities = load_json(resolution["capabilities_path"])
    composition = load_json(resolution["composition_path"])
    validate_composition_template_ownership(composition)
    field_catalog = _load_business_field_catalogs(industry)
    semantic_fields = capabilities.get("semantic_fields", {})
    business_fields = []
    for page_field_id, semantic_id in semantic_fields.items():
        if semantic_id not in field_catalog:
            raise ContractError(f"页面字段引用未登记语义: {semantic_id}")
        business_fields.append({
            "id": page_field_id,
            "semantic_id": semantic_id,
            **field_catalog[semantic_id],
        })
    allowed = capabilities["allowed"]
    business_actions = list(dict.fromkeys(
        allowed.get("toolbar_actions", []) + allowed.get("row_actions", [])
    ))
    component_ids = list(dict.fromkeys(
        component_id
        for component_ids in composition.get("zones", {}).values()
        for component_id in component_ids
    ))
    portal = portal_shell.get("portal", {})
    return {
        "schema_version": "capability-bundle.v1",
        "resolution_level": resolution["resolution_level"],
        "matched": True,
        "can_compile": True,
        "selection": {
            "industry": industry,
            "product": product,
            "product_version": product_version,
            "shell_standard": resolved_shell_standard,
            "product_name": profile["brand"]["name"],
            "page_intent": page_type,
            "page_pattern": page_pattern["id"],
            "compile_route": "product-composition",
            "renderer": composition["renderer"],
            "input_contract": "page-spec.v2",
        },
        "allowed_zone_ids": list(composition.get("zones", {})),
        "page_region_roles": page_pattern.get("zones", []),
        "allowed_component_pattern_ids": component_ids,
        "business_fields": business_fields,
        "business_actions": business_actions,
        "extension_kinds": allowed.get("extension_kinds", []),
        "shell_capabilities": _shell_capability_summary(portal_shell),
        "runtime_features": ["hui-vue", "cdn-preview"],
        "page_options": capabilities,
        "knowledge_gaps": [],
    }


def _matches_schema_type(value: Any, expected: str) -> bool:
    checks = {
        "object": lambda item: isinstance(item, dict),
        "array": lambda item: isinstance(item, list),
        "string": lambda item: isinstance(item, str),
        "boolean": lambda item: isinstance(item, bool),
        "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
        "number": lambda item: isinstance(item, (int, float)) and not isinstance(item, bool),
    }
    return expected in checks and checks[expected](value)


def validate_json_contract(
    value: Any, schema: dict[str, Any], path: str = "$"
) -> list[str]:
    errors: list[str] = []
    expected = schema.get("type")
    if expected is not None:
        expected_types = expected if isinstance(expected, list) else [expected]
        if not any(_matches_schema_type(value, item) for item in expected_types):
            return [f"{path}类型错误，期望{'/'.join(expected_types)}"]
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}必须是{schema['const']}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}不在允许值中: {value}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{path}长度不足")
        pattern = schema.get("pattern")
        if pattern and not re.fullmatch(pattern, value):
            errors.append(f"{path}格式不匹配: {value}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}不能小于{schema['minimum']}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append(f"{path}项目数量不足")
        if schema.get("uniqueItems"):
            serialized = [
                json.dumps(item, ensure_ascii=False, sort_keys=True)
                for item in value
            ]
            if len(serialized) != len(set(serialized)):
                errors.append(f"{path}不能包含重复项")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                errors.extend(validate_json_contract(item, item_schema, f"{path}[{index}]"))
    if isinstance(value, dict):
        required = schema.get("required", [])
        for name in required:
            if name not in value:
                errors.append(f"{path}缺少必要字段: {name}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for name in value:
                if name not in properties:
                    errors.append(f"{path}.{name}未在Schema登记")
        for name, child_schema in properties.items():
            if name in value:
                errors.extend(
                    validate_json_contract(value[name], child_schema, f"{path}.{name}")
                )
    return errors


def validate_spec(spec: dict[str, Any], context: dict[str, Any] | None = None) -> None:
    if not isinstance(spec, dict):
        raise ContractError("PageSpec必须是对象")
    envelope_schema = load_json(ROOT / "schemas" / "page-spec.schema.json")
    errors = validate_json_contract(spec, envelope_schema)
    if context is None and not errors:
        context = load_context(spec)
    if context:
        errors.extend(
            validate_json_contract(
                spec.get("payload"), context["payload_schema"], "$.payload"
            )
        )
        capabilities = context["capabilities"]
        allowed = capabilities["allowed"]
        payload = spec.get("payload") if isinstance(spec.get("payload"), dict) else {}
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        filter_options = options.get("filter", {})
        toolbar_options = options.get("toolbar", {})
        collection_options = options.get("collection", {})
        selections = {
            "payload.options.filter.fields": (
                filter_options.get("fields"),
                allowed["filter_fields"],
            ),
            "payload.options.toolbar.actions": (
                toolbar_options.get("actions"),
                allowed["toolbar_actions"],
            ),
            "payload.options.collection.columns": (
                collection_options.get("columns"),
                allowed["table_columns"],
            ),
            "payload.options.collection.row_actions": (
                collection_options.get("row_actions"),
                allowed["row_actions"],
            ),
            "payload.options.collection.card_fields": (
                collection_options.get("card_fields"),
                allowed["card_fields"],
            ),
        }
        for path, (selected, valid_values) in selections.items():
            if selected is None:
                continue
            if not isinstance(selected, list) or not all(
                isinstance(item, str) for item in selected
            ):
                errors.append(f"{path}必须是字符串数组")
                continue
            if len(selected) != len(set(selected)):
                errors.append(f"{path}不能包含重复项")
            unknown = sorted(set(selected) - set(valid_values))
            if unknown:
                errors.append(f"{path}包含未授权能力: {unknown}")

        for index, extension in enumerate(options.get("extensions", [])):
            if extension.get("kind") not in allowed["extension_kinds"]:
                errors.append(
                    f"payload.options.extensions[{index}].kind未授权: {extension.get('kind')}"
                )
        selected_columns = collection_options.get("columns")
        selected_actions = collection_options.get("row_actions")
        if isinstance(selected_columns, list) and isinstance(selected_actions, list):
            if bool(selected_actions) != ("actions" in selected_columns):
                errors.append(
                    "payload.options.collection.row_actions与actions列必须同时存在或同时省略"
                )

    visual_scope = deepcopy(spec)
    if isinstance(visual_scope.get("payload"), dict):
        visual_scope["payload"].pop("content", None)
    if re.search(
        r"(?<![A-Za-z0-9_-])\d+(?:\.\d+)?px\b",
        json.dumps(visual_scope, ensure_ascii=False),
    ):
        errors.append("PageSpec禁止声明px视觉数值")

    if errors:
        raise ContractError("\n".join(errors))


def _resolve_list_search_spec(
    spec: dict[str, Any], capabilities: dict[str, Any]
) -> dict[str, Any]:
    defaults = capabilities["defaults"]
    resolved = deepcopy(spec)
    resolved.setdefault("title", defaults["title"])
    resolved.setdefault("shell", {})
    payload = resolved.setdefault("payload", {})
    options = payload.setdefault("options", {})
    payload.setdefault("content", {})
    classification = options.setdefault("classification", {})
    filter_options = options.setdefault("filter", {})
    toolbar = options.setdefault("toolbar", {})
    collection = options.setdefault("collection", {})
    pagination = options.setdefault("pagination", {})
    options.setdefault("extensions", [])
    classification.setdefault("default_mode", "type")
    filter_options.setdefault("fields", deepcopy(defaults["filter_fields"]))
    filter_options.setdefault("collapsed", True)
    toolbar.setdefault("actions", deepcopy(defaults["toolbar_actions"]))
    toolbar.setdefault("view_switch", True)
    toolbar.setdefault("video_mode_switch", True)
    collection.setdefault("columns", deepcopy(defaults["table_columns"]))
    collection.setdefault("row_actions", deepcopy(defaults["row_actions"]))
    collection.setdefault("card_fields", deepcopy(defaults["card_fields"]))
    pagination.setdefault("page_size", defaults["page_size"])
    return resolved


def _resolve_detail_workspace_spec(
    spec: dict[str, Any], capabilities: dict[str, Any]
) -> dict[str, Any]:
    resolved = deepcopy(spec)
    resolved.setdefault("title", capabilities["defaults"]["title"])
    resolved.setdefault("shell", {})
    payload = resolved.setdefault("payload", {})
    payload.setdefault("options", {})
    payload.setdefault("content", {})
    return resolved


SPEC_RESOLVERS = {}

if set(SPEC_RESOLVERS) != PAGE_RENDERER_IDS:
    raise RuntimeError("PageSpec Resolver实现与Renderer Registry不一致")


def resolve_spec(spec: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    renderer = context["composition"].get("renderer")
    resolver = SPEC_RESOLVERS.get(renderer)
    if resolver is None:
        raise ContractError(f"未登记PageSpec解析器: {renderer}")
    return resolver(spec, context["capabilities"])


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def render_product_tokens(product_tokens: dict[str, Any]) -> str:
    return "\n".join(
        f"      {name}: {value} !important;"
        for name, value in product_tokens["overrides"].items()
    )


def render_geometry_roles(profile: dict[str, Any]) -> str:
    return "\n".join(
        f"      --d2c-{name}: {value};"
        for name, value in profile["geometry_roles"].items()
    )


def render_filter_fields(
    field_ids: list[str], composition: dict[str, Any]
) -> str:
    blocks: list[str] = []
    for field_id in field_ids:
        field = composition["filter_fields"][field_id]
        visibility = ' v-show="filterExpanded"' if field["visibility"] == "expanded" else ""
        label = esc(field["label"])
        model = esc(field["model"])
        if field["kind"] == "select":
            source = esc(field["source"])
            control = (
                f'<el-select v-model="filters.{model}" placeholder="全部">'
                f'<el-option v-for="item in config.{source}" :key="item" '
                f':label="item" :value="item"></el-option></el-select>'
            )
        elif field["kind"] == "input":
            control = (
                f'<el-input v-model="filters.{model}" clearable '
                f'prefix-icon="{esc(field["icon"])}" '
                f'placeholder="{esc(field["placeholder"])}"></el-input>'
            )
        elif field["kind"] == "datetime-range":
            control = (
                f'<el-date-picker v-model="filters.{model}" type="datetimerange" '
                'range-separator="至" start-placeholder="开始时间" '
                'end-placeholder="结束时间" '
                'value-format="yyyy-MM-dd HH:mm:ss"></el-date-picker>'
            )
        else:
            raise ContractError(f"未知筛选字段类型: {field['kind']}")
        blocks.append(
            f'                    <el-form-item{visibility} label="{label}">\n'
            f"                      {control}\n"
            "                    </el-form-item>"
        )
    return "\n".join(blocks)


def render_toolbar_actions(
    action_ids: list[str], composition: dict[str, Any]
) -> str:
    blocks: list[str] = []
    for action_id in action_ids:
        action = composition["toolbar_actions"][action_id]
        attrs = [
            f'data-action="{esc(action_id)}"',
            f'type="{esc(action["type"])}"',
            f'size="{esc(action["size"])}"',
            f'icon="{esc(action["icon"])}"',
        ]
        if action.get("disabled"):
            attrs.append(f':disabled="{esc(action["disabled"])}"')
        if action.get("event"):
            attrs.append(f'@click="{esc(action["event"])}"')
        blocks.append(
            f"                  <el-button {' '.join(attrs)}>"
            f"{esc(action['label'])}</el-button>"
        )
    return "\n".join(blocks)


def render_view_switch(enabled: bool) -> str:
    if not enabled:
        return ""
    return """                  <el-button-group class="event-search-toolbar__view-toggle">
                    <el-button data-action="view-card" size="small" icon="h-icon-picture"
                      title="卡片视图" :type="viewMode === 'card' ? 'primary' : 'default'"
                      @click="viewMode = 'card'"></el-button>
                    <el-button data-action="view-list" size="small" icon="h-icon-details"
                      title="列表视图" :type="viewMode === 'list' ? 'primary' : 'default'"
                      @click="viewMode = 'list'"></el-button>
                  </el-button-group>"""


def render_video_mode_switch(enabled: bool) -> str:
    if not enabled:
        return ""
    return """                  <el-button data-action="video-mode" type="text" size="small"
                    icon="h-icon-switch" @click="toggleVideoMode">视频打开方式：外置 OCX 插件播放</el-button>"""


def _column_attrs(column_id: str, column: dict[str, Any]) -> list[str]:
    attrs = [f'data-column="{esc(column_id)}"']
    mapping = {
        "prop": "prop",
        "label": "label",
        "width": "width",
        "min_width": "min-width",
        "fixed": "fixed",
        "align": "align",
        "header_align": "header-align",
        "header_class": "label-class-name",
    }
    for key, attr_name in mapping.items():
        if key in column:
            attrs.append(f'{attr_name}="{esc(column[key])}"')
    return attrs


def render_row_action_buttons(
    action_ids: list[str], composition: dict[str, Any], row_expr: str, button_type: str
) -> str:
    blocks: list[str] = []
    for action_id in action_ids:
        action = composition["row_actions"][action_id]
        blocks.append(
            f'<el-button data-row-action="{esc(action_id)}" type="{button_type}" '
            f'size="{esc(action["size"])}" '
            f'@click="{esc(action["event"])}({row_expr})">'
            f'{esc(action["label"])}</el-button>'
        )
    return "\n".join(blocks)


def render_table_columns(
    column_ids: list[str], action_ids: list[str], composition: dict[str, Any]
) -> str:
    blocks: list[str] = []
    for column_id in column_ids:
        column = composition["table_columns"][column_id]
        attrs = _column_attrs(column_id, column)
        kind = column["kind"]
        if kind == "selection":
            attrs.insert(1, 'type="selection"')
            body = f"<el-table-column {' '.join(attrs)}></el-table-column>"
        elif kind == "plain":
            body = f"<el-table-column {' '.join(attrs)}></el-table-column>"
        elif kind == "class":
            method = esc(column["class_method"])
            prop = esc(column["prop"])
            body = (
                f"<el-table-column {' '.join(attrs)}>\n"
                '                      <template slot-scope="scope">\n'
                f'                        <span :class="{method}(scope.row.{prop})">'
                f"{{{{ scope.row.{prop} }}}}</span>\n"
                "                      </template>\n"
                "                    </el-table-column>"
            )
        elif kind == "actions":
            actions = render_row_action_buttons(
                action_ids, composition, "scope.row", "link"
            )
            body = (
                f"<el-table-column {' '.join(attrs)}>\n"
                '                      <template slot-scope="scope">\n'
                '                        <div class="event-search-table__actions">\n'
                + "\n".join(f"                          {line}" for line in actions.splitlines())
                + "\n"
                "                        </div>\n"
                "                      </template>\n"
                "                    </el-table-column>"
            )
        else:
            raise ContractError(f"未知表格列类型: {kind}")
        blocks.append("                    " + body)
    return "\n".join(blocks)


def render_card_fields(field_ids: list[str], composition: dict[str, Any]) -> str:
    blocks: list[str] = []
    for field_id in field_ids:
        field = composition["card_fields"][field_id]
        class_binding = (
            f' :class="{esc(field["class_method"])}(row.{esc(field["prop"])})"'
            if field.get("class_method")
            else ""
        )
        blocks.append(
            f'                        <div class="event-card-row">'
            f"<label>{esc(field['label'])}</label>"
            f"<span{class_binding}>{{{{ row.{esc(field['prop'])} }}}}</span></div>"
        )
    return "\n".join(blocks)


def render_extensions(extensions: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for index, extension in enumerate(extensions):
        if extension["kind"] != "summary-strip":
            raise ContractError(f"未知扩展类型: {extension['kind']}")
        items = "".join(
            '<span class="event-summary-strip__item">'
            f"{esc(item['label'])}<strong>{esc(item['value'])}</strong></span>"
            for item in extension.get("items", [])
        )
        blocks.append(
            '<section class="event-summary-strip" data-zone="summary.metrics">'
            f'<span class="event-summary-strip__title">{esc(extension.get("title", "统计"))}</span>'
            f'<div class="event-summary-strip__items">{items}</div></section>'
        )
    return "\n".join(blocks)


def build_vue_data(
    spec: dict[str, Any], profile: dict[str, Any], composition: dict[str, Any],
    fixture: dict[str, Any]
) -> dict[str, Any]:
    defaults = fixture
    shell = spec["shell"]
    options = spec["payload"]["options"]
    classification = options["classification"]
    filter_options = options["filter"]
    pagination = options["pagination"]
    content = spec["payload"]["content"]
    rows = content.get("rows", defaults["rows"])
    return {
        "sidebarCollapsed": False,
        "expandedSideMenus": [],
        "portalKeyword": "",
        "topMenus": profile["portal"]["top_menus"],
        "activeTopMenu": shell.get(
            "active_top_menu", profile["portal"]["default_active_top_menu"]
        ),
        "sideMenus": profile["portal"]["side_menus"],
        "activeSideMenu": shell.get("active_side_menu", "event-search"),
        "pageTabTitle": shell.get("tab_title", "设备监控事件"),
        "eventTypeMode": classification["default_mode"],
        "eventTypeModes": composition["classification_modes"],
        "eventTypes": classification.get("event_types", defaults["event_types"]),
        "eventRuleNames": classification.get("rule_names", defaults["rule_names"]),
        "eventTypeKeyword": "",
        "activeEventType": "全部",
        "activeEventRule": "",
        "areas": defaults["areas"],
        "deviceTypes": defaults["device_types"],
        "levels": defaults["levels"],
        "statuses": defaults["statuses"],
        "filterExpanded": not filter_options["collapsed"],
        "filters": {
            "area": "全部",
            "deviceType": "全部",
            "level": "全部",
            "status": "全部",
            "source": "",
            "time": [],
        },
        "appliedFilters": {},
        "viewMode": "list",
        "selectedIds": [],
        "currentPage": 1,
        "pageSize": pagination["page_size"],
        "total": content.get("total", 326),
        "rows": rows,
    }
