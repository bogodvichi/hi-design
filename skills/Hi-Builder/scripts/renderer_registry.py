#!/usr/bin/env python3
from __future__ import annotations

from typing import Any


RENDERER_CONTRACTS: dict[str, dict[str, Any]] = {
    "hui.tpp.form": {
        "pipeline": "pattern-page",
        "input_contract": "pattern-page-spec.v2",
        "pattern_kinds": ["form"],
        "hui_pattern_prefixes": ["hui.tpp.family.form-"],
        "allowed_zone_ids": [
            "portal.header", "portal.sidebar", "form.content", "form.actions"
        ],
        "allowed_component_pattern_ids": [
            "portal.global-header", "portal.app-sidebar",
            "form.data-form", "navigation.anchor-nav", "toolbar.action-toolbar"
        ],
        "template": "assets/templates/HUI/renderers/form.html",
        "styles": [
            "assets/templates/HUI/styles/page-tabs.css",
            "assets/templates/HUI/styles/form.css",
        ],
    },
    "hui.tpp.table": {
        "pipeline": "pattern-page",
        "input_contract": "pattern-page-spec.v2",
        "pattern_kinds": ["table"],
        "hui_pattern_prefixes": ["hui.tpp.family.table-"],
        "allowed_zone_ids": [
            "portal.header", "portal.sidebar", "query.filter", "page.actions",
            "navigation.view-tabs", "summary.metrics", "data.results", "detail.content",
            "page.pagination"
        ],
        "allowed_component_pattern_ids": [
            "portal.global-header", "portal.app-sidebar", "filter.search-form",
            "toolbar.action-toolbar", "summary.metric-strip", "navigation.tabs", "table.data-table",
            "collection.calendar-grid", "detail.details-pane", "form.data-form",
            "pagination.page-navigation"
        ],
        "layout_roles": {
            "table-content-margin": "0px 12px",
            "table-content-padding": "0px 12px",
            "page-actions-margin": "0px",
            "page-actions-padding": "0px 24px",
            "page-actions-border": "none",
        },
        "template": "assets/templates/HUI/renderers/table.html",
        "styles": ["assets/templates/HUI/styles/collection.css"],
    },
    "hui.tpp.card": {
        "pipeline": "pattern-page",
        "input_contract": "pattern-page-spec.v2",
        "pattern_kinds": ["card", "card-tabs"],
        "hui_pattern_prefixes": ["hui.tpp.family.card-"],
        "allowed_zone_ids": [
            "portal.header", "portal.sidebar", "query.filter", "page.actions",
            "navigation.view-tabs", "data.results", "page.pagination"
        ],
        "allowed_component_pattern_ids": [
            "portal.global-header", "portal.app-sidebar", "filter.search-form",
            "toolbar.action-toolbar", "navigation.tabs", "collection.card-grid",
            "navigation.tree-panel", "pagination.page-navigation"
        ],
        "template": "assets/templates/HUI/renderers/card.html",
        "styles": ["assets/templates/HUI/styles/collection.css"],
    },
    "hui.tpp.collection-switch": {
        "pipeline": "pattern-page",
        "input_contract": "pattern-page-spec.v2",
        "pattern_kinds": ["switch"],
        "template": "assets/templates/HUI/renderers/collection-switch.html",
        "styles": ["assets/templates/HUI/styles/collection.css"],
    },
    "hui.tpp.details": {
        "pipeline": "pattern-page",
        "input_contract": "pattern-page-spec.v2",
        "pattern_kinds": ["details"],
        "hui_pattern_prefixes": ["hui.tpp.family.details-"],
        "allowed_zone_ids": [
            "portal.header", "portal.sidebar", "detail.content",
            "media.preview", "navigation.detail-tabs", "data.results",
            "page.pagination"
        ],
        "allowed_component_pattern_ids": [
            "portal.global-header", "portal.app-sidebar",
            "detail.details-pane", "media.image-viewer",
            "navigation.anchor-nav", "navigation.tabs", "table.data-table",
            "pagination.page-navigation"
        ],
        "template": "assets/templates/HUI/renderers/details.html",
        "styles": [
            "assets/templates/HUI/styles/page-tabs.css",
            "assets/templates/HUI/styles/details.css",
        ],
    },
}

PAGE_RENDERER_IDS = {
    renderer_id
    for renderer_id, contract in RENDERER_CONTRACTS.items()
    if contract["pipeline"] == "page"
}

PATTERN_KIND_RENDERERS = {
    page_kind: renderer_id
    for renderer_id, contract in RENDERER_CONTRACTS.items()
    if contract["pipeline"] == "pattern-page"
    for page_kind in contract["pattern_kinds"]
}

HUI_PATTERN_PREFIX_RENDERERS = {
    prefix: renderer_id
    for renderer_id, contract in RENDERER_CONTRACTS.items()
    for prefix in contract.get("hui_pattern_prefixes", [])
}


def renderer_for_pattern_kind(page_kind: str) -> str:
    try:
        return PATTERN_KIND_RENDERERS[page_kind]
    except KeyError as exc:
        raise ValueError(f"未登记TPP页面族Renderer: {page_kind}") from exc


def renderer_for_hui_pattern(pattern_id: str) -> str:
    matches = [
        renderer_id
        for prefix, renderer_id in HUI_PATTERN_PREFIX_RENDERERS.items()
        if pattern_id.startswith(prefix)
    ]
    if len(matches) != 1:
        raise ValueError(f"HUI页面模式未登记唯一兜底Renderer: {pattern_id}")
    return matches[0]


def template_for_renderer(renderer_id: str) -> str:
    try:
        return RENDERER_CONTRACTS[renderer_id]["template"]
    except KeyError as exc:
        raise ValueError(f"Renderer未登记模板: {renderer_id}") from exc


def contract_for_renderer(renderer_id: str) -> dict[str, Any]:
    try:
        return RENDERER_CONTRACTS[renderer_id]
    except KeyError as exc:
        raise ValueError(f"Renderer未登记: {renderer_id}") from exc
