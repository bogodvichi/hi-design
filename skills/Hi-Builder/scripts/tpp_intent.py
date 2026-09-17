#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

from core import ContractError, DESIGN_SYSTEMS_ROOT, ROOT, load_json, validate_json_contract


TPP_ROOT = DESIGN_SYSTEMS_ROOT / "HUI" / "page-patterns" / "tpp"
SUPPORTED_PAGE_KINDS = ("table", "form", "card", "details")
SCALAR_TYPES = (str, int, float, bool)


def _validate_intent(intent: dict[str, Any]) -> None:
    errors = validate_json_contract(
        intent, load_json(ROOT / "schemas" / "tpp-page-intent.schema.json")
    )
    features = intent.get("features")
    if isinstance(features, dict):
        for key, value in features.items():
            if not isinstance(key, str) or not key:
                errors.append("$.features的键必须是非空字符串")
            if not isinstance(value, SCALAR_TYPES) and not (
                isinstance(value, list) and all(isinstance(item, SCALAR_TYPES) for item in value)
            ):
                errors.append(f"$.features.{key}必须是标量或标量数组")
    if errors:
        raise ContractError("\n".join(errors))


def resolve_tpp_intent(intent: dict[str, Any]) -> dict[str, Any]:
    """Resolve one structured intent to exactly one evidence-backed TPP page."""
    _validate_intent(intent)
    page_kind = intent["page_kind"]
    family = intent["semantic_family"]
    if not family.startswith(f"{page_kind}-"):
        raise ContractError(
            f"PageIntent语义族与页面类型不一致: {family}不属于{page_kind}"
        )

    mapping = load_json(TPP_ROOT / "mappings" / f"{page_kind}.json")
    catalog = load_json(TPP_ROOT / "catalog.json")
    catalog_by_route = {page["route"]: page for page in catalog["pages"]}
    family_pages = [
        (route, page) for route, page in mapping["pages"].items()
        if page["family"] == family
    ]
    if not family_pages:
        raise ContractError(f"TPP知识中不存在语义族: {family}")

    known_features = sorted({
        key for _, page in family_pages for key in page.get("parameters", {})
    })
    unknown = sorted(set(intent["features"]) - set(known_features))
    if unknown:
        raise ContractError(
            f"PageIntent包含{family}未登记特征: {unknown}; 可用特征: {known_features}"
        )

    family_defaults = mapping.get("families", {}).get(family, {}).get("defaults", {})
    effective_features = {**family_defaults, **intent["features"]}
    candidates = []
    for route, page in family_pages:
        parameters = page.get("parameters", {})
        if all(parameters.get(key) == value for key, value in effective_features.items()):
            catalog_page = catalog_by_route.get(route)
            if not catalog_page:
                raise ContractError(f"TPP目录缺少路由: {route}")
            candidates.append({
                "route": route,
                "variant": page["variant"],
                "family": family,
                "parameters": parameters,
                "pattern_contract": catalog_page["contract"].removeprefix("pages/"),
                "name": catalog_page["name"],
            })

    if len(candidates) == 1:
        return {
            "schema_version": "tpp-intent-resolution.v1",
            "status": "selected",
            "intent": intent,
            "selection": candidates[0],
            "candidates": candidates,
            "diagnostics": [],
        }
    if not candidates:
        return {
            "schema_version": "tpp-intent-resolution.v1",
            "status": "no-match",
            "intent": intent,
            "selection": None,
            "candidates": [],
            "diagnostics": ["已登记Variant均不满足这些特征；这是知识缺口或意图参数错误"],
        }

    distinguishing = sorted({
        key for key in known_features
        if len({repr(item["parameters"].get(key)) for item in candidates}) > 1
    })
    return {
        "schema_version": "tpp-intent-resolution.v1",
        "status": "ambiguous",
        "intent": intent,
        "selection": None,
        "candidates": candidates,
        "diagnostics": [f"多个Variant同时成立；请补充区分特征: {distinguishing}"],
    }


def require_tpp_selection(intent: dict[str, Any]) -> dict[str, Any]:
    result = resolve_tpp_intent(intent)
    if result["status"] != "selected":
        raise ContractError("; ".join(result["diagnostics"]))
    return result
