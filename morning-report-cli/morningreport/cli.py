"""morningreport — the command line half.

    morningreport score <transcript.vtt> <session-id>
    morningreport feedback <session-id>
    morningreport mark-sent <session-id>
    morningreport purge
    morningreport calibrate

The 7-day sweep of working/ runs on every invocation, whether or not
anyone asked for it.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import click

from . import calibration as calib
from . import feedback as fb
from . import manifest as mf
from . import model, rubric as rb, scoring, vtt
from .roles import NameBoundary
from .store import Store, StoreError


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _store(ctx) -> Store:
    try:
        s = Store.resolve(ctx.obj.get("data"))
    except StoreError as e:
        raise click.ClickException(str(e)) from e
    # the sweep runs on every invocation, asked for or not
    removed = s.purge()
    if removed and not ctx.obj.get("quiet"):
        click.echo(click.style(
            f"Swept {len(removed)} file(s) older than 7 days from working/.", fg="yellow"))
    return s


def _rubric(ctx):
    try:
        return rb.load(ctx.obj.get("rubric"))
    except FileNotFoundError as e:
        raise click.ClickException(str(e)) from e


def _manifest(store: Store, session_id: str, explicit=None) -> mf.Manifest:
    if explicit:
        return mf.load(explicit)
    for candidate in (
        store.working(f"{session_id}.manifest.json"),
        store.path("manifests", f"{session_id}.json"),
    ):
        if candidate.exists():
            return mf.load(candidate)
    raise click.ClickException(
        f"No manifest for {session_id}. Pass --manifest, or run "
        f"`morningreport manifest {session_id}` to write a template."
    )


def _mark(v):
    return {True: click.style("yes", fg="green"),
            False: click.style("no", fg="red"),
            None: click.style("?", fg="yellow")}[v]


@click.group()
@click.option("--data", envvar="MORNINGREPORT_DATA", help="The data folder the browser tools use.")
@click.option("--rubric", "rubric_path", type=click.Path(), help="Override content/rubric.json.")
@click.option("--quiet", is_flag=True, help="Only errors.")
@click.version_option(package_name="morningreport", prog_name="morningreport")
@click.pass_context
def cli(ctx, data, rubric_path, quiet):
    """Local tooling for the Morning Report module.

    Reads and writes the same data folder as the browser tools. Identified
    work lives in working/ and is deleted after seven days regardless.
    """
    ctx.ensure_object(dict)
    ctx.obj.update(data=data, rubric=rubric_path, quiet=quiet)


# ---------------------------------------------------------------- manifest

@cli.command()
@click.argument("session_id")
@click.option("--force", is_flag=True, help="Overwrite an existing manifest.")
@click.pass_context
def manifest(ctx, session_id, force):
    """Write a manifest template for a session, to fill in."""
    store = _store(ctx)
    path = store.path("manifests", f"{session_id}.json")
    if path.exists() and not force:
        raise click.ClickException(f"{path} already exists. Use --force to overwrite.")

    template = dict(mf.TEMPLATE)
    parts = session_id.split("-")
    if len(parts) >= 3:
        template["session_date"] = "-".join(parts[:3])
        if len(parts) > 3:
            template["site"] = " ".join(parts[3:]).title()

    board = store.read("board-archive", f"{session_id}.json")
    if board:
        template["objective"] = board.get("objective") or template["objective"]
        d = board.get("derived") or {}
        if d.get("board_archived"):
            template["board_exported"] = True
        click.echo(f"Prefilled the objective and board flag from board-archive/{session_id}.json.")

    store.write(template, "manifests", f"{session_id}.json")
    click.echo(f"Wrote {path}")
    click.echo("Fill in the roles, the slide count and the de-identification attestation, then run score.")


# ------------------------------------------------------------------- score

@cli.command()
@click.argument("transcript", type=click.Path(exists=True, dir_okay=False))
@click.argument("session_id")
@click.option("--manifest", "manifest_path", type=click.Path(exists=True, dir_okay=False))
@click.option("--only", help="Comma-separated item codes, e.g. B5,B8.")
@click.option("--show-api-payload", is_flag=True,
              help="Print exactly what would be sent, and send nothing.")
@click.option("--dry-run", is_flag=True, help="Deterministic items only; no model calls.")
@click.option("--model", "model_name", default=model.MODEL, show_default=True)
@click.pass_context
def score(ctx, transcript, session_id, manifest_path, only, show_api_payload, dry_run, model_name):
    """Score a transcript against the rubric.

    Deterministic items are decided locally. Model items get one call
    each, carrying only the phase window the item is scoped to, with
    names already swapped for role tokens.
    """
    store = _store(ctx)
    rubric = _rubric(ctx)
    man = _manifest(store, session_id, manifest_path)

    tx = vtt.parse_file(transcript)
    if not len(tx):
        raise click.ClickException(f"{transcript} produced no cues. Is it a Zoom .vtt?")

    boundary = NameBoundary(man.roles)

    unmapped = boundary.unmapped_speakers(tx.speakers)
    if unmapped:
        click.echo(click.style(
            "These speakers have no role in the manifest, so their names would NOT be "
            "substituted:\n  " + "\n  ".join(unmapped), fg="red"), err=True)
        if not (show_api_payload or dry_run):
            raise click.ClickException(
                "Refusing to make model calls with unmapped speakers. Add them to the "
                "manifest roles, or remove them from the transcript."
            )

    codes = [c.strip() for c in only.split(",")] if only else None

    # ---- the payload inspector -----------------------------------------
    if show_api_payload:
        items = [i for i in rubric.items
                 if i.model_scored and model.has_prompt(i.code)
                 and (not codes or i.code.upper() in {c.upper() for c in codes})]
        if not items:
            raise click.ClickException("No model-scored items match that selection.")
        leaked = False
        for item in items:
            payload = model.build_payload(item, tx, boundary, man)
            click.echo(click.style("=" * 72, dim=True))
            click.echo(click.style(f"{payload.code} — {item.text}", bold=True))
            click.echo(click.style("=" * 72, dim=True))
            click.echo(json.dumps(payload.as_dict(), indent=2, ensure_ascii=False))
            if payload.residual_names:
                leaked = True
                click.echo(click.style(
                    "NAMES SURVIVED SUBSTITUTION: " + ", ".join(payload.residual_names),
                    fg="red", bold=True), err=True)
            else:
                click.echo(click.style("no name survived substitution in this payload", fg="green"))
        click.echo()
        click.echo(f"{len(items)} payload(s) shown. Nothing was sent.")
        if leaked:
            raise click.ClickException("At least one payload still contains a name.")
        return

    # ---- score ------------------------------------------------------------
    client = model.Client(model=model_name)
    if not dry_run and not client.ready():
        click.echo(click.style(
            "No ANTHROPIC_API_KEY, so only the deterministic items will be scored. "
            "Set the key, or pass --dry-run to silence this.", fg="yellow"), err=True)

    board = store.read("board-archive", f"{session_id}.json")
    if board and not ctx.obj.get("quiet"):
        click.echo(f"Reading what the board already settled from board-archive/{session_id}.json.")

    def progress(item, result):
        if ctx.obj.get("quiet"):
            return
        conf = result.get("confidence")
        tail = f"  ({result.get('source')}"
        tail += f", confidence {conf:.2f})" if isinstance(conf, float) else ")"
        click.echo(f"  {item.code:3} {_mark(result.get('final_verdict'))}  {item.text[:52]}{tail}")

    session = scoring.score(rubric, tx, man, boundary, client=client, only=codes,
                            board=board, dry_run=dry_run, on_item=progress)

    working = scoring.to_working(session, man, rubric)
    working["scored"] = _now()
    working["transcript"] = str(Path(transcript).name)
    path = store.write(working, "working", f"{session_id}.json")

    click.echo()
    click.echo(f"Struck {session.struck()} of {rubric.of()}."
               + (click.style("  Automatic fail triggered.", fg="red") if session.failed() else ""))
    if session.needs_review():
        click.echo(click.style(
            "Needs a human: " + ", ".join(session.needs_review()), fg="yellow"))
    for note in session.notes:
        click.echo(click.style("  " + note, dim=True))
    click.echo(f"Working copy at {path} — identified, and deleted after seven days.")


# ---------------------------------------------------------------- feedback

@cli.command()
@click.argument("session_id")
@click.option("--dry-run", is_flag=True, help="Draft without calling the model.")
@click.option("--model", "model_name", default=model.MODEL, show_default=True)
@click.pass_context
def feedback(ctx, session_id, dry_run, model_name):
    """Draft one feedback email per participant, to disk.

    Drafts only. Nothing is sent, and there is no mail integration to
    send it with.
    """
    store = _store(ctx)
    rubric = _rubric(ctx)

    working = store.read("working", f"{session_id}.json")
    if not working:
        raise click.ClickException(
            f"No working record for {session_id}. Run score first — or it has been purged, "
            "which is what is meant to happen after seven days."
        )

    boundary = NameBoundary(working.get("roles") or {})
    client = model.Client(model=model_name)
    if not dry_run and not client.ready():
        click.echo(click.style("No ANTHROPIC_API_KEY — drafting placeholders instead.", fg="yellow"), err=True)
        dry_run = True

    drafts = fb.draft_all(working, rubric, client, boundary, dry_run=dry_run)
    if not drafts:
        raise click.ClickException("No roles in the manifest, so there is nobody to write to.")

    for d in drafts:
        path = store.write_text(d.render(), "working", "emails", d.filename())
        click.echo(f"  {d.role.lower():12} {path.name}"
                   + (click.style("   (nothing to raise)", dim=True) if not d.based_on["improvement"] else ""))
        for w in d.withheld:
            click.echo(click.style(f"      withheld: {w}", dim=True))

    click.echo()
    click.echo(f"{len(drafts)} draft(s) in {store.working('emails')}.")
    click.echo("Read them, change them, send them yourself. Then run mark-sent.")


# --------------------------------------------------------------- mark-sent

@cli.command("mark-sent")
@click.argument("session_id")
@click.option("--yes", is_flag=True, help="Do not ask.")
@click.pass_context
def mark_sent(ctx, session_id, yes):
    """Write the de-identified row and delete everything identified."""
    store = _store(ctx)
    rubric = _rubric(ctx)

    working = store.read("working", f"{session_id}.json")
    if not working:
        raise click.ClickException(f"No working record for {session_id}.")

    names = list((working.get("roles") or {}).keys())
    emails = [e for e in store.list("working", "emails") if e.startswith(tuple(
        r.lower() for r in ("presenter", "scribe", "pgy1", "senior", "faculty", "facilitator")))]

    if not yes:
        click.echo(f"This will write sessions/{session_id}.json with no names in it, then delete:")
        click.echo(f"  working/{session_id}.json")
        for e in emails:
            click.echo(f"  working/emails/{e}")
        if store.path("manifests", f"{session_id}.json").exists():
            click.echo(f"  manifests/{session_id}.json   (the name-to-role mapping)")
        click.confirm("Go ahead?", abort=True)

    deident = scoring.to_deidentified(working, rubric)
    deident["scored"] = working.get("scored") or _now()
    deident["marked_sent"] = _now()
    path = store.write(deident, "sessions", f"{session_id}.json")
    click.echo(f"Wrote {path}")

    store.remove("working", f"{session_id}.json")
    for e in emails:
        store.remove("working", "emails", e)
    # the manifest IS the name-to-role mapping, so it goes too
    store.remove("working", f"{session_id}.manifest.json")
    store.remove("manifests", f"{session_id}.json")

    # say plainly whether anything survived
    from .roles import ALSO_A_WORD

    leftovers = []
    for name in names:
        needles = [name] + [
            p for p in name.split()
            if len(p) >= 4 and p.lower() not in ALSO_A_WORD
        ]
        for needle in needles:
            leftovers += store.grep(needle)
    leftovers = sorted(set(leftovers))

    if leftovers:
        click.echo(click.style(
            "A name still appears in:\n  " + "\n  ".join(leftovers), fg="red"), err=True)
        raise click.ClickException(
            "The purge did not finish. Do not treat this session as de-identified."
        )
    click.echo(click.style(
        "Nothing outside roster.json contains any of those names.", fg="green"))


# ------------------------------------------------------------------- purge

@cli.command()
@click.option("--days", default=7, show_default=True, help="Delete working files older than this.")
@click.option("--all", "everything", is_flag=True, help="Delete all of working/, whatever its age.")
@click.option("--yes", is_flag=True, help="Do not ask.")
@click.pass_context
def purge(ctx, days, everything, yes):
    """Force the sweep of working/ early."""
    store = _store(ctx)
    if everything and not yes:
        click.confirm("Delete everything under working/, regardless of age?", abort=True)
    removed = store.purge(days=days, force=everything)
    if not removed:
        click.echo("Nothing to purge.")
        return
    for r in removed:
        click.echo(f"  removed {r}")
    click.echo(f"{len(removed)} file(s) removed.")


# --------------------------------------------------------------- calibrate

@cli.command()
@click.option("--json", "as_json", is_flag=True, help="Machine-readable.")
@click.pass_context
def calibrate(ctx, as_json):
    """Per-item agreement between the model and the human.

    Do not report aggregate findings to anyone until this has been run
    over at least ten sessions. The model is a second rater with unknown
    reliability until measured.
    """
    store = _store(ctx)
    rubric = _rubric(ctx)
    sessions = [data for _, data in store.read_all("sessions")]
    out = calib.compare(sessions, rubric)

    if as_json:
        click.echo(json.dumps({
            "sessions": out["sessions"], "ready": out["ready"],
            "overall": out["overall"], "demote": out["demote"],
            "items": [{"code": a.code, "compared": a.compared, "agreed": a.agreed,
                       "rate": a.rate, "verdict": a.verdict} for a in out["items"]],
        }, indent=2))
        return

    click.echo(f"{out['sessions']} scored session(s) in the store.")
    if not out["ready"]:
        click.echo(click.style(
            f"Calibration is not complete: {out['sessions']} of {out['min_sessions']} sessions. "
            "Do not report aggregate findings to anyone yet.", fg="yellow"))
    if out["overall"] is not None:
        click.echo(f"Overall agreement where both rated: {out['overall']:.0%}")
    click.echo()

    any_rows = False
    for a in out["items"]:
        if not a.compared:
            continue
        any_rows = True
        colour = "green" if a.verdict == "keep" else "yellow" if a.verdict == "too few" else "red"
        rate = f"{a.rate:.0%}" if a.rate is not None else "  —"
        click.echo(f"  {a.code:3} {rate:>5}  {a.agreed}/{a.compared:<3} "
                   + click.style(a.verdict, fg=colour) + f"  {a.text[:44]}")
    if not any_rows:
        click.echo("No item has both a model verdict and a human verdict yet.")
        return

    if out["demote"]:
        click.echo()
        click.echo(click.style(
            "Below " + f"{out['threshold']:.0%}" + " agreement, so not trustworthy: "
            + ", ".join(out["demote"])
            + ". Demote these to human-only in the next rubric version.", fg="red"))


def main():
    try:
        cli(obj={})
    except StoreError as e:
        click.echo(click.style(str(e), fg="red"), err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
