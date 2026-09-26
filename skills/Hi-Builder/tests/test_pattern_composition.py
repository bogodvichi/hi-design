import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import PatternPageError, compile_pattern_page
from core import load_json
from validate_pattern_page import validate_pattern_html


class PatternCompositionTest(unittest.TestCase):
    def load_case(self, name: str) -> dict:
        return load_json(ROOT / "tests" / "generation" / f"{name}.json")

    def test_normal_case_uses_one_exact_variant(self) -> None:
        spec = self.load_case("pvia-face-alarm-case-normal")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "normal.html"
            html = compile_pattern_page(spec, path)
            self.assertIn('"pattern_family": "hui.tpp.family.table-manual-filter"', html)
            self.assertNotIn('"composition_resolution"', html)
            path.write_text(html, encoding="utf-8")
            self.assertEqual(validate_pattern_html(spec, path), [])

    def test_positive_composition_generates_filter_and_statistics(self) -> None:
        spec = self.load_case("pvia-face-alarm-case-composition-positive")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "positive.html"
            html = compile_pattern_page(spec, path)
            self.assertIn('"status": "verified"', html)
            self.assertIn('"contribution": "summary.metrics"', html)
            self.assertIn("hui.tpp.page.table.horizontal-filter-high-low", html)
            self.assertIn("hui.tpp.page.table.with-statistics", html)
            self.assertIn('class="manual-horizontal-filter"', html)
            self.assertIn('data-zone="summary.metrics"', html)
            self.assertIn("<h-stats", html)
            path.write_text(html, encoding="utf-8")
            self.assertEqual(validate_pattern_html(spec, path), [])

    def test_conflicting_filter_placements_are_rejected(self) -> None:
        spec = self.load_case("pvia-face-alarm-case-composition-conflict")
        with self.assertRaisesRegex(
            PatternPageError,
            "TPP组合参数冲突: filter_placement=horizontal-bar vs left-sidebar",
        ):
            compile_pattern_page(spec)

    def test_missing_auxiliary_variables_are_rejected(self) -> None:
        spec = self.load_case(
            "pvia-face-alarm-case-composition-missing-variable"
        )
        with self.assertRaisesRegex(
            PatternPageError, "辅助Variant缺少PageSpec变量: summary_metrics"
        ):
            compile_pattern_page(spec)


if __name__ == "__main__":
    unittest.main()
