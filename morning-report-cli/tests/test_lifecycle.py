"""Identified is a working stage, never a storage state."""

import json
import os
import time
from pathlib import Path

import pytest
from click.testing import CliRunner

from morningreport import scoring
from morningreport.cli import cli
from morningreport.store import Store

FIXTURES = Path(__file__).parent / "fixtures"
NAMES = ["Will Barlow", "Nadia Haddad", "A Resident", "B Resident",
         "C Attending", "D Chief"]


@pytest.fixture
def folder(tmp_path):
    """A data folder with the manifest in place, ready to score into."""
    (tmp_path / "manifests").mkdir()
    (tmp_path / "manifests" / "2026-09-03-galveston.json").write_text(
        (FIXTURES / "manifest-clean.json").read_text(), encoding="utf-8")
    return tmp_path


def run(folder, *args):
    return CliRunner().invoke(cli, ["--data", str(folder), *args], obj={})


def test_score_writes_an_identified_working_copy(folder):
    r = run(folder, "score", str(FIXTURES / "clean.vtt"), "2026-09-03-galveston", "--dry-run")
    assert r.exit_code == 0, r.output
    working = folder / "working" / "2026-09-03-galveston.json"
    assert working.exists()
    data = json.loads(working.read_text())
    assert data["identified"] is True
    assert set(data["roles"]) == set(NAMES)
    assert "deleted" in data["_warning"].lower()


def test_mark_sent_leaves_no_name_anywhere(folder):
    """The phase 10 acceptance test, run rather than described."""
    run(folder, "score", str(FIXTURES / "clean.vtt"), "2026-09-03-galveston", "--dry-run")
    run(folder, "feedback", "2026-09-03-galveston", "--dry-run")

    store = Store(root=folder)
    assert store.grep("Will Barlow"), "the working stage should be identified"

    r = run(folder, "mark-sent", "2026-09-03-galveston", "--yes")
    assert r.exit_code == 0, r.output

    # the surviving row exists and is de-identified
    session = json.loads((folder / "sessions" / "2026-09-03-galveston.json").read_text())
    assert session["id"] == "2026-09-03-galveston"
    assert "roles" not in session
    assert session["items"]

    # grep the whole data directory, as the spec asks
    for name in NAMES:
        for needle in [name] + [p for p in name.split() if len(p) > 2]:
            hits = store.grep(needle)
            assert hits == [], (needle, hits)

    assert not (folder / "working" / "2026-09-03-galveston.json").exists()
    assert not list((folder / "working").glob("emails/*")) if (folder / "working").exists() else True


def test_the_deidentified_row_carries_no_quotes(folder, rubric):
    run(folder, "score", str(FIXTURES / "clean.vtt"), "2026-09-03-galveston", "--dry-run")
    working = json.loads((folder / "working" / "2026-09-03-galveston.json").read_text())
    working["items"]["problem_rep"]["quote"] = "three-year-old, two days of fever"
    working["items"]["problem_rep"]["why"] = "A Resident said it plainly"

    out = scoring.to_deidentified(working, rubric)
    blob = json.dumps(out)
    assert "quote" not in blob
    assert "three-year-old" not in blob
    assert "why" not in blob
    for r in out["items"].values():
        assert set(r) == {"final_verdict", "source", "confidence", "model_verdict", "agreement"}


def test_the_sweep_runs_on_every_invocation(folder):
    old = folder / "working" / "stale.json"
    old.parent.mkdir(parents=True, exist_ok=True)
    old.write_text("{}")
    os.utime(old, (0, 0))

    r = run(folder, "purge", "--days", "7")
    assert r.exit_code == 0
    assert not old.exists()


def test_the_sweep_runs_even_when_the_command_is_something_else(folder):
    old = folder / "working" / "stale.json"
    old.parent.mkdir(parents=True, exist_ok=True)
    old.write_text("{}")
    os.utime(old, (0, 0))

    r = run(folder, "calibrate")
    assert r.exit_code == 0
    assert not old.exists(), "the 7-day sweep should not need to be asked for"


def test_purge_all_clears_working_but_not_the_permanent_folders(folder):
    run(folder, "score", str(FIXTURES / "clean.vtt"), "2026-09-03-galveston", "--dry-run")
    Store(root=folder).write({"id": "x"}, "casebank", "x.json")
    Store(root=folder).write({"id": "y"}, "sessions", "y.json")

    r = run(folder, "purge", "--all", "--yes")
    assert r.exit_code == 0
    assert not (folder / "working" / "2026-09-03-galveston.json").exists()
    assert (folder / "casebank" / "x.json").exists()
    assert (folder / "sessions" / "y.json").exists()


def test_recent_working_files_survive_the_sweep(folder):
    run(folder, "score", str(FIXTURES / "clean.vtt"), "2026-09-03-galveston", "--dry-run")
    r = run(folder, "purge")
    assert r.exit_code == 0
    assert (folder / "working" / "2026-09-03-galveston.json").exists()


def test_feedback_after_a_purge_says_what_happened(folder):
    run(folder, "score", str(FIXTURES / "clean.vtt"), "2026-09-03-galveston", "--dry-run")
    run(folder, "purge", "--all", "--yes")
    r = run(folder, "feedback", "2026-09-03-galveston", "--dry-run")
    assert r.exit_code != 0
    assert "purged" in r.output or "No working record" in r.output


def test_a_session_id_cannot_escape_the_data_folder(folder):
    store = Store(root=folder)
    with pytest.raises(Exception):
        store.write({"x": 1}, "..", "..", "escaped.json")
