#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import Any

from compile_page import compile_page
from core import ContractError, ROOT, load_json
from validate_page import validate_html


def resolve_project_path(relative: str, label: str) -> Path:
    if not isinstance(relative, str) or not relative:
        raise ContractError(f"{label}必须是非空项目相对路径")
    path = (ROOT / relative).resolve()
    if path != ROOT and ROOT not in path.parents:
        raise ContractError(f"{label}越出Skill项目边界: {relative}")
    return path


def validate_suite(suite: dict[str, Any]) -> None:
    if suite.get("schema_version") != "product-acceptance-suite.v1":
        raise ContractError(
            "产品验收套件schema_version必须是product-acceptance-suite.v1"
        )
    for key in ("industry", "product", "output_root"):
        if not suite.get(key):
            raise ContractError(f"产品验收套件缺少字段: {key}")
    if "cases" not in suite:
        raise ContractError("产品验收套件缺少字段: cases")
    cases = suite["cases"]
    if not isinstance(cases, list):
        raise ContractError("产品验收套件cases必须是数组")
    ids: set[str] = set()
    outputs: set[str] = set()
    for case in cases:
        for key in ("id", "page_type", "spec", "output"):
            if not isinstance(case.get(key), str) or not case[key]:
                raise ContractError(f"产品验收用例缺少字段: {key}")
        if case["id"] in ids:
            raise ContractError(f"产品验收用例ID重复: {case['id']}")
        if case["output"] in outputs:
            raise ContractError(f"产品验收输出重复: {case['output']}")
        if Path(case["output"]).name != case["output"]:
            raise ContractError(
                f"产品验收output只允许文件名: {case['output']}"
            )
        ids.add(case["id"])
        outputs.add(case["output"])


def build_product_acceptance(
    suite: dict[str, Any], output_root: Path | None = None
) -> list[Path]:
    validate_suite(suite)
    target_root = (
        output_root.resolve()
        if output_root is not None
        else resolve_project_path(suite["output_root"], "output_root")
    )
    if not suite["cases"]:
        return []
    target_root.mkdir(parents=True, exist_ok=True)

    asset_target = target_root.parent / "assets" / "imgs"
    shutil.copytree(
        ROOT / "assets" / "imgs",
        asset_target,
        dirs_exist_ok=True,
    )

    generated: list[Path] = []
    for case in suite["cases"]:
        spec = load_json(resolve_project_path(case["spec"], "case.spec"))
        expected_identity = (
            suite["industry"], suite["product"], case["page_type"]
        )
        actual_identity = (
            spec.get("industry"), spec.get("product"), spec.get("page_type")
        )
        if actual_identity != expected_identity:
            raise ContractError(
                f"产品验收用例身份不一致: {case['id']} -> {actual_identity}"
            )
        html = compile_page(spec)
        output = target_root / case["output"]
        output.write_text(html, encoding="utf-8")
        errors = validate_html(spec, output)
        if errors:
            raise ContractError(
                f"产品验收静态校验失败: {case['id']}\n" + "\n".join(errors)
            )
        generated.append(output)
    return generated


def main() -> int:
    parser = argparse.ArgumentParser(description="构建并静态校验产品页面验收套件")
    parser.add_argument("--suite", required=True, type=Path)
    args = parser.parse_args()
    try:
        suite = load_json(args.suite.resolve())
        outputs = build_product_acceptance(suite)
    except (ContractError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    for output in outputs:
        print(f"[PASS] {output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
