"""Drafting one feedback email per participant.

Coaching voice, not scoring voice. Three short paragraphs: what worked,
the one thing, why it matters. Under 200 words, because a long feedback
email does not get read.

The most useful element is a timestamped quote of the person's own
words — it makes the note specific rather than disputable. That quote is
the reason this stage is identified, and the reason it is deleted
afterwards.

Two rules the drafter enforces rather than hopes for:

* an intern is never coached on a demand their block has not reached;
* an unconfirmed low-confidence verdict never reaches an email.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import model

# Which rubric items belong to which role. A person is only ever coached
# on something their own card asked of them.
OWNED_BY = {
    "PRESENTER": ["deidentified", "eight_slides", "hook_first", "one_block",
                  "let_silence", "reveal_missed"],
    "SCRIBE": ["board_posted", "struck_reason"],
    # The intern owns the whole ladder; BLOCK_ASKS gates which rungs
    # have actually been introduced. Without that, the block-awareness
    # has nothing to withhold and the rule is decorative.
    "PGY1": ["problem_rep", "three_to_four", "cant_miss",
             "discriminator", "framework_first", "struck_reason", "confidence"],
    "SENIOR": ["framework_first", "struck_reason", "discriminator", "confidence"],
    "FACULTY": [],
    "FACILITATOR": ["objective_read", "uninterrupted"],
}

# What each block has introduced for the intern. An item outside this
# list is not yet a fair thing to coach on.
BLOCK_ASKS = {
    "jul-sep": ["problem_rep", "three_to_four", "cant_miss"],
    "oct-dec": ["problem_rep", "three_to_four", "cant_miss", "discriminator"],
    "jan-mar": ["problem_rep", "three_to_four", "cant_miss", "discriminator", "framework_first"],
    "apr-jun": ["problem_rep", "three_to_four", "cant_miss", "discriminator",
                "framework_first", "struck_reason", "confidence"],
}

CARD_URL = "https://sageproject.xyz/morning-report/roles/{slug}/"
CARD_SLUG = {
    "PRESENTER": "presenter", "SCRIBE": "scribe", "PGY1": "pgy1",
    "SENIOR": "senior", "FACULTY": "faculty", "FACILITATOR": "facilitator",
}

SYSTEM = (
    "You draft a short, private coaching note to one participant after a 25-minute pediatric "
    "morning report. You are given what they did well and the single thing to work on, both "
    "already chosen for you.\n\n"
    "Write exactly three short paragraphs, under 200 words in total:\n"
    "1. What worked. Name it, and quote their own words with the timestamp you are given.\n"
    "2. The one thing for next time. One improvement, not five. Concrete and doable next session.\n"
    "3. Why it matters — the reasoning behind the standard, not a restatement of it.\n\n"
    "Rules:\n"
    "- Coaching voice. Never mention scores, counts, boxes, percentages or a rubric.\n"
    "- Never write 'you scored', 'you missed', 'item B5' or anything that reads as a grade.\n"
    "- Second person, warm, direct, no preamble and no sign-off.\n"
    "- Do not invent quotes. Use only the quote you are given, verbatim, with its timestamp.\n"
    "- Do not raise anything beyond the one improvement you were given.\n"
    "- Plain prose. No headings, no bullets, no markdown.\n"
    "- Refer to the person as 'you'. Do not use their name; you have not been given it."
)


@dataclass
class Draft:
    role: str
    name: str
    subject: str
    body: str
    based_on: dict
    withheld: list

    def filename(self) -> str:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in self.name.lower())
        while "--" in safe:
            safe = safe.replace("--", "-")
        return f"{self.role.lower()}-{safe.strip('-')}.md"

    def render(self) -> str:
        lines = [
            f"Subject: {self.subject}",
            "",
            self.body.strip(),
            "",
            "---",
            f"Your card, if it is useful: {CARD_URL.format(slug=CARD_SLUG.get(self.role, 'run-of-show'))}",
            "",
            "<!--",
            "  Draft only. Read it, change it, send it from your own mail client.",
            "  Nothing here is filed, reported, or used for evaluation.",
            f"  Strength drawn from: {self.based_on.get('strength', '(none found)')}",
            f"  Improvement drawn from: {self.based_on.get('improvement', '(none found)')}",
        ]
        for w in self.withheld:
            lines.append(f"  Withheld: {w}")
        lines += ["-->", ""]
        return "\n".join(lines)


def _confirmed(result: dict) -> bool:
    """A verdict good enough to coach on.

    A low-confidence model verdict nobody has confirmed is not.
    """
    if result.get("final_verdict") is None:
        return False
    if result.get("source") != "model":
        return True
    return (result.get("confidence") or 0) >= model.LOW_CONFIDENCE


def choose(role: str, results: dict, rubric, block: str) -> tuple:
    """Pick the one strength and the one improvement, plus what was withheld."""
    owned = OWNED_BY.get(role.upper(), [])
    allowed = owned
    withheld: list[str] = []

    if role.upper() == "PGY1":
        introduced = BLOCK_ASKS.get(block, BLOCK_ASKS["jul-sep"])
        blocked = [i for i in owned if i not in introduced]
        allowed = [i for i in owned if i in introduced]
        for item_id in blocked:
            item = rubric.by_id(item_id)
            if item:
                withheld.append(
                    f"{item.code} ({item.text}) — not introduced until after the {block} block"
                )

    strength = improvement = None
    for item_id in allowed:
        r = results.get(item_id)
        item = rubric.by_id(item_id)
        if not r or not item or not _confirmed(r):
            if r is not None and item is not None:
                if r.get("final_verdict") is None:
                    why = "no verdict yet, so not used"
                else:
                    why = (f"model confidence {r.get('confidence'):.2f}, below "
                           f"{model.LOW_CONFIDENCE:.2f} and unconfirmed, so not used")
                withheld.append(f"{item.code} — {why}")
            continue
        if r["final_verdict"] is True and strength is None:
            strength = (item, r)
        elif r["final_verdict"] is False and improvement is None:
            improvement = (item, r)

    return strength, improvement, withheld


def build_payload(role: str, item_strength, item_improvement, block: str, objective: str) -> dict:
    """The prompt for one note. Carries no name — the role is all it needs."""
    parts = [f"Role: {role.lower().replace('pgy1', 'PGY-1 discussant')}"]
    if objective:
        parts.append(f"Session objective: {objective}")
    if block and role.upper() == "PGY1":
        parts.append(
            f"Their block is {block}. Do not raise anything the block has not introduced."
        )

    if item_strength:
        item, r = item_strength
        parts.append("\nWHAT WORKED — write paragraph one about this:")
        parts.append(f"  The standard: {item.text}")
        if r.get("quote"):
            parts.append(f'  Their words: "{r["quote"]}" at {r.get("timestamp") or "the time given"}')
        if r.get("why"):
            parts.append(f"  Why it counted: {r['why']}")
    else:
        parts.append("\nWHAT WORKED: nothing specific was recorded. Open by acknowledging "
                     "they took the role, briefly and without inventing detail.")

    if item_improvement:
        item, r = item_improvement
        parts.append("\nTHE ONE THING — write paragraphs two and three about this, and nothing else:")
        parts.append(f"  The standard, from their card: {item.text}")
        if r.get("why"):
            parts.append(f"  What happened: {r['why']}")
        if r.get("quote"):
            parts.append(f'  Their words: "{r["quote"]}" at {r.get("timestamp") or "the time given"}')
        parts.append(f"  Why the standard exists: {item.evidence}")
    else:
        parts.append("\nTHE ONE THING: nothing to raise. Write two short paragraphs instead — "
                     "what worked, and one thing to keep doing. Do not invent a criticism.")

    return {"system": SYSTEM, "user": "\n".join(parts)}


def subject_for(role: str) -> str:
    return {
        "PRESENTER": "Morning report — a quick note on your case",
        "SCRIBE": "Morning report — a quick note on the board",
        "PGY1": "Morning report — a quick note on your first pass",
        "SENIOR": "Morning report — a quick note on your second pass",
        "FACULTY": "Morning report — a quick note",
        "FACILITATOR": "Morning report — a quick note on running the room",
    }.get(role.upper(), "Morning report — a quick note")


def draft_all(working: dict, rubric, client, boundary, dry_run: bool = False) -> list[Draft]:
    results = {**working.get("items", {}), **working.get("automatic_fails", {})}
    block = working.get("block", "jul-sep")
    objective = working.get("objective", "")
    drafts: list[Draft] = []

    for name, role in (working.get("roles") or {}).items():
        strength, improvement, withheld = choose(role, results, rubric, block)
        payload = build_payload(role, strength, improvement, block, objective)

        # nothing identified leaves, even here
        payload["user"] = boundary.substitute(payload["user"])
        residual = boundary.residual_names(payload["user"])
        if residual:
            raise model.ModelError(
                "refusing to draft: names survived substitution — " + ", ".join(residual)
            )

        if dry_run or client is None or not client.ready():
            body = _placeholder(role, strength, improvement)
        else:
            resp = client._sdk().messages.create(
                model=client.model, max_tokens=700,
                system=payload["system"],
                messages=[{"role": "user", "content": payload["user"]}],
            )
            body = "".join(getattr(b, "text", "") for b in resp.content).strip()

        drafts.append(Draft(
            role=role.upper(), name=name, subject=subject_for(role), body=body,
            based_on={
                "strength": strength[0].code + " " + strength[0].text if strength else None,
                "improvement": improvement[0].code + " " + improvement[0].text if improvement else None,
            },
            withheld=withheld,
        ))

    return drafts


def _placeholder(role, strength, improvement) -> str:
    """What a dry run writes instead of calling the model."""
    lines = []
    if strength:
        item, r = strength
        q = f' You said: "{r["quote"]}" ({r.get("timestamp") or "—"}).' if r.get("quote") else ""
        lines.append(f"[dry run] What worked: {item.text.lower()}.{q}")
    else:
        lines.append("[dry run] What worked: nothing specific was recorded.")
    if improvement:
        item, r = improvement
        lines.append(f"[dry run] One thing for next time: {item.text.lower()}. {r.get('why', '')}".strip())
        lines.append(f"[dry run] Why it matters: {item.evidence}")
    else:
        lines.append("[dry run] Nothing to raise this session.")
    return "\n\n".join(lines)
