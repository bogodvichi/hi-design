#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HUI_ROOT = ROOT / "design-systems" / "HUI"


def normalize_heading(value: str) -> str:
    value = value.replace("#", " ")
    value = re.sub(r"\b(?:Beta\s*)?\d+\.\d+(?:\.\d+)?\+?\b", " ", value, flags=re.I)
    return " ".join(value.split())


def template_name(value: str) -> str:
    value = re.split(r"\s{2,}|（|\(|已废弃", value.strip(), maxsplit=1)[0]
    value = re.sub(r"\b\d+\.\d+(?:\.\d+)?\+?\b.*$", "", value).strip()
    value = value.split("/")[0].strip()
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    return value.lower()


def row_name(section: dict) -> str:
    headers = section["headers"]
    return headers[0] if headers else "name"


def normalize_rows(section: dict) -> list[dict]:
    headers = section["headers"]
    result = []
    for values in section["rows"]:
        if not headers or not values:
            continue
        row = {
            headers[index]: value
            for index, value in enumerate(values)
            if index < len(headers)
        }
        source_name = values[0].strip()
        row["template_name"] = template_name(source_name)
        result.append(row)
    return result


def find_sections(item: dict, requested: list[str]) -> list[dict]:
    wanted = [normalize_heading(value) for value in requested]
    matches = []
    for table in item.get("tables", []):
        heading = normalize_heading(table.get("heading") or "")
        if any(heading == value or heading.startswith(f"{value} ") for value in wanted):
            matches.append(table)
    return matches


def preserve_curated_d2c_usage(contract: dict, path: Path) -> dict:
    if not path.is_file():
        return contract
    existing = json.loads(path.read_text(encoding="utf-8"))
    if "d2c_usage" in existing:
        contract["d2c_usage"] = existing["d2c_usage"]
    return contract


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    args = parser.parse_args()

    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
    items = {item["id"]: item for item in snapshot["items"]}
    batch = mapping["batch"]

    evidence_dir = HUI_ROOT / "runtime-contracts" / "evidence"
    contract_dir = HUI_ROOT / "runtime-contracts" / batch
    evidence_dir.mkdir(parents=True, exist_ok=True)
    contract_dir.mkdir(parents=True, exist_ok=True)
    evidence_path = evidence_dir / f"{batch}.docs.json"
    api_first_headers = {
        "参数",
        "事件名称",
        "方法名",
        "名称",
        "name",
        "Name",
        "插槽名称",
        "格式",
    }
    evidence_payload = {
        "observedAt": snapshot["observedAt"],
        "items": [
            {
                "id": item["id"],
                "path": item["path"],
                "tables": [
                    table
                    for table in item.get("tables", [])
                    if table.get("headers")
                    and table["headers"][0] in api_first_headers
                ],
            }
            for item in snapshot["items"]
        ],
    }
    evidence_path.write_text(
        json.dumps(evidence_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    digest = hashlib.sha256(evidence_path.read_bytes()).hexdigest()

    manifest_path = HUI_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    for component_id, component_mapping in mapping["components"].items():
        item = items[component_id]
        assigned_sections: set[tuple[str, int]] = set()
        runtime: dict[str, dict] = {}

        for tag, tag_mapping in component_mapping.get("runtime", {}).items():
            tag_contract = {
                "props": [],
                "events": [],
                "slots": [],
                "methods": [],
            }
            for kind in tag_contract:
                sections = find_sections(item, tag_mapping.get(kind, []))
                if tag_mapping.get(kind) and not sections:
                    raise ValueError(
                        f"{component_id}/{tag}/{kind}未找到文档章节: "
                        f"{tag_mapping[kind]}"
                    )
                for section in sections:
                    assigned_sections.add(
                        (section.get("heading") or "", item["tables"].index(section))
                    )
                    rows = normalize_rows(section)
                    tag_contract[kind].extend(rows)
            runtime[tag] = tag_contract

        supporting_sections = []
        for index, section in enumerate(item.get("tables", [])):
            key = (section.get("heading") or "", index)
            if (
                key in assigned_sections
                or not section.get("headers")
                or section["headers"][0] not in api_first_headers
            ):
                continue
            supporting_sections.append(
                {
                    "heading": normalize_heading(section.get("heading") or ""),
                    "headers": section["headers"],
                    "rows": normalize_rows(section),
                }
            )

        contract = {
            "schema_version": "hui-runtime-contract.v1",
            "component_id": component_id,
            "source": {
                "url": f"http://hui.dev.hikhub.net{item['path']}",
                "observed_at": snapshot["observedAt"],
                "evidence": f"../evidence/{batch}.docs.json",
                "evidence_sha256": digest,
            },
            "documentation_status": component_mapping.get(
                "documentation_status", "api-table"
            ),
            "contract_kind": component_mapping.get(
                "contract_kind", "vue-component"
            ),
            "runtime": runtime,
            "supporting_sections": supporting_sections,
        }
        path = contract_dir / f"{component_id}.json"
        contract = preserve_curated_d2c_usage(contract, path)
        path.write_text(
            json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    runtime_index: dict[str, dict] = {}
    contract_root = HUI_ROOT / "runtime-contracts"
    for path in sorted(contract_root.glob("*/*.json")):
        contract = json.loads(path.read_text(encoding="utf-8"))
        if contract.get("schema_version") != "hui-runtime-contract.v1":
            continue
        component_id = contract["component_id"]
        contract_file = str(path.relative_to(HUI_ROOT))
        for tag, interface in contract.get("runtime", {}).items():
            index = runtime_index.setdefault(
                tag,
                {
                    "component_ids": [],
                    "contract_files": [],
                    "interface_counts": {
                        "props": 0,
                        "events": 0,
                        "slots": 0,
                        "methods": 0,
                    },
                    "verification": "official-examples-only",
                },
            )
            if component_id not in index["component_ids"]:
                index["component_ids"].append(component_id)
            if contract_file not in index["contract_files"]:
                index["contract_files"].append(contract_file)
            for kind in index["interface_counts"]:
                names = {
                    row["template_name"]
                    for row in interface.get(kind, [])
                    if row.get("template_name")
                }
                index["interface_counts"][kind] += len(names)
                if names:
                    index["verification"] = "official-api-table"
    runtime_index_path = contract_root / "index.json"
    runtime_index_path.write_text(
        json.dumps(
            {
                "schema_version": "hui-runtime-index.v1",
                "maintenance": {
                    "purpose": "HUI Vue运行时原子标签索引，连接实际模板标签与已验证组件合同。",
                    "edit_policy": "不要直接编辑entries；更新mapping和官方文档证据后运行import_hui_contracts.py重建。",
                    "managed_paths": {
                        "basic-form": "基础、表单和图标组件的已验证运行时合同。",
                        "data": "表格、树、分页等数据展示组件合同。",
                        "navigation": "菜单、页签、步骤等导航组件合同。",
                        "notice": "消息、通知、加载等反馈服务与组件合同。",
                        "others": "Dialog、Card、Tooltip等其他HUI组件合同。",
                        "mappings": "官方组件目录到采集批次和合同文件的映射。",
                        "evidence": "官方文档采集证据，仅用于追溯与重新提炼。",
                    },
                },
                "entries": runtime_index,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    manifest["runtime_contracts"] = {
        "index": "runtime-contracts/index.json",
        "policy": "verified-only",
        "entry_count": len(runtime_index),
    }
    manifest["runtime_contract_batches"] = manifest.get(
        "runtime_contract_batches", {}
    )
    manifest["runtime_contract_batches"][batch] = {
        "status": "verified",
        "component_ids": list(mapping["components"]),
        "observed_at": snapshot["observedAt"],
        "evidence": f"runtime-contracts/evidence/{batch}.docs.json",
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Imported {len(mapping['components'])} components into "
        f"{contract_dir.relative_to(ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
