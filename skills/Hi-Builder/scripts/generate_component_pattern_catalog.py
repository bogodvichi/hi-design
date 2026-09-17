#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from semantic_registry import HUI_ROOT, SemanticRegistryError, load_component_pattern_registry


DEFAULT_OUTPUT = HUI_ROOT / "component-patterns" / "catalog.json"


def build_component_pattern_catalog() -> dict[str, Any]:
    patterns = load_component_pattern_registry()
    entries: dict[str, dict[str, Any]] = {}
    for component_id, contract in sorted(patterns.items()):
        entries[component_id] = {
            "name": contract["name"],
            "split_mode": contract["split_mode"],
            "vue_component": contract["vue_component"],
            "description": contract["description"],
            "use_when": contract["use_when"],
        }
    return {
        "schema_version": "data-component-catalog.v1.0.2",
        "maintenance": {
            "purpose": "HUI通用data-component派生索引，供生成与校验按稳定语义ID查找组合模式。",
            "edit_policy": "不要直接编辑entries；新增或修改词条时编辑同目录对应<id>/contract.json，再运行本脚本重建。",
            "managed_paths": {
                "catalog.json": "由所有Component Contract确定性汇总的只读派生词典。",
                ".": "每个<id>/contract.json是该data-component词条的人工维护事实源。",
            },
        },
        "naming": {
            "format": "<domain>.<responsibility>",
            "segment_style": "lowercase-kebab-case",
            "forbidden_prefixes": ["hui", "isc", "pvia"],
        },
        "split_modes": {
            "single": "对应一个单一Vue控件",
            "composite": "由多个不同Vue控件组合成一个业务区域",
            "repeat-item": "由多个同类单项Vue组件重复组成",
        },
        "entry_count": len(entries),
        "entries": entries,
    }


def render_catalog() -> str:
    return json.dumps(
        build_component_pattern_catalog(),
        ensure_ascii=False,
        indent=2,
    ) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="生成HUI通用data-component词典")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        rendered = render_catalog()
        output = args.out.resolve()
        if args.check:
            if not output.is_file() or output.read_text(encoding="utf-8") != rendered:
                print(f"ERROR: data-component词典需要重新生成: {output}", file=sys.stderr)
                return 2
            print(f"[PASS] {output}")
            return 0
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    except (SemanticRegistryError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
