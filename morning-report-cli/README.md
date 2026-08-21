# morningreport — the local half

The browser half of the Morning Report module lives in `../morning-report/` and runs
from the website. This is the other half: a Python CLI that runs from a terminal on
one machine and handles the two things a static page cannot — model API calls with a
secret key, and identified data.

It reads and writes the **same data folder** the browser tools are pointed at.

```
MorningReport/
  roster.json          names and the participation log   (browser half only)
  casebank/            de-identified, permanent
  sessions/            de-identified, permanent          <- this tool writes here
  board-archive/       de-identified, permanent
  manifests/           the name-to-role mapping          <- identified
  working/             identified, ephemeral, 7-day sweep <- identified
```

## Install

```bash
cd morning-report-cli
pip install -e .            # add [model] for the Anthropic SDK, [dev] for pytest
export MORNINGREPORT_DATA=~/OneDrive/MorningReport
export ANTHROPIC_API_KEY=...    # only needed for model-scored items
```

## The two stages, and why they are different

**Identified is a working stage, never a storage state.** Scoring and feedback happen
with real names attached, because the facilitator has to know who to send what to. That
stage lives in `working/` and `manifests/`, and it is on a clock from the moment it is
written. `mark-sent` deletes it; the 7-day sweep deletes it anyway, on every invocation,
whether or not anyone asked. Retention, not identification, is the actual risk.

**The model API never sees a name, even while the local file is identified.** Every
string that leaves the machine goes through the boundary in `roles.py` first, which
swaps names for role tokens — full names, name parts, possessives, and case variants —
and then re-checks the result. A payload that still contains a known name is refused
rather than sent. `--show-api-payload` prints exactly what would go, and sends nothing.

If a speaker in the transcript has no role in the manifest, their name would not be
substituted because nothing knows to substitute it. The tool refuses to make model calls
in that state rather than guessing.

## Commands

```bash
morningreport manifest 2026-09-03-galveston      # write a template to fill in
morningreport score transcript.vtt 2026-09-03-galveston
morningreport feedback 2026-09-03-galveston      # drafts to disk; nothing is sent
morningreport mark-sent 2026-09-03-galveston     # de-identify, then delete
morningreport purge                              # force the sweep early
morningreport calibrate                          # per-item agreement
```

Useful flags on `score`:

| Flag | What it does |
|---|---|
| `--show-api-payload` | Print the exact outbound payload for each item and send nothing |
| `--dry-run` | Deterministic items only, no model calls, no key needed |
| `--only B5,B8` | Restrict to given rubric codes |
| `--manifest PATH` | Use a manifest from somewhere other than `manifests/` |

## How an item gets its verdict

The rubric is `../morning-report/content/rubric.json` — the same file the web scorecard
reads, so the printed card, the web form and this tool cannot drift. Each item declares
where a verdict may legitimately come from:

| `scored_from` | Decided by | Example |
|---|---|---|
| `manifest` | Facilitator attestation | A2 eight slides, B9 board exported |
| `timing` | Clock arithmetic on the cues | B4 uninterrupted, F2 faculty early, F3 overran |
| `transcript` | One model call, one item | B5 framework first, B8 confidence and trigger |
| `derived` | Another item's verdict | F4 nothing struck, the inverse of B6 |
| `human` | Nobody else | A6 stopped talking and let the silence run |

Precedence when two sources have an opinion: **human > manifest and board > timing and
transcript > model.** A board archive written by the browser half is deterministic, so
it settles an item outright and no model call is made for it.

One call per item, never one for all sixteen — cleaner reasoning, and each prompt can be
tuned on its own. Prompts are editable files in `morningreport/prompts/<CODE>.md`, not
Python string literals. Each call receives only the phase window the item is scoped to.

## Feedback drafting

Coaching voice, not scoring voice. Three short paragraphs under 200 words: what worked,
the one thing, why it matters. One improvement, not five. Every suggestion maps to
something the person's own role card already asked of them, so nothing arrives as a new
expectation.

Two rules are enforced rather than hoped for:

* **The PGY-1 note is block-aware.** An intern is never coached on a demand their block
  has not introduced. In Jul–Sep that is the four deliverables and nothing else; the
  framework, the discriminator, explicit pruning and the trigger arrive on the ladder in
  `content/roles.json`. Anything held back is recorded in the draft's audit comment.
* **A low-confidence model verdict never reaches an email** unconfirmed, and neither does
  an item with no verdict at all.

Drafts are written to `working/emails/<role>-<name>.md` for a human to read, edit and
send from their own mail client. There is no mail integration, and there is not meant to
be one.

## Before any of this is trusted

```bash
morningreport calibrate
```

For the first ten real sessions the tool scores blind and a human scores independently,
and this reports per-item agreement. **Do not report aggregate findings to anyone until
per-item agreement is known.** Any item under roughly 80% agreement gets demoted to
human-only in the next rubric version.

Treat the model's judgment as a second rater with unknown reliability, because that is
what it is.

## Tests

```bash
pip install -e ".[dev]" && pytest
```

The fixture set is in `tests/fixtures/`: one transcript that should score full marks, one
that trips each of the four automatic fails, and four realistically messy ones — two
objectives read out, demographics before the hook with labs leaking early, a weak
first pass that gets interrupted, and a second pass with no framework and no trigger.

The suite also asserts the things that are easy to let rot:

* no participant name survives into any outbound payload, for every model-scored item;
* the client refuses a payload that still contains one;
* after `mark-sent`, grepping the whole data directory finds no name outside `roster.json`;
* the phase timings here match `content/roles.json`;
* the identifier rules here match `assets/phi.js` in the browser half.

## Non-goals

No audio or video processing — input is Zoom's `.vtt`. No mail sending. No live scoring
during the session. No per-resident performance history: individual feedback is
per-session and ephemeral, and there is deliberately no way to ask this tool how a named
person has been doing.
