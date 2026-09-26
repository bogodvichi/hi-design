#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
HUI_ROOT = ROOT / "design-systems" / "HUI"
ZONE_ROOT = HUI_ROOT / "zones"
PATTERN_ROOT = HUI_ROOT / "component-patterns"
ATOM_INDEX = HUI_ROOT / "runtime-contracts" / "index.json"
SEMANTIC_ID = re.compile(r"^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$")
FORBIDDEN_PREFIXES = {"hui", "isc", "pvia"}


class SemanticRegistryError(ValueError):
    pass


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SemanticRegistryError(f"缺少语义合同: {path.relative_to(ROOT)}") from exc
    except json.JSONDecodeError as exc:
        raise SemanticRegistryError(
            f"语义合同JSON格式错误: {path.relative_to(ROOT)}: {exc}"
        ) from exc


def _validate_id(identifier: Any, kind: str) -> str:
    if not isinstance(identifier, str) or not SEMANTIC_ID.fullmatch(identifier):
        raise SemanticRegistryError(f"{kind} ID不符合<domain>.<responsibility>: {identifier}")
    if identifier.split(".", 1)[0] in FORBIDDEN_PREFIXES:
        raise SemanticRegistryError(f"{kind} ID不得使用产品或知识层前缀: {identifier}")
    return identifier


def load_hui_atom_catalog() -> dict[str, dict[str, Any]]:
    document = _load_json(ATOM_INDEX)
    if document.get("schema_version") != "hui-runtime-index.v1":
        raise SemanticRegistryError("HUI原子控件索引版本必须是hui-runtime-index.v1")
    entries = document.get("entries")
    if not isinstance(entries, dict) or not entries:
        raise SemanticRegistryError("HUI原子控件索引不能为空")
    return entries


def load_zone_registry() -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for path in sorted(ZONE_ROOT.glob("*.json")):
        document = _load_json(path)
        if document.get("schema_version") != "d2c-zone.v1":
            raise SemanticRegistryError(f"Zone合同版本错误: {path.relative_to(ROOT)}")
        zone_id = _validate_id(document.get("id"), "Zone")
        if path.stem != zone_id:
            raise SemanticRegistryError(f"Zone文件名必须与ID一致: {path.name} != {zone_id}.json")
        if zone_id in entries:
            raise SemanticRegistryError(f"Zone ID重复: {zone_id}")
        for key in ("name", "description", "use_when", "owner"):
            if not document.get(key):
                raise SemanticRegistryError(f"Zone合同缺少{key}: {zone_id}")
        entries[zone_id] = document
    if not entries:
        raise SemanticRegistryError("HUI通用Zone Registry不能为空")
    return entries


def load_component_pattern_registry() -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    vue_components: set[str] = set()
    for path in sorted(PATTERN_ROOT.glob("*/contract.json")):
        document = _load_json(path)
        if document.get("schema_version") != "hui-component-pattern.v2":
            raise SemanticRegistryError(
                f"Component Pattern合同版本错误: {path.relative_to(ROOT)}"
            )
        component_id = _validate_id(document.get("id"), "Component")
        if path.parent.name != component_id:
            raise SemanticRegistryError(
                f"Component目录名必须与ID一致: {path.parent.name} != {component_id}"
            )
        if component_id in entries:
            raise SemanticRegistryError(f"Component ID重复: {component_id}")
        for key in (
            "name",
            "split_mode",
            "vue_component",
            "description",
            "category",
            "use_when",
            "owner",
        ):
            if not document.get(key):
                raise SemanticRegistryError(f"Component合同缺少{key}: {component_id}")
        if document["split_mode"] not in {"single", "composite", "repeat-item"}:
            raise SemanticRegistryError(
                "split_mode必须是single、composite或repeat-item: "
                f"{component_id}"
            )
        vue_component = document["vue_component"]
        if not re.fullmatch(r"[A-Z][A-Za-z0-9]*", vue_component):
            raise SemanticRegistryError(
                f"vue_component必须是PascalCase标识符: {component_id}: {vue_component}"
            )
        if vue_component in vue_components:
            raise SemanticRegistryError(f"vue_component映射重复: {vue_component}")
        vue_components.add(vue_component)
        entries[component_id] = document
    if not entries:
        raise SemanticRegistryError("HUI通用Component Pattern Registry不能为空")
    return entries


class _SemanticHTMLParser(HTMLParser):
    VOID_TAGS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[dict[str, Any]] = []
        self.zones: list[str] = []
        self.components: list[dict[str, Any]] = []
        self.orphan_atoms: list[str] = []
        self.deprecated_origins: list[str] = []

    @staticmethod
    def _is_hui_atom(tag: str) -> bool:
        return tag.startswith("el-") or tag.startswith("h-")

    def _start(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        inherited_zone = self.stack[-1]["zone"] if self.stack else None
        inherited_component = self.stack[-1]["component"] if self.stack else None
        zone = attrs.get("data-zone") or inherited_zone
        component_id = attrs.get("data-component")
        component_record = inherited_component
        if attrs.get("data-zone"):
            self.zones.append(attrs["data-zone"] or "")
        if "data-origin" in attrs:
            self.deprecated_origins.append(attrs.get("data-origin") or "")
        if component_id:
            component_record = {
                "id": component_id,
                "zone": zone,
                "tag": tag,
                "ancestor_component": inherited_component["id"] if inherited_component else None,
                "hui_atoms": set(),
            }
            self.components.append(component_record)
        if self._is_hui_atom(tag) and component_record:
            component_record["hui_atoms"].add(tag)
        elif self._is_hui_atom(tag):
            self.orphan_atoms.append(tag)
        self.stack.append({"tag": tag, "zone": zone, "component": component_record})

    def handle_starttag(
        self, tag: str, attrs_list: list[tuple[str, str | None]]
    ) -> None:
        self._start(tag, attrs_list)
        if tag in self.VOID_TAGS:
            self.stack.pop()

    def handle_startendtag(
        self, tag: str, attrs_list: list[tuple[str, str | None]]
    ) -> None:
        self._start(tag, attrs_list)
        self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break


def validate_semantic_html(
    html: str,
    composition: dict[str, Any] | None = None,
) -> list[str]:
    zones = load_zone_registry()
    patterns = load_component_pattern_registry()
    atoms = load_hui_atom_catalog()
    parser = _SemanticHTMLParser()
    parser.feed(html)
    errors: list[str] = []

    if parser.deprecated_origins:
        errors.append("HTML不得输出废弃属性data-origin，来源由Composition与Zone ID推导")

    for zone_id in sorted(set(parser.zones)):
        if zone_id not in zones:
            errors.append(f"HTML引用了未登记Zone: {zone_id}")
    if parser.orphan_atoms:
        errors.append(
            "HUI原子控件必须位于data-component内: "
            f"{sorted(set(parser.orphan_atoms))}"
        )
    for component in parser.components:
        component_id = component["id"]
        if component_id not in patterns:
            errors.append(f"HTML引用了未登记Component Pattern: {component_id}")
            continue
        if not component["zone"]:
            errors.append(f"Component必须位于Zone内: {component_id}")
        if component["ancestor_component"]:
            errors.append(
                f"data-component不得嵌套: {component['ancestor_component']} -> {component_id}"
            )
        if component["tag"].startswith(("el-", "h-")):
            errors.append(f"HUI原子控件不得声明data-component: {component['tag']}")
        used_atoms = component["hui_atoms"]
        if not used_atoms:
            errors.append(f"Component未包含HUI原子控件: {component_id}")

    parser_atoms = {
        tag
        for component in parser.components
        for tag in component["hui_atoms"]
    }
    unknown_atoms = sorted(parser_atoms - set(atoms))
    if unknown_atoms:
        errors.append(f"HTML使用了未登记HUI原子控件: {unknown_atoms}")

    if composition is not None:
        if composition.get("schema_version") != "page-composition.v1":
            errors.append("Page Composition版本必须是page-composition.v1")
        if "components" in composition:
            errors.append("Page Composition不得使用旧components映射")
        if "template" in composition:
            errors.append("Page Composition不得声明template，模板由Renderer Registry选择")
        composition_zones = composition.get("zones")
        if not isinstance(composition_zones, dict):
            errors.append("Page Composition必须声明zones映射")
        else:
            actual_pairs = {
                (component["zone"], component["id"])
                for component in parser.components
            }
            declared_pairs: set[tuple[str, str]] = set()
            for zone_id, component_ids in composition_zones.items():
                if zone_id not in zones:
                    errors.append(f"Composition引用了未登记Zone: {zone_id}")
                    continue
                if not isinstance(component_ids, list):
                    errors.append(f"Composition Zone组件必须是数组: {zone_id}")
                    continue
                for component_id in component_ids:
                    declared_pairs.add((zone_id, component_id))
                    if component_id not in patterns:
                        errors.append(f"Composition引用了未登记Component Pattern: {component_id}")
                    elif (zone_id, component_id) not in actual_pairs:
                        errors.append(f"缺少Zone组件绑定: {zone_id} -> {component_id}")
            for zone_id, component_id in sorted(actual_pairs - declared_pairs):
                errors.append(f"HTML存在Composition未声明的Zone组件绑定: {zone_id} -> {component_id}")
    return errors


def assert_semantic_html(html: str, composition: dict[str, Any] | None = None) -> None:
    errors = validate_semantic_html(html, composition)
    if errors:
        raise SemanticRegistryError("; ".join(errors))
