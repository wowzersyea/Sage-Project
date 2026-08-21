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
OWNED_CUBS = os.path.join(ROOT, "tools", "trait-ingest", "data", "owned_cubs.json")


PAGE = os.path.join(ROOT, "play", "index.html")


def fail(message: str, code: int = 1):
    print(f"LICENSING GATE FAILED: {message}", file=sys.stderr)
    sys.exit(code)


def load_shipped_art():
    """The tiles actually embedded in play/index.html, by symbol id."""
    if not os.path.exists(PAGE):
        return None
    page = open(PAGE).read()
    start = page.find("/* @@@SYMBOL_ART@@@ */")
    end = page.find("/* @@@SYMBOL_ART_END@@@ */")
    if start == -1 or end == -1:
        return None
    block = page[start:end]
    try:
        return json.loads(block[block.index("=") + 1:].rstrip().rstrip(";"))
    except ValueError:
        return None


def check_deck_art(owned_token_ids):
    """The Hi/Lo rarity deck, which nothing had ever checked.

    The gate covered symbols.json and then the symbol tiles embedded in the
    page. It never looked at DECK_ART -- seventy more collection Lions, shipped
    in the same file, each one a full portrait. That is the largest body of
    collection art in the build and it sat outside the only thing standing
    between this project and a licensing problem.

    They all trace clean today. The point is that nothing would have said so if
    they did not.
    """
    if not os.path.exists(PAGE):
        return []
    page = open(PAGE).read()
    start = page.find("/* @@@DECK_ART@@@ */")
    end = page.find("/* @@@DECK_ART_END@@@ */")
    if start == -1 or end == -1:
        print("  deck    : no deck art block -- not checked")
        return []
    block = page[start:end]
    try:
        deck = json.loads(block[block.index("=") + 1:].rstrip().rstrip(";"))
    except ValueError:
        return ["DECK_ART present but unreadable"]

    art = deck.get("rankArt", {})
    problems, checked = [], 0
    for rank, entry in sorted(art.items(), key=lambda kv: int(kv[0])):
        token = entry.get("id")
        if token is None:
            problems.append(f"hi/lo rank {rank}: card names no token")
            continue
        checked += 1
        if token not in owned_token_ids:
            problems.append(
                f"hi/lo rank {rank}: card is Lion #{token}, which the operator does not hold")
    print(f"  deck    : {checked} Hi/Lo cards traced to owned tokens")
    return problems


def check_shipped_art(symbols, owned_token_ids, owned_cub_ids):
    """Tie the licence to the ART, not to the paperwork describing it.

    Everything above validates symbols.json. But symbols.json is written by
    hand and build-symbols.py has never read it -- the builder picks its own
    token and injects the tile straight into the page. So the two are free to
    drift, and when they do this gate keeps passing while the page ships art
    from a lion nobody cleared. A gate that reads a description of the thing
    instead of the thing is the same fault the fairness verifier had when its
    copy of the strips went stale.

    So: every tile embedded in the page must name a token, that token must be
    one the operator holds, and it must be the token symbols.json cleared.
    """
    art = load_shipped_art()
    if art is None:
        print("  shipped : play/index.html carries no symbol art block -- not checked")
        return []

    declared = {s["id"]: s for s in symbols}
    problems, checked = [], 0
    for group, entries in art.items():
        if not isinstance(entries, dict):
            continue                      # provenance keys like generatedBy
        for sid, entry in entries.items():
            token = entry.get("tokenId")
            collection = entry.get("collection", "lion")
            held = owned_token_ids if collection == "lion" else owned_cub_ids
            if token is None:
                problems.append(f"{group}:{sid}: shipped tile names no token")
                continue
            checked += 1
            if token not in held:
                problems.append(
                    f"{group}:{sid}: SHIPPED tile is {collection} #{token}, "
                    f"which the operator does not hold"
                )
                continue
            # cubcluster deliberately overrides some ids with different art, so
            # only the default set is required to match symbols.json.
            if group != "default":
                continue
            want = declared.get(sid, {}).get("tokenId")
            if want is not None and want != token:
                problems.append(
                    f"{sid}: symbols.json cleared #{want} but the page ships #{token}"
                )
    print(f"  shipped : {checked} embedded tiles traced to owned tokens")
    return problems


def main() -> int:
    for path in (SYMBOLS, OWNED):
        if not os.path.exists(path):
            fail(f"missing {path}. Run tools/trait-ingest/ingest.py first.", 2)

    symbols = json.load(open(SYMBOLS))["symbols"]
    owned = json.load(open(OWNED))
    licensed_traits = set(owned["licensed_traits"])
    owned_token_ids = {int(t) for t in owned["owned_tokens"]}

    # Lazy Cubs are a separate collection with separate holdings. Commercial
    # rights follow the tokens the operator holds in EACH collection, so Cub
    # symbols are checked against Cub holdings -- never against the Lions.
    cubs = json.load(open(OWNED_CUBS)) if os.path.exists(OWNED_CUBS) else {}
    owned_cub_ids = {int(t) for t in cubs}
    licensed_cub_traits = {
        f"{c}::{v}" for tok in cubs.values() for c, v in tok["traits"].items()
    }

    violations: list[str] = []
    blocked: list[str] = []
    asserted: list[str] = []
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

        elif source == "OWNED_CUB":
            token_id = sym.get("tokenId")
            if not cubs:
                violations.append(f"{sid}: no owned Cub data -- run trait-ingest for Lazy Cubs")
            elif token_id not in owned_cub_ids:
                violations.append(f"{sid}: Cub #{token_id} is not held by {owned['operator_wallet']}")
            else:
                ok += 1

        elif source == "CUB_TRAIT":
            trait = sym.get("trait")
            if not cubs:
                violations.append(f"{sid}: no owned Cub data -- run trait-ingest for Lazy Cubs")
            elif trait not in licensed_cub_traits:
                violations.append(f"{sid}: trait {trait!r} is NOT present on any Cub the operator holds")
            else:
                ok += 1

        elif source == "OWNED_DRINK":
            # ERC-1155: holdings are a balance per token id, checked on-chain at
            # ingest and recorded here. Juice is held; Milk and Special are not.
            held = {0: 11}
            if sym.get("tokenId") not in held:
                violations.append(
                    f"{sid}: Lazy Drinks token id {sym.get('tokenId')} is not held "
                    f"(operator holds {sorted(held)})")
            else:
                ok += 1

        elif source == "ASSERTED_PERMISSION":
            # Rights claimed by the operator rather than proven by holdings.
            # Allowed, but surfaced on every run: this is the one category the
            # gate cannot actually verify, so it must never pass quietly.
            if not sym.get("reason"):
                violations.append(f"{sid}: ASSERTED_PERMISSION requires a documented reason")
            else:
                asserted.append(f"{sid} ({sym.get('contract','?')} #{sym.get('tokenId','?')})")
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

    violations += check_shipped_art(symbols, owned_token_ids, owned_cub_ids)
    violations += check_deck_art(owned_token_ids)

    print(f"licensing gate: {len(symbols)} symbols checked against "
          f"{len(licensed_traits)} Lion traits / {len(owned_token_ids)} Lions, "
          f"{len(licensed_cub_traits)} Cub traits / {len(owned_cub_ids)} Cubs")
    print(f"  cleared : {ok}")

    if asserted:
        print(f"  asserted: {len(asserted)} rights claimed by the operator, NOT verifiable "
              f"on-chain -- confirm before mainnet")
        for a in asserted:
            print(f"      - {a}")

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
