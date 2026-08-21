"""Putting a session together.

Order matters: deterministic items first, then the model items one at a
time, then the items derived from others. Whatever the board and the
human already supplied wins over the model, because those are not
guesses.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import deterministic, model
from .roles import NameBoundary
from .vtt import Transcript

# Precedence when two sources have an opinion. Higher wins.
PRECEDENCE = {"model": 0, "timing": 1, "transcript": 1, "derived": 1,
              "manifest": 2, "board": 2, "human": 3}


@dataclass
class Session:
    session_id: str
    date: str
    site: str
    rubric_version: int
    block: str
    items: dict = field(default_factory=dict)
    fails: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)

    def all_results(self) -> dict:
        return {**self.items, **self.fails}

    def struck(self) -> int:
        return sum(1 for v in self.items.values() if v.get("final_verdict") is True)

    def failed(self) -> bool:
        return any(v.get("final_verdict") is True for v in self.fails.values())

    def needs_review(self) -> list[str]:
        out = []
        for code, v in self.all_results().items():
            if v.get("final_verdict") is None:
                out.append(code)
            elif v.get("source") == "model" and (v.get("confidence") or 0) < model.LOW_CONFIDENCE:
                out.append(code)
        return sorted(out)


def blank_result(item) -> dict:
    return {
        "code": item.code,
        "item": item.text,
        "final_verdict": None,
        "model_verdict": None,
        "source": "human" if item.human_only else "unscored",
        "confidence": None,
        "why": "Not scorable from a transcript; this one is yours." if item.human_only else "",
        "quote": "",
        "timestamp": None,
        "agreement": None,
    }


def merge(existing: dict, incoming: dict, item) -> dict:
    """Fold a new opinion into a result, respecting precedence."""
    out = dict(existing)
    src = incoming.get("source", "model")

    if src == "model":
        out["model_verdict"] = incoming.get("verdict")
        out["confidence"] = incoming.get("confidence")
        out["quote"] = incoming.get("quote", "")
        out["timestamp"] = incoming.get("timestamp") or out.get("timestamp")
        out["why"] = incoming.get("reasoning", "") or out.get("why", "")
    else:
        out["why"] = incoming.get("why", "") or out.get("why", "")
        if incoming.get("timestamp"):
            out["timestamp"] = incoming["timestamp"]
        if incoming.get("confidence") is not None:
            out["confidence"] = incoming["confidence"]

    current = out.get("source", "unscored")
    value = incoming.get("verdict") if src == "model" else incoming.get("final_verdict")

    if current == "unscored" or PRECEDENCE.get(src, 0) >= PRECEDENCE.get(current, 0):
        if value is not None or current == "unscored":
            out["final_verdict"] = value
            out["source"] = src

    if out.get("model_verdict") is not None and out.get("final_verdict") is not None:
        out["agreement"] = out["model_verdict"] == out["final_verdict"]

    return out


def score(rubric, transcript: Transcript, manifest, boundary: NameBoundary,
          client: model.Client | None = None, only: list[str] | None = None,
          board=None, dry_run: bool = False, on_item=None) -> Session:
    """Score a session. `only` restricts to given item codes."""
    session = Session(
        session_id=manifest.session_id,
        date=manifest.session_date,
        site=manifest.site,
        rubric_version=rubric.version,
        block=manifest.block_id(),
    )

    wanted = {c.upper() for c in only} if only else None

    for item in rubric.items:
        bucket = session.fails if item.is_fail else session.items
        bucket[item.id] = blank_result(item)

    # 1. what the board already settled — deterministic, and not a guess
    if board:
        derived = board.get("derived") or {}
        for item in rubric.items:
            key = item.derived
            if not key:
                continue
            neg = key.startswith("!")
            k = key[1:] if neg else key
            if k not in derived or derived[k] is None:
                continue
            value = not derived[k] if neg else bool(derived[k])
            bucket = session.fails if item.is_fail else session.items
            bucket[item.id] = merge(
                bucket[item.id],
                {"final_verdict": value, "source": "board",
                 "why": f"From the board archive ({k})."},
                item,
            )

    # 2. deterministic scorers
    for item in rubric.items:
        if wanted and item.code.upper() not in wanted:
            continue
        fn = deterministic.SCORERS.get(item.id)
        if not fn:
            continue
        bucket = session.fails if item.is_fail else session.items
        if bucket[item.id]["source"] == "board":
            continue
        result = fn(manifest, transcript, boundary)
        bucket[item.id] = merge(bucket[item.id], result, item)
        if on_item:
            on_item(item, bucket[item.id])

    # 3. model items, one call each
    for item in rubric.items:
        if wanted and item.code.upper() not in wanted:
            continue
        if not item.model_scored or not model.has_prompt(item.code):
            continue
        bucket = session.fails if item.is_fail else session.items
        if bucket[item.id]["source"] in ("board", "manifest"):
            continue
        if dry_run or client is None or not client.ready():
            session.notes.append(f"{item.code}: not scored (no model call made)")
            continue
        payload = model.build_payload(item, transcript, boundary, manifest)
        try:
            reply = client.send(payload)
        except model.ModelError as e:
            session.notes.append(f"{item.code}: {e}")
            continue
        reply["source"] = "model"
        bucket[item.id] = merge(bucket[item.id], reply, item)
        if on_item:
            on_item(item, bucket[item.id])

    # 4. items derived from other items
    for item in rubric.items:
        fn = deterministic.DEPENDENT.get(item.id)
        if not fn:
            continue
        bucket = session.fails if item.is_fail else session.items
        if bucket[item.id]["source"] in ("board", "human"):
            continue
        result = fn(manifest, transcript, boundary, session.items)
        if result.get("final_verdict") is not None:
            bucket[item.id] = merge(bucket[item.id], result, item)

    return session


def to_working(session: Session, manifest, rubric) -> dict:
    """The identified working record. Deleted on mark-sent or by the purge."""
    return {
        "id": session.session_id,
        "date": session.date,
        "site": session.site,
        "block": session.block,
        "objective": manifest.objective,
        "rubric_version": session.rubric_version,
        "roles": manifest.roles,
        "items": session.items,
        "automatic_fails": session.fails,
        "struck": session.struck(),
        "of": rubric.of(),
        "failed": session.failed(),
        "needs_review": session.needs_review(),
        "notes": session.notes,
        "identified": True,
        "_warning": "Identified and ephemeral. Deleted by mark-sent, and by the 7-day sweep regardless.",
    }


def to_deidentified(working: dict, rubric) -> dict:
    """What survives: verdicts, sources, confidences. No names, no quotes.

    A verbatim quote is re-identifying in a group this small, so the
    de-identified record has nowhere to put one.
    """
    def strip(results: dict) -> dict:
        out = {}
        for item_id, r in results.items():
            out[item_id] = {
                "final_verdict": r.get("final_verdict"),
                "source": r.get("source"),
                "confidence": r.get("confidence"),
                "model_verdict": r.get("model_verdict"),
                "agreement": r.get("agreement"),
            }
        return out

    return {
        "id": working["id"],
        "date": working["date"],
        "site": working["site"],
        "block": working.get("block"),
        "rubric_version": working.get("rubric_version"),
        "items": strip(working.get("items", {})),
        "automatic_fails": strip(working.get("automatic_fails", {})),
        "struck": working.get("struck"),
        "of": working.get("of"),
        "failed": working.get("failed"),
        "scored": working.get("scored"),
    }
