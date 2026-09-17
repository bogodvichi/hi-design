#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from semantic_registry import (
    SemanticRegistryError,
    load_component_pattern_registry,
    load_hui_atom_catalog,
    load_zone_registry,
)
from generate_component_pattern_catalog import render_catalog
from core import (
    ContractError,
    load_json,
    SPEC_RESOLVERS,
    validate_product_tokens,
)
from compile_page import RENDERERS
from validate_page import VALIDATORS
from renderer_registry import (
    PAGE_RENDERER_IDS,
    PATTERN_KIND_RENDERERS,
    RENDERER_CONTRACTS,
)


ROOT = Path(__file__).resolve().parents[1]


def validate_knowledge_index_maintenance(root: Path = ROOT) -> list[str]:
    """校验设计知识索引带有可就地阅读且路径真实的维护说明。"""
    errors: list[str] = []
    design_systems = root / "design-systems"
    index_paths = {
        design_systems / "catalog.json",
        design_systems / "HUI" / "common-domain" / "fields" / "catalog.json",
        design_systems / "HUI" / "manifest.json",
        design_systems / "HUI" / "component-patterns" / "catalog.json",
        design_systems / "HUI" / "page-patterns" / "catalog.json",
        design_systems / "HUI" / "page-patterns" / "tpp" / "catalog.json",
        design_systems / "HUI" / "runtime-contracts" / "index.json",
    }
    index_paths.update(design_systems.glob("industry-products/*/industry.json"))
    index_paths.update(design_systems.glob("industry-products/*/domain/fields/catalog.json"))
    index_paths.update(design_systems.glob("industry-products/*/products/*/product.json"))
    index_paths.update(design_systems.glob("industry-products/*/products/*/pages/*/page.json"))

    for path in sorted(index_paths):
        if not path.is_file():
            errors.append(f"知识维护索引不存在: {path.relative_to(root)}")
            continue
        try:
            document = load_json(path)
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"知识维护索引无效: {path.relative_to(root)}: {exc}")
            continue
        maintenance = document.get("maintenance")
        label = str(path.relative_to(root))
        if not isinstance(maintenance, dict):
            errors.append(f"知识索引缺少maintenance说明: {label}")
            continue
        purpose = maintenance.get("purpose")
        if not isinstance(purpose, str) or not purpose.strip():
            errors.append(f"知识索引maintenance.purpose无效: {label}")
        edit_policy = maintenance.get("edit_policy")
        if not isinstance(edit_policy, str) or not edit_policy.strip():
            errors.append(f"知识索引maintenance.edit_policy无效: {label}")
        managed_paths = maintenance.get("managed_paths")
        if not isinstance(managed_paths, dict) or not managed_paths:
            errors.append(f"知识索引maintenance.managed_paths无效: {label}")
            continue
        for relative, description in managed_paths.items():
            if not isinstance(relative, str) or not relative:
                errors.append(f"知识索引维护路径无效: {label}")
                continue
            if not isinstance(description, str) or not description.strip():
                errors.append(f"知识索引维护路径缺少用途: {label} -> {relative}")
            target = (path.parent / relative).resolve()
            try:
                target.relative_to(root.resolve())
            except ValueError:
                errors.append(f"知识索引维护路径越界: {label} -> {relative}")
                continue
            if not target.exists():
                errors.append(f"知识索引维护路径不存在: {label} -> {relative}")
    return errors


def validate_rule_ownership(root: Path = ROOT) -> list[str]:
    """校验规则只能由登记文档定义，机器事实不得复制到说明文档。"""
    errors: list[str] = []
    ownership_path = root / "references" / "rule-ownership.json"
    if not ownership_path.is_file():
        return ["缺少规则归属索引: references/rule-ownership.json"]

    try:
        ownership = load_json(ownership_path)
    except (OSError, json.JSONDecodeError) as exc:
        return [f"规则归属索引无效: {exc}"]

    if ownership.get("schema_version") != "hi-design-rule-ownership.v1":
        errors.append("规则归属索引版本必须是hi-design-rule-ownership.v1")

    governed = ownership.get("governed_documents")
    if not isinstance(governed, list) or not governed:
        return errors + ["规则归属索引缺少governed_documents"]

    documents: dict[str, str] = {}
    for relative in governed:
        path = root / relative
        if not isinstance(relative, str) or not path.is_file():
            errors.append(f"规则治理文档不存在: {relative}")
            continue
        documents[relative] = path.read_text(encoding="utf-8")

    navigation_documents: dict[str, str] = {}
    for relative in ownership.get("navigation_documents", []):
        path = root / relative
        if not isinstance(relative, str) or not path.is_file():
            errors.append(f"规则导航文档不存在: {relative}")
            continue
        navigation_documents[relative] = path.read_text(encoding="utf-8")

    rules = ownership.get("rules")
    if not isinstance(rules, list) or not rules:
        return errors + ["规则归属索引缺少rules"]

    rule_ids: set[str] = set()
    literal_owners: dict[str, str] = {}
    for rule in rules:
        if not isinstance(rule, dict):
            errors.append("规则归属条目必须是对象")
            continue
        rule_id = rule.get("id")
        owner = rule.get("owner")
        if not isinstance(rule_id, str) or not rule_id:
            errors.append("规则归属条目缺少id")
            continue
        if rule_id in rule_ids:
            errors.append(f"规则ID重复: {rule_id}")
        rule_ids.add(rule_id)
        if owner not in documents:
            errors.append(f"规则所有者不在治理文档中: {rule_id} -> {owner}")
            continue

        marker = f"<!-- rule-owner:{rule_id} -->"
        marker_locations = [
            relative for relative, text in documents.items() if marker in text
        ]
        if marker_locations != [owner]:
            errors.append(
                f"规则所有者标记必须只出现在权威文档: "
                f"{rule_id} -> {marker_locations}, 期望{owner}"
            )
        if documents[owner].count(marker) != 1:
            errors.append(f"规则所有者标记必须恰好出现一次: {rule_id}")

        for source in rule.get("machine_sources", []):
            if not isinstance(source, str) or not (root / source).exists():
                errors.append(f"规则机器事实源不存在: {rule_id} -> {source}")
        for reference in rule.get("required_references", []):
            if not isinstance(reference, str) or f"`{reference}`" not in documents[owner]:
                errors.append(f"权威文档缺少规则引用: {rule_id} -> {reference}")

        for literal in rule.get("exclusive_literals", []):
            if not isinstance(literal, str) or not literal:
                errors.append(f"规则exclusive_literals无效: {rule_id}")
                continue
            previous = literal_owners.get(literal)
            if previous and previous != rule_id:
                errors.append(
                    f"独占规则文本被多个规则认领: {literal} -> {previous}, {rule_id}"
                )
            literal_owners[literal] = rule_id
            if literal not in documents[owner]:
                errors.append(f"权威文档缺少独占规则文本: {rule_id} -> {literal}")
            duplicates = [
                relative
                for relative, text in documents.items()
                if relative != owner and literal in text
            ]
            if duplicates:
                errors.append(
                    f"独占规则文本出现在非权威文档: {literal} -> {duplicates}"
                )
            copied_to_navigation = [
                relative
                for relative, text in navigation_documents.items()
                if literal in text
            ]
            if copied_to_navigation:
                errors.append(
                    f"独占规则文本不得复制到导航文档: "
                    f"{literal} -> {copied_to_navigation}"
                )

    marker_pattern = re.compile(r"<!--\s*rule-owner:([a-z0-9-]+)\s*-->")
    for relative, text in documents.items():
        unknown = sorted(set(marker_pattern.findall(text)) - rule_ids)
        if unknown:
            errors.append(f"文档包含未登记规则所有者标记: {relative} -> {unknown}")

    for item in ownership.get("machine_only_literals", []):
        if not isinstance(item, dict):
            errors.append("machine_only_literals条目必须是对象")
            continue
        literal = item.get("literal")
        source = item.get("source")
        if not isinstance(source, str) or not (root / source).exists():
            errors.append(f"机器专属事实源不存在: {literal} -> {source}")
        if not isinstance(literal, str) or not literal:
            errors.append("machine_only_literals缺少literal")
            continue
        copied_to = [
            relative for relative, text in documents.items() if literal in text
        ]
        if copied_to:
            errors.append(f"机器事实不得复制到治理文档: {literal} -> {copied_to}")
        copied_to_navigation = [
            relative
            for relative, text in navigation_documents.items()
            if literal in text
        ]
        if copied_to_navigation:
            errors.append(
                f"机器事实不得复制到导航文档: "
                f"{literal} -> {copied_to_navigation}"
            )

    normative_lines: dict[str, list[str]] = {}
    for relative, text in documents.items():
        in_fence = False
        for raw_line in text.splitlines():
            if raw_line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence or raw_line.lstrip().startswith("|"):
                continue
            line = re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", raw_line).strip()
            if len(line) < 20 or not re.search(r"必须|不得|禁止|只允许|唯一事实源|固定为", line):
                continue
            normalized = re.sub(r"[`*_\s，。；：、]", "", line)
            normative_lines.setdefault(normalized, []).append(relative)
    for normalized, locations in normative_lines.items():
        unique_locations = sorted(set(locations))
        if len(unique_locations) > 1:
            errors.append(
                f"规范性文本在多个治理文档重复: {unique_locations} -> {normalized[:60]}"
            )

    return errors


TEMPLATE_INCLUDE_PATTERN = re.compile(r"<!--\s*@include\s+([^\s]+)\s*-->")


def read_composed_template(path: Path, stack: tuple[Path, ...] = ()) -> str:
    path = path.resolve()
    if path in stack or not path.is_file():
        return ""
    source = path.read_text(encoding="utf-8")
    return TEMPLATE_INCLUDE_PATTERN.sub(
        lambda match: read_composed_template(
            path.parent / match.group(1), (*stack, path)
        ),
        source,
    )


def validate_generation_templates(root: Path = ROOT) -> list[str]:
    """校验模板不复制机器资源事实，并保持可确定的数据与语义分层。"""
    errors: list[str] = []
    template_paths = sorted({
        root / contract["template"]
        for contract in RENDERER_CONTRACTS.values()
        if isinstance(contract.get("template"), str)
    })
    resource_slots = ("__HUI_CSS__", "__VUE_JS__", "__HUI_JS__")
    portal_bindings = {
        "portal.header": "portal.global-header",
        "portal.sidebar": "portal.app-sidebar",
    }

    for path in template_paths:
        if not path.is_file():
            errors.append(f"生成模板不存在: {path.relative_to(root)}")
            continue
        source = read_composed_template(path)
        source = source.replace(
            "/* __PRODUCT_SHELL_STYLES__ */",
            (root / "assets/templates/HUI/styles/portal.css").read_text(encoding="utf-8"),
        )
        source = source.replace(
            "<!-- __PRODUCT_SHELL_START__ -->",
            read_composed_template(root / "assets/templates/HUI/shells/portal-start.html"),
        )
        source = source.replace(
            "<!-- __PRODUCT_SHELL_END__ -->",
            read_composed_template(root / "assets/templates/HUI/shells/portal-end.html"),
        )
        source = re.sub(
            r"/\*\s*D2C:PRODUCT_SHELL_STYLES:START\s*\*/.*?"
            r"/\*\s*D2C:PRODUCT_SHELL_STYLES:END\s*\*/",
            (root / "assets/templates/HUI/styles/portal.css").read_text(encoding="utf-8"),
            source,
            flags=re.S,
        )
        source = re.sub(
            r"<!--\s*D2C:PRODUCT_SHELL_START:START\s*-->.*?"
            r"<!--\s*D2C:PRODUCT_SHELL_START:END\s*-->",
            read_composed_template(root / "assets/templates/HUI/shells/portal-start.html"),
            source,
            flags=re.S,
        )
        source = re.sub(
            r"<!--\s*D2C:PRODUCT_SHELL_END:START\s*-->.*?"
            r"<!--\s*D2C:PRODUCT_SHELL_END:END\s*-->",
            read_composed_template(root / "assets/templates/HUI/shells/portal-end.html"),
            source,
            flags=re.S,
        )
        label = str(path.relative_to(root))
        for slot in resource_slots:
            if source.count(slot) != 1:
                errors.append(f"模板资源槽必须恰好出现一次: {label} -> {slot}")
        if "https://pixso.hikvision.com.cn/hik-plugin/ai-builder-web/public/webresources/libs/" in source:
            errors.append(f"模板不得复制Manifest资源URL: {label}")
        if "config: PAGE_CONFIG" not in source:
            errors.append(f"模板data必须只读引用PAGE_CONFIG: {label}")
        for forbidden in (
            "cloneRuntimeValue(PAGE_CONFIG)",
            "this.spec =",
            "spec.rows = fixtures.rows",
            "spec.total = fixtures.total",
        ):
            if forbidden in source:
                errors.append(f"模板重新混合配置与预览数据: {label} -> {forbidden}")
        if re.search(r"<(?:button|input)(?:\s|>)", source, re.I):
            errors.append(f"模板基础交互控件必须使用HUI Vue组件: {label}")
        for zone_id, component_id in portal_bindings.items():
            tag_pattern = re.compile(
                rf"<[^>]+data-zone=\"{re.escape(zone_id)}\"[^>]*>", re.S
            )
            match = tag_pattern.search(source)
            if not match or f'data-component="{component_id}"' not in match.group(0):
                errors.append(
                    f"模板Portal Zone缺少组合模式: {label} -> "
                    f"{zone_id}/{component_id}"
                )
        if "<el-input" not in source and "<el-button" not in source:
            errors.append(f"模板未使用已登记HUI基础控件: {label}")
        if path.name == "device-detail.html":
            for collection in ("deviceInfo", "metrics"):
                binding = f'v-for="item in {collection}"'
                if source.count(binding) != 1:
                    errors.append(
                        f"详情模板fixture集合必须由唯一响应式循环渲染: "
                        f"{label} -> {collection}"
                    )
            for legacy_block in ("DEVICE_INFO_ROWS", "METRIC_ROWS"):
                if legacy_block in source:
                    errors.append(
                        f"详情模板不得把fixture静态展开: {label} -> {legacy_block}"
                    )

    return errors


def validate_renderer_geometry_ownership(root: Path = ROOT) -> list[str]:
    """校验TPP证据几何只由页面合同拥有，Renderer仅消费CSS变量。"""
    errors: list[str] = []
    tpp_root = root / "design-systems" / "HUI" / "page-patterns" / "tpp"
    styles: dict[str, str] = {}
    for contract in RENDERER_CONTRACTS.values():
        for relative in contract.get("styles", []):
            path = root / relative
            if path.is_file():
                styles[str(path.relative_to(root))] = path.read_text(encoding="utf-8")
    for family_path in sorted((tpp_root / "families").glob("*/contract.json")):
        family = load_json(family_path)
        non_binding = family.get("invariants", {}).get("non_binding_geometry", {})
        if not isinstance(non_binding, dict):
            errors.append(
                f"TPP页面族non_binding_geometry必须是对象: {family_path.relative_to(root)}"
            )
            non_binding = {}
        for selector, properties in non_binding.items():
            if not isinstance(selector, str) or not isinstance(properties, list):
                errors.append(f"TPP非绑定几何声明无效: {family.get('id')} -> {selector}")
                continue
            selector_pattern = re.compile(
                rf"{re.escape(selector)}\s*\{{([^}}]*)\}}", re.S
            )
            for label, source in styles.items():
                for block in selector_pattern.findall(source):
                    for property_name in properties:
                        if re.search(
                            rf"(?:^|;)\s*{re.escape(property_name)}\s*:",
                            block,
                        ):
                            errors.append(
                                "Renderer不得绑定TPP观测几何: "
                                f"{label} -> {selector} {property_name}"
                            )
        bindings = family.get("invariants", {}).get("geometry_bindings", {})
        if not isinstance(bindings, dict):
            errors.append(
                f"TPP页面族geometry_bindings必须是对象: {family_path.relative_to(root)}"
            )
            continue
        for region, binding in bindings.items():
            if not isinstance(binding, dict):
                errors.append(f"TPP几何绑定无效: {family.get('id')} -> {region}")
                continue
            selector = binding.get("selector")
            property_name = binding.get("property")
            css_variable = binding.get("css_variable")
            if not all(isinstance(value, str) and value for value in (selector, property_name, css_variable)):
                errors.append(f"TPP几何绑定字段不完整: {family.get('id')} -> {region}")
                continue
            selector_pattern = re.compile(
                rf"{re.escape(selector)}\s*\{{([^}}]*)\}}", re.S
            )
            matched = False
            for label, source in styles.items():
                for block in selector_pattern.findall(source):
                    matched = True
                    declaration = re.search(
                        rf"(?:^|;)\s*{re.escape(property_name)}\s*:\s*([^;]+)",
                        block,
                    )
                    if not declaration:
                        continue
                    value = declaration.group(1).strip()
                    if re.fullmatch(r"-?\d+(?:\.\d+)?px(?:\s*!important)?", value):
                        errors.append(
                            "Renderer不得硬编码TPP证据几何: "
                            f"{label} -> {selector} {property_name}: {value}"
                        )
                    if f"var({css_variable}" not in value:
                        errors.append(
                            "Renderer必须通过页面级CSS变量消费TPP证据几何: "
                            f"{label} -> {selector} {property_name} / {css_variable}"
                        )
            if not matched:
                errors.append(
                    f"Renderer缺少TPP几何绑定选择器: {selector}"
                )
    return errors


def validate_filter_search_form_ownership(root: Path = ROOT) -> list[str]:
    """校验所有标准组合筛选栏复用公共合同，不允许页面类型旁路。"""
    errors: list[str] = []
    contract_path = (
        root
        / "design-systems/HUI/component-patterns/filter.search-form/contract.json"
    )
    shell_path = root / "assets/templates/HUI/shells/page-end.html"
    collection_path = root / "assets/templates/HUI/fragments/collection/page.html"
    if not contract_path.is_file() or not shell_path.is_file() or not collection_path.is_file():
        return ["标准组合筛选栏公共合同或Renderer模板不存在"]

    behavior = load_json(contract_path).get("fixed_behavior", {})
    expected = {
        "grid_columns": 4,
        "action_column": 4,
        "collapsed_visible_fields": 3,
        "collapse_threshold": 3,
    }
    for key, value in expected.items():
        if behavior.get(key) != value:
            errors.append(f"标准组合筛选栏默认行为被修改: {key} != {value}")

    shell = shell_path.read_text(encoding="utf-8")
    for marker, message in (
        (
            "Number((this.config.filter_search_form_behavior || {}).collapse_threshold)",
            "标准组合筛选栏折叠阈值必须消费公共合同",
        ),
        (
            "Number((this.config.filter_search_form_behavior || {}).collapsed_visible_fields)",
            "标准组合筛选栏折叠态展示数量必须消费公共合同",
        ),
    ):
        if marker not in shell:
            errors.append(message)

    collection = collection_path.read_text(encoding="utf-8")
    start = collection.find('v-if="isTableTabsSearch"')
    end = collection.find('<div v-if="showPageToolbar"', start)
    table_tabs_search = collection[start:end] if start >= 0 and end > start else ""
    if not table_tabs_search:
        errors.append("标签页表格缺少标准组合筛选栏")
    else:
        if 'v-for="field in visibleFilters"' not in table_tabs_search:
            errors.append("标签页表格不得绕过公共筛选项显隐逻辑")
        if 'v-if="hasCollapsibleFilters"' not in table_tabs_search:
            errors.append("标签页表格不得绕过公共筛选栏展开收起逻辑")
        if 'v-for="field in config.filters"' in table_tabs_search:
            errors.append("标签页表格不得直接渲染全部筛选项")
    return errors


def validate_selection_column_ownership(root: Path = ROOT) -> list[str]:
    """校验selection列完整沿用HUI默认布局，不得覆盖宽度、对齐与内部样式。"""
    errors: list[str] = []
    template_path = root / "assets/templates/HUI/fragments/collection/page.html"
    if not template_path.is_file():
        return ["表格Renderer模板不存在"]
    source = template_path.read_text(encoding="utf-8")
    selection_tags = re.findall(
        r'<el-table-column\b(?=[^>]*\btype="selection")[^>]*>',
        source,
    )
    if not selection_tags:
        errors.append("表格Renderer缺少selection列")
    for tag in selection_tags:
        if re.search(
            r'\b(?:width|min-width|align|header-align|class-name|label-class-name)\s*=',
            tag,
        ):
            errors.append("selection列必须完整使用HUI默认布局，Renderer不得覆盖")

    styles_path = root / "assets/templates/HUI/styles/collection.css"
    if not styles_path.is_file():
        errors.append("表格Renderer样式不存在")
    else:
        styles = styles_path.read_text(encoding="utf-8")
        if re.search(
            r"[^{}]*\.el-table-column--selection[^{}]*\{",
            styles,
        ):
            errors.append("selection列不得覆盖HUI原生样式")

    compositions = root.glob(
        "design-systems/industry-products/*/products/*/pages/*/composition.json"
    )
    for path in compositions:
        document = load_json(path)
        for column_id, column in document.get("table_columns", {}).items():
            if not isinstance(column, dict) or column.get("kind") != "selection":
                continue
            if "width" in column or "min_width" in column:
                errors.append(
                    "selection列必须使用HUI默认宽度，产品Composition不得覆盖: "
                    f"{path.relative_to(root)} -> {column_id}"
                )
    return errors


def main() -> int:
    errors: list[str] = []
    required = [
        "SKILL.md",
        "agents/openai.yaml",
        "references/architecture.md",
        "references/knowledge-resolution.md",
        "references/generation-contract.md",
        "references/hui-vue-runtime-contract.md",
        "references/rule-ownership.json",
        "schemas/page-spec.schema.json",
        "schemas/pattern-page-spec.schema.json",
        "design-systems/catalog.json",
        "design-systems/HUI/common-domain/fields/catalog.json",
        "design-systems/HUI/manifest.json",
        "design-systems/HUI/theme/token-contract.json",
        "design-systems/HUI/runtime-contracts/others/card.json",
        "design-systems/HUI/runtime-contracts/index.json",
        "design-systems/HUI/zones/media.preview.json",
        "design-systems/HUI/component-patterns/catalog.json",
        "design-systems/HUI/page-patterns/catalog.json",
        "design-systems/HUI/page-patterns/list-search/contract.json",
        "design-systems/HUI/page-patterns/form-fixed-width-one-column/contract.json",
        "design-systems/HUI/page-patterns/form-fixed-width-one-column/evidence.json",
        "design-systems/HUI/page-patterns/generic/contract.json",
        "design-systems/HUI/page-patterns/tpp/catalog.json",
        "design-systems/HUI/page-patterns/tpp/mappings/form.json",
        "design-systems/HUI/page-patterns/tpp/mappings/table.json",
        "design-systems/HUI/page-patterns/tpp/mappings/card.json",
        "design-systems/HUI/page-patterns/tpp/mappings/details.json",
        "design-systems/HUI/page-patterns/tpp/evidence/details/fill-up.json",
        "design-systems/HUI/page-patterns/tpp/evidence/details/fixed-width.json",
        "design-systems/HUI/page-patterns/tpp/pages/details/fill-up.json",
        "design-systems/HUI/page-patterns/tpp/pages/details/fixed-width.json",
        "design-systems/HUI/page-patterns/tpp/families/details-basic/contract.json",
        "design-systems/HUI/component-patterns/form.data-form/contract.json",
        "design-systems/industry-products/general/industry.json",
        "design-systems/industry-products/general/domain/fields/catalog.json",
        "design-systems/industry-products/general/products/isc/product.json",
        "design-systems/industry-products/general/products/isc/profile.json",
        "design-systems/industry-products/general/products/isc/theme/tokens.json",
        "design-systems/industry-products/general/products/isc/portal-shell/contract.json",
        "design-systems/industry-products/public-security/industry.json",
        "design-systems/industry-products/public-security/products/pvia/product.json",
        "scripts/resolve_capabilities.py",
        "scripts/compile_page.py",
        "scripts/build_product_acceptance.py",
        "scripts/compile_pattern_page.py",
        "scripts/compile_generation_test.py",
        "scripts/renderer_registry.py",
        "scripts/semantic_registry.py",
        "scripts/generate_component_pattern_catalog.py",
        "scripts/validate_page.py",
        "scripts/validate_pattern_page.py",
        "tests/generation/device-permission-form.json",
        "tests/generation/device-list-table.json",
        "tests/generation/device-capture-card.json",
        "tests/generation/device-capture-switch.json",
        "tests/generation/capture-card-tabs.json",
        "tests/product-pages/isc/cases.json",
    ]
    for relative in required:
        if not (ROOT / relative).is_file():
            errors.append(f"缺少必要文件: {relative}")
    errors.extend(validate_rule_ownership())
    errors.extend(validate_knowledge_index_maintenance())
    errors.extend(validate_generation_templates())
    errors.extend(validate_renderer_geometry_ownership())
    errors.extend(validate_filter_search_form_ownership())
    errors.extend(validate_selection_column_ownership())
    if (ROOT / "knowledge").exists():
        errors.append("旧knowledge目录仍存在，应统一使用design-systems")
    product_dictionaries = list(
        (ROOT / "design-systems" / "industry-products").glob(
            "*/products/*/component-dictionary.json"
        )
    )
    if product_dictionaries:
        errors.append(
            "产品不得维护data-component词典: "
            f"{[str(path.relative_to(ROOT)) for path in product_dictionaries]}"
        )
    if (
        set(RENDERERS) != set(VALIDATORS)
        or set(RENDERERS) != set(SPEC_RESOLVERS)
        or set(RENDERERS) != PAGE_RENDERER_IDS
    ):
        errors.append(
            "Renderer、Validator与PageSpec Resolver注册表不一致: "
            f"{sorted(RENDERERS)} / {sorted(VALIDATORS)} / "
            f"{sorted(SPEC_RESOLVERS)} / {sorted(PAGE_RENDERER_IDS)}"
        )
    expected_pattern_kinds = {
        "form", "table", "card", "switch", "card-tabs", "details"
    }
    if set(PATTERN_KIND_RENDERERS) != expected_pattern_kinds:
        errors.append(
            "TPP Renderer未覆盖正式Pattern Page种类: "
            f"{sorted(PATTERN_KIND_RENDERERS)}"
        )
    templates_root = (ROOT / "assets" / "templates").resolve()
    for renderer_id, contract in RENDERER_CONTRACTS.items():
        if (
            not contract.get("input_contract")
            or not contract.get("pattern_kinds")
            or not contract.get("template")
        ):
            errors.append(f"Renderer合同不完整: {renderer_id}")
            continue
        template_path = (ROOT / contract["template"]).resolve()
        if templates_root not in template_path.parents or not template_path.is_file():
            errors.append(
                f"Renderer模板必须位于assets/templates且真实存在: "
                f"{renderer_id} -> {contract['template']}"
            )
    isc_product = load_json(
        ROOT
        / "design-systems"
        / "industry-products"
        / "general"
        / "products"
        / "isc"
        / "product.json"
    )
    for page_type in isc_product.get("pages", {}):
        page_root = (
            ROOT
            / "design-systems"
            / "industry-products"
            / "general"
            / "products"
            / "isc"
            / "pages"
            / page_type
        )
        page_manifest = load_json(page_root / "page.json")
        composition = load_json(page_root / page_manifest["composition"])
        renderer = composition.get("renderer")
        if renderer not in RENDERERS:
            errors.append(f"页面Composition引用未登记Renderer: {page_type} -> {renderer}")
        if "compiler" in composition:
            errors.append(f"页面Composition不得使用旧compiler分支: {page_type}")
        if "defaults" in composition:
            errors.append(f"页面Composition不得维护预览defaults: {page_type}")
        if "template" in composition:
            errors.append(f"页面Composition不得声明template: {page_type}")
        capabilities = load_json(page_root / page_manifest["capability"])
        payload_schema = capabilities.get("spec_schema")
        if payload_schema != page_manifest.get("payload_schema"):
            errors.append(f"页面Capability与清单的payload Schema不一致: {page_type}")
        if not isinstance(payload_schema, str) or not (page_root / payload_schema).is_file():
            errors.append(f"页面payload Schema不存在: {page_type} -> {payload_schema}")
        fixture = load_json(page_root / page_manifest["fixture"])
        if fixture.get("schema_version") != "preview-fixture.v1":
            errors.append(f"页面Fixture版本无效: {page_type}")

    acceptance_path = ROOT / "tests" / "product-pages" / "isc" / "cases.json"
    product_path = (
        ROOT
        / "design-systems"
        / "industry-products"
        / "general"
        / "products"
        / "isc"
        / "product.json"
    )
    if acceptance_path.is_file() and product_path.is_file():
        acceptance = load_json(acceptance_path)
        product = load_json(product_path)
        covered = {
            case.get("page_type")
            for case in acceptance.get("cases", [])
            if isinstance(case, dict)
        }
        registered = set(product.get("pages", {}))
        if covered != registered:
            errors.append(
                "ISC产品验收套件未精确覆盖已登记页面: "
                f"{sorted(covered)} != {sorted(registered)}"
            )
        if acceptance.get("output_root") != "output/product-tests/isc":
            errors.append("ISC产品验收输出目录必须是output/product-tests/isc")

    skill_path = ROOT / "SKILL.md"
    if skill_path.exists():
        text = skill_path.read_text(encoding="utf-8")
        frontmatter = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
        if not frontmatter:
            errors.append("SKILL.md缺少YAML frontmatter")
        else:
            block = frontmatter.group(1)
            if not re.search(r"^name:\s*hi-builder\s*$", block, re.M):
                errors.append("SKILL.md name必须是hi-builder")
            if not re.search(r"^description:\s*\S+", block, re.M):
                errors.append("SKILL.md缺少description")
        if len(text.splitlines()) > 500:
            errors.append("SKILL.md超过500行")
        for reference in (
            "references/architecture.md",
            "references/knowledge-resolution.md",
            "references/generation-contract.md",
            "references/hui-vue-runtime-contract.md",
        ):
            if f"`{reference}`" not in text:
                errors.append(f"SKILL.md未路由必要契约: {reference}")

    for path in ROOT.rglob("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"JSON格式错误: {path.relative_to(ROOT)}: {exc}")

    card_contract_path = (
        ROOT
        / "design-systems"
        / "HUI"
        / "runtime-contracts"
        / "others"
        / "card.json"
    )
    if card_contract_path.is_file():
        card_contract = json.loads(card_contract_path.read_text(encoding="utf-8"))
        d2c_usage = card_contract.get("d2c_usage", {})
        expected_profiles = {
            "vehicle-card",
            "face-card",
            "similarity-card",
            "text-card",
            "data-list",
        }
        actual_profiles = set(d2c_usage.get("visual_profiles", {}))
        if actual_profiles != expected_profiles:
            errors.append(
                "HUI Card视觉Profile不完整: "
                f"{sorted(expected_profiles - actual_profiles)}"
            )
        for relative in d2c_usage.get("source_page_patterns", []):
            if not (
                ROOT / "design-systems" / "HUI" / relative
            ).is_file():
                errors.append(f"HUI Card引用的页面契约不存在: {relative}")

    icon_contract_path = (
        ROOT
        / "design-systems"
        / "HUI"
        / "runtime-contracts"
        / "basic-form"
        / "icon.json"
    )
    if icon_contract_path.is_file():
        icon_contract = load_json(icon_contract_path)
        icon_usage = icon_contract.get("d2c_usage", {})
        verified_classes = icon_usage.get("verified_font_classes")
        if not isinstance(verified_classes, list) or not verified_classes:
            errors.append("HUI Icon合同缺少已验证字体图标类索引")
        elif len(verified_classes) != len(set(verified_classes)):
            errors.append("HUI Icon合同存在重复字体图标类")
        if not re.fullmatch(
            r"[0-9a-f]{64}", str(icon_usage.get("font_class_source_sha256", ""))
        ):
            errors.append("HUI Icon合同缺少hui.css证据哈希")

    try:
        zones = load_zone_registry()
        patterns = load_component_pattern_registry()
        atoms = load_hui_atom_catalog()
        if not zones or not patterns or not atoms:
            errors.append("HUI通用Zone、Component Pattern和HUI Atom注册表不能为空")
    except (SemanticRegistryError, KeyError, OSError) as exc:
        errors.append(f"HUI通用语义注册表无效: {exc}")
    catalog_path = (
        ROOT
        / "design-systems"
        / "HUI"
        / "component-patterns"
        / "catalog.json"
    )
    if catalog_path.is_file() and catalog_path.read_text(encoding="utf-8") != render_catalog():
        errors.append("data-component词典与Component Contract不一致，请重新生成")

    manifest_path = ROOT / "design-systems" / "HUI" / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        catalog = manifest.get("official_catalog", {})
        source = manifest.get("catalog_source", {})
        entries = [
            (category, item)
            for category, items in catalog.items()
            for item in items
        ]
        if len(entries) != source.get("component_count"):
            errors.append(
                "HUI官方组件目录数量不一致: "
                f"{len(entries)} != {source.get('component_count')}"
            )
        actual_counts = {
            category: len(items) for category, items in catalog.items()
        }
        if actual_counts != source.get("category_counts"):
            errors.append(
                f"HUI官方组件分类数量不一致: {actual_counts}"
            )
        ids = [item.get("id") for _, item in entries]
        docs = [item.get("docs") for _, item in entries]
        if len(ids) != len(set(ids)):
            errors.append("HUI官方组件目录存在重复id")
        if len(docs) != len(set(docs)):
            errors.append("HUI官方组件目录存在重复文档地址")
        runtime_meta = manifest.get("runtime_contracts")
        runtime_entries: dict = {}
        if not isinstance(runtime_meta, dict):
            errors.append("HUI Manifest缺少runtime_contracts")
        else:
            index_relative = runtime_meta.get("index")
            index_path = (
                manifest_path.parent / index_relative
                if isinstance(index_relative, str)
                else None
            )
            if not index_path or not index_path.is_file():
                errors.append(f"HUI运行契约索引不存在: {index_relative}")
            else:
                runtime_entries = json.loads(
                    index_path.read_text(encoding="utf-8")
                ).get("entries", {})
                if runtime_meta.get("entry_count") != len(runtime_entries):
                    errors.append(
                        "HUI运行契约索引数量不一致: "
                        f"{runtime_meta.get('entry_count')} != "
                        f"{len(runtime_entries)}"
                    )
        official_ids = set(ids)
        for batch_id, batch in manifest.get(
            "runtime_contract_batches", {}
        ).items():
            unknown = sorted(set(batch.get("component_ids", [])) - official_ids)
            if unknown:
                errors.append(
                    f"HUI运行契约批次{batch_id}包含非官方组件: {unknown}"
                )
            evidence = batch.get("evidence")
            if not evidence or not (manifest_path.parent / evidence).is_file():
                errors.append(
                    f"HUI运行契约批次{batch_id}缺少证据文件: {evidence}"
                )
        covered_ids = [
            component_id
            for batch in manifest.get("runtime_contract_batches", {}).values()
            for component_id in batch.get("component_ids", [])
        ]
        if set(covered_ids) != official_ids:
            errors.append(
                "HUI运行契约批次未完整覆盖官方目录: "
                f"{sorted(official_ids - set(covered_ids))}"
            )
        if len(covered_ids) != len(set(covered_ids)):
            errors.append("HUI运行契约批次存在重复组件")
        indexed_ids = {
            component_id
            for contract in runtime_entries.values()
            for component_id in contract.get("component_ids", [])
        }
        if indexed_ids != official_ids:
            errors.append(
                "HUI运行时标签索引未完整覆盖官方目录: "
                f"{sorted(official_ids - indexed_ids)}"
            )
        for tag, contract in runtime_entries.items():
            for contract_file in contract.get("contract_files", []):
                if not (manifest_path.parent / contract_file).is_file():
                    errors.append(
                        f"HUI运行契约{tag}引用不存在: {contract_file}"
                    )
            counts = contract.get("interface_counts")
            if not isinstance(counts, dict) or set(counts) != {
                "props",
                "events",
                "slots",
                "methods",
            }:
                errors.append(f"HUI运行契约{tag}接口计数不完整")

        theme_meta = manifest.get("theme", {})
        token_contract_relative = theme_meta.get("token_contract")
        token_contract_path = (
            manifest_path.parent / token_contract_relative
            if isinstance(token_contract_relative, str)
            else None
        )
        if not token_contract_path or not token_contract_path.is_file():
            errors.append(f"HUI token合同不存在: {token_contract_relative}")
        else:
            product_root = (
                ROOT
                / "design-systems"
                / "industry-products"
                / "general"
                / "products"
                / "isc"
            )
            product = load_json(product_root / "product.json")
            theme_relative = product.get("theme")
            theme_path = (
                product_root / theme_relative
                if isinstance(theme_relative, str)
                else None
            )
            if not theme_path or not theme_path.is_file():
                errors.append(f"产品theme显式引用不存在: {theme_relative}")
            else:
                try:
                    validate_product_tokens(
                        load_json(theme_path), load_json(token_contract_path)
                    )
                except (ContractError, KeyError) as exc:
                    errors.append(f"产品tokens无效: {exc}")
            profile = load_json(product_root / "profile.json")
            if "theme_overrides" in profile:
                errors.append("产品Profile不得重复维护theme_overrides")
            logo = profile.get("brand", {}).get("logo")
            logo_source = (
                (ROOT / "output" / logo).resolve()
                if isinstance(logo, str) and logo
                else None
            )
            if (
                logo_source is None
                or ROOT.resolve() not in logo_source.parents
                or not logo_source.is_file()
            ):
                errors.append(f"产品Profile Logo资源不存在: {logo}")

    common_fields_path = (
        ROOT
        / "design-systems"
        / "HUI"
        / "common-domain"
        / "fields"
        / "catalog.json"
    )
    industry_fields_path = (
        ROOT
        / "design-systems"
        / "industry-products"
        / "general"
        / "domain"
        / "fields"
        / "catalog.json"
    )
    if common_fields_path.is_file() and industry_fields_path.is_file():
        common_fields = load_json(common_fields_path).get("fields", {})
        industry_fields = load_json(industry_fields_path)
        if industry_fields.get("extends") != "hui.common.fields":
            errors.append("行业字段目录必须继承hui.common.fields")
        overlap = sorted(set(common_fields) & set(industry_fields.get("fields", {})))
        if overlap:
            errors.append(f"行业字段不得复制或覆盖HUI通用字段: {overlap}")

    tpp_catalog_path = (
        ROOT
        / "design-systems"
        / "HUI"
        / "page-patterns"
        / "tpp"
        / "catalog.json"
    )
    if tpp_catalog_path.exists():
        tpp_catalog = json.loads(tpp_catalog_path.read_text(encoding="utf-8"))
        tpp_source = tpp_catalog.get("source", {})
        tpp_pages = tpp_catalog.get("pages", [])
        if len(tpp_pages) != tpp_source.get("page_count"):
            errors.append(
                "TPP典型页目录数量不一致: "
                f"{len(tpp_pages)} != {tpp_source.get('page_count')}"
            )
        tpp_counts = {
            category: sum(
                1 for page in tpp_pages if page.get("category", [None])[0] == category
            )
            for category in tpp_source.get("category_counts", {})
        }
        if tpp_counts != tpp_source.get("category_counts"):
            errors.append(f"TPP典型页分类数量不一致: {tpp_counts}")
        routes = [page.get("route") for page in tpp_pages]
        if len(routes) != len(set(routes)):
            errors.append("TPP典型页目录存在重复路由")
        verified = [
            page for page in tpp_pages if page.get("status") == "evidence-verified"
        ]
        expected_verified = sum(
            family.get("variant_count", 0)
            for family in tpp_catalog.get("families", {}).values()
        )
        if len(verified) != expected_verified:
            errors.append(
                "TPP已验证页面数量与页面族变体数不一致: "
                f"{len(verified)} != {expected_verified}"
            )
        tpp_root = tpp_catalog_path.parent
        verified_contracts: dict[str, dict] = {}
        for page in verified:
            contract = page.get("contract")
            if not contract or not (tpp_root / contract).is_file():
                errors.append(
                    f"TPP页面合同不存在: {page.get('route')} -> {contract}"
                )
                continue
            try:
                page_contract = load_json(tpp_root / contract)
            except (OSError, json.JSONDecodeError) as exc:
                errors.append(
                    f"TPP页面合同无效: {page.get('route')} -> {contract}: {exc}"
                )
                continue
            verified_contracts[page_contract.get("id", "")] = page_contract
            if page_contract.get("family") != page.get("family"):
                errors.append(
                    "TPP页面Catalog与合同的页面族不一致: "
                    f"{page.get('route')} -> {page.get('family')} != "
                    f"{page_contract.get('family')}"
                )
            evidence = page_contract.get("source", {}).get("evidence")
            evidence_path = (tpp_root / contract).parent / evidence if evidence else None
            if not evidence_path or not evidence_path.resolve().is_file():
                errors.append(
                    f"TPP页面证据不存在: {page.get('route')} -> {evidence}"
                )
        for family_id, family in tpp_catalog.get("families", {}).items():
            contract = family.get("contract")
            if not contract or not (tpp_root / contract).is_file():
                errors.append(
                    f"TPP页面族合同不存在: {family_id} -> {contract}"
                )
                continue
            try:
                family_contract = load_json(tpp_root / contract)
            except (OSError, json.JSONDecodeError) as exc:
                errors.append(
                    f"TPP页面族合同无效: {family_id} -> {contract}: {exc}"
                )
                continue
            variants = family_contract.get("variants", [])
            if len(variants) != family.get("variant_count"):
                errors.append(
                    "TPP页面族变体数量不一致: "
                    f"{family_id} -> {len(variants)} != {family.get('variant_count')}"
                )
            expected_family = f"hui.tpp.family.{family_id}"
            if family_contract.get("id") != expected_family:
                errors.append(
                    "TPP页面族ID与Catalog键不一致: "
                    f"{family_id} -> {family_contract.get('id')}"
                )
            for variant in variants:
                variant_id = variant.get("id")
                variant_contract = variant.get("contract")
                variant_path = (tpp_root / contract).parent / variant_contract if variant_contract else None
                if not variant_path or not variant_path.resolve().is_file():
                    errors.append(
                        f"TPP页面族变体合同不存在: {family_id} -> {variant_contract}"
                    )
                    continue
                page_contract = verified_contracts.get(variant_id)
                if not page_contract:
                    errors.append(
                        f"TPP页面族变体未登记为已验证页面: {family_id} -> {variant_id}"
                    )
                elif page_contract.get("family") != expected_family:
                    errors.append(
                        "TPP页面族变体反向关联不一致: "
                        f"{family_id} -> {variant_id} -> {page_contract.get('family')}"
                    )

    if errors:
        print("[FAIL] Hi-Builder")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("[PASS] Hi-Builder")
    print("  ✓ Skill入口与UI元数据")
    print("  ✓ HUI通用知识与行业产品知识")
    print("  ✓ 产品优先与HUI兜底索引")
    print("  ✓ 所有JSON可解析")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
