"""The API name boundary.

Every string that leaves this machine for a model API goes through
:func:`substitute` first. Names are replaced by role tokens, so the API
never receives an identifier even while the local working copy is
identified.

This is the load-bearing piece of the privacy design, so it is
deliberately paranoid:

* it substitutes full names, and also each name part on its own, because
  a transcript says "Mark" as often as it says "Mark Murphy";
* it handles possessives and punctuation attached to a name;
* it is case-insensitive, because Zoom's transcript and the manifest do
  not always agree on capitalisation;
* it matches longest-first, so "Mark Murphy" cannot be half-replaced by
  a rule for "Mark";
* and :func:`residual_names` re-checks the output afterwards, so a name
  that slipped through is caught before the call rather than after.

Nothing here is a substitute for `--show-api-payload`, which prints
exactly what would be sent so a human can look at it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ROLE_TOKENS = {
    "PRESENTER": "presenter",
    "SCRIBE": "scribe",
    "PGY1": "pgy1_discussant",
    "SENIOR": "senior_discussant",
    "FACULTY": "faculty",
    "FACILITATOR": "facilitator",
}

# Name parts too common or too short to blank out on their own without
# mangling ordinary words.
TOO_COMMON = {
    "a", "an", "the", "de", "van", "von", "der", "den", "el", "al", "bin",
    "md", "do", "rn", "np", "pa", "dr", "mr", "mrs", "ms",
}

# First names that are also ordinary English words. A lone one of these
# is only substituted when it is capitalised, so "The mark on the film"
# survives while "Mark, can you share?" does not. The full name is always
# matched case-insensitively, so nothing is lost by this.
ALSO_A_WORD = {
    "mark", "will", "bill", "art", "rose", "grace", "may", "june", "july",
    "august", "dawn", "hope", "faith", "frank", "drew", "chase", "sunny",
    "sky", "summer", "autumn", "olive", "ruby", "pearl", "jade", "amber",
    "crystal", "hunter", "carter", "parker", "porter", "cooper", "mason",
    "miller", "baker", "walker", "fisher", "gardener", "sawyer", "wade",
    "rich", "young", "long", "short", "white", "black", "brown", "green",
    "gray", "grey", "reed", "cliff", "dale", "glen", "heath", "moss",
    "stone", "field", "brooks", "banks", "rivers", "ford", "bridges",
    "case", "reason", "story", "page", "chapter", "bond", "lane", "king",
    "prince", "earl", "duke", "marshall", "sergeant", "major", "chance",
    "trace", "scout", "colt", "bear", "wolf", "fox", "robin", "jay",
    "lark", "wren", "crane", "swift", "day", "night", "star", "sun",
    "north", "south", "east", "west", "france", "holland", "wales",
    # role words: programs really do use placeholder names like
    # "A Resident" and "D Chief", and "chief complaint" is not a person
    "chief", "resident", "attending", "fellow", "intern", "student",
    "doctor", "nurse", "senior", "junior", "faculty", "presenter",
    "scribe", "facilitator",
}


@dataclass(frozen=True)
class Rule:
    pattern: re.Pattern
    token: str
    source: str


class NameBoundary:
    """Swaps participant names for role tokens on the way out."""

    def __init__(self, mapping: dict[str, str]):
        """`mapping` is {display name from the transcript: ROLE}."""
        self.mapping: dict[str, str] = {}
        self.rules: list[Rule] = []

        for name, role in mapping.items():
            role = str(role).strip().upper()
            if role not in ROLE_TOKENS:
                raise ValueError(
                    f"unknown role {role!r} for {name!r}; expected one of {', '.join(sorted(ROLE_TOKENS))}"
                )
            self.mapping[name] = role

        variants: list[tuple[str, str, str]] = []
        for name, role in self.mapping.items():
            token = f"[{role}]"
            full = name.strip()
            if full:
                variants.append((full, token, name))
            for part in re.split(r"[\s,]+", full):
                part = part.strip(".").strip()
                if len(part) < 3 or part.lower() in TOO_COMMON:
                    continue
                variants.append((part, token, name))

        # longest first, so "Mark Murphy" wins over "Mark"
        variants.sort(key=lambda v: len(v[0]), reverse=True)
        seen: set[str] = set()
        for text, token, source in variants:
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            # A lone name part that is also an ordinary word only matches
            # when capitalised. Full names always match case-insensitively.
            is_part = " " not in text.strip()
            flags = 0 if (is_part and text.lower() in ALSO_A_WORD) else re.IGNORECASE
            # \b would not fire next to an apostrophe, so handle possessives
            pattern = re.compile(
                r"(?<![\w'])" + re.escape(text) + r"(?:'s|’s)?(?![\w])",
                flags,
            )
            self.rules.append(Rule(pattern=pattern, token=token, source=source))

    def token_for(self, name: str) -> str | None:
        role = self.mapping.get(name)
        if role:
            return f"[{role}]"
        for known, role in self.mapping.items():
            if known.lower() == str(name).lower():
                return f"[{role}]"
        return None

    def substitute(self, text: str) -> str:
        """Replace every known name with its role token."""
        return self.substitute_counted(text)[0]

    def substitute_counted(self, text: str) -> tuple[str, int]:
        """As :meth:`substitute`, and how many replacements were made."""
        if not text:
            return text, 0
        out = text
        total = 0
        for rule in self.rules:
            out, n = rule.pattern.subn(rule.token, out)
            total += n
        return out, total

    def residual_names(self, text: str) -> list[str]:
        """Any known name still present after substitution.

        Always empty if :meth:`substitute` did its job. It is checked
        anyway, because the cost of being wrong here is a name reaching
        an API and the cost of checking is nothing.
        """
        found: list[str] = []
        for rule in self.rules:
            if rule.pattern.search(text):
                found.append(rule.source)
        return sorted(set(found))

    def unmapped_speakers(self, speakers: list[str]) -> list[str]:
        """Speakers in the transcript with no role in the manifest.

        These are the dangerous ones: an unmapped speaker's name is not
        substituted, because nothing knows to substitute it.
        """
        known = {k.lower() for k in self.mapping}
        return [s for s in speakers if s and s.lower() not in known]


def redact_cue(cue, boundary: NameBoundary) -> str:
    """One transcript line, safe to send: role token, timestamp, text."""
    speaker = boundary.token_for(cue.speaker) if cue.speaker else None
    if speaker is None:
        speaker = "[OTHER]"
    return f"[{cue.stamp}] {speaker}: {boundary.substitute(cue.text)}"


def redact_transcript(transcript, boundary: NameBoundary) -> str:
    return "\n".join(redact_cue(c, boundary) for c in transcript)
