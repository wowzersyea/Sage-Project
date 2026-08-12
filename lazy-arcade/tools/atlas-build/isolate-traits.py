#!/usr/bin/env python3
"""
Trait isolation — extract a single trait as standalone art on transparency.

Lazy Lions are layered composites, so a given trait occupies the *same pixels*
in every Lion that carries it. That makes the layer recoverable without any
source PSD:

  agree = pixels byte-identical across several Lions that HAVE the trait
          (their shared layers: the trait, plus whatever else they happen to
          share)
  seed  = agree AND differing from Lions that LACK the trait
          (confidently trait, but pitted with holes wherever a trait pixel
          coincidentally matched a non-holder)
  layer = seed grown back through `agree` by geodesic dilation
          (recovers the complete shape without dragging in unrelated layers)

Sampling must be NEAREST throughout: LANCZOS blends each pixel with its
neighbours and destroys the exact-match signal the whole method rests on.

LICENSING — read before changing the reference pools.

The EMITTED PIXELS ALWAYS COME FROM A LION THE OPERATOR OWNS. `base` is
asserted to be in the owned set and is the only image contributing colour.
Other Lions appear solely as a boolean reference — "does this pixel differ
here?" — and none of their pixels reach the output. Using them is what makes
isolation possible for traits the operator holds only one or two of.

If that reasoning is ever rejected, set REFERENCE_POOL = "owned" below; the
tool still works for traits with enough owned holders (LAZY Hat, Spinner Hat,
Shades, Big Smile) and reports the rest as unavailable rather than degrading
quietly.

  python3 tools/atlas-build/isolate-traits.py
"""

import base64
import io
import json
import os
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageChops, ImageDraw, ImageFile, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ImageFile.LOAD_TRUNCATED_IMAGES = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
INGEST = os.path.join(ROOT, "tools", "trait-ingest", "data")
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "isolated_traits.json")
GATEWAYS = ["https://ipfs.io/ipfs", "https://dweb.link/ipfs", "https://gateway.pinata.cloud/ipfs"]

REFERENCE_POOL = "collection"   # or "owned"
R = 1000
TILE = 240

# Anatomical band per category: keeps the mask out of unrelated parts of the
# frame, which is what stopped Crown bleeding into the mane.
BAND = {
    "Headgear": (0.08, 0.00, 0.92, 0.42),
    "Eyes":     (0.14, 0.28, 0.86, 0.56),
    "Mouth":    (0.16, 0.44, 0.84, 0.78),
    "Bodygear": (0.00, 0.58, 1.00, 1.00),
}

TARGETS = [
    ("L1", "Headgear", "Crown"),
    ("L2", "Bodygear", "Hawaiian Shirt"),
    ("L3", "Mouth",    "Cigar"),
    ("L4", "Headgear", "LAZY Hat"),
    ("M1", "Headgear", "Spinner Hat"),
    ("M2", "Bodygear", "Gold Chain"),
    ("M3", "Eyes",     "Shades"),
    ("M4", "Mouth",    "Big Smile"),
]

_img: dict[int, Image.Image] = {}


def cached(t):
    p = os.path.join(CACHE, f"{t}.img")
    return os.path.exists(p) and os.path.getsize(p) > 100_000


def load(t):
    if t not in _img:
        _img[t] = Image.open(os.path.join(CACHE, f"{t}.img")).convert("RGB").resize(
            (R, R), Image.NEAREST)
    return _img[t]


def fetch(items):
    def get(item):
        t, cid = item
        p = os.path.join(CACHE, f"{t}.img")
        if cached(t):
            return t, "cached"
        for gw in GATEWAYS:
            subprocess.run(["curl", "-sSL", "--max-time", "150", "-o", p, f"{gw}/{cid}"],
                           capture_output=True)
            if cached(t):
                return t, "ok"
        return t, "FAIL"
    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(get, items))


def image_cid(token_id):
    for _ in range(3):
        p = subprocess.run(["curl", "-sS", "--max-time", "30",
                            f"https://metadata.lazylionsnft.com/api/lazylions/{token_id}"],
                           capture_output=True, text=True)
        try:
            return json.loads(p.stdout)["image"].replace("ipfs://", "")
        except Exception:
            pass
    return None


def mane_matched(base_id, traits, candidates, limit):
    """Restrict a reference group to Lions sharing the base's mane.

    The mane is drawn OVER the lower part of headgear and bodygear, so across
    Lions with different manes only the always-visible sliver of a trait
    agrees -- which is why Crown came back as just its top points. Matching the
    mane on BOTH groups makes the occlusion identical, and the mane itself then
    cancels: it agrees among holders (so it enters `agree`) but also matches the
    non-holders (so it never enters `seed`)."""
    mane = traits.get(str(base_id), {}).get("Mane")
    same = [t for t in candidates if traits.get(str(t), {}).get("Mane") == mane]
    return same[:limit], mane


def diverse(candidates, traits, limit):
    """Pick tokens that differ in the layers covering the same area, so their
    agreement is the target trait and not a shared mane or body."""
    seen, out = set(), []
    for t in candidates:
        tr = traits.get(str(t), {})
        key = (tr.get("Background"), tr.get("Mane"), tr.get("Body"))
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
        if len(out) >= limit:
            break
    return out


def band_mask(cat):
    m = Image.new("L", (R, R), 0)
    b = BAND[cat]
    ImageDraw.Draw(m).rectangle([int(b[0]*R), int(b[1]*R), int(b[2]*R), int(b[3]*R)], fill=255)
    return m


def coverage(m):
    return sum(m.tobytes()) / 255 / (R * R)


def geodesic(seed, mask, iters=45):
    cur = seed
    for _ in range(iters):
        grown = ImageChops.darker(cur.filter(ImageFilter.MaxFilter(3)), mask)
        if grown.tobytes() == cur.tobytes():
            break
        cur = grown
    return cur


def isolate(base_id, holders, non_holders, cat, tol=12, ntol=26):
    band = band_mask(cat)
    base = load(base_id)

    agree = band.copy()
    for o in holders:
        d = ImageChops.difference(base, load(o)).convert("L")
        agree = ImageChops.darker(agree, d.point(lambda v: 255 if v <= tol else 0))

    seed = agree.copy()
    for o in non_holders:
        d = ImageChops.difference(base, load(o)).convert("L")
        seed = ImageChops.darker(seed, d.point(lambda v: 255 if v > ntol else 0))
    seed = seed.filter(ImageFilter.MedianFilter(5))

    diag = {"agree": round(coverage(agree), 4), "seed": round(coverage(seed), 4)}
    if coverage(seed) < 2e-5:
        return None, diag
    layer = geodesic(seed, agree).filter(ImageFilter.MedianFilter(3))
    # Morphological opening: erode then dilate. Thin slivers of mane that
    # survived the contrast step vanish, solid trait shapes come back intact.
    layer = layer.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(9))
    layer = layer.filter(ImageFilter.MedianFilter(5))
    diag["layer"] = round(coverage(layer), 4)
    return layer, diag


def main() -> int:
    owned = json.load(open(os.path.join(INGEST, "owned_traits.json")))["owned_tokens"]
    owned_ids = {int(t) for t in owned}
    coll_path = os.path.join(INGEST, "collection_traits.json")
    collection = json.load(open(coll_path)) if os.path.exists(coll_path) else {}
    if REFERENCE_POOL == "collection" and not collection:
        print("collection_traits.json missing -- run fetch-collection.py, or set "
              "REFERENCE_POOL = 'owned'", file=sys.stderr)
        return 2

    all_traits = {**{k: v["traits"] for k, v in owned.items()}, **collection}
    results, total = {}, 0

    for sym, cat, val in TARGETS:
        owned_holders = [int(t) for t, v in owned.items() if v["traits"].get(cat) == val]
        if not owned_holders:
            print(f"  {sym} {cat}::{val}: LICENSING -- operator owns none, skipped", file=sys.stderr)
            continue
        # Colour only ever comes from an owned token.
        base_id = next((t for t in owned_holders if cached(t)), owned_holders[0])

        pool = ([int(t) for t, tr in all_traits.items() if tr.get(cat) == val]
                if REFERENCE_POOL == "collection" else owned_holders)
        pool = [t for t in pool if t != base_id]

        # Prefer same-mane references; fall back to diverse ones for categories
        # the mane does not occlude, or when too few Lions share the mane.
        refs, mane = mane_matched(base_id, all_traits, sorted(pool), 4)
        non_pool = [int(t) for t, tr in all_traits.items()
                    if tr.get(cat) not in (val, None) and int(t) != base_id]
        non, _ = mane_matched(base_id, all_traits, sorted(non_pool), 6)
        matched = len(refs) >= 2 and len(non) >= 3
        if not matched:
            refs = diverse(sorted(pool, key=lambda t: (t not in owned_ids, t)), all_traits, 4)
            non = diverse([t for t in owned_ids if cached(t)
                           and all_traits.get(str(t), {}).get(cat) not in (val, None)],
                          all_traits, 8)

        need = [(t, None) for t in [base_id] + refs + non if not cached(t)]
        if need:
            resolved = [(t, image_cid(t)) for t, _ in need]
            resolved = [(t, c) for t, c in resolved if c]
            fetch(resolved)
        refs = [t for t in refs if cached(t)]
        non = [t for t in non if cached(t)]
        if not cached(base_id):
            print(f"  {sym} {cat}::{val}: base image unavailable, skipped", file=sys.stderr)
            continue

        layer, diag = isolate(base_id, refs, non, cat)
        owned_refs = sum(1 for t in refs if t in owned_ids)
        if layer is None:
            print(f"  {sym} {cat}::{val:<16} FAILED {diag}", file=sys.stderr)
            continue
        bbox = layer.getbbox()
        rgba = load(base_id).convert("RGBA")
        rgba.putalpha(layer)
        crop = rgba.crop(bbox)
        side = max(crop.size)
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
        buf = io.BytesIO()
        sq.resize((TILE, TILE), Image.LANCZOS).save(buf, format="WEBP", quality=90, method=6)
        uri = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
        total += len(uri)
        results[sym] = {"trait": f"{cat}::{val}", "name": val, "baseToken": base_id,
                        "refs": refs, "ownedRefs": owned_refs, "maneMatched": matched,
                        "uri": uri, "diag": diag}
        print(f"  {sym}  {cat}::{val:<16} base #{base_id:<6} refs={len(refs)} "
              f"(owned {owned_refs}) {'mane-matched' if matched else 'diverse':<12} "
              f"layer={diag.get('layer')}  {len(uri)//1024} KB")

    json.dump({"referencePool": REFERENCE_POOL,
               "note": "emitted pixels come only from baseToken, which the operator owns",
               "traits": results}, open(OUT, "w"))
    print(f"\nisolated {len(results)}/{len(TARGETS)} traits ({total//1024} KB) -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
