"""The rubric, loaded from the same file the web scorecard reads.

content/rubric.json lives in the site half. The CLI reads it rather than
keeping a copy, so the printed card, the web form and the scorer cannot
drift apart.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Item:
    id: str
    code: str
    text: str
    scored_from: str
    evidence: str
    card: str | None
    anchor: str | None
    column: str
    derived: str | None
    is_fail: bool

    @property
    def human_only(self) -> bool:
        return self.scored_from == "human"

    @property
    def model_scored(self) -> bool:
        return self.scored_from == "transcript"


@dataclass
class Rubric:
    version: int
    title: str
    lede: str
    footer: str
    items: list[Item]

    def __iter__(self):
        return iter(self.items)

    def by_code(self, code: str) -> Item | None:
        for i in self.items:
            if i.code.upper() == code.upper():
                return i
        return None

    def by_id(self, item_id: str) -> Item | None:
        for i in self.items:
            if i.id == item_id:
                return i
        return None

    @property
    def scored_items(self) -> list[Item]:
        return [i for i in self.items if not i.is_fail]

    @property
    def fails(self) -> list[Item]:
        return [i for i in self.items if i.is_fail]

    def of(self) -> int:
        return len(self.scored_items)


def default_path() -> Path:
    """morning-report/content/rubric.json, relative to this package."""
    here = Path(__file__).resolve()
    return here.parents[2] / "morning-report" / "content" / "rubric.json"


def load(path=None) -> Rubric:
    p = Path(path) if path else default_path()
    if not p.exists():
        raise FileNotFoundError(
            f"no rubric at {p}. Pass --rubric, or run from the repository so "
            "morning-report/content/rubric.json can be found."
        )
    data = json.loads(p.read_text(encoding="utf-8"))

    items: list[Item] = []
    for col in data.get("columns", []):
        for raw in col.get("items", []):
            items.append(_item(raw, col.get("title", ""), False))
    for raw in data.get("automatic_fails", []):
        items.append(_item(raw, "Automatic fail", True))

    return Rubric(
        version=int(data.get("version", 1)),
        title=data.get("title", ""),
        lede=data.get("lede", ""),
        footer=data.get("footer", ""),
        items=items,
    )


def _item(raw: dict, column: str, is_fail: bool) -> Item:
    return Item(
        id=raw["id"],
        code=raw.get("code", raw["id"]),
        text=raw["text"],
        scored_from=raw.get("scored_from", "human"),
        evidence=raw.get("evidence", ""),
        card=raw.get("card"),
        anchor=raw.get("anchor"),
        column=column,
        derived=raw.get("derived"),
        is_fail=is_fail,
    )
