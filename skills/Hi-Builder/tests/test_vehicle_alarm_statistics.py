import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import compile_pattern_page
from core import load_json
from validate_pattern_page import validate_pattern_html


class VehicleAlarmStatisticsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = load_json(
            ROOT / "tests/generation/vehicle-alarm-statistics-table.json"
        )
        self.html = compile_pattern_page(self.spec)

    def test_statistics_are_rendered_inside_table_columns(self) -> None:
        self.assertIn("collection-summary-metrics", self.html)
        self.assertIn("statisticsStyle", self.html)
        self.assertIn("activeSummaryMetric", self.html)
        self.assertIn('slot="titlePrefix"', self.html)
        self.assertIn('slot="valueSuffix"', self.html)
        self.assertIn("<h-stats", self.html)
        self.assertIn("column.kind==='progress'", self.html)
        self.assertIn("<el-progress", self.html)
        self.assertIn("column.kind==='tag-pair'", self.html)
        self.assertIn('data-variant="primary"', self.html)
        self.assertIn('data-variant="secondary"', self.html)

    def test_generated_page_passes_pattern_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            html_path = Path(directory) / "vehicle-alarm.html"
            html_path.write_text(
                compile_pattern_page(self.spec, html_path),
                encoding="utf-8",
            )
            self.assertEqual(validate_pattern_html(self.spec, html_path), [])

    def test_detail_action_toggles_alarm_detail_pane(self) -> None:
        self.assertIn('class="table-detail-pane"', self.html)
        self.assertIn("detailPaneVisible", self.html)
        self.assertIn("this.selectedDetailRow.id === row.id", self.html)
        self.assertNotIn("table-detail-pane__header", self.html)
        self.assertNotIn("closeDetailPane", self.html)
        self.assertIn("has-master-divider", self.html)
        self.assertIn("!!(this.config.detail_tabs || []).length", self.html)
        self.assertIn(".query-filter::after", self.html)
        self.assertIn("right: 0; bottom: 0; left: 0; height: 1px", self.html)
        self.assertNotIn(".collection-main.has-toolbar-divider", self.html)
        self.assertNotIn(".collection-main.is-details-pane-open .table-detail-pane", self.html)
        self.assertIn("'has-details-pane':hasTableDetailsPane", self.html)
        self.assertIn("'is-details-pane-open':isTableDetailsPane", self.html)
        self.assertIn("hasTableDetailsPane: function", self.html)
        self.assertNotIn(".page-toolbar::before", self.html)
        self.assertIn("padding: var(--d2c-renderer-page-actions-padding, 0 24px)", self.html)
        self.assertIn("margin: 0 24px; padding: 16px 0;", self.html)
        self.assertNotIn("overflow: hidden; border-top: 1px solid var(--h-color-border-tertiary);", self.html)

    def test_statistics_cards_filter_the_table_as_tabs(self) -> None:
        self.assertIn('@click="selectSummaryMetric(item)"', self.html)
        self.assertIn('@keyup.enter="selectSummaryMetric(item)"', self.html)
        self.assertIn('role="button"', self.html)
        self.assertIn("selectSummaryMetric: function (item)", self.html)
        self.assertIn("activeMetric.filter_key", self.html)
        self.assertIn("row[activeMetric.filter_key]", self.html)
        self.assertIn('"filter_key": "riskStatus"', self.html)
        self.assertIn('"filter_value": "高风险"', self.html)

    def test_filters_use_the_registered_realtime_filter_pattern(self) -> None:
        self.assertIn('filter-container is-selected-tags realtime-filter', self.html)
        self.assertIn('<el-checkable-tag', self.html)
        self.assertIn('data-component="filter.instant-filter"', self.html)
        self.assertIn("isRealtimeFilter: function", self.html)
        self.assertIn("selectedRealtimeFilters: function", self.html)
        self.assertIn("selectRealtimeFilter: function", self.html)
        self.assertIn("clearRealtimeFilters: function", self.html)
        self.assertIn('"trigger": "realtime"', self.html)
        self.assertIn('"selected_filter_state_separator": "dashed-top"', self.html)
        self.assertIn('"selected_filter_state_spacing_before": "24px"', self.html)
        self.assertIn('"filter_container_padding_vertical": "16px"', self.html)
        self.assertIn('"filter_option_interactive_tone": "brand"', self.html)
        self.assertIn('"selected_filter_state_padding_vertical": "16px"', self.html)
        self.assertIn('"selected_filter_state_bottom_spacing_compensation": "-16px"', self.html)
        self.assertIn('"selected_filter_state_visibility_when_empty": "hidden"', self.html)
        self.assertIn('"selected_filter_clear_action_placement": "after-selected-items"', self.html)
        self.assertIn('"selected_filter_clear_action_tone": "brand"', self.html)
        self.assertIn('"selected_filter_clear_action_interactive_tone": "brand-stable"', self.html)
        self.assertIn('v-if="selectedRealtimeFilters.length" class="realtime-filter__selected"', self.html)
        self.assertIn(".realtime-filter__selected .el-button { margin-left: 0; }", self.html)
        self.assertIn(
            ".realtime-filter-sidebar__selected .el-button { font-size: 14px; }",
            self.html,
        )
        self.assertIn(".realtime-filter__selected .realtime-filter__clear { color: var(--h-color-brand) !important; }", self.html)
        self.assertIn(".realtime-filter__selected .realtime-filter__clear:active { color: var(--h-color-brand) !important; }", self.html)
        self.assertIn(".realtime-filter { flex: none; margin: 0 24px; padding: 16px 0; border-bottom: 1px solid var(--h-color-border-tertiary); }", self.html)
        self.assertIn(".realtime-filter__options .el-tag.is-checkable:not(.is-checked):hover { color: var(--h-color-brand); border-color: var(--h-color-brand); }", self.html)
        self.assertIn(".realtime-filter__options .el-tag.is-checkable.is-checked:hover { color: #fff; border-color: var(--h-color-brand); background-color: var(--h-color-brand) !important; }", self.html)
        self.assertIn(".realtime-filter__selected { gap: 8px; margin-top: 24px; margin-bottom: -16px; padding: 16px 0; border-top: 1px dashed var(--h-color-border-tertiary); }", self.html)


if __name__ == "__main__":
    unittest.main()
