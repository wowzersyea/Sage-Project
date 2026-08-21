"""Coaching voice, one improvement, and the block ladder."""

import pytest

from morningreport import feedback as fb
from morningreport.roles import NameBoundary


def result(v, **kw):
    base = {"final_verdict": v, "source": "model", "confidence": 0.9,
            "quote": "", "timestamp": "07:12", "why": ""}
    base.update(kw)
    return base


def test_one_improvement_not_five(rubric):
    results = {
        "problem_rep": result(True, quote="Three-year-old, two days of fever"),
        "three_to_four": result(False, why="Five offered, two were categories."),
        "cant_miss": result(False, why="Not named as such."),
    }
    strength, improvement, _ = fb.choose("PGY1", results, rubric, "jul-sep")
    assert strength[0].code == "B1"
    assert improvement[0].code == "B2"     # the first failure, not all of them


def test_a_low_confidence_verdict_never_reaches_an_email(rubric):
    results = {"three_to_four": result(False, confidence=0.35, why="unclear")}
    strength, improvement, withheld = fb.choose("PGY1", results, rubric, "jul-sep")
    assert improvement is None
    assert any("unconfirmed" in w and "0.35" in w for w in withheld), withheld


def test_a_confirmed_human_verdict_is_used_whatever_its_confidence(rubric):
    results = {"three_to_four": result(False, source="human", confidence=None)}
    _, improvement, _ = fb.choose("PGY1", results, rubric, "jul-sep")
    assert improvement[0].code == "B2"


@pytest.mark.parametrize("block,coachable,withheld", [
    ("jul-sep", set(), {"B5", "B6", "B7", "B8"}),
    ("oct-dec", {"B7"}, {"B5", "B6", "B8"}),
    ("jan-mar", {"B5", "B7"}, {"B6", "B8"}),
    ("apr-jun", {"B5", "B6", "B7", "B8"}, set()),
])
def test_the_intern_is_never_coached_ahead_of_their_block(rubric, block, coachable, withheld):
    results = {
        "problem_rep": result(True),
        "three_to_four": result(True),
        "cant_miss": result(True),
        "discriminator": result(False, why="A panel was ordered."),
        "framework_first": result(False, why="No scheme named."),
        "struck_reason": result(False, why="Ruled out silently."),
        "confidence": result(False, why="No trigger."),
    }
    _, improvement, w = fb.choose("PGY1", results, rubric, block)
    held = {x.split()[0] for x in w if "not introduced" in x}
    assert held == withheld, (block, held)
    if coachable:
        assert improvement[0].code in coachable
    else:
        assert improvement is None


def test_a_senior_is_held_to_the_senior_card(rubric):
    results = {
        "framework_first": result(False, why="No scheme named."),
        "problem_rep": result(False, why="not theirs"),
    }
    _, improvement, _ = fb.choose("SENIOR", results, rubric, "jul-sep")
    assert improvement[0].code == "B5"      # never B1, which is the intern's


def test_the_prompt_carries_no_name_and_nothing_gradelike(rubric):
    """The drafter is told the standard and what happened, never a tally."""
    item = rubric.by_code("B2")
    r = result(False, why="Five offered, two of them categories.")
    payload = fb.build_payload("PGY1", None, (item, r), "jan-mar", "an objective")
    user = payload["user"]

    # no tally, no rubric identity, no grade
    for banned in ("scored", "score of", "out of 16", "struck", "16", "B2", "rubric"):
        assert banned not in user, banned
    # and no participant name
    for word in ("Will", "Barlow", "Nadia", "Haddad", "Resident", "Attending"):
        assert word not in user, word
    # but it does carry the standard and what happened
    assert item.text in user
    assert "Five offered" in user


def test_the_system_prompt_forbids_scoring_voice():
    assert "you scored" in fb.SYSTEM.lower()
    assert "coaching voice" in fb.SYSTEM.lower()
    assert "200 words" in fb.SYSTEM


def test_drafts_are_written_per_role_and_say_what_they_rest_on(rubric, man):
    working = {
        "block": "apr-jun",
        "objective": "an objective",
        "roles": man.roles,
        "items": {
            "problem_rep": result(True, quote="Three-year-old, two days of fever"),
            "three_to_four": result(False, why="Five offered."),
            "framework_first": result(False, why="No scheme named."),
        },
        "automatic_fails": {},
    }
    boundary = NameBoundary(man.roles)
    drafts = fb.draft_all(working, rubric, client=None, boundary=boundary, dry_run=True)
    assert {d.role for d in drafts} == {"PRESENTER", "SCRIBE", "PGY1", "SENIOR",
                                        "FACULTY", "FACILITATOR"}
    pgy1 = next(d for d in drafts if d.role == "PGY1")
    rendered = pgy1.render()
    assert "Subject:" in rendered
    assert "roles/pgy1/" in rendered
    assert "Draft only" in rendered
    assert "B2" in rendered                    # the audit comment says what it rests on
    assert pgy1.filename() == "pgy1-a-resident.md"


def test_a_draft_never_leaves_with_a_name_in_the_prompt(rubric, man):
    """The drafting call goes through the same boundary as scoring."""
    working = {"block": "jul-sep", "objective": "Will Barlow's case about a toddler",
               "roles": man.roles, "items": {"problem_rep": result(True)}, "automatic_fails": {}}
    boundary = NameBoundary(man.roles)
    payload = fb.build_payload("PGY1", None, None, "jul-sep", working["objective"])
    substituted = boundary.substitute(payload["user"])
    assert "Will Barlow" not in substituted
    assert boundary.residual_names(substituted) == []
