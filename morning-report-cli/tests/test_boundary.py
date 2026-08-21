"""The API name boundary — the load-bearing piece of the privacy design."""

import pytest

from morningreport import model
from morningreport.roles import NameBoundary


def test_full_name_and_parts(boundary):
    out = boundary.substitute("Mark Murphy: over to you. Mark, take it away.")
    assert "[PRESENTER]" in out
    assert "Mark" not in out and "Murphy" not in out


def test_possessives(boundary):
    out = boundary.substitute("That was Mark's point and Murphy’s slide.")
    assert "Mark" not in out and "Murphy" not in out
    assert out.count("[PRESENTER]") == 2


def test_case_insensitive_full_name(boundary):
    assert "[PRESENTER]" in boundary.substitute("mark murphy said so")


def test_ordinary_words_survive(boundary):
    """A lone lowercase 'mark' is a word, not the presenter."""
    text = "The mark on the film is unrelated; we will mark it as pending."
    assert boundary.substitute(text) == text


def test_capitalised_first_name_is_still_caught(boundary):
    assert "[PRESENTER]" in boundary.substitute("Mark, can you share?")


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
    assert boundary.unmapped_speakers(["Mark Murphy", "E Visitor"]) == ["E Visitor"]


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
                if len(part) > 2 and part.lower() not in ("mark",):
                    assert part not in payload.user, (item.code, part)
    assert checked >= 10


def test_client_refuses_to_send_a_payload_with_a_name(boundary):
    payload = model.Payload(
        code="B5", model="x", system="s",
        user="Mark Murphy said something", residual_names=["Mark Murphy"],
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
