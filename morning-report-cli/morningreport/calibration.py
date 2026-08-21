"""Calibration — measuring the second rater before trusting it.

For the first ten real sessions the tool scores blind and a human scores
independently, and this reports per-item agreement. Nothing aggregate is
reported to anyone until that agreement is known.

An item under roughly 80% agreement is not trustworthy and is demoted to
human-only in the next rubric version. The model is a second rater with
unknown reliability, because that is what it is.
"""

from __future__ import annotations

from dataclasses import dataclass

THRESHOLD = 0.80
MIN_SESSIONS = 10
MIN_OBSERVATIONS = 4


@dataclass
class ItemAgreement:
    code: str
    text: str
    compared: int
    agreed: int

    @property
    def rate(self) -> float | None:
        return self.agreed / self.compared if self.compared else None

    @property
    def verdict(self) -> str:
        if self.compared < MIN_OBSERVATIONS:
            return "too few"
        if self.rate is None:
            return "too few"
        return "keep" if self.rate >= THRESHOLD else "demote to human-only"


def compare(sessions: list[dict], rubric) -> dict:
    """Per-item agreement between the model and the human across sessions.

    A comparison only exists where both a model verdict and a settled
    final verdict are present. Items the model never scored are reported
    as such rather than counted as agreement.
    """
    rows: dict[str, ItemAgreement] = {}
    for item in rubric.items:
        rows[item.id] = ItemAgreement(code=item.code, text=item.text, compared=0, agreed=0)

    for s in sessions:
        results = {**(s.get("items") or {}), **(s.get("automatic_fails") or {})}
        for item_id, r in results.items():
            if item_id not in rows:
                continue
            mv, fv = r.get("model_verdict"), r.get("final_verdict")
            if mv is None or fv is None:
                continue
            rows[item_id].compared += 1
            if mv == fv:
                rows[item_id].agreed += 1

    ordered = sorted(
        rows.values(),
        key=lambda a: (a.rate if a.rate is not None else 2, a.code),
    )

    scored = [a for a in ordered if a.compared >= MIN_OBSERVATIONS]
    overall = (
        sum(a.agreed for a in scored) / sum(a.compared for a in scored)
        if scored and sum(a.compared for a in scored) else None
    )

    return {
        "sessions": len(sessions),
        "ready": len(sessions) >= MIN_SESSIONS,
        "min_sessions": MIN_SESSIONS,
        "threshold": THRESHOLD,
        "overall": overall,
        "items": ordered,
        "demote": [a.code for a in scored if a.rate is not None and a.rate < THRESHOLD],
    }
