#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from core import ContractError
from tpp_intent import resolve_tpp_intent


def main() -> int:
    parser = argparse.ArgumentParser(description="以结构化PageIntent唯一选择TPP Variant")
    parser.add_argument("--intent", required=True, type=Path)
    args = parser.parse_args()
    try:
        intent = json.loads(args.intent.read_text(encoding="utf-8"))
        result = resolve_tpp_intent(intent)
    except (ContractError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "selected" else 3


if __name__ == "__main__":
    raise SystemExit(main())
