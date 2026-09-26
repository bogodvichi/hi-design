#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from core import (
    ContractError,
    load_context,
    load_json,
    resolve_spec,
    validate_spec,
)
from semantic_registry import SemanticRegistryError, validate_semantic_html
from renderer_registry import PAGE_RENDERER_IDS

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.nodes: list[dict[str, Any]] = []
        self.styles: list[str] = []
        self.scripts: list[str] = []
        self.stack: list[dict[str, Any]] = []
        self._capture_style = False
        self._capture_script = False

    def handle_starttag(
        self, tag: str, attrs_list: list[tuple[str, str | None]]
    ) -> None:
        attrs = {name: value if value is not None else "" for name, value in attrs_list}
        duplicate_attrs = sorted(
            {name for name, _ in attrs_list if sum(1 for key, _ in attrs_list if key == name) > 1}
        )
        own_classes = set((attrs.get("class") or "").split())
        ancestor_classes = set().union(
            *(entry["classes"] for entry in self.stack)
        ) if self.stack else set()
        ancestor_zones = [
            entry["zone"] for entry in self.stack if entry.get("zone")
        ]
        ancestor_tags = [entry["tag"] for entry in self.stack]
        zone = attrs.get("data-zone") or (ancestor_zones[-1] if ancestor_zones else None)
        node = {
            "tag": tag,
            "attrs": attrs,
            "duplicate_attrs": duplicate_attrs,
            "classes": own_classes,
            "ancestor_classes": ancestor_classes,
            "ancestor_tags": ancestor_tags,
            "parent_tag": ancestor_tags[-1] if ancestor_tags else None,
            "zone": zone,
        }
        self.nodes.append(node)
        self.stack.append({"tag": tag, "classes": own_classes, "zone": zone})
        if tag == "style":
            self._capture_style = True
        if tag == "script":
            self._capture_script = True

    def handle_startendtag(
        self, tag: str, attrs_list: list[tuple[str, str | None]]
    ) -> None:
        self.handle_starttag(tag, attrs_list)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == "style":
            self._capture_style = False
        if tag == "script":
            self._capture_script = False
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self._capture_style:
            self.styles.append(data)
        if self._capture_script:
            self.scripts.append(data)


def node_matches(
    node: dict[str, Any],
    *,
    tag: str | None = None,
    zone: str | None = None,
    attr: tuple[str, str] | None = None,
    ancestor_class: str | None = None,
) -> bool:
    return (
        (tag is None or node["tag"] == tag)
        and (zone is None or node["zone"] == zone)
        and (attr is None or node["attrs"].get(attr[0]) == attr[1])
        and (
            ancestor_class is None
            or ancestor_class in node["ancestor_classes"]
        )
    )


def expected_column_attrs(column_id: str, column: dict[str, Any]) -> dict[str, str]:
    attrs = {"data-column": column_id}
    if column["kind"] == "selection":
        attrs["type"] = "selection"
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
            attrs[attr_name] = str(column[key])
    return attrs


def validate_runtime_contract(
    source: str,
    parser: PageParser,
    manifest: dict[str, Any],
    html_path: Path,
) -> list[str]:
    errors: list[str] = []
    resource_attrs = [
        ("link", "href", manifest["resources"]["css"]),
        ("script", "src", manifest["resources"]["vue"]),
        ("script", "src", manifest["resources"]["hui"]),
    ]
    for tag, attr_name, value in resource_attrs:
        count = sum(
            1
            for node in parser.nodes
            if node["tag"] == tag and node["attrs"].get(attr_name) == value
        )
        if count != 1:
            errors.append(f"运行资源必须出现一次: {value}，实际{count}次")
    required_script_urls = [
        manifest["resources"]["vue"],
        manifest["resources"]["hui"],
    ]
    required_script_positions = [
        next(
            (
                index
                for index, node in enumerate(parser.nodes)
                if node["tag"] == "script"
                and node["attrs"].get("src") == url
            ),
            -1,
        )
        for url in required_script_urls
    ]
    if -1 not in required_script_positions and required_script_positions != sorted(
        required_script_positions
    ):
        errors.append("运行脚本顺序必须是vue.min.js → hui.umd.js")

    html_is_in_project = (
        html_path.resolve() == PROJECT_ROOT
        or PROJECT_ROOT in html_path.resolve().parents
    )
    if html_is_in_project:
        for node in parser.nodes:
            attribute = "href" if node["tag"] == "link" else "src"
            value = node["attrs"].get(attribute, "")
            if (
                node["tag"] not in {"link", "script", "img"}
                or not value
                or value.startswith(("http://", "https://", "data:", "#"))
                or "{{" in value
            ):
                continue
            resolved = (html_path.parent / value).resolve()
            if resolved != PROJECT_ROOT and PROJECT_ROOT not in resolved.parents:
                errors.append(f"本地运行资源越出Hi-Builder边界: {value}")

    scripts = "\n".join(parser.scripts)
    external_font_styles = [
        node["attrs"].get("href", "")
        for node in parser.nodes
        if node["tag"] == "link"
        and "h-icon.css" in node["attrs"].get("href", "")
    ]
    if external_font_styles:
        errors.append(f"禁止加载独立字体图标CSS: {external_font_styles}")

    svg_icon_resource = manifest.get("optional_resources", {}).get("svg_icons", {})
    svg_icon_url = svg_icon_resource.get("url")
    icon_v2_nodes = [
        node
        for node in parser.nodes
        if node["parent_tag"] == "h-icon"
        and node["tag"] not in {"svg", "template"}
    ]
    business_svg_nodes = [
        node
        for node in parser.nodes
        if node["tag"] == "d2c-icon"
        and "business-svg" in node["attrs"].get(":icon", "")
    ]
    if svg_icon_url:
        svg_icon_count = sum(
            1
            for node in parser.nodes
            if node["tag"] == "script"
            and node["attrs"].get("src") == svg_icon_url
        )
        uses_icon_v2 = bool(icon_v2_nodes) or bool(business_svg_nodes) or bool(
            re.search(r'"mode"\s*:\s*"(?:icon-v2|business-svg)"', scripts)
        )
        registration = f"Vue.use(window['{svg_icon_resource['global']}'])"
        if uses_icon_v2 and svg_icon_count != 1:
            errors.append(f"使用Icon V2组件时SVG图标资源必须出现一次，实际{svg_icon_count}次")
        if uses_icon_v2 and registration not in scripts:
            errors.append("使用Icon V2组件时必须在创建Vue实例前注册SVG图标资源")
        if uses_icon_v2 and registration in scripts and "new Vue" in scripts:
            if scripts.index(registration) > scripts.index("new Vue"):
                errors.append("SVG图标资源必须在创建Vue实例前注册")
        if not uses_icon_v2 and svg_icon_count:
            errors.append("未使用Icon V2组件却引入SVG图标资源")
        if uses_icon_v2 and svg_icon_count == 1:
            hui_position = required_script_positions[1]
            svg_position = next(
                index
                for index, node in enumerate(parser.nodes)
                if node["tag"] == "script"
                and node["attrs"].get("src") == svg_icon_url
            )
            if hui_position >= svg_position:
                errors.append("SVG图标资源必须在hui.umd.js之后装载")

    invalid_predefined_svg_children = [
        node["tag"]
        for node in parser.nodes
        if node["parent_tag"] == "h-svg-icon"
        and not node["tag"].startswith("svg-")
        and node["tag"] != "template"
    ]
    if invalid_predefined_svg_children:
        errors.append(
            "h-svg-icon内部只允许官方svg-*组件: "
            f"{sorted(set(invalid_predefined_svg_children))}"
        )
    vuex_url = manifest.get("optional_resources", {}).get("vuex")
    if vuex_url:
        vuex_count = sum(
            1
            for node in parser.nodes
            if node["tag"] == "script" and node["attrs"].get("src") == vuex_url
        )
        uses_vuex = bool(re.search(r"\bVuex\b|\$store\b", scripts))
        if vuex_count and not uses_vuex:
            errors.append("未使用Vuex却引入Vuex运行资源")
        if uses_vuex and vuex_count != 1:
            errors.append(f"页面使用Vuex时资源必须出现一次，实际{vuex_count}次")

    runtime_profile = manifest["runtime_profile"]
    for global_name in runtime_profile["forbidden_globals"]:
        if re.search(rf"\b{re.escape(global_name)}\b", scripts):
            errors.append(f"禁止使用HUI全局服务: {global_name}，请使用Vue实例服务")
    if re.search(r"\bel-icon-[a-zA-Z0-9_-]+", source):
        errors.append("禁止使用el-icon-*，请使用已登记的HUI图标模式")
    icon_catalog = load_json(
        PROJECT_ROOT / "design-systems" / "HUI" / "icons" / "catalog.json"
    )
    verified_font_classes = set(icon_catalog.get("font", []))
    used_font_classes = set(
        re.findall(r"\bh-icon-[A-Za-z0-9_-]+\b", source)
    )
    unknown_font_classes = sorted(used_font_classes - verified_font_classes)
    if unknown_font_classes:
        errors.append(f"使用了目标hui.css未验证的字体图标类: {unknown_font_classes}")

    for node in parser.nodes:
        if node["tag"] != "el-dialog":
            continue
        if "v-model" in node["attrs"]:
            errors.append("Dialog禁止使用v-model，必须使用:visible.sync")
        if node["attrs"].get(":visible.sync") is None:
            errors.append("Dialog必须使用:visible.sync绑定可见状态")

    required_data_layers = {
        "const PAGE_CONFIG =": "缺少PAGE_CONFIG页面配置层",
        "const PREVIEW_FIXTURES =": "缺少PREVIEW_FIXTURES预览数据层",
        "config: PAGE_CONFIG": "data缺少PAGE_CONFIG只读引用",
        "created: function ()": "缺少created预览数据装载入口",
        "loadPreviewFixtures: function ()": "缺少loadPreviewFixtures预览数据装载方法",
    }
    for marker, message in required_data_layers.items():
        if marker not in scripts:
            errors.append(message)
    for forbidden in (
        "cloneRuntimeValue(PAGE_CONFIG)",
        "this.spec =",
        "spec.rows = fixtures.rows",
        "spec.total = fixtures.total",
    ):
        if forbidden in scripts:
            errors.append(f"配置与预览数据不得重新混入data: {forbidden}")
    return errors


def validate_detail_workspace(
    spec: dict[str, Any], html_path: Path, context: dict[str, Any]
) -> list[str]:
    manifest = context["manifest"]
    profile = context["profile"]
    product_tokens = context["product_tokens"]
    composition = context["composition"]
    source = html_path.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(source)
    errors: list[str] = []
    errors.extend(validate_runtime_contract(source, parser, manifest, html_path))
    try:
        errors.extend(validate_semantic_html(source, composition))
    except SemanticRegistryError as exc:
        errors.append(str(exc))

    unresolved = sorted(set(re.findall(r"__[A-Z_]+__|D2C:[A-Z_]+", source)))
    if unresolved:
        errors.append(f"存在未解析模板哨兵: {unresolved}")
    duplicate_nodes = [
        f"{node['tag']}:{node['duplicate_attrs']}"
        for node in parser.nodes
        if node["duplicate_attrs"]
    ]
    if duplicate_nodes:
        errors.append(f"存在重复HTML属性: {duplicate_nodes}")

    style = "\n".join(parser.styles)
    for name, value in product_tokens["overrides"].items():
        pattern = rf"{re.escape(name)}\s*:\s*{re.escape(value)}\s*!important\s*;"
        if not re.search(pattern, style):
            errors.append(f"缺少产品Token覆盖: {name}")
    for name, value in profile["geometry_roles"].items():
        var_name = f"--d2c-{name}"
        pattern = rf"{re.escape(var_name)}\s*:\s*{re.escape(value)}\s*;"
        if not re.search(pattern, style):
            errors.append(f"产品几何角色不一致: {var_name}={value}")

    css_without_geometry = re.sub(
        r"\.product-isc\s*\{.*?\}", "", style, flags=re.S
    ).replace(profile["breakpoints"]["compact"], "")
    raw_px = sorted(set(re.findall(r"\b\d+(?:\.\d+)?px\b", css_without_geometry)))
    if raw_px:
        errors.append(f"模板绕过Product Profile声明裸px: {raw_px}")

    allowed_hui = set(context["runtime_contracts"])
    used_hui = {
        node["tag"] for node in parser.nodes if node["tag"].startswith("el-")
    }
    unknown_hui = sorted(used_hui - allowed_hui)
    if unknown_hui:
        errors.append(f"使用了Manifest未声明的HUI组件: {unknown_hui}")

    business_zones = set(composition["zones"])
    forbidden_native = sorted(
        {
            node["tag"]
            for node in parser.nodes
            if node["zone"] in business_zones
            and node["tag"] in {"button", "input", "select", "textarea", "table"}
        }
    )
    if forbidden_native:
        errors.append(f"详情页业务zone使用原生控件: {forbidden_native}")

    required_hui = {
        "el-tabs": 1,
        "el-form": 1,
        "el-select": 1,
        "el-checkable-tag": 1,
    }
    for tag, minimum in required_hui.items():
        count = sum(1 for node in parser.nodes if node["tag"] == tag)
        if count < minimum:
            errors.append(f"详情页缺少HUI组件: {tag}，至少{minimum}个，实际{count}个")

    for collection in ("deviceInfo", "metrics"):
        binding = f'v-for="item in {collection}"'
        if source.count(binding) != 1:
            errors.append(f"详情页fixture集合必须由唯一响应式循环渲染: {collection}")

    primary_actions = [
        node
        for node in parser.nodes
        if node_matches(node, tag="el-button", zone="device.details")
        and node["attrs"].get("type") == "primary"
    ]
    if len(primary_actions) != 1:
        errors.append("设备操作表单必须有且只有一个primary确认按钮")

    thumbnails = [
        node
        for node in parser.nodes
        if node_matches(node, tag="el-button", zone="media.preview")
        and "event-image-viewer__thumb" in node["classes"]
    ]
    if len(thumbnails) != 1:
        errors.append("缩略图切换必须由唯一的v-for HUI按钮模板生成")

    canonical_spec = json.dumps(
        spec, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    expected_hash = hashlib.sha256(canonical_spec.encode("utf-8")).hexdigest()
    meta_hash = next(
        (
            node["attrs"].get("content")
            for node in parser.nodes
            if node["tag"] == "meta"
            and node["attrs"].get("name") == "d2c-spec-sha256"
        ),
        None,
    )
    if meta_hash != expected_hash:
        errors.append("HTML与PageSpec哈希不一致")
    return errors


def validate_list_search(
    spec: dict[str, Any], html_path: Path, context: dict[str, Any]
) -> list[str]:
    manifest = context["manifest"]
    profile = context["profile"]
    product_tokens = context["product_tokens"]
    composition = context["composition"]
    options = spec["payload"]["options"]
    filter_options = options["filter"]
    toolbar_options = options["toolbar"]
    collection_options = options["collection"]

    source = html_path.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(source)
    errors: list[str] = []
    errors.extend(validate_runtime_contract(source, parser, manifest, html_path))
    try:
        errors.extend(validate_semantic_html(source, composition))
    except SemanticRegistryError as exc:
        errors.append(str(exc))

    unresolved = sorted(set(re.findall(r"__[A-Z_]+__|D2C:[A-Z_]+", source)))
    if unresolved:
        errors.append(f"存在未解析模板哨兵: {unresolved}")

    duplicate_nodes = [
        f"{node['tag']}:{node['duplicate_attrs']}"
        for node in parser.nodes
        if node["duplicate_attrs"]
    ]
    if duplicate_nodes:
        errors.append(f"存在重复HTML属性: {duplicate_nodes}")

    style = "\n".join(parser.styles)
    for name, value in product_tokens["overrides"].items():
        pattern = rf"{re.escape(name)}\s*:\s*{re.escape(value)}\s*!important\s*;"
        if not re.search(pattern, style):
            errors.append(f"缺少产品Token覆盖: {name}")
    for name, value in profile["geometry_roles"].items():
        var_name = f"--d2c-{name}"
        pattern = rf"{re.escape(var_name)}\s*:\s*{re.escape(value)}\s*;"
        if not re.search(pattern, style):
            errors.append(f"产品几何角色不一致: {var_name}={value}")

    css_without_geometry = re.sub(
        r"\.product-isc\s*\{.*?\}",
        "",
        style,
        flags=re.S,
    )
    css_without_geometry = css_without_geometry.replace(
        profile["breakpoints"]["compact"], ""
    )
    raw_px = sorted(set(re.findall(r"\b\d+(?:\.\d+)?px\b", css_without_geometry)))
    if raw_px:
        errors.append(f"模板绕过Product Profile声明裸px: {raw_px}")

    allowed_hui = set(context["runtime_contracts"])
    used_hui = {node["tag"] for node in parser.nodes if node["tag"].startswith("el-")}
    unknown_hui = sorted(used_hui - allowed_hui)
    if unknown_hui:
        errors.append(f"使用了Manifest未声明的HUI组件: {unknown_hui}")

    business_zones = set(composition["zones"])
    forbidden_native = sorted(
        {
            node["tag"]
            for node in parser.nodes
            if node["zone"] in business_zones
            and node["tag"] in {"button", "input", "select", "table"}
        }
    )
    if forbidden_native:
        errors.append(f"业务zone使用原生控件: {forbidden_native}")

    for field_id in filter_options["fields"]:
        field = composition["filter_fields"][field_id]
        candidates = [
            node
            for node in parser.nodes
            if node_matches(node, tag="el-form-item", zone="event.filter")
            and node["attrs"].get("label") == field["label"]
        ]
        if len(candidates) != 1:
            errors.append(f"筛选字段实例不唯一: {field_id}")
            continue
        expected_visibility = "filterExpanded" if field["visibility"] == "expanded" else None
        actual_visibility = candidates[0]["attrs"].get("v-show")
        if actual_visibility != expected_visibility:
            errors.append(
                f"筛选字段可见性错误: {field_id}，期望{expected_visibility}，实际{actual_visibility}"
            )

    for action_id in toolbar_options["actions"]:
        action = composition["toolbar_actions"][action_id]
        candidates = [
            node
            for node in parser.nodes
            if node_matches(
                node,
                tag="el-button",
                zone="page.actions",
                attr=("data-action", action_id),
            )
        ]
        if len(candidates) != 1:
            errors.append(f"工具栏动作实例不唯一: {action_id}")
            continue
        attrs = candidates[0]["attrs"]
        expected = {
            "type": action["type"],
            "size": action["size"],
            "icon": action["icon"],
        }
        if action.get("event"):
            expected["@click"] = action["event"]
        if action.get("disabled"):
            expected[":disabled"] = action["disabled"]
        wrong = {
            key: (value, attrs.get(key))
            for key, value in expected.items()
            if attrs.get(key) != value
        }
        if wrong:
            errors.append(f"工具栏动作属性错误: {action_id}: {wrong}")

    for column_id in collection_options["columns"]:
        column = composition["table_columns"][column_id]
        candidates = [
            node
            for node in parser.nodes
            if node_matches(
                node,
                tag="el-table-column",
                zone="event.results",
                attr=("data-column", column_id),
            )
        ]
        if len(candidates) != 1:
            errors.append(f"表格列实例不唯一: {column_id}")
            continue
        expected = expected_column_attrs(column_id, column)
        attrs = candidates[0]["attrs"]
        wrong = {
            key: (value, attrs.get(key))
            for key, value in expected.items()
            if attrs.get(key) != value
        }
        if wrong:
            errors.append(f"表格列属性错误: {column_id}: {wrong}")

    for action_id in collection_options["row_actions"]:
        table_candidates = [
            node
            for node in parser.nodes
            if node_matches(
                node,
                tag="el-button",
                zone="event.results",
                attr=("data-row-action", action_id),
                ancestor_class="event-search-table__actions",
            )
        ]
        card_candidates = [
            node
            for node in parser.nodes
            if node_matches(
                node,
                tag="el-button",
                zone="event.results",
                attr=("data-row-action", action_id),
                ancestor_class="event-card-actions",
            )
        ]
        if len(table_candidates) != 1:
            errors.append(f"表格行操作实例不唯一: {action_id}")
        elif table_candidates[0]["attrs"].get("type") != "link":
            errors.append(f"表格行操作必须是link按钮: {action_id}")
        if len(card_candidates) != 1:
            errors.append(f"卡片操作实例不唯一: {action_id}")
        elif card_candidates[0]["attrs"].get("type") != "text":
            errors.append(f"卡片操作必须是text按钮: {action_id}")

    paginations = [
        node
        for node in parser.nodes
        if node_matches(node, tag="el-pagination", zone="page.pagination")
    ]
    if len(paginations) != 1:
        errors.append("分页器实例不唯一")
    else:
        attrs = paginations[0]["attrs"]
        expected_pagination = {
            ":page-size": "pageSize",
            "layout": "total, sizes, ->, prev, pager, next, jumper",
        }
        wrong = {
            key: (value, attrs.get(key))
            for key, value in expected_pagination.items()
            if attrs.get(key) != value
        }
        if wrong:
            errors.append(f"分页器属性错误: {wrong}")

    canonical_spec = json.dumps(
        spec, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    expected_hash = hashlib.sha256(canonical_spec.encode("utf-8")).hexdigest()
    meta_hash = next(
        (
            node["attrs"].get("content")
            for node in parser.nodes
            if node["tag"] == "meta"
            and node["attrs"].get("name") == "d2c-spec-sha256"
        ),
        None,
    )
    if meta_hash != expected_hash:
        errors.append("HTML与PageSpec哈希不一致")

    return errors


VALIDATORS = {}

if set(VALIDATORS) != PAGE_RENDERER_IDS:
    raise RuntimeError("HTML Validator实现与Renderer Registry不一致")


def validate_html(spec: dict[str, Any], html_path: Path) -> list[str]:
    context = load_context(spec)
    validate_spec(spec, context)
    resolved = resolve_spec(spec, context)
    validate_spec(resolved, context)
    renderer_id = context["composition"].get("renderer")
    validator = VALIDATORS.get(renderer_id)
    if validator is None:
        raise ContractError(f"未登记HTML Validator: {renderer_id}")
    return validator(resolved, html_path, context)


def main() -> int:
    parser = argparse.ArgumentParser(description="验证D2C编译页面")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    try:
        spec = load_json(args.spec.resolve())
        errors = validate_html(spec, args.html.resolve())
    except (ContractError, OSError) as exc:
        errors = [str(exc)]

    report = {
        "passed": not errors,
        "html": str(args.html),
        "spec": str(args.spec),
        "errors": errors,
    }
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    if errors:
        print(f"[FAIL] {args.html}")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"[PASS] {args.html}")
    print("  ✓ PageSpec contract")
    print("  ✓ Zone、Component Pattern与HUI Atom语义层级")
    print("  ✓ Product tokens and geometry roles")
    print("  ✓ Page Composition semantics")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
