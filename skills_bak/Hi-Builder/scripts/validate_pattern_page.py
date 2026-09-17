#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from compile_pattern_page import (
    PatternPageError,
    hui_fallback_context,
    load_pattern,
    materialize_pattern_spec,
    product_logo_for_output,
    validate_spec,
)
from core import ContractError, load_json, load_product_context
from renderer_registry import renderer_for_pattern_kind
from semantic_registry import validate_semantic_html
from validate_page import PageParser, validate_runtime_contract


ROOT = Path(__file__).resolve().parents[1]


def extract_frozen_json(source: str, name: str) -> dict[str, Any] | None:
    match = re.search(
        rf"const\s+{re.escape(name)}\s*=\s*Object\.freeze\((\{{.*?\}})\);",
        source,
        flags=re.DOTALL,
    )
    if not match:
        return None
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def validate_pattern_html(
    spec: dict[str, Any], html_path: Path
) -> list[str]:
    spec = materialize_pattern_spec(spec)
    validate_spec(spec)
    try:
        context = load_product_context(
            spec["industry"], spec["product"], spec.get("shell_standard"),
            spec.get("product_version")
        )
        matched_product = True
    except ContractError as exc:
        context = hui_fallback_context(spec, str(exc))
        matched_product = False
    source = html_path.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(source)
    errors = validate_runtime_contract(
        source, parser, context["manifest"], html_path
    )
    errors.extend(validate_semantic_html(source))
    page_config = extract_frozen_json(source, "PAGE_CONFIG")
    preview_fixtures = extract_frozen_json(source, "PREVIEW_FIXTURES")
    if page_config is None:
        errors.append("HTML缺少可解析的PAGE_CONFIG")
    elif "preview" in page_config:
        errors.append("PAGE_CONFIG不得包含Pattern PageSpec的preview模拟数据")
    if preview_fixtures is None:
        errors.append("HTML缺少可解析的PREVIEW_FIXTURES")
    elif preview_fixtures != spec.get("preview"):
        errors.append("PREVIEW_FIXTURES必须原样来自Pattern PageSpec.preview")
    composition = spec.get("knowledge_composition")
    if composition and page_config is not None:
        resolution = page_config.get("composition_resolution", {})
        if resolution.get("status") != "verified":
            errors.append("组合页面缺少已验证的composition_resolution")
        if resolution.get("contribution") != composition.get("expected_contribution"):
            errors.append("组合页面运行配置未记录AI声明的辅助能力")
        if len(page_config.get("pattern_ids", [])) != 2:
            errors.append("组合页面必须记录一个主Variant和一个辅助Variant")
        if composition.get("expected_contribution") == "summary.metrics":
            if 'data-zone="summary.metrics"' not in source or "<h-stats" not in source:
                errors.append("统计辅助Variant未生成summary.metrics区域")
        if composition.get("expected_contribution") == "filter.instant-filter":
            parameters = page_config.get("pattern_parameters", {})
            if parameters.get("trigger") != "realtime":
                errors.append("即时过滤辅助Variant未合并realtime触发参数")
            if parameters.get("filter_placement") != "horizontal-bar":
                errors.append("即时过滤辅助Variant未合并顶部横栏布局参数")
    for marker, message in (
        (
            "Object.prototype.hasOwnProperty.call(vm.$data, key)",
            "loadPreviewFixtures必须只写入data()已声明的同名状态",
        ),
        (
            "key !== 'config'",
            "loadPreviewFixtures必须禁止覆盖config",
        ),
        (
            "cloneRuntimeValue(PREVIEW_FIXTURES)",
            "loadPreviewFixtures必须深复制PREVIEW_FIXTURES",
        ),
    ):
        if marker not in source:
            errors.append(message)
    renderer = renderer_for_pattern_kind(spec["page_kind"])
    if f'"renderer": "{renderer}"' not in source:
        errors.append(f"HTML缺少已登记Renderer标识: {renderer}")
    brand = context["profile"]["brand"]
    if "data-d2c-product-brand" not in source:
        errors.append("HTML缺少产品品牌Logo标识")
    expected_logo = product_logo_for_output(brand["logo"], html_path)
    if page_config is not None:
        rendered_logo = page_config.get("product_logo")
        rendered_logo_path = (
            (html_path.resolve().parent / rendered_logo).resolve()
            if isinstance(rendered_logo, str)
            else None
        )
        packaged_logo = bool(
            isinstance(rendered_logo, str)
            and rendered_logo.startswith("./")
            and rendered_logo_path is not None
            and rendered_logo_path.parent == html_path.resolve().parent
            and rendered_logo_path.name == Path(brand["logo"]).name
            and rendered_logo_path.is_file()
        )
        if rendered_logo != expected_logo and not packaged_logo:
            errors.append("HTML未按实际输出位置生成产品Logo相对路径")
        if rendered_logo_path is None or not rendered_logo_path.is_file():
            errors.append("HTML中的产品Logo本地路径无效")
    if "portal-logo-mark" in source:
        errors.append("HTML不得使用通用占位Logo替代产品Logo")
    uses_product_shell = '"product_shell_source": "product:' in source
    if uses_product_shell:
        if context.get("portal_shell_standard") in {"personnel-management", "isc-3.0.0"}:
            for shell_marker in (
                "isc-personnel-header", "isc-personnel-sidebar",
                "isc-personnel-side-menu",
            ):
                if shell_marker not in source:
                    errors.append(f"HTML缺少人员管理Portal Shell结构: {shell_marker}")
            if '"product_shell_source": "product:isc/personnel-management"' not in source:
                errors.append("HTML缺少人员管理Portal Shell来源标识")
            portal_config = page_config.get("portal", {}) if page_config else {}
            expects_context_sidebar = spec["portal"].get("show_context_sidebar", False)
            if portal_config.get("show_context_sidebar") != expects_context_sidebar:
                errors.append("人员管理Portal Shell组织树显示配置与PageSpec不一致")
            if 'v-if="config.portal.show_context_sidebar"' not in source:
                errors.append("人员管理Portal Shell组织树必须受页面配置控制")
            if expects_context_sidebar:
                for context_marker in (
                    "isc-personnel-context-sidebar", "portalContextTree",
                ):
                    if context_marker not in source:
                        errors.append(f"人员列表缺少组织树结构: {context_marker}")
            personnel_knowledge = context["portal_shell"].get(
                "personnel_management", {}
            )
            matched_personnel_pages = [
                page_id
                for page_id, page in personnel_knowledge.get("pages", {}).items()
                if spec.get("id") in page.get("spec_ids", [])
            ]
            if matched_personnel_pages:
                personnel_policy = (
                    page_config.get("personnel_page_policy", {})
                    if page_config else {}
                )
                if personnel_policy.get("page") != matched_personnel_pages[0]:
                    errors.append("人员管理页面未消费匹配的产品级Composition")
                if matched_personnel_pages[0] in {"add_form", "detail"}:
                    for tab_marker, message in (
                        (
                            "margin: 0 !important; padding: 0 12px",
                            "人员管理Tab未消费左右各12px内边距",
                        ),
                        (
                            ".page-breadcrumb__tab:hover,",
                            "人员管理Tab缺少悬浮态规则",
                        ),
                        (
                            "text-decoration: none !important",
                            "人员管理Tab悬浮态未关闭文本下划线",
                        ),
                        (
                            ".page-breadcrumb__tab.is-active::after",
                            "人员管理Tab缺少激活指示器",
                        ),
                    ):
                        if tab_marker not in source:
                            errors.append(message)
        else:
            for shell_marker in (
                "portal-pill", "portal-side-collapse", "portal-side-submenu"
            ):
                if shell_marker not in source:
                    errors.append(f"HTML缺少产品Portal Shell结构: {shell_marker}")
            for icon_class in (
                "h-icon-menu_leftbar", "h-icon-qrcode", "h-icon-share"
            ):
                if icon_class not in source:
                    errors.append(f"HTML缺少产品Portal Shell图标: {icon_class}")
            if "text-decoration: none !important;" not in source:
                errors.append("产品侧栏菜单必须清除HUI文本按钮的悬浮下划线")
    else:
        if "hui-tpp-shell product-context" not in source:
            errors.append("未提供产品专属Shell时必须使用HUI默认Portal Shell")
        if '"product_shell_source": "HUI"' not in source:
            errors.append("使用HUI默认Portal Shell时必须登记Shell来源")
        leaf_menu_with_manual_icon = re.search(
            r"<el-nav-item\b[^>]*>(?:(?!</el-nav-item>).)*<i\b[^>]*\bitem\.icon\b",
            source,
            flags=re.DOTALL,
        )
        if leaf_menu_with_manual_icon:
            errors.append(
                "HUI叶子菜单不得手工渲染图标；一级分组图标必须通过el-subnav的icon API输出"
            )
    runtime_parameters = page_config.get("pattern_parameters", {}) if page_config else {}
    if spec.get("filters") and runtime_parameters.get("trigger") != "realtime":
        if ".query-filter__form .el-form-item { margin-bottom: 0; }" not in source:
            errors.append("query.filter必须清除表单项底部间距，避免与容器内边距叠加")
        behavior = load_json(
            ROOT
            / "design-systems/HUI/component-patterns/filter.search-form/contract.json"
        ).get("fixed_behavior", {})
        if page_config is not None and page_config.get("filter_search_form_behavior") != behavior:
            errors.append("标准筛选表单必须消费filter.search-form公共固定行为")
    elif page_config is not None and runtime_parameters.get("trigger") == "realtime":
        if page_config.get("filter_search_form_behavior") is not None:
            errors.append("即时过滤页面不得注入标准查询表单行为")
        instant_filter = load_json(
            ROOT
            / "design-systems/HUI/component-patterns/filter.instant-filter/contract.json"
        ).get("fixed_behavior", {})
        if instant_filter.get("selected_state_font_size") != "14px":
            errors.append("即时过滤公共合同必须规定已选条件字号为14px")
        if (
            ".realtime-filter-sidebar__selected .el-button { font-size: 14px; }"
            not in source
        ):
            errors.append("即时过滤已选条件区域必须统一使用14px字号")
    pattern = load_pattern(spec["pattern_contract"])
    if pattern.get("family") == "hui.tpp.family.table-manual-filter":
        parameters = pattern.get("parameters", {})
        placement = parameters.get("filter_placement")
        collapse_mode = parameters.get("collapse_mode")
        filters = spec.get("filters", [])
        filter_kinds = {item.get("kind") for item in filters}
        if placement == "regular-box":
            unsupported = filter_kinds - {"input", "select", "date", "date-range", "time"}
            if unsupported:
                errors.append(f"常规过滤不得使用水平Tab变量类型: {sorted(unsupported)}")
            if collapse_mode == "high-low-frequency" and len(filters) <= 4:
                errors.append("常规高低频过滤必须提供超过4个条件以验证换行和展开收起")
            if collapse_mode == "all-retractable" and len(filters) != 4:
                errors.append("全量可收起常规过滤盒必须匹配证据中的4项单行控件")
            if "query-filter--regular" not in source or "query-filter--boxed" not in source:
                errors.append("表格Renderer缺少常规过滤与过滤盒的独立结构")
            if "this.config.filters.slice(0, 3)" not in source:
                errors.append("常规过滤收起态必须保留3个条件，并由查询/重置占据第4列")
            if "grid-template-columns: repeat(4, minmax(0, 1fr))" not in source:
                errors.append("常规过滤必须使用包含查询操作位的四列栅格")
            if ".query-filter__actions { display: flex; grid-column: 4;" not in source:
                errors.append("常规过滤查询/重置必须固定在最后一行第4列")
        elif placement == "horizontal-bar":
            if "checkable-tags" not in filter_kinds:
                errors.append("水平栏过滤必须使用checkable-tags表达Tab选项")
            if "radio" in filter_kinds:
                errors.append("水平栏过滤不得使用radio变量冒充Tab选项")
            if "date-range" not in filter_kinds:
                errors.append("水平栏过滤必须包含证据登记的日期范围控件")
            if "manual-horizontal-filter__tabs" not in source or "el-checkable-tag" not in source:
                errors.append("表格Renderer缺少水平栏Tab选项过滤结构")
            if collapse_mode == "all-retractable" and "manual-horizontal-filter--boxed" not in source:
                errors.append("全量可收起水平栏必须使用带背景过滤容器")
        elif placement == "left-sidebar":
            unsupported = filter_kinds - {"input", "select"}
            if unsupported:
                errors.append(f"侧边栏过滤只允许输入与选择控件: {sorted(unsupported)}")
            if "manual-filter-sidebar" not in source:
                errors.append("表格Renderer缺少独立左侧手动过滤栏")
    if pattern.get("family") == "hui.tpp.family.table-tabs":
        parameters = pattern.get("parameters", {})
        required_config = ("toolbar_actions", "columns", "table_tabs")
        if not (page_config or {}).get("field_configuration"):
            required_config = ("filters",) + required_config
        if page_config is not None:
            missing = [key for key in required_config if not page_config.get(key)]
            if missing:
                errors.append(f"标签页表格缺少必需生成配置: {missing}")
        for marker, message in (
            ('class="table-tabs-navigation"', "标签页表格缺少数据集Tabs"),
            ('class="collection-main h-layout"', "标签页表格主区域必须使用h-layout"),
            ('v-if="isTableTabsSearch" class="query-filter query-filter--regular table-tabs-search"', "标签页表格缺少主内容区筛选条件"),
            ('data-zone="page.actions"', "标签页表格缺少操作栏"),
            ('data-component="table.data-table"', "标签页表格缺少数据表格"),
            ('data-zone="page.pagination"', "标签页表格缺少分页"),
            ('.table-tabs-navigation .el-tabs__content { display: none; }', "标签页表格必须明确折叠仅用于导航的空Tabs内容区"),
            ('v-for="field in visibleFilters"', "标签页表格必须复用公共筛选项展开收起逻辑"),
            ('v-if="hasCollapsibleFilters"', "标签页表格必须复用公共筛选展开收起操作"),
        ):
            if marker not in source:
                errors.append(message)
        tabs_end = source.find('</el-tabs>', source.find('class="table-tabs-navigation"'))
        layout_start = source.find('class="collection-main h-layout"')
        if tabs_end == -1 or layout_start == -1 or tabs_end > layout_start:
            errors.append("标签页表格的Tabs必须与后续h-layout保持兄弟顺序")
        if not re.search(
            r'<el-tab-pane\s+v-for="tab in config\.table_tabs"[^>]*></el-tab-pane>',
            source,
        ):
            errors.append("标签页表格的el-tab-pane必须保持无主体内容")
        if parameters.get("tree"):
            for marker, message in (
                ('v-if="hasTableTree" class="h-page-sidebar-wrapper table-tree-sidebar"', "带树标签页表格缺少标准Sidebar包装"),
                ('class="h-page-sidebar"', "带树标签页表格缺少h-page-sidebar"),
                ('class="h-page-sidebar__search"', "带树标签页表格缺少Sidebar搜索区"),
                ('class="h-page-sidebar__main"', "带树标签页表格缺少Sidebar树内容区"),
            ):
                if marker not in source:
                    errors.append(message)
            if page_config is not None and (
                not page_config.get("tree_nodes")
                or not page_config.get("default_tree_node")
            ):
                errors.append("带树标签页表格缺少树演示配置")
    if pattern.get("family") == "hui.tpp.family.form-anchored":
        anchor_rules = {
            "margin-right: calc(-1 * var(--d2c-page-form-content-inline-padding))": "表单滚动条必须延伸到白色内容区右侧",
            "margin-top: calc(-1 * var(--d2c-page-form-content-padding-top))": "表单滚动条顶部不得受content内边距约束",
            "position: relative; z-index: 1": "表单滚动层必须位于锚点面板下方",
            ".form-area.is-anchored-form { gap: 24px; }": "白色表单内容区与常驻锚点之间必须保留24px灰色间距",
            "flex: 1 1 auto; width: min(1280px, calc(100% - 204px))": "白色表单内容区必须为灰底锚点栏预留宽度",
            "position: static; z-index: 2; width: 180px; flex: none; align-self: start": "常驻锚点必须参与外层布局并位于白色内容区右侧",
            "padding: 48px 0 0; background: transparent; box-shadow: none": "常驻锚点必须显示在灰色页面底上且无白色浮层",
            ".permission-form .el-row { display: flex; flex-wrap: wrap; align-items: flex-start; }": "多列表单必须按字段顺序稳定换行",
            ".permission-form .el-row > .el-col { float: none; }": "多列表单不得继续使用浮动列布局",
        }
        for marker, message in anchor_rules.items():
            if marker not in source:
                errors.append(message)
        form_end = source.find("</el-form>", source.find('ref="permissionForm"'))
        scroll_end = source.find("</div>", form_end)
        anchor_start = source.find('class="form-anchor-nav"')
        footer_start = source.find('class="form-area__footer"')
        if (
            form_end == -1
            or scroll_end == -1
            or footer_start == -1
            or anchor_start < footer_start
        ):
            errors.append("常驻锚点必须位于白色内容区之外的灰色页面底上")
        if "margin-bottom: calc(-1 * var(--d2c-page-form-content-padding-bottom))" in source:
            errors.append("表单滚动条不得越过固定操作栏")
        persistent_anchor = (
            '<h-anchor :affix="true" container=".permission-form-scroll">'
            '<h-anchor-link v-for="section in visibleFormSections"'
        )
        if persistent_anchor not in source.replace("\n", "").replace("  ", ""):
            errors.append("常驻表单锚点必须使用HAnchor并绑定表单滚动容器")
    if pattern.get("family") == "hui.tpp.family.table-details-pane":
        for marker in (
            'class="collection-main h-layout"', 'class="table-detail-pane"',
            'data-zone="detail.content"',
            'data-component="detail.details-pane"',
            "@row-click=\"selectDetailRow\"",
        ):
            if marker not in source:
                errors.append(f"详情栏表格页缺少选择联动结构: {marker}")
        if "--d2c-page-table-details-width: 431px" not in source:
            errors.append("详情栏表格页未使用Variant合同登记的详情栏宽度")
        separators = pattern.get("parameters", {}).get("separators", {})
        filter_separator = separators.get("filter_toolbar", {})
        if (
            filter_separator.get("owner") != ".query-filter::after"
            or filter_separator.get("mechanism") != "pseudo-element"
            or filter_separator.get("token") != "--h-color-border-tertiary"
        ):
            errors.append("详情栏Variant未正确登记筛选栏底部分割线")
        if ".query-filter::after" not in source:
            errors.append("详情栏表格页未渲染筛选栏底部分割线")
        master_separator = separators.get("master_details", {})
        if master_separator.get("token") != "--h-color-border-tertiary":
            errors.append("详情栏Variant未登记主列表与详情栏的边框token")
        if "table-detail-pane.has-master-divider::before" not in source:
            errors.append("详情栏表格页未渲染主列表与详情栏分隔线")
        expected_spacing = {
            "content_end_padding": "24px",
            "pane_width": "455px",
            "pane_padding": "8px 0px 40px 24px",
            "tabs_content_padding": "8px 0px",
            "container_margin": "0px -20px",
            "item_padding": "0px 0px 0px 20px",
            "item_margin": "0px 0px 24px",
            "title_height": "22px",
        }
        if pattern.get("parameters", {}).get("details_spacing") != expected_spacing:
            errors.append("详情栏Variant内部间距未完整继承典型页采集证据")
        for variable in (
            "--d2c-page-table-details-content-end-padding: 24px",
            "--d2c-page-table-details-pane-width: 455px",
            "--d2c-page-table-details-pane-padding: 8px 0px 40px 24px",
            "--d2c-page-table-details-tabs-content-padding: 8px 0px",
            "--d2c-page-table-details-container-margin: 0px -20px",
            "--d2c-page-table-details-item-padding: 0px 0px 0px 20px",
            "--d2c-page-table-details-item-margin: 0px 0px 24px",
            "--d2c-page-table-details-title-height: 22px",
        ):
            if variable not in source:
                errors.append(f"详情栏Renderer未消费典型页间距变量: {variable}")
        if "table-detail-pane__summary" in source:
            errors.append("详情栏不得插入典型页知识未登记的额外摘要卡")
        if "margin: 0; padding: var(--d2c-page-table-details-pane-padding" not in source:
            errors.append("详情栏必须使用内部padding，不得用外部margin模拟典型页间距")
    if pattern.get("family") == "hui.tpp.family.table-realtime-filter":
        if pattern.get("parameters", {}).get("filter_container_padding_vertical") != "16px":
            errors.append("即时过滤Variant必须登记过滤容器上下16px内间距")
        if pattern.get("parameters", {}).get("filter_option_interactive_tone") != "brand":
            errors.append("即时过滤Variant必须登记过滤选项悬浮与选中态使用品牌色")
        if pattern.get("parameters", {}).get("selected_filter_state_separator") != "dashed-top":
            errors.append("即时过滤Variant必须登记已选条件区顶部虚线分割规则")
        if pattern.get("parameters", {}).get("selected_filter_state_spacing_before") != "24px":
            errors.append("即时过滤Variant必须登记已选条件区与筛选条件的24px间距")
        if pattern.get("parameters", {}).get("selected_filter_state_padding_vertical") != "16px":
            errors.append("即时过滤Variant必须登记已选条件区上下16px内间距")
        if pattern.get("parameters", {}).get("selected_filter_state_bottom_spacing_compensation") != "-16px":
            errors.append("即时过滤Variant必须抵消父子容器叠加的底部16px间距")
        if pattern.get("parameters", {}).get("selected_filter_state_visibility_when_empty") != "hidden":
            errors.append("即时过滤Variant必须登记无已选条件时隐藏已选条件区")
        if pattern.get("parameters", {}).get("selected_filter_clear_action_placement") != "after-selected-items":
            errors.append("即时过滤Variant必须登记清空操作紧跟已选条件项")
        if pattern.get("parameters", {}).get("selected_filter_clear_action_tone") != "brand":
            errors.append("即时过滤Variant必须登记清空操作使用品牌色")
        if pattern.get("parameters", {}).get("selected_filter_clear_action_interactive_tone") != "brand-stable":
            errors.append("即时过滤Variant必须保持清空操作交互态品牌色稳定")
        if 'v-if="selectedRealtimeFilters.length" class="realtime-filter__selected"' not in source:
            errors.append("即时过滤已选条件区在无条件时未隐藏")
        if ".realtime-filter__selected .el-button { margin-left: 0; }" not in source:
            errors.append("即时过滤清空操作未紧跟已选条件项")
        if ".realtime-filter__selected .realtime-filter__clear { color: var(--h-color-brand) !important; }" not in source:
            errors.append("即时过滤清空操作未使用主题品牌色")
        if ".realtime-filter__selected .realtime-filter__clear:active { color: var(--h-color-brand) !important; }" not in source:
            errors.append("即时过滤清空操作交互态未保持主题品牌色")
        if ".realtime-filter { flex: none; margin: 0 24px; padding: 16px 0; border-bottom: 1px solid var(--h-color-border-tertiary); }" not in source:
            errors.append("即时过滤容器未使用上下16px内间距")
        if ".realtime-filter__options .el-tag.is-checkable:not(.is-checked):hover { color: var(--h-color-brand); border-color: var(--h-color-brand); }" not in source:
            errors.append("即时过滤选项悬浮态未使用主题品牌色")
        if ".realtime-filter__options .el-tag.is-checkable.is-checked:hover { color: #fff; border-color: var(--h-color-brand); background-color: var(--h-color-brand) !important; }" not in source:
            errors.append("即时过滤选项选中态未使用主题品牌色")
        if ".realtime-filter__selected { gap: 8px; margin-top: 24px; margin-bottom: -16px; padding: 16px 0; border-top: 1px dashed var(--h-color-border-tertiary); }" not in source:
            errors.append("即时过滤已选条件区缺少顶部虚线分割线")
    if spec["page_kind"] == "table":
        if spec.get("row_actions"):
            if page_config is not None and page_config.get("row_actions") != spec["row_actions"]:
                errors.append("表格行操作必须原样写入PAGE_CONFIG")
            for marker, message in (
                ('v-for="action in config.row_actions"', "表格缺少可配置行操作循环"),
                (':icon="action.icon"', "表格行操作必须使用登记图标"),
                (':aria-label="action.label"', "图标行操作缺少可访问名称"),
                ('@click.stop="rowAction(action, scope.row)"', "表格行操作缺少独立交互处理"),
            ):
                if marker not in source:
                    errors.append(message)
        for renderer_variable in (
            "--d2c-renderer-table-content-margin: 0px 12px",
            "--d2c-renderer-table-content-padding: 0px 12px",
            "--d2c-renderer-page-actions-margin: 0px",
            "--d2c-renderer-page-actions-padding: 0px 24px",
            "--d2c-renderer-page-actions-border: none",
        ):
            if renderer_variable not in source:
                errors.append(f"表格Renderer未应用公共布局规则: {renderer_variable}")
    if spec["page_kind"] == "card" and spec.get("row_actions"):
        if page_config is not None and page_config.get("row_actions") != spec["row_actions"]:
            errors.append("卡片操作必须原样写入PAGE_CONFIG")
        for marker, message in (
            ('v-for="action in config.row_actions"', "卡片缺少可配置操作循环"),
            ('@click.stop="rowAction(action, row)"', "卡片操作缺少独立交互处理"),
        ):
            if marker not in source:
                errors.append(message)
    if spec["page_kind"] == "details" and spec.get("detail_tabs"):
        if page_config is not None and page_config.get("detail_tabs") != spec["detail_tabs"]:
            errors.append("详情页签必须原样写入PAGE_CONFIG")
        detail_policy = (
            page_config.get("detail_page_policy", {})
            if page_config is not None
            else {}
        )
        tab_bar = detail_policy.get("tab_bar", {})
        for marker, message in (
            ('v-for="tab in config.detail_tabs"', "详情页缺少信息页签循环"),
            ('v-for="section in visibleDetailSections"', "详情页签未驱动可见信息分组"),
        ):
            if marker not in source:
                errors.append(message)
        if tab_bar.get("placement") == "breadcrumb":
            if '<div v-if="detailsTabsInBreadcrumb" class="page-breadcrumb__tabs"' not in source:
                errors.append("详情页签未放入面包屑容器")
            if 'v-if="hasDetailsPageTabs && !detailsTabsInBreadcrumb" class="details-page-tabs"' not in source:
                errors.append("详情内容区页签未避让面包屑页签")
        if spec.get("detail_columns") == 3:
            if "'is-three-column':config.detail_columns===3" not in source:
                errors.append("三列详情页缺少布局状态类")
            if ".details-page.is-three-column .details-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }" not in source:
                errors.append("三列详情页未应用三列字段网格")
            content_surface = detail_policy.get("content_surface", {})
            if content_surface.get("cross_axis_stretch") is True:
                if ".details-page.is-three-column.is-flat .details-main { align-self: stretch; }" not in source:
                    errors.append("三列详情内容背景必须沿交叉轴撑满")
    if (
        spec["page_kind"] == "details"
        and pattern.get("parameters", {}).get("anchor_mode") == "resident"
    ):
        if pattern.get("parameters", {}).get("anchor_position") != "right":
            errors.append("常驻详情锚点必须使用已登记的右侧位置")
        if pattern.get("parameters", {}).get("text_align") != "left":
            errors.append("右侧常驻锚点必须默认左对齐")
        resident_anchor_marker = (
            'class="details-anchor details-side" '
            'data-zone="navigation.detail-tabs" '
            'data-component="navigation.anchor-nav"'
        )
        if source.count(resident_anchor_marker) != 1:
            errors.append("常驻详情页必须且只能生成一个锚点导航组件")
        safe_resident_anchor = (
            '<h-anchor :style="{ textAlign: config.pattern_parameters.text_align }" '
            ':affix="true" container=".details-page">'
            '<h-anchor-link v-for="section in visibleDetailSections"'
        )
        if safe_resident_anchor not in source:
            errors.append("常驻详情锚点必须使用HAnchor并绑定左对齐参数与详情滚动容器")
        if ':href="\'#detail-section-\' + section.id"' not in source:
            errors.append("常驻详情锚点缺少章节链接")
        if ':id="\'detail-section-\' + section.id"' not in source:
            errors.append("常驻详情内容缺少章节锚点ID")
        resident_anchor_style = (
            ".details-anchor.details-side {\n"
            "      width: 180px; align-self: flex-start; margin-bottom: 0; "
            "padding: 48px 0 0; background: transparent;\n"
            "    }"
        )
        if resident_anchor_style not in source:
            errors.append("常驻详情锚点必须使用180px透明右侧保留区和48px顶部偏移")
        anchor_policy = (
            page_config.get("detail_page_policy", {}).get("anchor", {})
            if page_config is not None
            else {}
        )
        if anchor_policy.get("content_gap_px") != 24:
            errors.append("常驻锚点与主内容区的水平间距必须为24px")
        if "anchorPolicy.content_gap_px || parameters.region_gap_px || 24" not in source:
            errors.append("详情布局未消费产品登记的锚点内容间距")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="验证HUI TPP Pattern Page HTML")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    try:
        spec = load_json(args.spec.resolve())
        errors = validate_pattern_html(spec, args.html.resolve())
    except (PatternPageError, ContractError, OSError) as exc:
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
