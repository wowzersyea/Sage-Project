#!/usr/bin/env python3
"""
Symbol art builder (spec Sec. 5.2 step 5 / Sec. 5.3).

Turns the operator's OWNED Lions into slot symbol tiles and injects them into
play/index.html as inline data URIs (the bench must stay self-contained).

Only tokens listed in owned_traits.json are ever read, so the licensing
constraint is enforced by construction rather than by convention: there is no
code path here that can reach a Lion the operator does not hold.

Pipeline per symbol:
  10000x10000 source  ->  square crop around the head
                      ->  flood-key the flat background to transparency
                      ->  downsample to a 240px tile (anti-aliases the cut edge)
                      ->  WebP with alpha  ->  base64 data URI

WILD and SCATTER are NOT built here. WILD is blocked (no Signature Series is
owned) and SCATTER is project branding, not collection art -- both are drawn as
original SVG in the page itself.

  python3 tools/atlas-build/build-symbols.py
"""

import base64
import io
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFile

Image.MAX_IMAGE_PIXELS = None
ImageFile.LOAD_TRUNCATED_IMAGES = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OWNED = os.path.join(ROOT, "tools", "trait-ingest", "data", "owned_traits.json")
CACHE = os.path.join(HERE, "cache")
PAGE = os.path.join(ROOT, "play", "index.html")

GATEWAYS = ["https://ipfs.io/ipfs", "https://dweb.link/ipfs"]

# Symbol -> owned token. Chosen for visual separation: a player must tell these
# apart at 60px on a phone, so mane colour and headgear silhouette carry it.
ASSIGNMENT = [
    ("P1", 2038, "Emerald mane, police hat, water goggles"),
    ("P2", 1466, "Orange top knot, police hat, angry"),
    ("P3", 1506, "White mane, sheriff hat, pipe"),
    ("P4", 3273, "Brown mane, magenta ground, shades"),
    ("M1", 2735, "Pirate hat, bubble gum"),
    ("M2", 1725, "Black mane, horns, party blower"),
    ("M3", 3406, "Red mane, spinner hat"),
    ("M4", 840,  "Yellow mane, bunny ears"),
]

# Head crop as fractions of the source square. Lazy Lions are consistently
# framed, so one box works for the whole collection.
CROP = (0.11, 0.02, 0.89, 0.80)
TILE = 240
KEY = (1, 254, 3)   # sentinel for the flood fill; asserted absent below


def fetch(token_id: int, cid: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{token_id}.img")
    if os.path.exists(path) and os.path.getsize(path) > 100_000:
        return path
    for gw in GATEWAYS:
        subprocess.run(["curl", "-sSL", "--max-time", "120", "-o", path, f"{gw}/{cid}"],
                       capture_output=True)
        if os.path.exists(path) and os.path.getsize(path) > 100_000:
            return path
    raise RuntimeError(f"could not fetch token {token_id} ({cid})")


def build_tile(path: str):
    """Crop to the head, key the flat background out, return (RGBA tile, bg hex)."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    box = (int(CROP[0] * w), int(CROP[1] * h), int(CROP[2] * w), int(CROP[3] * h))
    head = im.crop(box)

    # Square it off so tiles share one aspect ratio.
    side = max(head.size)
    square = Image.new("RGB", (side, side), head.getpixel((1, 1)))
    square.paste(head, ((side - head.width) // 2, (side - head.height) // 2))

    # Key at 800px: large enough that the cut follows the linework, small enough
    # that the flood fill is quick. Downsampling afterwards anti-aliases the edge.
    work = square.resize((800, 800), Image.LANCZOS)
    bg = work.getpixel((3, 3))
    if bg == KEY:
        raise RuntimeError("sentinel colour collides with the artwork")

    # Flood from the border only. A global colour match would punch holes in any
    # part of the Lion that happens to share the background colour.
    draw_target = work.copy()
    for xy in [(0, 0), (799, 0), (0, 799), (799, 799),
               (400, 0), (400, 799), (0, 400), (799, 400)]:
        ImageDraw.floodfill(draw_target, xy, KEY, thresh=42)

    rgba = draw_target.convert("RGBA")
    px = rgba.load()
    for y in range(800):
        for x in range(800):
            if px[x, y][:3] == KEY:
                px[x, y] = (0, 0, 0, 0)

    tile = rgba.resize((TILE, TILE), Image.LANCZOS)
    return tile, "#%02x%02x%02x" % bg


def to_data_uri(tile: Image.Image) -> str:
    buf = io.BytesIO()
    tile.save(buf, format="WEBP", quality=88, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    owned = json.load(open(OWNED))
    tokens = owned["owned_tokens"]
    out = {}
    total = 0

    for sym, token_id, note in ASSIGNMENT:
        if str(token_id) not in tokens:
            print(f"REFUSING: token #{token_id} for {sym} is not owned by "
                  f"{owned['operator_wallet']}", file=sys.stderr)
            return 1
        meta = tokens[str(token_id)]
        path = fetch(token_id, meta["image"].replace("ipfs://", ""))
        tile, bg = build_tile(path)
        uri = to_data_uri(tile)
        total += len(uri)
        out[sym] = {"tokenId": token_id, "uri": uri, "bg": bg,
                    "traits": meta["traits"], "note": note}
        print(f"  {sym}  Lion #{token_id:<5} {len(uri)//1024:>4} KB  bg {bg}  {note}")

    # Low tier: gem glyphs coloured from real owned backgrounds (spec Sec. 6.3).
    # Derived palette, not reproduced art.
    seen, palette = set(), []
    for tok in tokens.values():
        bgname = tok["traits"].get("Background")
        if bgname and bgname not in seen:
            seen.add(bgname)
            palette.append(bgname)
    gems = palette[:4]

    payload = {
        "generatedBy": "tools/atlas-build/build-symbols.py",
        "operator": owned["operator_wallet"],
        "symbols": out,
        "gemBackgrounds": gems,
    }
    block = "/* @@@SYMBOL_ART@@@ */\nconst SYMBOL_ART=" + json.dumps(payload) + ";\n"

    page = open(PAGE).read()
    start = page.find("/* @@@SYMBOL_ART@@@ */")
    end = page.find("/* @@@SYMBOL_ART_END@@@ */")
    if start == -1 or end == -1:
        print("PAGE MISSING MARKERS: add /* @@@SYMBOL_ART@@@ */ and "
              "/* @@@SYMBOL_ART_END@@@ */ to play/index.html", file=sys.stderr)
        return 2
    page = page[:start] + block + page[end:]
    open(PAGE, "w").write(page)

    print(f"\ninjected {len(out)} symbol tiles ({total//1024} KB of data URIs) into {PAGE}")
    print(f"gem palette from owned backgrounds: {', '.join(gems)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
