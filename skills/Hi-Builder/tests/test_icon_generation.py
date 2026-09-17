#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import (
    PatternPageError,
    classify_font_icon_style,
    compile_pattern_page,
)
from core import load_json
from validate_pattern_page import validate_pattern_html


class IconGenerationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = load_json(ROOT / "tests/generation/capture-card-tabs.json")

    def compile_and_validate(self, icon: str | dict[str, str]) -> str:
        spec = json.loads(json.dumps(self.spec))
        spec["portal"]["side_menus"][0]["icon"] = icon
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "page.html"
            html = compile_pattern_page(spec, path)
            path.write_text(html, encoding="utf-8")
            self.assertEqual(validate_pattern_html(spec, path), [])
        return html

    def test_font_icon_remains_backward_compatible(self) -> None:
        html = self.compile_and_validate("h-icon-car")
        self.assertNotIn("hui-svg-icon.umd.js", html)
        self.assertIn("<i :class=\"item.icon\"></i>", html)

    def test_icon_v2_is_rejected_for_common_menu_icon(self) -> None:
        with self.assertRaises(PatternPageError):
            self.compile_and_validate({"mode": "icon-v2", "name": "Car"})

    def test_business_svg_is_rejected_for_common_menu_icon(self) -> None:
        with self.assertRaises(PatternPageError):
            self.compile_and_validate(
                {"mode": "business-svg", "name": "SvgBoxCamera"}
            )

    def test_unknown_icon_is_rejected(self) -> None:
        spec = json.loads(json.dumps(self.spec))
        spec["portal"]["side_menus"][0]["icon"] = "h-icon-not_real"
        with self.assertRaisesRegex(PatternPageError, "图标未在HUI目录登记"):
            compile_pattern_page(spec)

    def test_font_icon_style_is_classified_by_filled_suffix(self) -> None:
        catalog = load_json(ROOT / "design-systems/HUI/icons/catalog.json")
        self.assertEqual(
            catalog["font_style_classification"],
            {
                "method": "name-suffix",
                "filled_suffix": "_f",
                "filled_style": "filled",
                "default_style": "linear",
            },
        )
        self.assertEqual(
            classify_font_icon_style("h-icon-menu_f", catalog), "filled"
        )
        self.assertEqual(
            classify_font_icon_style("h-icon-mark_f", catalog), "filled"
        )
        self.assertEqual(
            classify_font_icon_style("h-icon-password_visible_f", catalog),
            "filled",
        )
        self.assertEqual(
            classify_font_icon_style("h-icon-associate", catalog), "linear"
        )

    def test_generated_catalog_keeps_font_style_classification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            css = root / "hui.css"
            icon_v2 = root / "icon-v2.js"
            hui = root / "hui.js"
            output = root / "catalog.json"
            css.write_text(
                '.h-icon-menu_f::before { content: "x"; }', encoding="utf-8"
            )
            icon_v2.write_text(
                'defineComponent({name:"Car"})', encoding="utf-8"
            )
            hui.write_text('name:"SvgCamera"', encoding="utf-8")
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts/generate_icon_catalog.py"),
                    "--css", str(css),
                    "--icon-v2", str(icon_v2),
                    "--hui", str(hui),
                    "--out", str(output),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            generated = load_json(output)
        self.assertEqual(
            generated["font_style_classification"]["filled_suffix"], "_f"
        )


if __name__ == "__main__":
    unittest.main()
