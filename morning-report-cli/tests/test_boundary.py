"""The API name boundary — the load-bearing piece of the privacy design."""

import pytest

from morningreport import model
from morningreport.roles import ALSO_A_WORD, NameBoundary


def test_full_name_and_parts(boundary):
    out = boundary.substitute("Will Barlow: over to you. Will, take it away.")
    assert "[PRESENTER]" in out
    assert "Will" not in out and "Barlow" not in out


def test_possessives(boundary):
    out = boundary.substitute("That was Will's point and Barlow’s slide.")
    assert "Will" not in out and "Barlow" not in out
    assert out.count("[PRESENTER]") == 2


def test_case_insensitive_full_name(boundary):
    assert "[PRESENTER]" in boundary.substitute("will barlow said so")


def test_ordinary_words_survive(boundary):
    """A lone lowercase 'will' is a word, not the presenter."""
    text = "He will not bear weight, and we will get the ultrasound."
    assert boundary.substitute(text) == text


def test_capitalised_first_name_is_still_caught(boundary):
    assert "[PRESENTER]" in boundary.substitute("Will, can you share?")


def test_every_role_is_covered(boundary, man):
    for name, role in man.roles.items():
        out = boundary.substitute(f"{name} spoke.")
        assert f"[{role}]" in out, (name, role)
        assert name not in out


def test_residual_names_is_clean_after_substitution(boundary, load_tx):
    from morningreport.roles import redact_transcript
    tx = load_tx("clean.vtt")
    redacted = redact_transcript(tx, boundary)
    assert boundary.residual_names(redacted) == []
    for name in boundary.mapping:
        assert name not in redacted


def test_unmapped_speakers_are_reported(boundary):
    assert boundary.unmapped_speakers(["Will Barlow", "E Visitor"]) == ["E Visitor"]


def test_unknown_role_is_rejected():
    with pytest.raises(ValueError):
        NameBoundary({"Someone": "CHIEF_OF_MEDICINE"})


def test_no_name_survives_into_any_payload(rubric, load_tx, man, boundary):
    """The acceptance test for phase 8, asserted rather than eyeballed."""
    tx = load_tx("clean.vtt")
    checked = 0
    for item in rubric.items:
        if not item.model_scored or not model.has_prompt(item.code):
            continue
        payload = model.build_payload(item, tx, boundary, man)
        checked += 1
        assert payload.residual_names == [], (item.code, payload.residual_names)
        for name in man.roles:
            assert name not in payload.user, (item.code, name)
            for part in name.split():
                if len(part) > 2 and part.lower() not in ALSO_A_WORD:
                    assert part not in payload.user, (item.code, part)
    assert checked >= 10


def test_client_refuses_to_send_a_payload_with_a_name(boundary):
    payload = model.Payload(
        code="B5", model="x", system="s",
        user="Will Barlow said something", residual_names=["Will Barlow"],
    )
    client = model.Client(api_key="not-used")
    with pytest.raises(model.ModelError, match="refusing to send"):
        client.send(payload)


def test_role_tokens_are_the_only_speakers_in_a_payload(rubric, load_tx, man, boundary):
    import re
    tx = load_tx("clean.vtt")
    item = rubric.by_code("B5")
    payload = model.build_payload(item, tx, boundary, man)
    speakers = set(re.findall(r"^\[\d{2}:\d{2}\] (\[[A-Z0-9]+\]):", payload.user, re.M))
    assert speakers
    assert speakers <= {"[PRESENTER]", "[SCRIBE]", "[PGY1]", "[SENIOR]",
                        "[FACULTY]", "[FACILITATOR]", "[OTHER]"}
