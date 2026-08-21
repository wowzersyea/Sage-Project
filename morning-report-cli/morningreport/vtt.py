"""WebVTT parsing for Zoom morning-report transcripts.

Zoom writes cues as:

    1
    00:00:04.120 --> 00:00:09.880
    Mark Murphy: All right, we've got four roles today...

The speaker name is part of the payload, not metadata, so it has to be
split out here — and once it is, it never travels any further than the
role mapping. Everything downstream works in role tokens.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Iterator


TIMING = re.compile(
    r"^(?P<start>\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(?P<end>\d{1,2}:\d{2}:\d{2}[.,]\d{3})"
)
SPEAKER = re.compile(r"^(?P<name>[^:]{1,60}?)\s*:\s*(?P<text>.*)$", re.DOTALL)


def parse_timestamp(ts: str) -> float:
    """'00:07:12.480' -> 432.48 seconds."""
    ts = ts.strip().replace(",", ".")
    parts = ts.split(":")
    if len(parts) == 2:                     # mm:ss.mmm
        h, m, s = 0, parts[0], parts[1]
    elif len(parts) == 3:
        h, m, s = parts
    else:
        raise ValueError(f"unparseable timestamp: {ts!r}")
    return int(h) * 3600 + int(m) * 60 + float(s)


def format_timestamp(seconds: float) -> str:
    """432.48 -> '07:12'. What a feedback email quotes."""
    seconds = max(0, int(seconds))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


@dataclass
class Cue:
    index: int
    start: float
    end: float
    speaker: str | None
    text: str

    @property
    def stamp(self) -> str:
        return format_timestamp(self.start)

    @property
    def words(self) -> int:
        return len(self.text.split())


@dataclass
class Transcript:
    cues: list[Cue] = field(default_factory=list)

    def __iter__(self) -> Iterator[Cue]:
        return iter(self.cues)

    def __len__(self) -> int:
        return len(self.cues)

    @property
    def duration(self) -> float:
        """Last cue end, in seconds. 0 for an empty transcript."""
        return max((c.end for c in self.cues), default=0.0)

    @property
    def speakers(self) -> list[str]:
        seen: dict[str, None] = {}
        for c in self.cues:
            if c.speaker:
                seen.setdefault(c.speaker, None)
        return list(seen)

    def between(self, start: float, end: float) -> "Transcript":
        """Cues that overlap the window — the phase slice an item is scoped to."""
        return Transcript([c for c in self.cues if c.end > start and c.start < end])

    def by_speaker(self, name: str) -> "Transcript":
        return Transcript([c for c in self.cues if c.speaker == name])

    def text(self) -> str:
        return "\n".join(
            f"[{c.stamp}] {c.speaker or 'UNKNOWN'}: {c.text}" for c in self.cues
        )


def parse(source: str | Iterable[str]) -> Transcript:
    """Parse WebVTT text into cues. Tolerant: Zoom's output is not always tidy."""
    if isinstance(source, str):
        lines = source.splitlines()
    else:
        lines = list(source)

    cues: list[Cue] = []
    i = 0
    n = len(lines)
    index = 0

    while i < n:
        line = lines[i].strip()
        if not line or line.upper().startswith("WEBVTT") or line.startswith("NOTE"):
            i += 1
            continue

        m = TIMING.match(line)
        if not m:
            # a cue identifier, or junk; either way the timing is next
            i += 1
            continue

        start = parse_timestamp(m.group("start"))
        end = parse_timestamp(m.group("end"))
        i += 1

        payload: list[str] = []
        while i < n and lines[i].strip() and not TIMING.match(lines[i].strip()):
            payload.append(lines[i].strip())
            i += 1

        body = " ".join(payload).strip()
        if not body:
            continue

        speaker = None
        sm = SPEAKER.match(body)
        if sm:
            candidate = sm.group("name").strip()
            # "38.6" or "Next" are not speakers; a speaker label is short and wordy
            if candidate and len(candidate.split()) <= 5 and not candidate.replace(".", "").isdigit():
                speaker = candidate
                body = sm.group("text").strip()

        index += 1
        cues.append(Cue(index=index, start=start, end=end, speaker=speaker, text=body))

    return Transcript(cues)


def parse_file(path) -> Transcript:
    from pathlib import Path

    return parse(Path(path).read_text(encoding="utf-8-sig"))
