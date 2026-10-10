#!/usr/bin/env python3
"""
Hi/Lo deck art (spec Sec. 7.3, OWNED deck mode).

Rarity Hi/Lo is a game *about* NFTs, so the OWNED deck should show the actual
NFT rather than a bare number. This builds a small keyed tile for every Lion the
operator holds and injects them into play/index.html.

Ordering caveat, deliberately surfaced in the UI rather than hidden: true
rarity ordinals require per-trait counts over the FULL 10,078-token collection
(`ingest.py --full-collection`), which has not been run. Ordering here is by
token id and is labelled provisional. It does not affect the odds -- Hi/Lo's
probabilities are purely positional, so only which portrait appears at each
ordinal is provisional, never the payout.

  python3 tools/atlas-build/build-deck.py
"""

import base64
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFile

Image.MAX_IMAGE_PIXELS = None
ImageFile.LOAD_TRUNCATED_IMAGES = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OWNED = os.path.join(ROOT, "tools", "trait-ingest", "data", "owned_traits.json")
CACHE = os.path.join(HERE, "cache")
PAGE = os.path.join(ROOT, "play", "index.html")

CROP = (0.09, 0.01, 0.91, 0.83)
TILE = 150
KEY = (1, 254, 3)


def tile_for(path: str):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    head = im.crop((int(CROP[0]*w), int(CROP[1]*h), int(CROP[2]*w), int(CROP[3]*h)))
    side = max(head.size)
    sq = Image.new("RGB", (side, side), head.getpixel((1, 1)))
    sq.paste(head, ((side-head.width)//2, (side-head.height)//2))
    work = sq.resize((520, 520), Image.LANCZOS)
    if work.getpixel((3, 3)) == KEY:
        raise RuntimeError("sentinel collides with artwork")
    for xy in [(0,0),(519,0),(0,519),(519,519),(260,0),(260,519),(0,260),(519,260)]:
        ImageDraw.floodfill(work, xy, KEY, thresh=42)
    rgba = work.convert("RGBA")
    px = rgba.load()
    for y in range(520):
        for x in range(520):
            if px[x, y][:3] == KEY:
                px[x, y] = (0, 0, 0, 0)
    buf = io.BytesIO()
    rgba.resize((TILE, TILE), Image.LANCZOS).save(buf, format="WEBP", quality=76, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    owned = json.load(open(OWNED))
    tokens = owned["owned_tokens"]
    ids = sorted(int(k) for k in tokens)

    deck, missing, total = [], 0, 0
    for tid in ids:
        path = os.path.join(CACHE, f"{tid}.img")
        if not os.path.exists(path) or os.path.getsize(path) < 100_000:
            missing += 1
            continue
        try:
            uri = tile_for(path)
        except Exception as exc:                      # keep going; a gap is survivable
            print(f"  #{tid}: {exc}", file=sys.stderr)
            missing += 1
            continue
        total += len(uri)
        t = tokens[str(tid)]["traits"]
        deck.append({"id": tid, "uri": uri,
                     "mane": t.get("Mane"), "bg": t.get("Background"),
                     "head": t.get("Headgear")})
        print(f"  #{tid}  {len(uri)//1024} KB")

    page = open(PAGE).read()
    start = page.find("/* @@@DECK_ART@@@ */")
    end = page.find("/* @@@DECK_ART_END@@@ */")
    if start == -1 or end == -1:
        print("PAGE MISSING DECK MARKERS", file=sys.stderr)
        return 2
    block = ("/* @@@DECK_ART@@@ */\nconst DECK_ART=" +
             json.dumps({"orderedBy": "tokenId (provisional -- true rarity needs "
                                      "the full-collection ingest)",
                         "cards": deck}) + ";\n")
    open(PAGE, "w").write(page[:start] + block + page[end:])
    print(f"\ninjected {len(deck)} deck cards ({total//1024} KB), {missing} missing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
