"""The data folder — the same one the browser half writes to.

    MorningReport/
      roster.json          names, browser half only
      casebank/            de-identified, permanent
      sessions/            de-identified, permanent
      board-archive/       de-identified, permanent
      working/             identified, ephemeral, CLI only, 7-day purge

Identified is a working stage, never a storage state. Everything under
working/ is on a clock from the moment it is written, and the sweep runs
on every invocation whether or not anyone asked for it — retention, not
identification, is the actual risk.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

RETENTION_DAYS = 7
WORKING = "working"
ENV_VAR = "MORNINGREPORT_DATA"


class StoreError(RuntimeError):
    pass


@dataclass
class Store:
    root: Path

    # ---- construction -------------------------------------------------

    @classmethod
    def resolve(cls, path=None) -> "Store":
        candidate = path or os.environ.get(ENV_VAR)
        if not candidate:
            raise StoreError(
                "No data folder. Pass --data, or set "
                f"{ENV_VAR} to the folder the browser tools are pointed at."
            )
        root = Path(candidate).expanduser().resolve()
        if not root.exists():
            raise StoreError(f"{root} does not exist.")
        if not root.is_dir():
            raise StoreError(f"{root} is not a folder.")
        return cls(root=root)

    # ---- paths ----------------------------------------------------------

    def path(self, *parts) -> Path:
        p = self.root.joinpath(*parts)
        # never let a session id escape the data folder
        if self.root not in p.resolve().parents and p.resolve() != self.root:
            raise StoreError(f"{p} is outside the data folder.")
        return p

    def working(self, *parts) -> Path:
        return self.path(WORKING, *parts)

    # ---- json -----------------------------------------------------------

    def read(self, *parts):
        p = self.path(*parts)
        if not p.exists():
            return None
        try:
            text = p.read_text(encoding="utf-8").strip()
        except OSError as e:
            raise StoreError(f"could not read {p}: {e}") from e
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise StoreError(f"{p} is not valid JSON: {e}") from e

    def write(self, obj, *parts) -> Path:
        p = self.path(*parts)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        try:
            tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            tmp.replace(p)
        except OSError as e:
            tmp.unlink(missing_ok=True)
            raise StoreError(f"could not write {p}: {e}") from e
        return p

    def write_text(self, text: str, *parts) -> Path:
        p = self.path(*parts)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def list(self, *parts) -> list[str]:
        p = self.path(*parts)
        if not p.exists():
            return []
        return sorted(f.name for f in p.iterdir() if f.is_file())

    def read_all(self, *parts) -> list[tuple[str, dict]]:
        out = []
        for name in self.list(*parts):
            if not name.endswith(".json"):
                continue
            data = self.read(*parts, name)
            if data is not None:
                out.append((name, data))
        return out

    def remove(self, *parts) -> bool:
        p = self.path(*parts)
        if p.is_dir():
            shutil.rmtree(p)
            return True
        if p.exists():
            p.unlink()
            return True
        return False

    # ---- the purge --------------------------------------------------------

    def purge(self, days: int = RETENTION_DAYS, force: bool = False) -> list[str]:
        """Delete everything under working/ older than `days`.

        With `force`, delete all of it regardless of age. Returns the
        paths removed, relative to the data folder, so the caller can say
        what went.
        """
        base = self.path(WORKING)
        if not base.exists():
            return []

        cutoff = time.time() - days * 86400
        removed: list[str] = []

        for p in sorted(base.rglob("*"), key=lambda x: len(x.parts), reverse=True):
            if p.is_dir():
                continue
            try:
                stale = force or p.stat().st_mtime < cutoff
            except OSError:
                stale = False
            if stale:
                try:
                    p.unlink()
                    removed.append(str(p.relative_to(self.root)))
                except OSError:
                    pass

        # tidy away directories the sweep emptied
        for p in sorted(base.rglob("*"), key=lambda x: len(x.parts), reverse=True):
            if p.is_dir() and not any(p.iterdir()):
                try:
                    p.rmdir()
                except OSError:
                    pass

        return removed

    def grep(self, needle: str, skip: tuple[str, ...] = ("roster.json",)) -> list[str]:
        """Every file where `needle` appears as a whole word.

        Whole-word rather than substring, or "Mark" matches
        "marked_sent" and the verification cries wolf on its own
        bookkeeping. Used by mark-sent to prove the purge finished, and
        by the tests, which assert a resident's name appears nowhere
        outside roster.json afterwards.
        """
        import re

        pattern = re.compile(r"(?<![\w'])" + re.escape(needle) + r"(?![\w])", re.IGNORECASE)
        hits: list[str] = []
        for p in self.root.rglob("*"):
            if not p.is_file():
                continue
            rel = str(p.relative_to(self.root))
            if rel in skip:
                continue
            try:
                if pattern.search(p.read_text(encoding="utf-8", errors="ignore")):
                    hits.append(rel)
            except OSError:
                continue
        return sorted(hits)
