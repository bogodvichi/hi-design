from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from core import ContractError, load_json  # noqa: E402
from tpp_intent import TPP_ROOT, resolve_tpp_intent  # noqa: E402


class TppIntentResolutionTest(unittest.TestCase):
    def test_every_registered_variant_is_uniquely_selectable(self) -> None:
        selected = []
        for page_kind in ("table", "form", "card", "details"):
            mapping = load_json(TPP_ROOT / "mappings" / f"{page_kind}.json")
            for page in mapping["pages"].values():
                result = resolve_tpp_intent({
                    "schema_version": "tpp-page-intent.v1",
                    "page_kind": page_kind,
                    "semantic_family": page["family"],
                    "features": page.get("parameters", {}),
                })
                self.assertEqual("selected", result["status"], result)
                self.assertEqual(page["variant"], result["selection"]["variant"])
                selected.append(result["selection"]["pattern_contract"])
        self.assertEqual(64, len(selected))
        self.assertEqual(64, len(set(selected)))

    def test_partial_intent_reports_ambiguity_and_discriminator(self) -> None:
        result = resolve_tpp_intent({
            "schema_version": "tpp-page-intent.v1",
            "page_kind": "table",
            "semantic_family": "table-manual-filter",
            "features": {"filter_placement": "regular-box"},
        })
        self.assertEqual("ambiguous", result["status"])
        self.assertIn("collapse_mode", result["diagnostics"][0])

    def test_anchored_form_defaults_to_persistent_single_container(self) -> None:
        result = resolve_tpp_intent({
            "schema_version": "tpp-page-intent.v1",
            "page_kind": "form",
            "semantic_family": "form-anchored",
            "features": {},
        })
        self.assertEqual("selected", result["status"])
        self.assertEqual(
            "persistent-anchor-single-container",
            result["selection"]["variant"],
        )
        self.assertEqual(3, result["selection"]["parameters"]["columns"])

    def test_selected_contract_uses_compiler_relative_path(self) -> None:
        result = resolve_tpp_intent({
            "schema_version": "tpp-page-intent.v1",
            "page_kind": "table",
            "semantic_family": "table-manual-filter",
            "features": {
                "filter_placement": "regular-box",
                "collapse_mode": "high-low-frequency",
            },
        })
        self.assertEqual(
            "table/regular-filter-box-high-low.json",
            result["selection"]["pattern_contract"],
        )

    def test_impossible_parameter_combination_is_a_knowledge_gap(self) -> None:
        result = resolve_tpp_intent({
            "schema_version": "tpp-page-intent.v1",
            "page_kind": "table",
            "semantic_family": "table-manual-filter",
            "features": {
                "filter_placement": "left-sidebar",
                "collapse_mode": "all-retractable",
            },
        })
        self.assertEqual("no-match", result["status"])

    def test_unknown_feature_is_rejected(self) -> None:
        with self.assertRaisesRegex(ContractError, "未登记特征"):
            resolve_tpp_intent({
                "schema_version": "tpp-page-intent.v1",
                "page_kind": "form",
                "semantic_family": "form-basic",
                "features": {"filter_placement": "regular-box"},
            })

    def test_page_kind_and_family_must_agree(self) -> None:
        with self.assertRaisesRegex(ContractError, "页面类型不一致"):
            resolve_tpp_intent({
                "schema_version": "tpp-page-intent.v1",
                "page_kind": "card",
                "semantic_family": "table-basic",
                "features": {},
            })


if __name__ == "__main__":
    unittest.main()
