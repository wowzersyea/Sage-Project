"""Precedence, model handling, and agreement with the browser half."""

import json
from pathlib import Path

import pytest

from morningreport import model, scoring
from morningreport.roles import NameBoundary


class FakeClient:
    """Answers without a network.

    `verdict` applies to the sixteen scored items. Automatic fails are
    answered False by default, since "the model says every fail
    happened" is not a useful baseline — pass fails=True for that.
    """

    def __init__(self, verdict=True, confidence=0.9, fail_on=(), fails=False):
        self.model = "fake"
        self.calls = []
        self.verdict = verdict
        self.confidence = confidence
        self.fail_on = set(fail_on)
        self.fails = fails

    def ready(self):
        return True

    def send(self, payload):
        self.calls.append(payload)
        if payload.code in self.fail_on:
            raise model.ModelError("the model was unreachable")
        verdict = self.fails if payload.code.startswith("F") else self.verdict
        return {"verdict": verdict, "confidence": self.confidence,
                "quote": "some words", "timestamp": "11:20", "reasoning": "because"}


def test_one_call_per_item_not_one_for_all(rubric, load_tx, man, boundary):
    client = FakeClient()
    scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client)
    codes = [p.code for p in client.calls]
    assert len(codes) == len(set(codes)), "each item gets its own call"
    assert len(codes) >= 10
    assert "A6" not in codes, "the human-only item is never sent"
    assert "A2" not in codes, "manifest facts are never sent"
    assert "F3" not in codes, "clock arithmetic is never sent"


def test_each_call_carries_only_its_phase_window(rubric, load_tx, man, boundary):
    client = FakeClient()
    scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client)
    by_code = {p.code: p for p in client.calls}
    b1 = by_code["B1"]
    assert b1.window == model.WINDOWS["B1"]
    # the reveal at 22:05 is outside the first-pass window
    assert "septic arthritis of the hip. What we came to late" not in b1.user


def test_a_model_failure_is_noted_not_swallowed(rubric, load_tx, man, boundary):
    client = FakeClient(fail_on={"B5"})
    session = scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client)
    assert session.items["framework_first"]["final_verdict"] is None
    assert any("B5" in n for n in session.notes)
    assert "framework_first" in session.needs_review()


def test_the_board_beats_the_model(rubric, load_tx, man, boundary):
    """A board fact is deterministic; a model verdict is a guess."""
    board = {"derived": {"framework_before_list": False, "pr_present": True,
                         "board_archived": True, "any_struck": True}}
    client = FakeClient(verdict=True)
    session = scoring.score(rubric, load_tx("clean.vtt"), man, boundary,
                            client=client, board=board)
    fw = session.items["framework_first"]
    assert fw["final_verdict"] is False
    assert fw["source"] == "board"
    assert "B5" not in [p.code for p in client.calls], "no call for what the board settled"


def test_disagreement_is_recorded_for_calibration(rubric, load_tx, man, boundary):
    board = {"derived": {"framework_before_list": False}}
    client = FakeClient(verdict=True)
    session = scoring.score(rubric, load_tx("clean.vtt"), man, boundary,
                            client=client, board=board)
    # the board settled it, so no model call was made and there is nothing to compare
    assert session.items["framework_first"]["model_verdict"] is None

    session2 = scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client)
    fw = session2.items["framework_first"]
    assert fw["model_verdict"] is True
    assert fw["agreement"] is True


def test_low_confidence_is_flagged_for_review(rubric, load_tx, man, boundary):
    client = FakeClient(confidence=0.4)
    session = scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client)
    assert "framework_first" in session.needs_review()


def test_only_restricts_the_items_scored(rubric, load_tx, man, boundary):
    client = FakeClient()
    scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client, only=["B5", "B8"])
    assert sorted(p.code for p in client.calls) == ["B5", "B8"]


def test_dry_run_makes_no_calls(rubric, load_tx, man, boundary):
    client = FakeClient()
    session = scoring.score(rubric, load_tx("clean.vtt"), man, boundary,
                            client=client, dry_run=True)
    assert client.calls == []
    assert session.items["eight_slides"]["final_verdict"] is True   # still deterministic


def test_struck_and_failed_counts(rubric, load_tx, man, boundary):
    client = FakeClient(verdict=True, fails=False)
    session = scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client)
    assert session.struck() >= 14
    assert session.failed() is False


def test_a_fail_item_answered_true_means_the_session_failed(rubric, load_tx, man, boundary):
    """F-items read as "did this happen", so True is the bad direction."""
    client = FakeClient(verdict=True, fails=True)
    session = scoring.score(rubric, load_tx("clean.vtt"), man, boundary, client=client)
    assert session.fails["early_diagnosis"]["final_verdict"] is True
    assert session.failed() is True


def test_an_automatic_fail_flips_failed(rubric, load_tx, man, boundary):
    session = scoring.score(rubric, load_tx("fail-overran.vtt"), man, boundary, dry_run=True)
    assert session.fails["ran_over"]["final_verdict"] is True
    assert session.failed() is True


# ---- the two halves must agree ------------------------------------------

def _js_rubric():
    p = Path(__file__).resolve().parents[2] / "morning-report" / "content" / "rubric.json"
    return json.loads(p.read_text(encoding="utf-8"))


def test_the_cli_reads_the_same_rubric_as_the_browser(rubric):
    data = _js_rubric()
    ids = [i["id"] for c in data["columns"] for i in c["items"]] + \
          [f["id"] for f in data["automatic_fails"]]
    assert sorted(i.id for i in rubric.items) == sorted(ids)
    assert len(rubric.scored_items) == 16
    assert len(rubric.fails) == 4


def test_the_run_of_show_matches_roles_json():
    """Phase timings in deterministic.py must not drift from the content file."""
    from morningreport import deterministic as det
    p = Path(__file__).resolve().parents[2] / "morning-report" / "content" / "roles.json"
    roles = json.loads(p.read_text(encoding="utf-8"))
    by_segment = {r["segment"]: r for r in roles["run_of_show"]}
    assert by_segment["First pass"]["start"] * 60 == det.FIRST_PASS_START
    assert by_segment["Second pass"]["start"] * 60 == det.FIRST_PASS_END
    assert by_segment["Labs & imaging"]["start"] * 60 == det.SECOND_PASS_END
    assert by_segment["Converge"]["start"] * 60 == det.FACULTY_ENTERS
    assert roles["format"]["minutes"] * 60 == det.SESSION_LENGTH


def test_the_phi_rules_match_the_browser_half():
    """phi.py and phi.js must catch and spare the same things."""
    from morningreport import phi
    js = (Path(__file__).resolve().parents[2] / "morning-report" / "assets" / "phi.js").read_text()
    for kind in ("MRN", "long number", "phone number", "SSN", "date of service",
                 "age over 89", "address", "named person", "named relative"):
        assert f'"{kind}"' in js or f"'{kind}'" in js, kind
        assert any(k == kind for k, _, _, _ in phi.RULES), kind
    for eponym in ("kawasaki", "kocher", "epstein", "murphy"):
        assert eponym in js and eponym in phi.EPONYMS
