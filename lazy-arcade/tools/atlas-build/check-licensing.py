#!/usr/bin/env python3
"""
Licensing gate (spec Sec. 5.3) -- run this in CI before any atlas is built.

Lazy Lions grants commercial rights to holders FOR THE LIONS THEY HOLD. It does
not grant rights to the collection's full trait library. So every symbol that
draws on collection art must trace back to a token in `owned_traits.json`, and
this script fails the build if one does not.

Exit codes:
  0  every symbol is licensed (symbols marked BLOCKED_PENDING_ART are reported
     but do not fail -- they are already flagged as needing commissioned art)
  1  a symbol references art the operator does not hold
  2  inputs missing or malformed
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SYMBOLS = os.path.join(ROOT, "packages", "assets", "symbols.json")
OWNED = os.path.join(ROOT, "tools", "trait-ingest", "data", "owned_traits.json")


def fail(message: str, code: int = 1):
    print(f"LICENSING GATE FAILED: {message}", file=sys.stderr)
    sys.exit(code)


def main() -> int:
    for path in (SYMBOLS, OWNED):
        if not os.path.exists(path):
            fail(f"missing {path}. Run tools/trait-ingest/ingest.py first.", 2)

    symbols = json.load(open(SYMBOLS))["symbols"]
    owned = json.load(open(OWNED))
    licensed_traits = set(owned["licensed_traits"])
    owned_token_ids = {int(t) for t in owned["owned_tokens"]}

    violations: list[str] = []
    blocked: list[str] = []
    ok = 0

    for sym in symbols:
        sid = sym["id"]
        source = sym.get("source")

        if sym.get("status") == "BLOCKED_PENDING_ART":
            blocked.append(f"{sid}: {sym.get('reason', 'no reason given')}")
            continue

        if source == "TRAIT":
            trait = sym.get("trait")
            if not trait:
                violations.append(f"{sid}: source TRAIT but no trait named")
            elif trait not in licensed_traits:
                violations.append(
                    f"{sid}: trait {trait!r} is NOT present on any Lion the operator holds"
                )
            else:
                ok += 1

        elif source == "OWNED_TOKEN":
            token_id = sym.get("tokenId")
            if token_id is None:
                violations.append(f"{sid}: source OWNED_TOKEN but no tokenId")
            elif token_id not in owned_token_ids:
                violations.append(
                    f"{sid}: token #{token_id} is not held by {owned['operator_wallet']}"
                )
            else:
                ok += 1

        elif source == "COMMISSIONED":
            # Original art carries no trait dependency, but it must not quietly
            # claim a trait it has no rights to.
            if sym.get("trait"):
                violations.append(
                    f"{sid}: marked COMMISSIONED yet references trait {sym['trait']!r}"
                )
            else:
                ok += 1
        else:
            violations.append(f"{sid}: unknown source {source!r}")

    print(f"licensing gate: {len(symbols)} symbols checked against "
          f"{len(licensed_traits)} licensed traits / {len(owned_token_ids)} owned tokens")
    print(f"  cleared : {ok}")

    if blocked:
        print(f"  blocked : {len(blocked)} (needs commissioned art before shipping)")
        for b in blocked:
            print(f"      - {b}")

    if violations:
        print(f"  ILLEGAL : {len(violations)}")
        for v in violations:
            print(f"      - {v}", file=sys.stderr)
        fail(f"{len(violations)} symbol(s) reference unlicensed art")

    print("OK -- no symbol references art outside the owned set.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
