"""Model calls — one per rubric item, never one for all sixteen.

Per-item calls give cleaner reasoning and let each prompt be tuned on
its own. Each call receives only the phase window the item is scoped to,
with names already swapped for role tokens by the boundary.

Nothing here decides anything on its own. Every verdict comes back as a
draft with a confidence, and a low-confidence verdict is flagged for
review and kept out of feedback emails until a human confirms it. The
model is a second rater with unknown reliability, which is what §11's
calibration mode exists to measure.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

MODEL = "claude-sonnet-5"
MAX_TOKENS = 1024
LOW_CONFIDENCE = 0.7

# The phase each item is scoped to, in seconds. Passing the whole
# transcript for every item wastes tokens and invites the model to find
# its evidence in the wrong part of the session.
WINDOWS = {
    "A3": (0, 120),
    "A4": (0, 240),
    "A7": (21 * 60, 25 * 60 + 120),
    "B1": (6 * 60, 12 * 60),
    "B2": (6 * 60, 12 * 60),
    "B3": (6 * 60, 12 * 60),
    "B5": (10 * 60, 17 * 60),
    "B6": (10 * 60, 20 * 60),
    "B7": (10 * 60, 20 * 60),
    "B8": (10 * 60, 22 * 60),
    "F1": (0, 22 * 60),
}

SYSTEM = (
    "You are a second rater for a pediatric morning report teaching rubric. "
    "You are shown one excerpt of a de-identified transcript and asked about exactly one rubric item.\n\n"
    "Speakers appear as role tokens: [PRESENTER], [SCRIBE], [PGY1], [SENIOR], [FACULTY], "
    "[FACILITATOR], [OTHER]. Lines are prefixed with [mm:ss].\n\n"
    "Rules:\n"
    "- Judge only the item you are asked about. Ignore everything else that went well or badly.\n"
    "- Judge only from what is in the excerpt. Do not assume something happened off-transcript.\n"
    "- A transcript is lossy: tone, the board and the slides are invisible to you. When the excerpt "
    "genuinely does not settle it, say so with a low confidence rather than guessing.\n"
    "- Quote the words that decided it, with their timestamp. One short quote, not a paragraph.\n"
    "- Never name or infer a person. The tokens are all you have and all you need.\n\n"
    "Reply with a single JSON object and nothing else:\n"
    '{"verdict": true|false|null, "confidence": 0.0-1.0, '
    '"quote": "the words that decided it", "timestamp": "mm:ss", '
    '"reasoning": "one or two sentences"}\n\n'
    "verdict null means the excerpt does not settle it."
)


class ModelError(RuntimeError):
    pass


@dataclass
class Payload:
    """Exactly what would be sent. Printed by --show-api-payload.

    `residual_names` covers the session-derived part — the transcript
    excerpt and the objective. The static prompt is authored in this
    repository and carries no participant data.
    """
    code: str
    model: str
    system: str
    user: str
    window: tuple[int, int] | None = None
    residual_names: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "item": self.code,
            "model": self.model,
            "window_seconds": list(self.window) if self.window else None,
            "system": self.system,
            "messages": [{"role": "user", "content": self.user}],
        }


def prompt_path(code: str) -> Path:
    return Path(__file__).parent / "prompts" / f"{code.upper()}.md"


def load_prompt(code: str) -> str:
    p = prompt_path(code)
    if not p.exists():
        raise ModelError(f"no prompt file for {code} (expected {p})")
    return p.read_text(encoding="utf-8")


def has_prompt(code: str) -> bool:
    return prompt_path(code).exists()


def build_payload(item, transcript, boundary, manifest=None) -> Payload:
    """Assemble one item's call. Substitution happens here, once, for everything."""
    from .roles import redact_transcript

    window = WINDOWS.get(item.code.upper())
    slice_ = transcript.between(*window) if window else transcript

    excerpt = redact_transcript(slice_, boundary)
    if not excerpt.strip():
        excerpt = "(no transcript in this window)"

    instructions = load_prompt(item.code)

    context = []
    if manifest is not None and manifest.objective:
        context.append("Stated objective for the session: " + boundary.substitute(manifest.objective))
    if window:
        context.append(
            f"Excerpt covers {window[0] // 60}:{window[0] % 60:02d} to {window[1] // 60}:{window[1] % 60:02d}."
        )

    user = (
        instructions.strip()
        + "\n\n---\n"
        + ("\n".join(context) + "\n\n" if context else "")
        + "TRANSCRIPT EXCERPT\n"
        + excerpt
        + "\n---\n\nReply with the JSON object only."
    )

    # Check what came from the session, not the static prompt: the
    # instructions are authored here and contain no participant data,
    # but they do contain words like "chief complaint" that collide
    # with placeholder names.
    residual = boundary.residual_names(excerpt + "\n" + "\n".join(context))

    return Payload(
        code=item.code,
        model=MODEL,
        system=SYSTEM,
        user=user,
        window=window,
        residual_names=residual,
    )


def parse_reply(text: str) -> dict:
    """Pull the JSON verdict out of a reply, tolerantly."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ModelError(f"no JSON in the reply: {text[:200]!r}") from None
        data = json.loads(m.group(0))

    verdict = data.get("verdict")
    if verdict not in (True, False, None):
        if isinstance(verdict, str) and verdict.lower() in ("true", "false"):
            verdict = verdict.lower() == "true"
        else:
            verdict = None

    try:
        confidence = float(data.get("confidence"))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = min(1.0, max(0.0, confidence))

    return {
        "verdict": verdict,
        "confidence": confidence,
        "quote": str(data.get("quote") or "").strip(),
        "timestamp": str(data.get("timestamp") or "").strip(),
        "reasoning": str(data.get("reasoning") or "").strip(),
    }


class Client:
    """Thin wrapper over the Anthropic SDK, with the boundary enforced."""

    def __init__(self, api_key: str | None = None, model: str = MODEL):
        self.model = model
        self._key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._client = None

    def ready(self) -> bool:
        return bool(self._key)

    def _sdk(self):
        if self._client is not None:
            return self._client
        if not self._key:
            raise ModelError(
                "No ANTHROPIC_API_KEY. Set it, or use --dry-run / --show-api-payload, "
                "which need no key."
            )
        try:
            import anthropic
        except ImportError as e:
            raise ModelError("the anthropic package is not installed: pip install anthropic") from e
        self._client = anthropic.Anthropic(api_key=self._key)
        return self._client

    def send(self, payload: Payload) -> dict:
        # Last line of defence. A payload carrying a name never leaves.
        if payload.residual_names:
            raise ModelError(
                "refusing to send: these names survived substitution — "
                + ", ".join(payload.residual_names)
                + ". This is a bug in the name boundary; report it rather than working around it."
            )
        client = self._sdk()
        resp = client.messages.create(
            model=self.model,
            max_tokens=MAX_TOKENS,
            system=payload.system,
            messages=[{"role": "user", "content": payload.user}],
        )
        text = "".join(getattr(b, "text", "") for b in resp.content)
        return parse_reply(text)
