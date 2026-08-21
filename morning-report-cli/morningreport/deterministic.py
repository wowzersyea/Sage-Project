"""Items that need no model at all.

Manifest lookups, clock arithmetic and turn counting. These are decided
here, recorded with a source that is not "model", and never sent to an
API — both because it would be wasteful and because a deterministic
answer should not acquire a confidence interval.
"""

from __future__ import annotations

import re

from .vtt import Transcript, format_timestamp

# The run of show, in seconds. Matches morning-report/content/roles.json;
# the two are checked against each other by the tests.
LAUNCH_END = 90          # an objective read "at 0:00" has this long to appear
FIRST_PASS_START = 7 * 60
FIRST_PASS_END = 11 * 60
SECOND_PASS_END = 16 * 60
FACULTY_ENTERS = 19 * 60
SESSION_LENGTH = 25 * 60

LAB_PATTERN = re.compile(
    r"\b(crp|esr|wbc|cbc|hgb|hemoglobin|haemoglobin|platelet|procalcitonin|"
    r"lactate|ast|alt|bilirubin|inr|creatinine|bun|sodium|potassium|glucose|"
    r"culture|gram stain|pcr|serology|titer|titre|"
    r"ultrasound|x-?ray|radiograph|ct\b|mri|echo|scan|imaging)\b",
    re.IGNORECASE,
)
CLOCK_CALL = re.compile(r"\b(0?\d[:.]\d{2}|time|minutes?|clock|move on|wrap|next)\b", re.IGNORECASE)


def _turns(transcript: Transcript, boundary, role: str):
    """Cues spoken by whoever holds `role`."""
    want = f"[{role.upper()}]"
    return [c for c in transcript if c.speaker and boundary.token_for(c.speaker) == want]


def verdict(value, source, confidence=None, why="", stamp=None):
    return {
        "final_verdict": value,
        "model_verdict": None,
        "source": source,
        "confidence": confidence,
        "why": why,
        "timestamp": stamp,
    }


def score_a1(manifest, transcript, boundary) -> dict:
    """De-identified — the attestation, plus a look at the transcript."""
    from .phi import scan

    hits = []
    for cue in transcript:
        for f in scan(cue.text):
            if f["severity"] == "block":
                hits.append(f"{f['kind']} at {cue.stamp}")
    if manifest.deidentified_confirmed is None:
        return verdict(None, "manifest", why="The manifest does not say. Confirm it by hand.")
    if hits:
        return verdict(
            False, "manifest",
            why="Attested, but the transcript still contains " + "; ".join(hits[:4])
                + (" and more" if len(hits) > 4 else "") + ".",
        )
    return verdict(
        bool(manifest.deidentified_confirmed), "manifest",
        why="Facilitator attestation; no identifier pattern found in the transcript.",
    )


def score_a2(manifest, transcript, boundary) -> dict:
    if manifest.slide_count is None:
        return verdict(None, "manifest", why="slide_count is not in the manifest.")
    ok = manifest.slide_count <= 8
    return verdict(ok, "manifest", why=f"slide_count is {manifest.slide_count}.")


def score_b9(manifest, transcript, boundary) -> dict:
    if manifest.board_exported is None:
        return verdict(None, "manifest", why="board_exported is not in the manifest.")
    return verdict(
        bool(manifest.board_exported), "manifest",
        why="board_exported is " + str(manifest.board_exported).lower() + " in the manifest.",
    )


def score_b4(manifest, transcript, boundary) -> dict:
    """First pass uninterrupted.

    Nobody but the intern speaks more than about five words between 0:07
    and 0:11 — except the facilitator calling the clock, which is their
    job rather than an interruption.
    """
    window = transcript.between(FIRST_PASS_START, FIRST_PASS_END)
    if not len(window):
        return verdict(None, "timing", why="No cues in the first-pass window; check the clock.")

    interruptions = []
    for cue in window:
        token = boundary.token_for(cue.speaker) if cue.speaker else None
        if token == "[PGY1]":
            continue
        if cue.words <= 5:
            continue
        if token == "[FACILITATOR]" and CLOCK_CALL.search(cue.text):
            continue
        who = (token or "[OTHER]").strip("[]").lower()
        interruptions.append(f"{who} at {cue.stamp} ({cue.words} words)")

    if interruptions:
        return verdict(
            False, "timing",
            why="Interrupted by " + "; ".join(interruptions[:3])
                + (" and more" if len(interruptions) > 3 else "") + ".",
            stamp=window.cues[0].stamp,
        )
    return verdict(True, "timing", why="Nobody else spoke more than five words between 0:07 and 0:11.")


def score_f2(manifest, transcript, boundary) -> dict:
    """Faculty in before 0:19."""
    faculty = _turns(transcript, boundary, "FACULTY")
    if not manifest.name_for("FACULTY"):
        return verdict(None, "timing", why="No faculty role in the manifest.")
    early = [c for c in faculty if c.start < FACULTY_ENTERS and c.words > 5]
    if early:
        first = early[0]
        return verdict(
            True, "timing",
            why=f"Faculty spoke {first.words} words at {first.stamp}, before 0:19.",
            stamp=first.stamp,
        )
    return verdict(False, "timing", why="No substantive faculty turn before 0:19.")


def score_f3(manifest, transcript, boundary) -> dict:
    """Ran past 25 minutes."""
    if not len(transcript):
        return verdict(None, "timing", why="Empty transcript.")
    over = transcript.duration > SESSION_LENGTH
    return verdict(
        over, "timing",
        why=f"The last cue ends at {format_timestamp(transcript.duration)}.",
        stamp=format_timestamp(transcript.duration),
    )


def score_a5(manifest, transcript, boundary) -> dict:
    """History and exam in one block — no labs before the intern commits.

    Deterministic enough to do without a model: it is a search for lab
    and imaging language before the first PGY-1 turn.
    """
    pgy1 = _turns(transcript, boundary, "PGY1")
    if not pgy1:
        return verdict(None, "transcript", why="No PGY-1 turns found; check the role mapping.")
    cutoff = pgy1[0].start

    leaked = []
    for cue in transcript:
        if cue.start >= cutoff:
            break
        token = boundary.token_for(cue.speaker) if cue.speaker else None
        if token not in ("[PRESENTER]", "[SCRIBE]"):
            continue
        m = LAB_PATTERN.search(cue.text)
        if m:
            leaked.append(f"“{m.group(0)}” at {cue.stamp}")

    if leaked:
        return verdict(
            False, "transcript",
            why="Diagnostic data before the first pass: " + "; ".join(leaked[:3]) + ".",
            stamp=leaked and leaked[0].split(" at ")[-1].rstrip("."),
        )
    return verdict(
        True, "transcript",
        why=f"No lab, imaging or micro language before the first PGY-1 turn at {pgy1[0].stamp}.",
    )


def score_f4(manifest, transcript, boundary, results=None) -> dict:
    """Nothing ever got crossed off — the inverse of B6."""
    b6 = (results or {}).get("struck_reason")
    if not b6 or b6.get("final_verdict") is None:
        return verdict(None, "derived", why="Depends on B6, which has no verdict yet.")
    return verdict(
        not b6["final_verdict"], "derived",
        why="B6 " + ("was not met, so nothing was struck with a reason."
                     if not b6["final_verdict"] else "was met, so something was struck."),
    )


SCORERS = {
    "deidentified": score_a1,
    "eight_slides": score_a2,
    "board_posted": score_b9,
    "uninterrupted": score_b4,
    "faculty_early": score_f2,
    "ran_over": score_f3,
    "one_block": score_a5,
}

DEPENDENT = {"nothing_struck": score_f4}
