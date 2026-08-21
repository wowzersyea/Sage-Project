"""The items decided without a model, against the fixture set."""

import pytest

from morningreport import deterministic as det
from morningreport import manifest as mf
from morningreport import scoring
from morningreport.roles import NameBoundary


def run(rubric, tx, man, codes=None):
    boundary = NameBoundary(man.roles)
    s = scoring.score(rubric, tx, man, boundary, client=None, dry_run=True, only=codes)
    return {**s.items, **s.fails}


# ---- the clean session -------------------------------------------------

def test_clean_session_passes_every_deterministic_item(rubric, load_tx, man):
    r = run(rubric, load_tx("clean.vtt"), man)
    assert r["eight_slides"]["final_verdict"] is True
    assert r["board_posted"]["final_verdict"] is True
    assert r["deidentified"]["final_verdict"] is True
    assert r["one_block"]["final_verdict"] is True
    assert r["uninterrupted"]["final_verdict"] is True


def test_clean_session_trips_no_automatic_fail(rubric, load_tx, man):
    r = run(rubric, load_tx("clean.vtt"), man)
    assert r["ran_over"]["final_verdict"] is False
    assert r["faculty_early"]["final_verdict"] is False


def test_deterministic_items_are_never_sourced_to_a_model(rubric, load_tx, man):
    r = run(rubric, load_tx("clean.vtt"), man)
    for item_id in ("eight_slides", "board_posted", "deidentified", "uninterrupted",
                    "ran_over", "faculty_early", "one_block"):
        assert r[item_id]["source"] in ("manifest", "timing", "transcript")
        assert r[item_id]["model_verdict"] is None


# ---- one fixture per automatic fail ---------------------------------------

def test_fail_overran(rubric, load_tx, man):
    r = run(rubric, load_tx("fail-overran.vtt"), man)
    assert r["ran_over"]["final_verdict"] is True
    assert "25:45" in r["ran_over"]["why"] or "25:" in r["ran_over"]["why"]


def test_fail_faculty_early(rubric, load_tx, man):
    r = run(rubric, load_tx("fail-faculty-early.vtt"), man)
    assert r["faculty_early"]["final_verdict"] is True
    assert r["faculty_early"]["timestamp"] == "06:00"


def test_faculty_after_0019_is_not_a_fail(rubric, load_tx, man):
    r = run(rubric, load_tx("clean.vtt"), man)
    assert r["faculty_early"]["final_verdict"] is False


def test_fail_nothing_struck_is_derived_from_b6(rubric, load_tx, man):
    """F4 is the inverse of B6 and needs B6 to have been decided."""
    from morningreport.deterministic import score_f4
    results = {"struck_reason": {"final_verdict": False}}
    out = score_f4(man, load_tx("fail-nothing-struck.vtt"), None, results)
    assert out["final_verdict"] is True
    assert out["source"] == "derived"

    results = {"struck_reason": {"final_verdict": True}}
    assert score_f4(man, None, None, results)["final_verdict"] is False

    results = {"struck_reason": {"final_verdict": None}}
    assert score_f4(man, None, None, results)["final_verdict"] is None


# ---- the messy ones ----------------------------------------------------------

def test_labs_before_the_first_pass_fails_a5(rubric, load_tx, man):
    r = run(rubric, load_tx("messy-demographics-first.vtt"), man)
    assert r["one_block"]["final_verdict"] is False
    assert "CRP" in r["one_block"]["why"] or "ultrasound" in r["one_block"]["why"].lower()


def test_an_interruption_during_the_first_pass_fails_b4(rubric, load_tx, man):
    r = run(rubric, load_tx("messy-weak-first-pass.vtt"), man)
    assert r["uninterrupted"]["final_verdict"] is False
    assert "senior" in r["uninterrupted"]["why"]


def test_the_facilitator_calling_the_clock_is_not_an_interruption(rubric, load_tx, man, boundary):
    from morningreport import vtt as v
    tx = v.parse("""WEBVTT

1
00:07:10.000 --> 00:07:30.000
A Resident: Three-year-old with two days of fever and refusal to bear weight.

2
00:08:00.000 --> 00:08:06.000
D Chief: We are at 0:08, keep going, you have three minutes left on this.

3
00:09:00.000 --> 00:09:20.000
A Resident: Septic arthritis is my leader because of the positioning.
""")
    assert det.score_b4(man, tx, boundary)["final_verdict"] is True


# ---- manifest facts ------------------------------------------------------------

def test_too_many_slides(rubric, load_tx, man):
    man.slide_count = 12
    r = run(rubric, load_tx("clean.vtt"), man)
    assert r["eight_slides"]["final_verdict"] is False
    assert "12" in r["eight_slides"]["why"]


def test_missing_manifest_facts_are_unknown_not_false(rubric, load_tx, man):
    man.slide_count = None
    man.board_exported = None
    man.deidentified_confirmed = None
    r = run(rubric, load_tx("clean.vtt"), man)
    for item_id in ("eight_slides", "board_posted", "deidentified"):
        assert r[item_id]["final_verdict"] is None, item_id
    # and they are surfaced for a human rather than quietly passed
    boundary = NameBoundary(man.roles)
    s = scoring.score(rubric, load_tx("clean.vtt"), man, boundary, dry_run=True)
    assert "eight_slides" in s.needs_review()


def test_attestation_is_overridden_by_what_is_in_the_transcript(rubric, man):
    from morningreport import vtt as v
    tx = v.parse("""WEBVTT

1
00:00:10.000 --> 00:00:20.000
Mark Murphy: This is the patient with MRN 4417723 seen on 09/03/2026.
""")
    boundary = NameBoundary(man.roles)
    out = det.score_a1(man, tx, boundary)
    assert man.deidentified_confirmed is True
    assert out["final_verdict"] is False
    assert "MRN" in out["why"]


def test_human_only_item_is_never_scored(rubric, load_tx, man):
    r = run(rubric, load_tx("clean.vtt"), man)
    assert r["let_silence"]["final_verdict"] is None
    assert r["let_silence"]["source"] == "human"


def test_unknown_role_in_manifest_is_rejected():
    with pytest.raises(mf.ManifestError):
        mf.from_dict({"session_date": "2026-09-03", "roles": {"X": "CHIEF"}})


def test_session_id_matches_the_browser_half(man):
    assert man.session_id == "2026-09-03-galveston"


def test_block_is_derived_from_the_date():
    for date, block in [("2026-08-15", "jul-sep"), ("2026-11-15", "oct-dec"),
                        ("2027-02-15", "jan-mar"), ("2027-05-15", "apr-jun")]:
        m = mf.from_dict({"session_date": date, "roles": {}})
        assert m.block_id() == block
