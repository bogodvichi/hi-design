#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from copy import deepcopy
from pathlib import Path

from semantic_registry import SemanticRegistryError, assert_semantic_html
from renderer_registry import PAGE_RENDERER_IDS, template_for_renderer

from core import (
    ContractError,
    ROOT,
    build_vue_data,
    load_context,
    load_json,
    render_card_fields,
    render_extensions,
    render_filter_fields,
    render_geometry_roles,
    render_product_tokens,
    render_row_action_buttons,
    render_table_columns,
    render_toolbar_actions,
    render_video_mode_switch,
    render_view_switch,
    resolve_spec,
    validate_spec,
)


def replace_block(source: str, name: str, value: str, style: str = "html") -> str:
    if style == "html":
        start = rf"<!--\s*D2C:{re.escape(name)}:START\s*-->"
        end = rf"<!--\s*D2C:{re.escape(name)}:END\s*-->"
    elif style == "css":
        start = rf"/\*\s*D2C:{re.escape(name)}:START\s*\*/"
        end = rf"/\*\s*D2C:{re.escape(name)}:END\s*\*/"
    else:
        raise ContractError(f"未知模板哨兵类型: {style}")
    pattern = start + r".*?" + end
    updated, count = re.subn(pattern, value, source, count=1, flags=re.S)
    if count != 1:
        raise ContractError(f"模板缺少唯一哨兵区间: {name}")
    return updated


def replace_marked_tag(
    source: str,
    marker_attr: str,
    replacements: dict[str, str],
) -> str:
    marker_pattern = re.escape(marker_attr)
    pattern = rf"<(?P<tag>[a-zA-Z0-9-]+)(?P<attrs>[^>]*\s{marker_pattern}(?:=\"[^\"]*\")?[^>]*)>"

    def update(match: re.Match[str]) -> str:
        attrs = match.group("attrs")
        for name, value in replacements.items():
            escaped = value.replace("&", "&amp;").replace('"', "&quot;")
            attr_pattern = rf"\b{re.escape(name)}=\"[^\"]*\""
            attrs, count = re.subn(
                attr_pattern, f'{name}="{escaped}"', attrs, count=1
            )
            if count != 1:
                raise ContractError(f"标记节点缺少属性: {marker_attr}.{name}")
        attrs = re.sub(
            rf"\s+{marker_pattern}(?:=\"[^\"]*\")?",
            "",
            attrs,
            count=1,
        )
        return f"<{match.group('tag')}{attrs}>"

    updated, count = re.subn(pattern, update, source, count=1)
    if count != 1:
        raise ContractError(f"模板缺少唯一标记节点: {marker_attr}")
    return updated


def replace_marked_text_tag(source: str, marker_attr: str, value: str) -> str:
    marker_pattern = re.escape(marker_attr)
    pattern = (
        rf"<(?P<tag>[a-zA-Z0-9-]+)"
        rf"(?P<attrs>[^>]*\s{marker_pattern}[^>]*)>"
        rf".*?</(?P=tag)>"
    )

    def update(match: re.Match[str]) -> str:
        attrs = re.sub(
            rf"\s+{marker_pattern}",
            "",
            match.group("attrs"),
            count=1,
        )
        escaped = (
            value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        tag = match.group("tag")
        return f"<{tag}{attrs}>{escaped}</{tag}>"

    updated, count = re.subn(pattern, update, source, count=1, flags=re.S)
    if count != 1:
        raise ContractError(f"模板缺少唯一文本标记节点: {marker_attr}")
    return updated


def load_product_shell_assets(product: str) -> tuple[str, str, str, str]:
    product_root = ROOT / "assets" / "templates" / "products" / product
    hui_root = ROOT / "assets" / "templates" / "HUI"
    requested = {
        "styles": (product_root / "styles" / "portal.css", hui_root / "styles" / "portal.css"),
        "start": (product_root / "shells" / "portal-start.html", hui_root / "shells" / "portal-start.html"),
        "end": (product_root / "shells" / "portal-end.html", hui_root / "shells" / "portal-end.html"),
    }
    selected = {
        key: product_path if product_path.is_file() else hui_path
        for key, (product_path, hui_path) in requested.items()
    }
    missing = [str(path.relative_to(ROOT)) for path in selected.values() if not path.is_file()]
    if missing:
        raise ContractError(f"产品壳子资产不完整: {missing}")
    source = (
        f"product:{product}"
        if all(path == requested[key][0] for key, path in selected.items())
        else "HUI"
    )
    return (
        selected["styles"].read_text(encoding="utf-8"),
        selected["start"].read_text(encoding="utf-8"),
        selected["end"].read_text(encoding="utf-8"),
        source,
    )


def compile_detail_workspace(spec: dict, context: dict) -> str:
    manifest = context["manifest"]
    profile = context["profile"]
    product_tokens = context["product_tokens"]
    composition = context["composition"]
    defaults = context["fixture"]
    template = (
        ROOT / template_for_renderer(composition["renderer"])
    ).read_text(encoding="utf-8")
    detail = spec["payload"]["content"]
    shell = spec["shell"]
    tabs = deepcopy(detail.get("tabs", defaults["tabs"]))
    quick_tags = [
        {"label": label, "checked": False}
        for label in detail.get("quickTags", defaults["quickTags"])
    ]
    portal = composition["portal"]
    vue_data = {
        "sidebarCollapsed": False,
        "ledgerExpanded": True,
        "brandName": portal["brand_name"],
        "topMenus": portal["top_menus"],
        "activeTopMenu": shell.get(
            "active_top_menu", portal["top_menus"][0]
        ),
        "sideMenus": portal["side_menus"],
        "activeSideMenu": shell.get(
            "active_side_menu", portal["side_menus"][0]["id"]
        ),
        "pageTabTitle": shell.get("tab_title", spec["title"]),
        "globalKeyword": "",
        "activeTab": tabs[0]["value"] if tabs else "realtime",
        "tabs": tabs,
        "device": deepcopy(detail.get("device", defaults["device"])),
        "thumbnails": deepcopy(detail.get("thumbnails", defaults["thumbnails"])),
        "activeThumbnailIndex": 0,
        "monitorPoints": deepcopy(
            detail.get("monitorPoints", defaults["monitorPoints"])
        ),
        "activeSourceIndex": 0,
        "deviceInfo": deepcopy(detail.get("deviceInfo", defaults["deviceInfo"])),
        "metrics": deepcopy(detail.get("metrics", defaults["metrics"])),
        "operationTypes": composition["operation_types"],
        "operationForm": {
            "type": composition["operation_types"][0],
            "comment": "",
        },
        "quickTags": quick_tags,
    }
    page_config_keys = {
        "brandName", "topMenus", "sideMenus", "pageTabTitle", "tabs",
        "operationTypes",
    }
    preview_fixture_keys = {
        "device", "thumbnails", "monitorPoints", "deviceInfo", "metrics",
        "quickTags",
    }
    page_config = {key: vue_data[key] for key in page_config_keys}
    preview_fixtures = {key: vue_data[key] for key in preview_fixture_keys}
    reactive_data = {
        key: value
        for key, value in vue_data.items()
        if key not in page_config_keys and key not in preview_fixture_keys
    }
    reactive_data.update({
        "device": {}, "thumbnails": [], "monitorPoints": [],
        "deviceInfo": [], "metrics": [], "quickTags": [],
    })

    template = replace_marked_text_tag(
        template, "data-d2c-page-title", spec["title"]
    )
    template = replace_block(
        template, "PRODUCT_TOKENS", render_product_tokens(product_tokens), style="css"
    )
    template = replace_block(
        template, "GEOMETRY_ROLES", render_geometry_roles(profile), style="css"
    )
    template, breakpoint_count = re.subn(
        r"[0-9.]+px\s*/\*\s*D2C:COMPACT_BREAKPOINT\s*\*/",
        profile["breakpoints"]["compact"],
        template,
        count=1,
    )
    if breakpoint_count != 1:
        raise ContractError("模板缺少唯一COMPACT_BREAKPOINT哨兵")

    resources = {
        "hui-css": ("href", manifest["resources"]["css"]),
        "vue": ("src", manifest["resources"]["vue"]),
        "hui": ("src", manifest["resources"]["hui"]),
    }
    for marker, (attribute, value) in resources.items():
        template = replace_marked_tag(
            template, f'data-d2c-resource="{marker}"', {attribute: value}
        )
    template = replace_marked_tag(
        template,
        "data-d2c-product-brand",
        {"src": profile["brand"]["logo"], "alt": portal["brand_name"]},
    )
    template = replace_block(
        template,
        "PAGE_CONFIG",
        json.dumps(page_config, ensure_ascii=False, indent=6),
        style="css",
    )
    template = replace_block(
        template,
        "PREVIEW_FIXTURES",
        json.dumps(preview_fixtures, ensure_ascii=False, indent=6),
        style="css",
    )
    template = replace_block(
        template,
        "VUE_DATA",
        json.dumps(reactive_data, ensure_ascii=False, indent=10),
        style="css",
    )

    canonical_spec = json.dumps(
        spec, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    spec_hash = hashlib.sha256(canonical_spec.encode("utf-8")).hexdigest()
    template = template.replace(
        "<head>",
        f'<head>\n  <meta name="d2c-spec-sha256" content="{spec_hash}">',
        1,
    )
    unresolved = sorted(set(re.findall(r"__[A-Z_]+__|D2C:[A-Z_]+", template)))
    if unresolved:
        raise ContractError(f"模板存在未解析哨兵: {unresolved}")
    return template


def compile_list_search(spec: dict, context: dict) -> str:
    manifest = context["manifest"]
    profile = context["profile"]
    product_tokens = context["product_tokens"]
    composition = context["composition"]
    options = spec["payload"]["options"]
    filter_options = options["filter"]
    toolbar_options = options["toolbar"]
    collection_options = options["collection"]
    template_path = ROOT / template_for_renderer(composition["renderer"])
    template = template_path.read_text(encoding="utf-8")

    canonical_spec = json.dumps(
        spec, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    spec_hash = hashlib.sha256(canonical_spec.encode("utf-8")).hexdigest()
    vue_data = build_vue_data(spec, profile, composition, context["fixture"])
    page_config_keys = {
        "topMenus", "sideMenus", "pageTabTitle", "eventTypeModes", "areas",
        "deviceTypes", "levels", "statuses",
    }
    preview_fixture_keys = {"eventTypes", "eventRuleNames", "total", "rows"}
    page_config = {key: vue_data[key] for key in page_config_keys}
    shell_styles, shell_start, shell_end, shell_source = load_product_shell_assets(
        spec["product"]
    )
    page_config.update({
        "product_name": profile["brand"]["name"],
        "product_logo": profile["brand"]["logo"],
        "top_menus": vue_data["topMenus"],
        "portal": {
            "active_top_menu": vue_data["activeTopMenu"],
            "tab_title": vue_data["pageTabTitle"],
            "side_menus": vue_data["sideMenus"],
            "active_side_menu": vue_data["activeSideMenu"],
        },
        "product_shell_source": shell_source,
    })
    shell_styles, shell_start, shell_end, shell_source = load_product_shell_assets(
        spec["product"]
    )
    page_config.update({
        "product_name": profile["brand"]["name"],
        "product_logo": profile["brand"]["logo"],
        "top_menus": vue_data["topMenus"],
        "portal": {
            "active_top_menu": vue_data["activeTopMenu"],
            "tab_title": vue_data["pageTabTitle"],
            "side_menus": vue_data["sideMenus"],
            "active_side_menu": vue_data["activeSideMenu"],
        },
        "product_shell_source": shell_source,
    })
    preview_fixtures = {key: vue_data[key] for key in preview_fixture_keys}
    reactive_data = {
        key: value
        for key, value in vue_data.items()
        if key not in page_config_keys and key not in preview_fixture_keys
    }
    reactive_data.update({
        "eventTypes": [], "eventRuleNames": [], "total": 0, "rows": [],
    })
    card_actions = render_row_action_buttons(
        collection_options["row_actions"], composition, "row", "text"
    )

    html_blocks = {
        "FILTER_FIELDS": render_filter_fields(filter_options["fields"], composition),
        "TOOLBAR_ACTIONS": render_toolbar_actions(
            toolbar_options["actions"], composition
        ),
        "VIEW_SWITCH": render_view_switch(toolbar_options["view_switch"]),
        "VIDEO_MODE_SWITCH": render_video_mode_switch(
            toolbar_options["video_mode_switch"]
        ),
        "EXTENSIONS_AFTER_TOOLBAR": render_extensions(options["extensions"]),
        "TABLE_COLUMNS": render_table_columns(
            collection_options["columns"], collection_options["row_actions"], composition
        ),
        "CARD_FIELDS": render_card_fields(collection_options["card_fields"], composition),
        "CARD_ACTIONS": "\n".join(
            f"                        {line}" for line in card_actions.splitlines()
        ),
    }
    for name, value in html_blocks.items():
        template = replace_block(template, name, value)
    template = replace_block(
        template, "PRODUCT_SHELL_STYLES", shell_styles, style="css"
    )
    template = replace_block(template, "PRODUCT_SHELL_START", shell_start)
    template = replace_block(template, "PRODUCT_SHELL_END", shell_end)
    template = replace_marked_text_tag(
        template, "data-d2c-page-title", spec["title"]
    )

    template = replace_block(
        template, "PRODUCT_TOKENS", render_product_tokens(product_tokens), style="css"
    )
    template = replace_block(
        template, "GEOMETRY_ROLES", render_geometry_roles(profile), style="css"
    )
    template, breakpoint_count = re.subn(
        r"[0-9.]+px\s*/\*\s*D2C:COMPACT_BREAKPOINT\s*\*/",
        profile["breakpoints"]["compact"],
        template,
        count=1,
    )
    if breakpoint_count != 1:
        raise ContractError("模板缺少唯一COMPACT_BREAKPOINT哨兵")

    resources = {
        "hui-css": ("href", manifest["resources"]["css"]),
        "vue": ("src", manifest["resources"]["vue"]),
        "hui": ("src", manifest["resources"]["hui"]),
    }
    for marker, (attribute, value) in resources.items():
        template = replace_marked_tag(
            template,
            f'data-d2c-resource="{marker}"',
            {attribute: value},
        )
    template = replace_block(
        template,
        "PAGE_CONFIG",
        json.dumps(page_config, ensure_ascii=False, indent=6),
        style="css",
    )
    template = replace_block(
        template,
        "PREVIEW_FIXTURES",
        json.dumps(preview_fixtures, ensure_ascii=False, indent=6),
        style="css",
    )
    vue_json = json.dumps(reactive_data, ensure_ascii=False, indent=10)
    template = replace_block(template, "VUE_DATA", vue_json, style="css")

    template = template.replace(
        "<head>",
        f'<head>\n  <meta name="d2c-spec-sha256" content="{spec_hash}">',
        1,
    )
    unresolved = sorted(set(re.findall(r"__[A-Z_]+__|D2C:[A-Z_]+", template)))
    if unresolved:
        raise ContractError(f"模板存在未解析哨兵: {unresolved}")
    return template


RENDERERS = {}

if set(RENDERERS) != PAGE_RENDERER_IDS:
    raise RuntimeError("HTML Renderer实现与Renderer Registry不一致")


def compile_page(spec: dict) -> str:
    context = load_context(spec)
    validate_spec(spec, context)
    resolved = resolve_spec(spec, context)
    validate_spec(resolved, context)
    renderer_id = context["composition"].get("renderer")
    renderer = RENDERERS.get(renderer_id)
    if renderer is None:
        raise ContractError(f"未登记HTML Renderer: {renderer_id}")
    html = renderer(resolved, context)
    try:
        assert_semantic_html(html, context["composition"])
    except SemanticRegistryError as exc:
        raise ContractError(str(exc)) from exc
    return html


def main() -> int:
    parser = argparse.ArgumentParser(description="将PageSpec编译为HUI Vue HTML")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        spec = load_json(args.spec.resolve())
        html = compile_page(spec)
        out = args.out.resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
    except (ContractError, SemanticRegistryError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
