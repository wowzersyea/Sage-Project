#!/usr/bin/env python3
"""
Merge isolated trait art into play/index.html.

`isolate-traits.py` produces standalone trait cut-outs on transparency; this
swaps them in over the framed close-ups for whichever symbols it managed to
isolate, and leaves the rest alone. Partial success is the expected case: a
trait needs several Lions carrying it before the layer signal is recoverable,
so a symbol with one or two holders may legitimately stay as a close-up.

Anything swapped in is recorded under `isolated: true` so the page — and anyone
reading the manifest later — can tell which symbols are true cut-outs and which
are still crops.

  python3 tools/atlas-build/inject-isolated.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PAGE = os.path.join(ROOT, "play", "index.html")
ISOLATED = os.path.join(HERE, "isolated_traits.json")

# Only symbols whose isolation was inspected and judged clean are swapped in.
# The rest keep their framed close-up, with the reason recorded here rather
# than shipping a half-cut asset and hoping nobody looks closely.
ACCEPTED = {"L1", "L4", "M1", "M3"}
REJECTED = {
    "L2": "Bodygear: the mane covers most of a Hawaiian Shirt, so only slivers "
          "are ever visible across Lions and the recovered layer is a fragment",
    "M2": "Bodygear: same occlusion problem -- the chain survives but arrives "
          "wrapped in mane",
    "L3": "Mouth: the Cigar layer legitimately includes the whole muzzle, and "
          "residual mane clings to its edges",
    "M4": "Mouth: same -- Big Smile is a muzzle layer, not a floating smile",
}

START = "/* @@@SYMBOL_ART@@@ */"
END = "/* @@@SYMBOL_ART_END@@@ */"


def main() -> int:
    if not os.path.exists(ISOLATED):
        print("no isolated_traits.json -- run isolate-traits.py first", file=sys.stderr)
        return 2
    iso = json.load(open(ISOLATED))["traits"]

    page = open(PAGE).read()
    s, e = page.find(START), page.find(END)
    if s == -1 or e == -1:
        print("PAGE MISSING MARKERS", file=sys.stderr)
        return 2
    block = page[s + len(START):e].strip()
    payload = json.loads(block[block.index("=") + 1:].rstrip(";").strip())

    swapped = []
    for sym, rec in iso.items():
        if sym not in payload.get("default", {}) or sym not in ACCEPTED:
            continue
        entry = payload["default"][sym]
        entry["uri"] = rec["uri"]
        entry["isolated"] = True
        entry["baseToken"] = rec["baseToken"]
        entry["name"] = rec["name"]
        swapped.append(f"{sym}={rec['name']}")

    for sym in payload.get("default", {}):
        payload["default"][sym].setdefault("isolated", False)

    new = f"{START}\nconst SYMBOL_ART=" + json.dumps(payload) + ";\n"
    open(PAGE, "w").write(page[:s] + new + page[e:])
    print(f"swapped {len(swapped)} isolated traits: {', '.join(swapped)}")
    for sym, why in REJECTED.items():
        if sym in payload.get("default", {}):
            payload["default"][sym]["isolationRejected"] = why
    new = f"{START}\nconst SYMBOL_ART=" + json.dumps(payload) + ";\n"
    page2 = open(PAGE).read()
    s2, e2 = page2.find(START), page2.find(END)
    open(PAGE, "w").write(page2[:s2] + new + page2[e2:])
    for sym, why in REJECTED.items():
        print(f"  kept close-up {sym}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
