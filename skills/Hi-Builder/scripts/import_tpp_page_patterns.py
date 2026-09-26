#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TPP_ROOT = (
    ROOT
    / "design-systems"
    / "HUI"
    / "page-patterns"
    / "tpp"
)


def slug(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def unique_actions(buttons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = Counter(button["text"] for button in buttons if button["text"])
    return [
        {"label": label, "count": count}
        for label, count in counts.items()
    ]


def selected_value(inputs: list[dict[str, Any]], allowed: set[str]) -> str | None:
    for item in inputs:
        if (
            item.get("type") == "radio"
            and item.get("checked")
            and item.get("value") in allowed
        ):
            return item["value"]
    return None


def select_region(page: dict[str, Any], class_name: str) -> dict[str, Any] | None:
    for region in page["regions"]:
        classes = region["class"].split()
        if class_name in classes:
            return region
    return None


def compact_region(region: dict[str, Any] | None) -> dict[str, Any] | None:
    if not region:
        return None
    return {
        "class": region["class"],
        "rect": region["rect"],
        "display": region["display"],
        "position": region["position"],
        "padding": region["padding"],
        "gap": region["gap"],
        "overflow_x": region["overflowX"],
        "overflow_y": region["overflowY"],
    }


def catalog_route(page: dict[str, Any]) -> str:
    return page.get("path") or page["route"]


def catalog_hui_version(page: dict[str, Any]) -> str:
    return page.get("hui") or page["hui_version"]


def catalog_category_names(page: dict[str, Any]) -> list[str]:
    return [
        item["name"] if isinstance(item, dict) else item
        for item in page["category"]
    ]


def common_region_values(
    regions: list[dict[str, Any] | None],
) -> dict[str, Any]:
    if not regions or any(region is None for region in regions):
        return {}
    comparable = [
        {
            "display": region.get("display"),
            "position": region.get("position"),
            "padding": region.get("padding"),
            "gap": region.get("gap"),
            "overflow_x": region.get("overflow_x"),
            "overflow_y": region.get("overflow_y"),
            "height": region.get("rect", {}).get("height"),
        }
        for region in regions
        if region
    ]
    return {
        key: comparable[0][key]
        for key in comparable[0]
        if all(value[key] == comparable[0][key] for value in comparable[1:])
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-source", type=Path, required=True)
    parser.add_argument("--evidence-source", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    args = parser.parse_args()

    source_catalog = json.loads(args.catalog_source.read_text(encoding="utf-8"))
    evidence_source = json.loads(args.evidence_source.read_text(encoding="utf-8"))
    mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
    runtime_index = json.loads(
        (
            ROOT
            / "design-systems"
            / "HUI"
            / "runtime-contracts"
            / "index.json"
        ).read_text(encoding="utf-8")
    )["entries"]
    known_hui_tags = set(runtime_index)
    page_framework_tags = {
        "h-layout",
        "h-layout-footer",
        "h-layout-header",
        "h-page",
        "h-page-container",
        "h-page-content",
        "h-page-header",
        "h-page-sidebar",
        "h-page-button-group",
        "h-page-search",
    }
    evidence_by_route = {
        page["path"]: page for page in evidence_source["pages"]
    }
    catalog_by_route = {
        catalog_route(page): page for page in source_catalog["pages"]
    }

    missing = sorted(set(mapping["pages"]) - set(evidence_by_route))
    if missing:
        raise ValueError(f"页面证据缺失: {missing}")

    batch = mapping["batch"]
    evidence_root = TPP_ROOT / "evidence" / batch
    page_root = TPP_ROOT / "pages" / batch
    family_root = TPP_ROOT / "families"
    evidence_root.mkdir(parents=True, exist_ok=True)
    page_root.mkdir(parents=True, exist_ok=True)
    family_root.mkdir(parents=True, exist_ok=True)

    page_contracts: dict[str, dict[str, Any]] = {}
    for route, page_mapping in mapping["pages"].items():
        page = evidence_by_route[route]
        catalog_page = catalog_by_route[route]
        page_id = page_mapping["variant"]
        evidence_path = evidence_root / f"{page_id}.json"
        evidence_path.write_text(
            json.dumps(page, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        key_regions = {}
        for region_name, class_name in mapping["region_classes"].items():
            region = compact_region(select_region(page, class_name))
            if region:
                key_regions[region_name] = region
        parameters = dict(page_mapping["parameters"])
        if page.get("statistical_cells"):
            parameters["statistical_columns"] = [
                {
                    key: value
                    for key, value in column.items()
                    if key in {
                        "kind", "component", "width", "props", "primary",
                        "secondary", "shared_flood_by_row"
                    }
                }
                for column in page["statistical_cells"].get("columns", [])
            ]
        if batch == "form":
            parameters["default_label_position"] = selected_value(
                page["inputs"], {"top", "left", "right"}
            )
            observed_container = selected_value(
                page["inputs"], {"md", "lg", "max"}
            )
            if observed_container:
                parameters["observed_container_mode"] = observed_container

        contract = {
            "schema_version": "hui-page-variant.v1",
            "id": f"hui.tpp.page.{batch}.{page_id}",
            "name": catalog_category_names(catalog_page)[-1],
            "family": f"hui.tpp.family.{page_mapping['family']}",
            "source": {
                "url": f"http://tpp.dev.hikhub.net/tpp#{route}",
                "package": catalog_page["package"],
                "hui_version": catalog_hui_version(catalog_page),
                "observed_at": evidence_source["observed_at"],
                "evidence": f"../../evidence/{batch}/{page_id}.json",
            },
            "parameters": parameters,
            "geometry": {
                "viewport": page["viewport"],
                "root": page["root"],
                "key_regions": key_regions,
                **(
                    {"repeat_layout": page["card_grid"]}
                    if page.get("card_grid")
                    else {}
                ),
            },
            "composition": {
                "hui_components": {
                    tag: count
                    for tag, count in page["runtime_components"].items()
                    if tag in known_hui_tags
                },
                "page_framework_components": {
                    tag: count
                    for tag, count in page["runtime_components"].items()
                    if tag in page_framework_tags or tag.startswith("h-page-")
                },
                "unindexed_runtime_components": {
                    tag: count
                    for tag, count in page["runtime_components"].items()
                    if tag not in known_hui_tags
                    and tag not in page_framework_tags
                    and not tag.startswith("h-page-")
                },
                "actions": unique_actions(page["buttons"]),
            },
        }
        contract_path = page_root / f"{page_id}.json"
        contract_path.write_text(
            json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        page_contracts[route] = contract

    family_contracts: dict[str, dict[str, Any]] = {}
    for family_id, family_mapping in mapping["families"].items():
        routes = [
            route
            for route, value in mapping["pages"].items()
            if value["family"] == family_id
        ]
        contracts = [page_contracts[route] for route in routes]
        component_sets = [
            set(contract["composition"]["hui_components"])
            for contract in contracts
        ]
        shared_components = sorted(set.intersection(*component_sets))
        region_invariants = {
            region_name: values
            for region_name in mapping["region_classes"]
            if (
                values := common_region_values(
                    [
                        contract["geometry"]["key_regions"].get(region_name)
                        for contract in contracts
                    ]
                )
            )
        }
        family_contract = {
            "schema_version": "hui-page-pattern.v1",
            "id": f"hui.tpp.family.{family_id}",
            "name": family_mapping["name"],
            "source": {
                "platform": "HUI-VUE典型页面",
                "observed_at": evidence_source["observed_at"],
                "catalog": "../../catalog.json",
            },
            "match": family_mapping["match"],
            "semantics": family_mapping["semantics"],
            "shared_runtime_components": shared_components,
            "invariants": {
                "regions": region_invariants,
                "variant_values_must_come_from_page_contract": True
            },
            "variants": [
                {
                    "id": contract["id"],
                    "name": contract["name"],
                    "contract": (
                        f"../../pages/{batch}/"
                        f"{mapping['pages'][route]['variant']}.json"
                    ),
                    "parameters": contract["parameters"],
                }
                for route, contract in zip(routes, contracts)
            ],
        }
        family_path = family_root / family_id / "contract.json"
        family_path.parent.mkdir(parents=True, exist_ok=True)
        family_path.write_text(
            json.dumps(family_contract, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        family_contracts[family_id] = family_contract

    category_counts = Counter(
        catalog_category_names(page)[0]
        for page in source_catalog["pages"]
    )
    source_observed_at = (
        source_catalog.get("observed_at")
        or source_catalog.get("source", {}).get("observed_at")
    )
    existing_catalog_path = TPP_ROOT / "catalog.json"
    existing_pages = {}
    existing_families = {}
    existing_maintenance = None
    if existing_catalog_path.is_file():
        existing_catalog = json.loads(
            existing_catalog_path.read_text(encoding="utf-8")
        )
        existing_maintenance = existing_catalog.get("maintenance")
        if not isinstance(existing_maintenance, dict):
            raise ValueError("TPP Catalog缺少maintenance，不能安全重建")
        existing_pages = {
            page["route"]: page for page in existing_catalog.get("pages", [])
        }
        existing_families = existing_catalog.get("families", {})
    catalog = {
        "schema_version": "tpp-page-catalog.v1",
        "maintenance": existing_maintenance,
        "source": {
            "url": "http://tpp.dev.hikhub.net/tpp",
            "observed_at": source_observed_at,
            "page_count": len(source_catalog["pages"]),
            "category_counts": dict(category_counts),
        },
        "pages": [
            {
                "route": catalog_route(page),
                "name": page["name"],
                "category": catalog_category_names(page),
                "package": page["package"],
                "hui_version": catalog_hui_version(page),
                "status": (
                    "evidence-verified"
                    if catalog_route(page) in page_contracts
                    else existing_pages.get(catalog_route(page), {}).get(
                        "status", "catalog-only"
                    )
                ),
                **(
                    {
                        "family": page_contracts[catalog_route(page)]["family"],
                        "contract": (
                            f"pages/{batch}/"
                            f"{mapping['pages'][catalog_route(page)]['variant']}.json"
                        ),
                    }
                    if catalog_route(page) in page_contracts
                    else {
                        key: value
                        for key, value in existing_pages.get(
                            catalog_route(page), {}
                        ).items()
                        if key in {"family", "contract"}
                    }
                ),
            }
            for page in source_catalog["pages"]
        ],
        "families": {
            **existing_families,
            **{
                family_id: {
                    "contract": f"families/{family_id}/contract.json",
                    "variant_count": len(contract["variants"]),
                }
                for family_id, contract in family_contracts.items()
            },
        },
    }
    TPP_ROOT.mkdir(parents=True, exist_ok=True)
    (TPP_ROOT / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Imported {len(page_contracts)} page variants and "
        f"{len(family_contracts)} families from {len(source_catalog['pages'])} routes"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
