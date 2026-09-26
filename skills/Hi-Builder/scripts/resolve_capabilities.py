#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys

from core import (
    build_capability_bundle,
    ContractError,
)
from tpp_intent import require_tpp_selection


def main() -> int:
    parser = argparse.ArgumentParser(description="输出AI可消费的精简页面能力")
    parser.add_argument("--industry", required=True)
    parser.add_argument("--product", required=True)
    parser.add_argument("--product-version")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--page-type")
    selection.add_argument("--intent", type=str)
    args = parser.parse_args()

    try:
        if args.intent:
            with open(args.intent, encoding="utf-8") as source:
                intent_resolution = require_tpp_selection(json.load(source))
            intent = intent_resolution["intent"]
            selected = intent_resolution["selection"]
            result = build_capability_bundle(
                args.industry, args.product, intent["semantic_family"],
                args.product_version
            )
            result["selection"]["page_intent"] = intent
            result["selection"]["variant"] = selected["variant"]
            result["selection"]["pattern_contract"] = selected["pattern_contract"]
            result["pattern_variants"] = [
                variant for variant in result.get("pattern_variants", [])
                if variant["id"].endswith(f'.{selected["variant"]}')
            ]
            result["intent_resolution"] = intent_resolution
            if len(result["pattern_variants"]) != 1:
                raise ContractError(
                    f"能力包未唯一登记所选Variant: {selected['variant']}"
                )
        else:
            result = build_capability_bundle(
                args.industry, args.product, args.page_type,
                args.product_version
            )
    except (ContractError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
