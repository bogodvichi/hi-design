#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="从HUI运行资源生成图标目录")
    parser.add_argument("--css", required=True, type=Path)
    parser.add_argument("--icon-v2", required=True, type=Path)
    parser.add_argument("--hui", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    css = args.css.read_text(encoding="utf-8", errors="replace")
    icon_v2 = args.icon_v2.read_text(encoding="utf-8", errors="replace")
    hui = args.hui.read_text(encoding="utf-8", errors="replace")
    payload = {
        "schema_version": "hui-icon-catalog.v1",
        "font_style_classification": {
            "method": "name-suffix",
            "filled_suffix": "_f",
            "filled_style": "filled",
            "default_style": "linear",
        },
        "sources": {
            "font": {"sha256": digest(args.css)},
            "icon_v2": {"sha256": digest(args.icon_v2)},
            "business_svg": {"sha256": digest(args.hui)},
        },
        "font": sorted(set(re.findall(r'\.((?:h-icon-)[A-Za-z0-9_-]+)::?before\s*\{[^}]*\bcontent\s*:', css))),
        "icon_v2": sorted(set(re.findall(r'defineComponent\(\{name:"([A-Za-z][A-Za-z0-9]*)"\}', icon_v2))),
        "business_svg": sorted(set(re.findall(r'name:"(Svg[A-Z][A-Za-z0-9]*)"', hui))),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.out}: font={len(payload['font'])}, icon_v2={len(payload['icon_v2'])}, business_svg={len(payload['business_svg'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
