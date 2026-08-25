"""The shared roster endpoint, read from the CLI.

The browser half writes a confirmed draw to a Google Sheet: who was the
PGY-1 discussant, who was the senior, on which date, at which site.
That is the same mapping a manifest needs, so a chief should not have to
type it in again from memory a day later — which is also where it goes
wrong, because `score` matches transcript speakers against manifest
names and a misremembered spelling silently drops a whole role.

Read-only on purpose. Confirming a draw is something you do in the room,
looking at the wheel; nothing here writes back.

urllib rather than requests or httpx: the package's only hard dependency
is click, and one GET does not justify changing that.

The endpoint URL and key are configuration, never committed. They come
from --endpoint/--key or MORNINGREPORT_ENDPOINT/MORNINGREPORT_KEY, the
same way the data folder comes from MORNINGREPORT_DATA.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

TIMEOUT = 20

# The two roles the wheel draws, as the manifest names them. Everyone
# else in the room — presenter, scribe, faculty, facilitator — is not
# drawn, so the sheet has nothing to say about them.
ROLE_FROM_DRAW = {
    "pgy1_discussant": "PGY1",
    "senior_discussant": "SENIOR",
}


class RemoteError(Exception):
    """The endpoint could not be read, or refused us."""


@dataclass(frozen=True)
class Draw:
    date: str
    site: str
    role: str
    resident: str
    name: str

    @property
    def manifest_role(self) -> str | None:
        return ROLE_FROM_DRAW.get(self.role)


def configured(endpoint: str | None, key: str | None) -> bool:
    return bool(endpoint and key)


def fetch(endpoint: str, key: str, timeout: int = TIMEOUT, opener=None) -> dict:
    """The whole payload: roster, rotations and confirmed draws.

    `opener` exists so tests can drive this without a network; nothing
    in the package passes it.
    """
    if not endpoint or not key:
        raise RemoteError("No endpoint and key are configured.")
    if not endpoint.startswith("https://"):
        raise RemoteError("The endpoint must start with https://")

    sep = "&" if "?" in endpoint else "?"
    url = f"{endpoint}{sep}key={urllib.parse.quote(key, safe='')}"

    try:
        get = opener or urllib.request.urlopen
        with get(url, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise RemoteError(f"The endpoint answered {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise RemoteError(f"Could not reach the endpoint: {exc.reason}") from exc
    except OSError as exc:                       # timeouts land here
        raise RemoteError(f"Could not reach the endpoint: {exc}") from exc

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RemoteError("The endpoint did not return JSON.") from exc

    if not isinstance(payload, dict):
        raise RemoteError("The endpoint did not return an object.")
    status = payload.get("status")
    if status == "denied":
        raise RemoteError("The endpoint refused that key.")
    if status != "ok":
        raise RemoteError(payload.get("message") or "The endpoint reported a problem.")
    return payload


def draws(payload: dict) -> list[Draw]:
    rows = ((payload.get("roster") or {}).get("draws")) or []
    out: list[Draw] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        date = str(row.get("date") or "").strip()
        if not date:
            continue
        out.append(Draw(
            date=date,
            site=str(row.get("site") or "").strip(),
            role=str(row.get("role") or "").strip(),
            resident=str(row.get("resident") or "").strip(),
            name=str(row.get("name") or "").strip(),
        ))
    return out


def draws_on(payload: dict, date: str) -> list[Draw]:
    return [d for d in draws(payload) if d.date == date]


def roles_for(payload: dict, date: str) -> tuple[dict[str, str], str, list[str]]:
    """The manifest fragment for one date.

    Returns the {name: ROLE} mapping, the site, and any notes worth
    printing — an unrecognised role, or a person recorded with no name.
    """
    rows = draws_on(payload, date)
    roles: dict[str, str] = {}
    notes: list[str] = []
    site = ""

    for d in rows:
        if d.site and not site:
            site = d.site
        role = d.manifest_role
        if role is None:
            notes.append(f"Ignored a draw for an unknown role {d.role!r}.")
            continue
        if not d.name:
            notes.append(f"A {role} was recorded for {date} with no name.")
            continue
        if d.name in roles and roles[d.name] != role:
            notes.append(f"{d.name} is recorded as both {roles[d.name]} and {role}; kept the first.")
            continue
        roles[d.name] = role

    return roles, site, notes
