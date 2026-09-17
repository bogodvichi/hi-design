#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
from pathlib import Path

from compile_pattern_page import compile_pattern_page
from core import load_json, load_product_context


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SPEC = ROOT / "tests/generation/personnel-permission-details-shell.json"
DEFAULT_OUTPUT = ROOT / "output/isc3-personnel-permission-details-shells"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="生成ISC 3.0.0十二种框架的人员权限配置详情测试页"
    )
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    base_spec = load_json(args.spec.resolve())
    context = load_product_context(
        base_spec["industry"],
        base_spec["product"],
        base_spec.get("shell_standard"),
        base_spec.get("product_version"),
    )
    variants = context["portal_shell"]["framework_variants"]["variants"]
    output_dir = args.out_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    for variant in variants:
        variant_id = variant["id"]
        spec = copy.deepcopy(base_spec)
        spec["id"] = f"isc3-personnel-permission-details-{variant_id}"
        spec["framework"]["variant"] = variant_id
        output_path = output_dir / f"{variant_id}.html"
        page_html = compile_pattern_page(spec, output_path)
        output_path.write_text(page_html, encoding="utf-8")
        print(f"Wrote {output_path.relative_to(ROOT)}")
        if variant_id == "regular-01":
            index_path = output_dir / "index.html"
            index_path.write_text(page_html, encoding="utf-8")
            print(f"Wrote {index_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
