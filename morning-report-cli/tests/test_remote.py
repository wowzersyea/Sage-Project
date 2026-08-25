"""The shared roster endpoint, and the manifest it fills in.

Invented people throughout. No network: `fetch` takes an opener so the
transport can be replaced with a function that returns bytes.
"""

import io
import json
import urllib.error

import pytest
from click.testing import CliRunner

from morningreport import remote as rm
from morningreport.cli import cli

ENDPOINT = "https://endpoint.test/exec"
KEY = "a-long-random-key"
DATE = "2026-09-03"


def payload(draws=None, status="ok"):
    return {
        "status": status,
        "generated": "2026-08-25T02:00:00Z",
        "warnings": [],
        "roster": {
            "source": "sheet",
            "academic_year": "2026-2027",
            "residents": [
                {"id": "r-1", "name": "Marisol Aguirre", "level": "PGY-1", "active": True},
                {"id": "r-2", "name": "Teodoro Nunez", "level": "PGY-3", "active": True},
            ],
            "draws": draws if draws is not None else [],
        },
        "rotations": None,
    }


def opener_for(body, *, status=200):
    """A stand-in for urllib.request.urlopen."""
    calls = []

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.close()
            return False

    def _open(url, timeout=None):
        calls.append({"url": url, "timeout": timeout})
        if status != 200:
            raise urllib.error.HTTPError(url, status, "nope", {}, None)
        raw = body if isinstance(body, str) else json.dumps(body)
        return Resp(raw.encode("utf-8"))

    _open.calls = calls
    return _open


DRAWS = [
    {"date": DATE, "site": "Galveston", "role": "pgy1_discussant",
     "resident": "r-1", "name": "Marisol Aguirre"},
    {"date": DATE, "site": "Galveston", "role": "senior_discussant",
     "resident": "r-2", "name": "Teodoro Nunez"},
    {"date": "2026-09-04", "site": "Clear Lake", "role": "pgy1_discussant",
     "resident": "r-1", "name": "Marisol Aguirre"},
]


# ----------------------------------------------------------------- fetch

def test_the_key_goes_on_the_query_string():
    op = opener_for(payload())
    rm.fetch(ENDPOINT, KEY, opener=op)
    assert f"key={KEY}" in op.calls[0]["url"]


def test_a_key_with_awkward_characters_is_escaped():
    op = opener_for(payload())
    rm.fetch(ENDPOINT, "a key/with+chars&in=it", opener=op)
    url = op.calls[0]["url"]
    assert "a%20key%2Fwith%2Bchars%26in%3Dit" in url
    # and it must not look like extra query parameters
    assert url.count("&") == 0


def test_an_endpoint_that_already_has_a_query_gets_an_ampersand():
    op = opener_for(payload())
    rm.fetch(ENDPOINT + "?v=2", KEY, opener=op)
    assert "?v=2&key=" in op.calls[0]["url"]


def test_a_refused_key_is_named_as_such():
    with pytest.raises(rm.RemoteError, match="refused"):
        rm.fetch(ENDPOINT, KEY, opener=opener_for({"status": "denied"}))


def test_an_http_error_is_reported_not_raised_raw():
    with pytest.raises(rm.RemoteError, match="500"):
        rm.fetch(ENDPOINT, KEY, opener=opener_for(payload(), status=500))


def test_a_non_json_answer_is_reported():
    with pytest.raises(rm.RemoteError, match="did not return JSON"):
        rm.fetch(ENDPOINT, KEY, opener=opener_for("<html>signin</html>"))


def test_http_endpoints_are_refused_before_anything_is_sent():
    op = opener_for(payload())
    with pytest.raises(rm.RemoteError, match="https"):
        rm.fetch("http://endpoint.test/exec", KEY, opener=op)
    assert op.calls == []


def test_no_configuration_is_refused_before_anything_is_sent():
    op = opener_for(payload())
    with pytest.raises(rm.RemoteError):
        rm.fetch("", "", opener=op)
    assert op.calls == []


def test_configured_needs_both():
    assert rm.configured(ENDPOINT, KEY)
    assert not rm.configured(ENDPOINT, "")
    assert not rm.configured("", KEY)


# ----------------------------------------------------------------- draws

def test_draws_are_read_for_one_date_only():
    p = payload(DRAWS)
    assert len(rm.draws(p)) == 3
    assert len(rm.draws_on(p, DATE)) == 2


def test_a_payload_with_no_draws_is_empty_not_an_error():
    assert rm.draws(payload()) == []
    assert rm.draws({}) == []


def test_roles_map_names_to_manifest_tokens():
    roles, site, notes = rm.roles_for(payload(DRAWS), DATE)
    assert roles == {"Marisol Aguirre": "PGY1", "Teodoro Nunez": "SENIOR"}
    assert site == "Galveston"
    assert notes == []


def test_an_acting_intern_is_still_named_in_the_manifest():
    """No resident id, but they held the role and the transcript will
    have their name on it, so the manifest needs them."""
    rows = [{"date": DATE, "site": "Galveston", "role": "pgy1_discussant",
             "resident": "", "name": "A Visiting Student"}]
    roles, _, notes = rm.roles_for(payload(rows), DATE)
    assert roles == {"A Visiting Student": "PGY1"}
    assert notes == []


def test_a_role_the_wheel_does_not_draw_is_reported_not_guessed():
    rows = [{"date": DATE, "site": "G", "role": "presenter",
             "resident": "r-1", "name": "Marisol Aguirre"}]
    roles, _, notes = rm.roles_for(payload(rows), DATE)
    assert roles == {}
    assert any("presenter" in n for n in notes)


def test_a_draw_with_no_name_is_reported():
    rows = [{"date": DATE, "site": "G", "role": "senior_discussant",
             "resident": "r-2", "name": ""}]
    roles, _, notes = rm.roles_for(payload(rows), DATE)
    assert roles == {}
    assert any("no name" in n for n in notes)


def test_one_person_in_two_roles_keeps_the_first_and_says_so():
    rows = [
        {"date": DATE, "site": "G", "role": "pgy1_discussant", "resident": "r-1", "name": "Marisol Aguirre"},
        {"date": DATE, "site": "G", "role": "senior_discussant", "resident": "r-1", "name": "Marisol Aguirre"},
    ]
    roles, _, notes = rm.roles_for(payload(rows), DATE)
    assert roles == {"Marisol Aguirre": "PGY1"}
    assert any("both" in n for n in notes)


def test_a_date_with_nothing_confirmed_is_empty():
    roles, site, notes = rm.roles_for(payload(DRAWS), "2026-12-25")
    assert roles == {} and site == "" and notes == []


# ------------------------------------------------------- manifest prefill

def run(tmp_path, args, monkeypatch, body=None, boom=None):
    if body is not None or boom is not None:
        def fake_fetch(endpoint, key, timeout=rm.TIMEOUT, opener=None):
            if boom:
                raise rm.RemoteError(boom)
            return body
        monkeypatch.setattr(rm, "fetch", fake_fetch)
    return CliRunner().invoke(cli, ["--data", str(tmp_path)] + args)


def read_manifest(tmp_path, session_id):
    return json.loads((tmp_path / "manifests" / f"{session_id}.json").read_text())


def test_manifest_fills_the_discussants_in_from_the_confirmed_draw(tmp_path, monkeypatch):
    res = run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", DATE],
              monkeypatch, body=payload(DRAWS))
    assert res.exit_code == 0, res.output
    roles = read_manifest(tmp_path, DATE)["roles"]
    assert roles["Marisol Aguirre"] == "PGY1"
    assert roles["Teodoro Nunez"] == "SENIOR"
    assert "Filled in from the confirmed draw" in res.output


def test_the_rest_of_the_room_is_left_to_fill_in(tmp_path, monkeypatch):
    """The wheel draws two people. The presenter, scribe, faculty and
    facilitator are not drawn, so their placeholders must survive."""
    run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", DATE],
        monkeypatch, body=payload(DRAWS))
    roles = read_manifest(tmp_path, DATE)["roles"]
    assert set(roles.values()) == {"PGY1", "SENIOR", "PRESENTER", "SCRIBE", "FACULTY", "FACILITATOR"}


def test_the_template_discussants_do_not_survive_alongside_the_real_ones(tmp_path, monkeypatch):
    """A leftover 'A Resident: PGY1' next to the real one would give the
    boundary two names for one role and quietly mis-substitute."""
    run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", DATE],
        monkeypatch, body=payload(DRAWS))
    roles = read_manifest(tmp_path, DATE)["roles"]
    assert list(roles.values()).count("PGY1") == 1
    assert list(roles.values()).count("SENIOR") == 1


def test_the_site_comes_from_the_draw(tmp_path, monkeypatch):
    run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", DATE],
        monkeypatch, body=payload(DRAWS))
    assert read_manifest(tmp_path, DATE)["site"] == "Galveston"


def test_no_endpoint_leaves_the_template_exactly_as_it_was(tmp_path, monkeypatch):
    res = run(tmp_path, ["manifest", DATE], monkeypatch)
    assert res.exit_code == 0, res.output
    roles = read_manifest(tmp_path, DATE)["roles"]
    assert "A Resident" in roles                      # the placeholder, untouched
    assert "Filled in from" not in res.output


def test_an_unreachable_endpoint_still_writes_a_usable_template(tmp_path, monkeypatch):
    res = run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", DATE],
              monkeypatch, boom="Could not reach the endpoint: timed out")
    assert res.exit_code == 0, res.output
    assert (tmp_path / "manifests" / f"{DATE}.json").exists()
    assert "by hand" in res.output


def test_a_date_with_no_confirmed_draw_says_so(tmp_path, monkeypatch):
    res = run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", "2026-12-25"],
              monkeypatch, body=payload(DRAWS))
    assert "No draw has been confirmed" in res.output
    assert read_manifest(tmp_path, "2026-12-25")["roles"]["A Resident"] == "PGY1"


def test_no_from_draw_skips_the_endpoint_entirely(tmp_path, monkeypatch):
    called = []

    def fake_fetch(*a, **k):
        called.append(1)
        return payload(DRAWS)

    monkeypatch.setattr(rm, "fetch", fake_fetch)
    run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", DATE, "--no-from-draw"],
        monkeypatch)
    assert called == []


def test_the_endpoint_can_come_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("MORNINGREPORT_ENDPOINT", ENDPOINT)
    monkeypatch.setenv("MORNINGREPORT_KEY", KEY)
    res = run(tmp_path, ["manifest", DATE], monkeypatch, body=payload(DRAWS))
    assert "Filled in from the confirmed draw" in res.output


def test_a_session_id_with_a_site_suffix_still_matches_the_draw(tmp_path, monkeypatch):
    """Sessions are dated `YYYY-MM-DD-site`; the draw is keyed on the
    date alone, so the suffix must not stop it matching."""
    res = run(tmp_path, ["--endpoint", ENDPOINT, "--key", KEY, "manifest", f"{DATE}-galveston"],
              monkeypatch, body=payload(DRAWS))
    roles = read_manifest(tmp_path, f"{DATE}-galveston")["roles"]
    assert roles["Marisol Aguirre"] == "PGY1"
