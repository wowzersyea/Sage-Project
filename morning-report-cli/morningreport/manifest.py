"""The session manifest: the facts the transcript cannot show.

Slide count, whether the board was exported, and the de-identification
attestation are artifact facts. Nothing in a transcript reveals them, so
they come from the facilitator and the items that depend on them are
recorded with source "manifest" rather than "model".
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .roles import ROLE_TOKENS

BLOCKS = {"jul-sep", "oct-dec", "jan-mar", "apr-jun"}


class ManifestError(ValueError):
    pass


@dataclass
class Manifest:
    session_date: str
    site: str = ""
    objective: str = ""
    slide_count: int | None = None
    board_exported: bool | None = None
    deidentified_confirmed: bool | None = None
    roles: dict[str, str] = field(default_factory=dict)
    block: str | None = None
    raw: dict = field(default_factory=dict)

    @property
    def session_id(self) -> str:
        slug = "".join(
            ch if ch.isalnum() else "-" for ch in self.site.lower()
        ).strip("-")
        while "--" in slug:
            slug = slug.replace("--", "-")
        return f"{self.session_date}-{slug}" if slug else self.session_date

    def block_id(self) -> str:
        if self.block:
            return self.block
        month = int(self.session_date.split("-")[1])
        if month in (7, 8, 9):
            return "jul-sep"
        if month in (10, 11, 12):
            return "oct-dec"
        if month in (1, 2, 3):
            return "jan-mar"
        return "apr-jun"

    def name_for(self, role: str) -> str | None:
        role = role.upper()
        for name, r in self.roles.items():
            if str(r).upper() == role:
                return name
        return None


def load(path) -> Manifest:
    p = Path(path)
    if not p.exists():
        raise ManifestError(f"no manifest at {p}")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ManifestError(f"{p} is not valid JSON: {e}") from e
    return from_dict(data)


def from_dict(data: dict) -> Manifest:
    if not isinstance(data, dict):
        raise ManifestError("the manifest must be a JSON object")

    date = str(data.get("session_date", "")).strip()
    if not date:
        raise ManifestError("session_date is required")
    parts = date.split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise ManifestError(f"session_date must look like 2026-09-03, got {date!r}")

    roles = data.get("roles") or {}
    if not isinstance(roles, dict):
        raise ManifestError("roles must be an object of {name: ROLE}")
    for name, role in roles.items():
        if str(role).upper() not in ROLE_TOKENS:
            raise ManifestError(
                f"unknown role {role!r} for {name!r}; expected one of "
                + ", ".join(sorted(ROLE_TOKENS))
            )

    block = data.get("block")
    if block is not None and str(block) not in BLOCKS:
        raise ManifestError(f"block must be one of {sorted(BLOCKS)}, got {block!r}")

    slides = data.get("slide_count")
    if slides is not None:
        try:
            slides = int(slides)
        except (TypeError, ValueError):
            raise ManifestError(f"slide_count must be a number, got {slides!r}") from None

    return Manifest(
        session_date=date,
        site=str(data.get("site", "") or ""),
        objective=str(data.get("objective", "") or ""),
        slide_count=slides,
        board_exported=_tri(data.get("board_exported")),
        deidentified_confirmed=_tri(data.get("deidentified_confirmed")),
        roles={str(k): str(v).upper() for k, v in roles.items()},
        block=str(block) if block else None,
        raw=data,
    )


def _tri(v):
    """True, False, or None for "the facilitator did not say"."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in {"true", "yes", "y", "1"}:
        return True
    if s in {"false", "no", "n", "0"}:
        return False
    return None


TEMPLATE = {
    "session_date": "2026-09-03",
    "site": "Galveston",
    "objective": "Distinguish septic arthritis from transient synovitis in a febrile toddler",
    "slide_count": 7,
    "board_exported": True,
    "deidentified_confirmed": True,
    "roles": {
        "Name As It Appears In Zoom": "PRESENTER",
        "Another Name": "SCRIBE",
        "A Resident": "PGY1",
        "B Resident": "SENIOR",
        "C Attending": "FACULTY",
        "D Chief": "FACILITATOR",
    },
}
